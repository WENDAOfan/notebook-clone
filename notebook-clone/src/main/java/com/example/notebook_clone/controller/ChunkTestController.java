package com.example.notebook_clone.controller;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.service.DocumentChunkService;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Day 28 测试控制器
 *
 * 用于手动触发文档分块和验证向量相似度搜索，方便开发调试。
 * 正式上线后可以删除此类。
 */
@RestController
@RequestMapping("/test/chunk")
public class ChunkTestController {

    private final DocumentChunkService documentChunkService;
    private final VectorStore vectorStore;

    public ChunkTestController(DocumentChunkService documentChunkService, VectorStore vectorStore) {
        this.documentChunkService = documentChunkService;
        this.vectorStore = vectorStore;
    }

    /**
     * 手动触发文档分块并向量化
     * 用法：GET /test/chunk/1  （对文档 ID=1 执行分块）
     */
    @GetMapping("/{documentId}")
    public Result<String> triggerChunk(@PathVariable Long documentId) {
        documentChunkService.chunkAndStoreAsync(documentId);
        return Result.success("分块任务已提交，请查看控制台日志确认完成");
    }

    /**
     * 测试向量相似度搜索
     * 用法：GET /test/chunk/search?query=什么是Spring&topK=3
     *
     * @param query 查询文本
     * @param topK  返回最相似的 K 个分块（默认 3）
     */
    @GetMapping("/search")
    public Result<List<Map<String, Object>>> search(
            @RequestParam String query,
            @RequestParam(defaultValue = "3") int topK) {

        if (query == null || query.trim().isEmpty()) {
            return Result.fail("查询内容不能为空");
        }

        List<org.springframework.ai.document.Document> results =
                vectorStore.similaritySearch(SearchRequest.builder()
                        .query(query)
                        .topK(topK)
                        .build());

        List<Map<String, Object>> response = results.stream()
                .map(doc -> Map.<String, Object>of(
                        "text", doc.getText().length() > 200
                                ? doc.getText().substring(0, 200) + "..."
                                : doc.getText(),
                        "metadata", doc.getMetadata(),
                        "score", doc.getScore() != null ? doc.getScore() : -1.0
                ))
                .collect(Collectors.toList());

        return Result.success(response);
    }
}
