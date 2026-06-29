package com.example.notebook_clone.controller;

import com.example.notebook_clone.entity.Notebook;
import com.example.notebook_clone.repository.NotebookRepository;

// @Valid 的意思就是："在把请求体转成 Java 对象时，
// 顺便检查一下字段上的校验注解"。如果校验不通过，Spring 会自动拦截并返回错误。
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.context.SecurityContextHolder;
import java.time.LocalDateTime;
import java.util.List;
import jakarta.validation.Valid;
import reactor.core.publisher.Flux;

import com.example.notebook_clone.common.Result;//返回值统一Result<T>
import com.example.notebook_clone.entity.User;           // ← 新增
import com.example.notebook_clone.repository.UserRepository; // ← 新增
//day22
import com.example.notebook_clone.dto.AskRequest;
import com.example.notebook_clone.entity.ChatMessage;  // Day 30 新增
import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.service.AiChatService;
import com.example.notebook_clone.service.ChatHistoryService;  // Day 30 新增
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;

@RestController
@RequestMapping("/api/notebooks") // 统一给这些接口加个前缀：/api/notebooks
public class NotebookController {

    // 把刚才建的“管家”请过来（依赖注入）
    private final NotebookRepository notebookRepository;
    private final UserRepository userRepository;  // ← 新增
    private final DocumentRepository documentRepository;
    private final AiChatService aiChatService;
    private final ChatHistoryService chatHistoryService;  // Day 30 新增
    public NotebookController(NotebookRepository notebookRepository,UserRepository userRepository,DocumentRepository documentRepository,AiChatService aiChatService,ChatHistoryService chatHistoryService) {
        this.notebookRepository = notebookRepository;
        this.userRepository = userRepository;
        this.documentRepository = documentRepository; 
        this.aiChatService = aiChatService;
        this.chatHistoryService = chatHistoryService;  // Day 30 新增
    }

