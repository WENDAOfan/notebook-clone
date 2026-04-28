package com.example.notebook_clone.controller;

import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.repository.UserRepository;
import com.example.notebook_clone.service.AiChatService;
import com.example.notebook_clone.service.AiSummaryService;
import com.example.notebook_clone.service.DocumentExtractService;

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
import java.nio.charset.StandardCharsets;
import java.io.IOException;
import jakarta.validation.Valid;
import reactor.core.publisher.Flux;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.dto.AskRequest;
import org.springframework.http.MediaType;


@RestController
@RequestMapping("/api/documents") 
public class DocumentController {

    private final DocumentRepository documentRepository;
    private final NotebookRepository notebookRepository;
    private final UserRepository userRepository;  // Day 15 新增
    private final DocumentExtractService extractService;  // Day 16.5 新增
    private final AiSummaryService aiSummaryService;  // ← Day 20 新增
    private final AiChatService aiChatService;//← Day 21 新增
    public DocumentController(DocumentRepository documentRepository, NotebookRepository notebookRepository,UserRepository userRepository,DocumentExtractService extractService,AiSummaryService aiSummaryService,AiChatService aiChatService) {
        this.documentRepository = documentRepository;
        this.notebookRepository = notebookRepository;
        this.userRepository = userRepository; 
        this.extractService = extractService;  // 新增赋值
        this.aiSummaryService = aiSummaryService;
        this.aiChatService = aiChatService;
    }

    // 接口 1：往笔记本里添加一份新文档 (POST 请求)
@PostMapping
public Result<Document> createDocument(@Valid @RequestBody Document document, @RequestParam Long notebookId) {
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
        Notebook notebook = notebookRepository.findByIdAndUserId(notebookId, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));

        // 调用我们刚才在 Repository 里写的魔法方法！
        return Result.success(documentRepository.findByNotebook_Id(notebookId));
    }
    // 接口 3：上传文件并自动提取文字 (POST 请求)
    @PostMapping("/upload")
    public Result<Document> uploadDocumentFile(
            @RequestParam("notebookId") Long notebookId, // 接收活页夹 ID
            @RequestParam("file") MultipartFile file     // 接收上传的文件
    ) {
        try {
            // 1. 获取文件的真实名字（比如：我的日记.txt）
            String fileName = file.getOriginalFilename();

            // 2. 🌟 核心魔法：把文件里的内容，按照 UTF-8 编码读取成一段超长的 Java 字符串
            //String extractedText = new String(file.getBytes(), StandardCharsets.UTF_8);
            //交给专业的 Service 去处理
            String extractedText = extractService.extractText(file);

            // 3. 把提取出来的文字，像之前一样存入数据库
            Document document = new Document();
            //改造后
            String username = SecurityContextHolder.getContext()
                    .getAuthentication().getName();
            User currentUser = userRepository.findByUsername(username)
                    .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
            Notebook notebook = notebookRepository.findByIdAndUserId(notebookId, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权操作"));
            
            // // 把注释掉的 setNotebookId 改成：
            document.setNotebook(notebook);
            
            document.setUser(currentUser);
            // =========================================
            notebook.getDocuments().add(document); // 同步双向关联
            document.setTitle(fileName);
            document.setContent(extractedText); // 把提取出来的几万字塞进去
            document.setCreateTime(LocalDateTime.now());
            // ===== Day 20 新增：自动生成摘要 =====
            // 注意：这是同步调用，会阻塞 2~5 秒！
            String summary = aiSummaryService.generateSummary(extractedText);
            document.setSummary(summary);
            // =====================================
            return Result.success(documentRepository.save(document));

        } catch (IOException e) {
            // 如果读取文件失败，程序不能崩溃，要抛出异常报错
            throw new RuntimeException("文件读取失败了！" + e.getMessage());
        }
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
        documentRepository.deleteById(id);
        return Result.success(null);
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

        // 5. 调用 AI 基于文档内容回答问题
        String answer = aiChatService.askBasedOnDocument(
                document.getContent(),
                request.getQuestion(),
                useDocumentContext
        );
        return Result.success(answer);
    }
    @GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8")
    public Flux<String> askDocumentStream(
            @PathVariable Long id,
            @RequestParam String question,
            @RequestParam(defaultValue = "true") boolean useDocumentContext) {
        
        // 1. 参数校验
        if (question == null || question.trim().isEmpty()) {
            return Flux.just("问题不能为空");
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
            return Flux.just("无权访问该文档");  // ← 流式要返回 Flux！
        }
        
        // 4. 调用流式 Service 方法
        return aiChatService.askBasedOnDocumentStream(
                document.getContent(),
                question,
                useDocumentContext
        );
    }
}
