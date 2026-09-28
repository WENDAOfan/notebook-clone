package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.repository.DocumentRepository;
import org.springframework.stereotype.Service;
import java.util.List;

/** 在 Controller 已校验资源归属后，为同步和流式问答统一准备证据。 */
@Service
public class RagContextService {
    private final DocumentRepository documents;
    private final RetrievalService retrieval;

    public RagContextService(DocumentRepository documents, RetrievalService retrieval) {
        this.documents = documents;
        this.retrieval = retrieval;
    }

    public Context document(Long id, String question) {
        Document document = documents.findById(id).orElse(null);
        if (document == null) return stop("文档不存在，无法回答问题。");
        if (empty(document)) return stop("文档内容为空，无法回答问题。");
        String status = status(List.of(document));
        if (status != null) return stop(status);
        return evidence(retrieval.retrieveDocumentChunks(question, id, 5));
    }

    public Context notebook(Long id, String question) {
        List<Document> all = documents.findByNotebook_Id(id);
        if (all.isEmpty()) return stop("该笔记本下没有文档，无法回答问题。");
        List<Document> nonEmpty = all.stream().filter(d -> !empty(d)).toList();
        if (nonEmpty.isEmpty()) return stop("该笔记本下的文档内容均为空，无法回答问题。");
        // 完整笔记本问答不静默忽略尚未就绪的非空文档。
        String status = status(nonEmpty);
        if (status != null) return stop(status);
        return evidence(retrieval.retrieveNotebookChunks(question, id, 8));
    }

    private boolean empty(Document document) {
        return document.getContent() == null || document.getContent().isBlank();
    }

    private String status(List<Document> documents) {
        if (documents.stream().anyMatch(d -> d.getChunkCount() != null && d.getChunkCount() < 0))
            return "存在文档索引失败，暂时无法基于文档回答，请检查索引状态。";
        if (documents.stream().anyMatch(d -> d.getChunkCount() == null || d.getChunkCount() == 0))
            return "文档索引尚未就绪，暂时无法基于文档回答，请确认索引完成。";
        return null;
    }

    private Context evidence(List<RetrievalService.RetrievedChunk> chunks) {
        List<String> texts = chunks.stream()
                .filter(c -> c.text() != null && !c.text().isBlank())
                .map(RetrievalService.RetrievedChunk::formattedText).toList();
        if (texts.isEmpty()) return stop("根据文档内容，无法找到相关答案。");
        return new Context(String.join("\n\n---\n\n", texts), null);
    }

    private Context stop(String message) { return new Context("", message); }

    /** message 非空表示直接返回提示，禁止继续调用模型。 */
    public record Context(String text, String message) {}
}
