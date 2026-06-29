package com.example.notebook_clone.controller;

import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.repository.UserRepository;
import com.example.notebook_clone.service.AiChatService;
import com.example.notebook_clone.service.AiSummaryService;
import com.example.notebook_clone.service.AsyncSummaryService;
import com.example.notebook_clone.service.ChatHistoryService;  // Day 30 新增
import com.example.notebook_clone.service.DocumentExtractService;
import com.example.notebook_clone.service.DocumentChunkService;  // Day 28 新增
import com.example.notebook_clone.entity.ChatMessage;  // Day 30 新增

import org.springframework.security.core.context.SecurityContextHolder;

import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.entity.Notebook;
import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.repository.NotebookRepository;


import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import jakarta.validation.Valid;
import reactor.core.publisher.Flux;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.dto.AskRequest;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;


@RestController
@RequestMapping("/api/documents") 
public class DocumentController {

    private final DocumentRepository documentRepository;
    private final NotebookRepository notebookRepository;
    private final UserRepository userRepository;  // Day 15 新增
    private final DocumentExtractService extractService;  // Day 16.5 新增
    private final AiSummaryService aiSummaryService;  // ← Day 20 新增
    private final AiChatService aiChatService;//← Day 21 新增
    private final AsyncSummaryService asyncSummaryService; //← Day 25 新增
    private final DocumentChunkService documentChunkService; //← Day 28 新增
    private final ChatHistoryService chatHistoryService; //← Day 30 新增
    public DocumentController(DocumentRepository documentRepository, NotebookRepository notebookRepository,UserRepository userRepository,DocumentExtractService extractService,AiSummaryService aiSummaryService,AiChatService aiChatService,AsyncSummaryService asyncSummaryService,DocumentChunkService documentChunkService,ChatHistoryService chatHistoryService) {
        this.documentRepository = documentRepository;
        this.notebookRepository = notebookRepository;
        this.userRepository = userRepository; 
        this.extractService = extractService;  // 新增赋值
        this.aiSummaryService = aiSummaryService;
        this.aiChatService = aiChatService;
        this.asyncSummaryService = asyncSummaryService;
        this.documentChunkService = documentChunkService;  // Day 28 新增
        this.chatHistoryService = chatHistoryService;  // Day 30 新增
    }

    // 接口 1：往笔记本里添加一份新文档 (POST 请求)
@PostMapping
public Result<Document> createDocument(@Valid @RequestBody Document document, @RequestParam Long notebookId) {
    document.setId(null);  // 防止客户端传 id 覆盖已有文档（Mass Assignment 防护）
    // ===== Day 15：自动关联当前登录用户 =====
    // 1. 从 SecurityContext 获取当前登录用户名
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    
    // 2. 查询用户实体并设置关联
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
    // 3. 查询并设置笔记本
    Notebook notebook = notebookRepository.findByIdAndUserId(notebookId,currentUser.getId())
            .orElseThrow(() -> new RuntimeException("笔记本不存在或无权操作"));
    document.setNotebook(notebook);
    
    
    document.setUser(currentUser);
    // =========================================
    
    document.setCreateTime(LocalDateTime.now());
    return Result.success(documentRepository.save(document));
}
    // 接口 2：查看某个特定笔记本下的所有文档 (GET 请求)
    // 路径会变成类似 /api/documents/notebook/1 (查询 ID 为 1 的笔记本下的文档)
    @GetMapping("/notebook/{notebookId}")
    public Result<List<Document>> getDocumentsByNotebook(@PathVariable Long notebookId) {
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

        // 2. 校验笔记本归属（门禁！）
        notebookRepository.findByIdAndUserId(notebookId, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));

