package com.example.notebook_clone.controller;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.repository.NotebookRepository;
import com.example.notebook_clone.repository.UserRepository;
import com.example.notebook_clone.service.RetrievalService;
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 只为自动化评测暴露真实检索上下文。
 *
 * 该 Controller 在默认生产 Profile 中不会注册；即使在 eval/test Profile 中，
 * 请求也仍然经过项目原有的 JWT 安全链和资源归属校验。
 */
@RestController
@Profile({"eval", "test"})
@RequestMapping("/api/eval")
public class EvalRetrievalController {

    private static final int DEFAULT_TOP_K = 5;
    private static final int MAX_TOP_K = 20;

    private final UserRepository userRepository;
    private final DocumentRepository documentRepository;
    private final NotebookRepository notebookRepository;
    private final RetrievalService retrievalService;

    public EvalRetrievalController(UserRepository userRepository,
                                   DocumentRepository documentRepository,
                                   NotebookRepository notebookRepository,
                                   RetrievalService retrievalService) {
        this.userRepository = userRepository;
        this.documentRepository = documentRepository;
        this.notebookRepository = notebookRepository;
        this.retrievalService = retrievalService;
    }

    @PostMapping("/retrieval")
    public Result<List<RetrievalChunkResponse>> retrieve(@RequestBody RetrievalRequest request) {
        if (request.question() == null || request.question().isBlank()) {
            return Result.fail("问题不能为空");
        }
        if (request.targetId() == null || request.targetId() <= 0) {
            return Result.fail("targetId 必须是正整数");
        }

        String username = SecurityContextHolder.getContext().getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        int topK = normalizeTopK(request.topK());

        List<RetrievalService.RetrievedChunk> chunks;
        if ("document".equalsIgnoreCase(request.targetType())) {
            // 使用带 userId 的查询完成归属校验，越权时不会触碰向量库。
            documentRepository.findByIdAndUserId(request.targetId(), currentUser.getId())
                    .orElseThrow(() -> new RuntimeException("文档不存在或无权访问"));
            chunks = retrievalService.retrieveDocumentChunks(request.question(), request.targetId(), topK);
        } else if ("notebook".equalsIgnoreCase(request.targetType())) {
            notebookRepository.findByIdAndUserId(request.targetId(), currentUser.getId())
                    .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));
            chunks = retrievalService.retrieveNotebookChunks(request.question(), request.targetId(), topK);
        } else {
            return Result.fail("targetType 只支持 document 或 notebook");
        }

        List<RetrievalChunkResponse> response = chunks.stream()
                .map(chunk -> new RetrievalChunkResponse(
                        chunk.rank(), chunk.text(), chunk.documentId(), chunk.documentTitle()))
                .toList();
        return Result.success(response);
    }

    private int normalizeTopK(Integer requestedTopK) {
        if (requestedTopK == null) {
            return DEFAULT_TOP_K;
        }
        return Math.max(1, Math.min(requestedTopK, MAX_TOP_K));
    }

    public record RetrievalRequest(String targetType, Long targetId, String question, Integer topK) {
    }

    /** 只返回评测所需字段，不返回 embedding、用户信息或配置。 */
    public record RetrievalChunkResponse(int rank, String text, Long documentId, String documentTitle) {
    }
}
