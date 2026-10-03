package com.example.notebook_clone.config;

import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.service.RetrievalService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.pgvector.PgVectorStore;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.PropertiesPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/** 显式开启才调用真实智谱 Embedding API；临时向量在 finally 中删除，不调用 Chat 模型。 */
@EnabledIfEnvironmentVariable(named = "PGVECTOR_LIVE_EMBEDDING", matches = "true")
class PgVectorLiveEmbeddingTests {
    @Test
    void productionEmbeddingCanSearchMigratedVectorsAndIndexNewText() throws Exception {
        Properties properties = new Properties();
        try (Reader reader = Files.newBufferedReader(Path.of("src/main/resources/application.properties"))) {
            properties.load(reader);
        }
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().getPropertySources()
                    .addLast(new PropertiesPropertySource("local-config", properties));
            var environment = context.getEnvironment();
            var jdbc = new JdbcTemplate(new DriverManagerDataSource(
                    environment.getProperty("spring.datasource.url"),
                    environment.getProperty("spring.datasource.username"),
                    environment.getProperty("spring.datasource.password")));
            context.registerBean(JdbcTemplate.class, () -> jdbc);
            context.register(VectorStoreConfig.class);
            context.refresh();
            var store = context.getBean(PgVectorStore.class);
            var retrieval = new RetrievalService(store, mock(DocumentRepository.class));
            Long existingId = jdbc.queryForObject(
                    "SELECT min(id) FROM document WHERE chunk_count > 0", Long.class);
            assertNotNull(existingId, "需要至少一篇已迁移或已索引文档");
            var migrated = retrieval.retrieveDocumentChunks("请概括这篇文档的主要内容", existingId, 3);
            assertFalse(migrated.isEmpty());
            assertTrue(migrated.stream().allMatch(chunk -> existingId.equals(chunk.documentId())));

            String id = "pgvector-live-test:" + UUID.randomUUID();
            long documentId = -Math.abs(System.nanoTime());
            try {
                store.add(List.of(new Document(id,
                        "pgvector 将向量保存到 PostgreSQL，支持余弦相似度检索。",
                        Map.of("documentId", documentId, "documentTitle", "临时接入验证"))));
                assertEquals(2048, jdbc.queryForObject(
                        "SELECT vector_dims(embedding) FROM vector_store WHERE id=?", Integer.class, id));
                var results = retrieval.retrieveDocumentChunks("pgvector 如何存储和检索向量？", documentId, 3);
                assertEquals(1, results.size());
                assertEquals(documentId, results.getFirst().documentId());
            } finally {
                store.delete(List.of(id));
            }
            assertEquals(0, jdbc.queryForObject(
                    "SELECT count(*) FROM vector_store WHERE id=?", Integer.class, id));
        }
    }
}