        // 调用我们刚才在 Repository 里写的魔法方法！
        return Result.success(documentRepository.findByNotebook_Id(notebookId));
    }
    // 接口 3：上传文件并自动提取文字 (POST 请求)
    @PostMapping("/upload")
    public Result<Document> uploadDocumentFile(
            @RequestParam("notebookId") Long notebookId,
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "additionalContent", required = false) String additionalContent
    ) {
        try {
            String fileName = file.getOriginalFilename();

            String extractedText = extractService.extractText(file);

            // Day 27：合并用户手动输入 + 文件提取文本
            String finalContent = mergeContent(extractedText, additionalContent);

            Document document = new Document();
            String username = SecurityContextHolder.getContext()
                    .getAuthentication().getName();
            User currentUser = userRepository.findByUsername(username)
                    .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
            Notebook notebook = notebookRepository.findByIdAndUserId(notebookId, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权操作"));
            
            document.setNotebook(notebook);
            document.setUser(currentUser);
            notebook.getDocuments().add(document);
            document.setTitle(fileName);
            document.setContent(finalContent);
            document.setCreateTime(LocalDateTime.now());
            document.setSummary("摘要生成中...");
            Document saved = documentRepository.save(document);
            asyncSummaryService.generateSummaryAsync(saved.getId());
            documentChunkService.chunkAndStoreAsync(saved.getId());  // Day 28：异步分块并向量化
            return Result.success(saved);

        } catch (Exception e) {
            throw new RuntimeException("文件上传失败: " + e.getMessage());
        }
    }

    /**
     * 合并用户手动输入内容和文件提取文本
     * 手动内容在前（笔记/备注），文件文本在后（原始材料），用分隔符连接
     */
    private String mergeContent(String fileText, String additionalContent) {
        if (additionalContent == null || additionalContent.isBlank()) {
            return fileText;
        }
        return additionalContent.trim() + "\n\n---\n\n" + fileText;
    }
    // 接口 4：撕毁某一张特定的资料纸 (DELETE 请求)
    // 路径例如：/api/documents/1 (代表删除 ID 为 1 的文档)
    @DeleteMapping("/{id}")
    public Result<Void> deleteDocument(@PathVariable Long id) {
        //获取当前用户
        String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
        User currentUser = userRepository
            .findByUsername(username)
            .orElseThrow(()->new RuntimeException("用户不存在: " + username));
        // 2. 校验归属
        Boolean exists = documentRepository.existsByIdAndUserId(id, currentUser.getId());
        if (!exists) {
        throw new RuntimeException("文档不存在或无权删除");
            }
        // 3. 校验通过，删除
        // Day 29：先清理向量库中的分块（再删数据库文档）
        documentChunkService.deleteDocumentChunks(id);
        // Day 30：清空该文档的对话历史
        chatHistoryService.clearDocHistory(id, currentUser.getId());
        documentRepository.deleteById(id);
        return Result.success(null);
    }
    @GetMapping("/{id}")
        public Result<Document> getDocument(@PathVariable Long id) {
        // 1. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

        // 2. 查询文档并校验归属
        Document document = documentRepository.findByIdAndUserId(id, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("文档不存在或无权访问"));

        // 3. 返回文档（包含summary字段）
        return Result.success(document);
        }

    /**
     * 为已有文档生成/重新生成 AI 摘要
     */
    @PostMapping("/{id}/summary")
    public Result<Document> generateSummary(@PathVariable Long id) {
        // 1. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

        // 2. 查询文档并校验归属（数据隔离！）
        Document document = documentRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("文档不存在"));
        //文档归属校验
        if (!document.getUser().getId().equals(currentUser.getId())) {
            throw new RuntimeException("无权操作该文档");
        }

        // 3. 调用 AI 生成摘要
        String summary = aiSummaryService.generateSummary(document.getContent());
        document.setSummary(summary);

        // 4. 保存并返回
        return Result.success(documentRepository.save(document));
    }
    /**
     * 基于单个文档内容进行智能问答
     */
    @PostMapping("/{id}/ask")
    public Result<String> askDocument(@PathVariable Long id,
                                   @RequestBody AskRequest request) {
        // 1. .trim()参数校验过滤纯空格或空字符串
        if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
            return Result.fail("问题不能为空");
        }
        // 2. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        // 3. 查询文档并校验归属（数据隔离！）
        Document document = documentRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("文档不存在"));

        if (!document.getUser().getId().equals(currentUser.getId())) {
            throw new RuntimeException("无权访问该文档");
        }

        // 4. 传递开关状态（如果请求没传，默认为 true）
        boolean useDocumentContext = request.getUseDocumentContext() != null
                ? request.getUseDocumentContext()
                : true;

        // 5. 调用 AI 基于文档内容回答问题（Day 30：传入 documentId 和 userId 用于对话历史）
        String answer = aiChatService.askBasedOnDocument(
                document.getContent(),
                request.getQuestion(),
                useDocumentContext,
                id,
                currentUser.getId()
        );
        return Result.success(answer);
    }
    @GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8")
    public Flux<ServerSentEvent<String>> askDocumentStream(
            @PathVariable Long id,
            @RequestParam String question,
            @RequestParam(defaultValue = "true") boolean useDocumentContext) {
        
        // 1. 参数校验
        if (question == null || question.trim().isEmpty()) {
            return Flux.just(ServerSentEvent.<String>builder().data("问题不能为空").build());
        }
        
        // 2. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        
        // 3. 查询文档并校验归属
        Document document = documentRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("文档不存在"));
        if (!document.getUser().getId().equals(currentUser.getId())) {
            return Flux.just(ServerSentEvent.<String>builder().data("无权访问该文档").build());
        }
        
        // 4. 调用流式 Service 方法（Day 30：传入 documentId 和 userId 用于对话历史）
        return aiChatService.askBasedOnDocumentStream(
                document.getContent(),
                question,
                useDocumentContext,
                id,
                currentUser.getId()
        );
    }

    // ===== Day 30 新增：对话历史查询/清空接口 =====

    /**
     * 查询某个文档的对话历史
     */
    @GetMapping("/{id}/chat/history")
    public Result<List<ChatMessage>> getChatHistory(@PathVariable Long id) {
        // 1. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

        // 2. 校验文档归属
        Boolean exists = documentRepository.existsByIdAndUserId(id, currentUser.getId());
        if (!exists) {
            throw new RuntimeException("文档不存在或无权访问");
        }

        // 3. 返回对话历史
        String sessionId = chatHistoryService.buildDocSessionId(id, currentUser.getId());
        return Result.success(chatHistoryService.getHistory(sessionId));
    }

    /**
     * 清空某个文档的对话历史
     */
    @DeleteMapping("/{id}/chat/history")
    public Result<Void> clearChatHistory(@PathVariable Long id) {
        // 1. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

        // 2. 校验文档归属
        Boolean exists = documentRepository.existsByIdAndUserId(id, currentUser.getId());
        if (!exists) {
            throw new RuntimeException("文档不存在或无权操作");
        }

        // 3. 清空历史
        chatHistoryService.clearDocHistory(id, currentUser.getId());
        return Result.success(null);
    }
}
