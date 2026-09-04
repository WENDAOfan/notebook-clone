package com.example.notebook_clone.service;

import com.example.notebook_clone.repository.DocumentRepository;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.filter.Filter;
import org.springframework.ai.vectorstore.filter.FilterExpressionBuilder;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * RAG 检索职责的统一入口。
 *
 * 问答服务和评测接口复用同一段检索代码，避免评测看到的上下文与真实问答不一致。
 */
@Service
public class RetrievalService {

    private final VectorStore vectorStore;
    private final DocumentRepository documentRepository;

    public RetrievalService(VectorStore vectorStore, DocumentRepository documentRepository) {
        this.vectorStore = vectorStore;
        this.documentRepository = documentRepository;
    }

    /** 只检索某一篇文档的分块。 */
    public List<RetrievedChunk> retrieveDocumentChunks(String question, Long documentId, int topK) {
        Filter.Expression filter = new FilterExpressionBuilder()
                .eq("documentId", documentId)
                .build();
        return retrieve(question, topK, filter);
    }

    /** 只检索某个笔记本所属文档的分块。 */
    public List<RetrievedChunk> retrieveNotebookChunks(String question, Long notebookId, int topK) {
        List<Long> documentIds = documentRepository.findIdsByNotebookId(notebookId);
        if (documentIds == null || documentIds.isEmpty()) {
            return List.of();
        }
        Filter.Expression filter = new FilterExpressionBuilder()
                .in("documentId", documentIds.toArray())
                .build();
        return retrieve(question, topK, filter);
    }

    private List<RetrievedChunk> retrieve(String question, int topK, Filter.Expression filter) {
        SearchRequest request = SearchRequest.builder()
                .query(question)
                .topK(topK)
                .filterExpression(filter)
                .build();
        List<Document> results = vectorStore.similaritySearch(request);

        List<RetrievedChunk> chunks = new ArrayList<>();
        for (int i = 0; i < results.size(); i++) {
            Document result = results.get(i);
            Object rawDocumentId = result.getMetadata().get("documentId");
            Long documentId = rawDocumentId instanceof Number number ? number.longValue() : null;
            String title = String.valueOf(
                    result.getMetadata().getOrDefault("documentTitle", "未知文档"));
            chunks.add(new RetrievedChunk(i + 1, result.getText(), documentId, title));
        }
        return chunks;
    }

    /** 单个检索结果；formattedText() 是传给现有 Prompt 的兼容格式。 */
    public record RetrievedChunk(int rank, String text, Long documentId, String documentTitle) {
        public String formattedText() {
            return "[%d] 来源：%s\n%s".formatted(rank, documentTitle, text);
        }
    }
}
