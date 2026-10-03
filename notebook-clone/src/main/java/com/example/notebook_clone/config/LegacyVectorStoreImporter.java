package com.example.notebook_clone.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.vectorstore.pgvector.PgVectorStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import lombok.extern.slf4j.Slf4j;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** 显式开启的一次性迁移：复用旧向量，不调用 Embedding，也不覆盖库中的新向量。 */
@Slf4j
@Component
@ConditionalOnProperty(name = "vector.store.import-file")
public class LegacyVectorStoreImporter implements ApplicationRunner {
    private static final Pattern CHUNK_ID = Pattern.compile("doc:(\\d+):chunk:(\\d+)");
    private final JdbcTemplate jdbc;
    private final String file;
    private final int dimensions;

    // 依赖 PgVectorStore，确保向量表已初始化，再运行迁移。
    public LegacyVectorStoreImporter(JdbcTemplate jdbc, PgVectorStore vectorStore,
            @Value("${vector.store.import-file}") String file,
            @Value("${vector.store.dimensions:2048}") int dimensions) {
        this.jdbc = jdbc;
        this.file = file;
        this.dimensions = dimensions;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) throws Exception {
        JsonNode root = new ObjectMapper().readTree(Path.of(file).toFile());
        List<LegacyChunk> chunks = parse(root, dimensions);
        int inserted = 0;
        int skipped = 0;
        for (LegacyChunk chunk : chunks) {
            Integer active = jdbc.queryForObject("""
                    SELECT count(*) FROM document
                    WHERE id = ? AND chunk_count > ?
                    """, Integer.class, chunk.documentId(), chunk.chunkIndex());
            if (active == null || active == 0) {
                skipped++;
                continue;
            }
            inserted += jdbc.update("""
                    INSERT INTO public.vector_store (id, content, metadata, embedding)
                    VALUES (?, ?, ?::jsonb, ?::vector)
                    ON CONFLICT (id) DO NOTHING
                    """, chunk.id(), chunk.text(), chunk.metadata(), chunk.embedding());
        }
        log.info("[pgvector 迁移] 文件条目={}，新增={}，无有效分块记录而跳过={}，已存在={}",
                chunks.size(), inserted, skipped, chunks.size() - inserted - skipped);
    }

    // 先验证整个文件，再执行写入；运行器事务保证数据库错误时整批回滚。
    static List<LegacyChunk> parse(JsonNode root, int dimensions) {
        if (root == null || !root.isObject()) {
            throw new IllegalArgumentException("旧向量文件必须是 JSON 对象");
        }
        List<LegacyChunk> chunks = new ArrayList<>();
        root.fields().forEachRemaining(entry -> {
            JsonNode row = entry.getValue();
            String id = row.path("id").asText();
            var matcher = CHUNK_ID.matcher(id);
            if (!entry.getKey().equals(id) || !matcher.matches()) {
                throw new IllegalArgumentException("旧向量 ID 格式无效");
            }
            long documentId = Long.parseLong(matcher.group(1));
            int chunkIndex = Integer.parseInt(matcher.group(2));
            JsonNode metadata = row.path("metadata");
            JsonNode metadataId = metadata.path("documentId");
            if (!metadata.isObject() || !metadataId.isIntegralNumber()
                    || metadataId.longValue() != documentId) {
                throw new IllegalArgumentException("向量元数据中的 documentId 与 ID 不一致");
            }
            JsonNode embedding = row.path("embedding");
            if (!embedding.isArray() || embedding.size() != dimensions) {
                throw new IllegalArgumentException("旧向量维度与 vector.store.dimensions 不一致");
            }
            for (JsonNode value : embedding) {
                if (!value.isNumber() || !Float.isFinite(value.floatValue())) {
                    throw new IllegalArgumentException("旧向量包含无效数字");
                }
            }
            if (!row.path("text").isTextual() || row.path("text").asText().isBlank()) {
                throw new IllegalArgumentException("旧向量缺少分块正文");
            }
            chunks.add(new LegacyChunk(id, row.path("text").asText(), metadata.toString(),
                    embedding.toString(), documentId, chunkIndex));
        });
        return chunks;
    }

    record LegacyChunk(String id, String text, String metadata, String embedding,
                       long documentId, int chunkIndex) { }
}
