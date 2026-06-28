package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.repository.DocumentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.SimpleVectorStore;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.File;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

/**
 * Day 28/29：文档分块 + 向量化服务
 *
 * 工作流程：
 *   文档上传 → 触发 chunkAndStoreAsync(documentId)
 *   → 从数据库读取文档内容
 *   → TokenTextSplitter 切分成块（512 Token / 块，50 Token 重叠）
 *   → 给每个块附加元数据（documentId、documentTitle）并设置唯一 ID
 *   → 存入 VectorStore（内部自动调智谱 Embedding API 生成向量）
 *   → 更新 document.chunkCount，方便删除时清理向量库
 *
 * 为什么用 @Async？
 *   分块 + 向量化比较耗时（尤其是长文档要调多次 Embedding API），
 *   不应该阻塞上传接口的响应。和 AsyncSummaryService 一样的思路。
 *
 * 注意：本类中 Spring AI 的 Document 使用全限定名 org.springframework.ai.document.Document，
 * 避免和项目的 Document 实体类重名。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DocumentChunkService {

    private final VectorStore vectorStore;
    private final DocumentRepository documentRepository;

    // 向量文件持久化路径（和 VectorStoreConfig 共用同一个配置项）
    @Value("${vector.store.file:vector-store.json}")
    private String vectorStoreFile;

    /**
     * 异步对文档进行分块并向量化存储
     * 在文档上传成功后调用，不阻塞上传响应
     *
     * @param documentId 文档 ID（从数据库重新读取，避免拿到过期数据）
     */
    @Async("aiTaskExecutor")
    public void chunkAndStoreAsync(Long documentId) {
        try {
            log.info("[分块] 开始处理文档 ID: {}", documentId);

            // 1. 从数据库重新读取文档（异步线程中的实体可能已过期）
            Document document = documentRepository.findById(documentId).orElse(null);
            if (document == null) {
                log.warn("[分块] 文档不存在，跳过 | ID: {}", documentId);
                return;
            }

            String content = document.getContent();
            if (content == null || content.isBlank()) {
                log.info("[分块] 文档内容为空，跳过 | 标题: {}", document.getTitle());
                return;
            }

            // 2. 分块：使用默认参数（512 Token / 块，50 Token 重叠）
            TokenTextSplitter splitter = new TokenTextSplitter();
            // Spring AI 的 Document 用全限定名，避免和实体类 Document 冲突
            org.springframework.ai.document.Document sourceDoc =
                    new org.springframework.ai.document.Document(content);
            List<org.springframework.ai.document.Document> chunks = splitter.apply(List.of(sourceDoc));

            // 3. 给每个块附加元数据（Day 29 检索时用来溯源）并设置唯一 ID
            List<org.springframework.ai.document.Document> enrichedChunks = IntStream.range(0, chunks.size())
                    .mapToObj(i -> {
                        org.springframework.ai.document.Document chunk = chunks.get(i);
                        Map<String, Object> metadata = new HashMap<>(chunk.getMetadata());
                        metadata.put("documentId", documentId);
                        metadata.put("documentTitle", document.getTitle());

                        String chunkId = buildChunkId(documentId, i);
                        return new org.springframework.ai.document.Document(
                                chunkId, chunk.getText(), metadata);
                    })
                    .collect(Collectors.toList());

            // 4. 存入向量存储（内部自动调 Embedding API 生成向量）
            vectorStore.add(enrichedChunks);

            // 4.5 持久化到文件（过渡方案：兜住重启丢失，pgvector 接入后可删除）
            if (vectorStore instanceof SimpleVectorStore simpleStore) {
                File file = new File(vectorStoreFile);
                simpleStore.save(file);
                log.info("[向量存储] 已保存到文件: {}", file.getAbsolutePath());
            }

            // 5. 更新文档的分块数量
            document.setChunkCount(enrichedChunks.size());
            documentRepository.save(document);

            log.info("[分块] 完成 | 文档: {} | 共 {} 块", document.getTitle(), enrichedChunks.size());

        } catch (Exception e) {
            log.error("[分块] 处理失败 | 文档 ID: {} | 错误: {}", documentId, e.getMessage(), e);
        }
    }

    /**
     * Day 29：删除指定文档在向量库中的所有块
     * 注意：仅对支持按 ID 删除的 VectorStore 有效。
     * SimpleVectorStore 支持 doDelete(List<String>)，生产环境可换 pgvector。
     *
     * @param documentId 文档 ID
     */
    public void deleteDocumentChunks(Long documentId) {
        try {
            Document document = documentRepository.findById(documentId).orElse(null);
            if (document == null) {
                log.warn("[向量清理] 文档不存在，跳过 | ID: {}", documentId);
                return;
            }

            Integer chunkCount = document.getChunkCount();
            if (chunkCount == null || chunkCount == 0) {
                log.info("[向量清理] 文档没有分块记录，跳过 | ID: {}", documentId);
                return;
            }

            List<String> chunkIds = IntStream.range(0, chunkCount)
                    .mapToObj(i -> buildChunkId(documentId, i))
                    .collect(Collectors.toList());

            vectorStore.delete(chunkIds);
            log.info("[向量清理] 已删除文档 {} 的 {} 个向量块", documentId, chunkCount);

        } catch (Exception e) {
            log.error("[向量清理] 失败 | 文档 ID: {} | 错误: {}", documentId, e.getMessage(), e);
        }
    }

    /**
     * Day 29：重新索引文档
     * 文档内容更新时调用：先删除旧块，再重新分块+向量化
     *
     * @param documentId 文档 ID
     */
    @Async("aiTaskExecutor")
    public void reindexDocument(Long documentId) {
        log.info("[重新索引] 开始 | 文档 ID: {}", documentId);
        deleteDocumentChunks(documentId);
        chunkAndStoreAsync(documentId);
        log.info("[重新索引] 任务已提交 | 文档 ID: {}", documentId);
    }

    /**
     * 构建块在向量库中的唯一 ID
     */
    private String buildChunkId(Long documentId, int chunkIndex) {
        return String.format("doc:%d:chunk:%d", documentId, chunkIndex);
    }
}