    // 接口 1：查看所有笔记本 (GET 请求)
    @GetMapping
    public Result<List<Notebook>> getAllNotebooks() {
        // 直接调用管家的 findAll() 方法，连 SQL 都不用写！
        String username = SecurityContextHolder.getContext()//获取 Security 上下文
                .getAuthentication().getName();//获取当前认证信息，获取用户名
        // 2. 查询用户实体
        User currentUser = userRepository.findByUsername(username)//根据用户名查用户实体
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));        
        return Result.success(notebookRepository.findByUserId(currentUser.getId()));
    }

    // 接口 2：创建一个新笔记本 (POST 请求)
    @PostMapping
    public Result<Notebook> createNotebook(@Valid @RequestBody Notebook notebook) {
        notebook.setId(null);  // 防止客户端传 id 覆盖已有笔记本（Mass Assignment 防护）

        // ===== Day 15：自动关联当前登录用户 =====
        // 1. 从 SecurityContext 获取当前登录用户名
        String username = SecurityContextHolder.getContext()//获取 Security 上下文
                .getAuthentication().getName();//获取当前认证信息，获取用户名
        
        // 2. 查询用户实体
        User currentUser = userRepository.findByUsername(username)//根据用户名查用户实体
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        
        // 3. 设置关联
        notebook.setUser(currentUser);
        // =========================================
        
        notebook.setCreateTime(LocalDateTime.now());
        return Result.success(notebookRepository.save(notebook));
    }

    // 接口 3：修改笔记本的名称或描述 (PUT 请求，专门用于修改)
    // 路径例如：/api/notebooks/1 (代表修改 ID 为 1 的笔记本)
    @PutMapping("/{id}")
    public Result<Notebook> updateNotebook(@PathVariable Long id, 
                                        @Valid @RequestBody Notebook updatedNotebook) {
        // Day 16 预告：这里还应该检查当前用户是否有权限修改这个笔记本！
        //获取当前用户
        String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)//根据用户名查用户实体
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        //查笔记本，同时校验
        Notebook existingNotebook = notebookRepository
                .findByIdAndUserId(id, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权操作"));
                    
        // 3. 修改字段
        existingNotebook.setName(updatedNotebook.getName());
        existingNotebook.setDescription(updatedNotebook.getDescription());

        return Result.success(notebookRepository.save(existingNotebook));
    }

    // 接口 4：把整个笔记本扔进垃圾桶 (DELETE 请求)
    @DeleteMapping("/{id}")
    public Result<Void> deleteNotebook(@PathVariable Long id) {
        //获取当前用户
        String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
        User currentUser = userRepository
            .findByUsername(username)
            .orElseThrow(()->new RuntimeException("用户不存在: " + username));
        // 2. 校验归属
        Boolean exists = notebookRepository.existsByIdAndUserId(id, currentUser.getId());
        if (!exists) {
        throw new RuntimeException("笔记本不存在或无权删除");
            }
        // 3. 校验通过，删除
        // Day 30：清空该笔记本的对话历史
        chatHistoryService.clearNotebookHistory(id, currentUser.getId());
        notebookRepository.deleteById(id);
        return Result.success(null);
        
    }
    //接口5：让用户可以对整个笔记本提问
    @PostMapping("/{id}/ask")
    public Result<String> askNotebook(@PathVariable Long id,@RequestBody AskRequest request) {
        // 1. .trim()参数校验过滤纯空格或空字符串
        if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
            return Result.fail("问题不能为空");
        }
        // 2. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        // 3. 查询笔记本并校验归属（数据隔离！）
        Notebook notebook = notebookRepository.findByIdAndUserId(id, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));
        // 4. 获取该笔记本下的所有文档
        List<Document> documents = documentRepository.findByNotebook_Id(id);
        // 5. 构建 [标题, 内容] 列表
        List<String[]> docList = documents.stream()//将 documents 列表(类型是 List<Document>)转换为流,可以逐个处理每个元素。
                .map(doc -> new String[]{doc.getTitle(), doc.getContent()})//对流中的每个 Document 对象进行转换
                .toList();//将流收集为不可变的 List<String[]>。
        //doc 是 lambda 表达式中的参数,代表流中的每一个 Document 实体对象。.map(doc -> ...): 对流的每个元素执行转换操作
        // 6. 调用 AI 基于多篇文档回答（Day 30：传入 notebookId 和 userId 用于对话历史）
        String answer = aiChatService.askBasedOnDocuments(
                docList,
                request.getQuestion(),
                id,
                currentUser.getId()
        );
        return Result.success(answer);
    }
    @GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8")
    public Flux<ServerSentEvent<String>> askNotebookStream(
            @PathVariable Long id,
            @RequestParam String question) {
        
        // 1. question 空校验
        if (question == null || question.trim().isEmpty()) {
            return Flux.just(ServerSentEvent.<String>builder().data("问题不能为空").build());
        }
        
        // 2. 获取当前用户（copy 同步方法的 121-124 行）
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        // 3. 查询笔记本并校验归属（copy 同步方法的 126-127 行）
        Notebook notebook = notebookRepository.findByIdAndUserId(id, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));
        //多判一次不会出错，只是多写了一行
        if (!notebook.getUser().getId().equals(currentUser.getId())) {
            return Flux.just(ServerSentEvent.<String>builder().data("无权访问该文档").build());
        }
        // 4. 获取该笔记本下的所有文档，转成 List<String[]>（copy 同步方法的 129-133 行）
        List<Document> documents = documentRepository.findByNotebook_Id(id);
        List<String[]> docList = documents.stream()//将 documents 列表(类型是 List<Document>)转换为流,可以逐个处理每个元素。
                .map(doc -> new String[]{doc.getTitle(), doc.getContent()})//对流中的每个 Document 对象进行转换
                .toList();//将流收集为不可变的 List<String[]>。
        // 5. 调用 aiChatService.askBasedOnDocumentsStream(docList, question)（Day 30：传入 notebookId 和 userId 用于对话历史）
        return aiChatService.askBasedOnDocumentsStream(
                docList,
                question,
                id,
                currentUser.getId()
        );
    }

    // ===== Day 30 新增：对话历史查询/清空接口 =====

    /**
     * 查询某个笔记本的对话历史
     */
    @GetMapping("/{id}/chat/history")
    public Result<List<ChatMessage>> getChatHistory(@PathVariable Long id) {
        // 1. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

        // 2. 校验笔记本归属
        notebookRepository.findByIdAndUserId(id, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));

        // 3. 返回对话历史
        String sessionId = chatHistoryService.buildNotebookSessionId(id, currentUser.getId());
        return Result.success(chatHistoryService.getHistory(sessionId));
    }

    /**
     * 清空某个笔记本的对话历史
     */
    @DeleteMapping("/{id}/chat/history")
    public Result<Void> clearChatHistory(@PathVariable Long id) {
        // 1. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

        // 2. 校验笔记本归属
        Boolean exists = notebookRepository.existsByIdAndUserId(id, currentUser.getId());
        if (!exists) {
            throw new RuntimeException("笔记本不存在或无权操作");
        }

        // 3. 清空历史
        chatHistoryService.clearNotebookHistory(id, currentUser.getId());
        return Result.success(null);
    }
}
