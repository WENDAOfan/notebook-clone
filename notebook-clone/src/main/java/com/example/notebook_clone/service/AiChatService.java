package com.example.notebook_clone.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.model.ChatResponse;//替代 String 接收 AI 返回值，包含文本 + Token 信息
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.retry.annotation.Backoff;//@Retryable 的退避参数（等多久、间隔倍数）
import org.springframework.retry.annotation.Recover;//标记兜底方法——重试全部失败后自动调用
import org.springframework.retry.annotation.Retryable;//标记方法为可重试
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;//	HTTP 调用层的异常，作为重试触发条件
import reactor.core.publisher.Flux;  //day23"推送式"的数据流
import reactor.core.publisher.Mono;
import lombok.extern.slf4j.Slf4j;//Lombok 自动生成 log 对象，让你能写 log.info(...)

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

@Slf4j
@Service
public class AiChatService {

    private final ChatClient chatClient;
    private final RagContextService contextService;
    private final ChatHistoryService chatHistoryService;  // Day 30 新增：对话历史
    private final ContextCompressionService compressionService;  // Day 30.5 新增：上下文压缩

    public AiChatService(ChatClient.Builder chatClientBuilder, RagContextService contextService,
                         ChatHistoryService chatHistoryService,
                         ContextCompressionService compressionService) {
        this.chatClient = chatClientBuilder.build();
        this.contextService = contextService;
        this.chatHistoryService = chatHistoryService;
        this.compressionService = compressionService;
    }
    /**
     * 基于单个文档内容回答用户问题（Day 30：带上对话历史实现多轮对话）
     *
     * @param documentContent    文档内容
     * @param question           用户问题
     * @param useDocumentContext 是否基于文档内容进行回答
     * @param documentId         文档 ID（用于隔离对话历史）
     * @param userId             用户 ID（用于隔离对话历史）
     * @return AI 基于文档内容的回答
     */
    @Retryable(
        retryFor = {RestClientException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1500, multiplier = 1.5)
    )
    public String askBasedOnDocument(String documentContent, String question,
                                     boolean useDocumentContext,
                                     Long documentId, Long userId) {
        // 先决定是否具备回答依据，避免无效请求触发模型或历史压缩。
        RagContextService.Context prepared = useDocumentContext
                ? contextService.document(documentId, question)
                : new RagContextService.Context("", null);
        if (prepared.message() != null) {
            return prepared.message();
        }
        String context = prepared.text();

        // ===== Day 30：读取对话历史 =====
        String sessionId = chatHistoryService.buildDocSessionId(documentId, userId);
        List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);
        // ================================

        // ===== Day 30.5：上下文压缩 =====
        if (compressionService.needsCompression(history)) {
            history = compressionService.compress(history);
        }
        // ================================

        // 根据开关选择 System Prompt
        String systemPrompt = buildSingleDocSystemPrompt(useDocumentContext);

        // 构建 User Prompt：如果基于文档，则拼接文档内容；否则只传问题
        String userPrompt = buildSingleDocUserPrompt(context, question, useDocumentContext);

        ChatResponse chatResponse = chatClient.prompt()
        .system(systemPrompt)
        .messages(history)      // ← Day 30：传入历史消息
        .user(userPrompt)
        .call()
        .chatResponse();

        String answer = chatResponse.getResult().getOutput().getText();
        // Token 日志
        var usage = chatResponse.getMetadata().getUsage();
        if (usage != null) {
            log.info("[Token] 单文档问答 | 文档长度: {} | 输入: {} | 输出: {} | 总计: {}",
                documentContent != null ? documentContent.length() : 0,
                usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
        }

        // ===== Day 30：保存本轮对话 =====
        chatHistoryService.saveTurn(sessionId, documentId, null, userId, question, answer);
        // ================================

        return answer;
    }
    @Recover
    public String askBasedOnDocumentRecover(RestClientException e, String documentContent, String question,
                                            boolean useDocumentContext, Long documentId, Long userId) {
    log.error("[重试] 单文档问答失败，已重试 3 次: {}", e.getMessage());
    return "AI 服务暂时不可用，请稍后重试";
    }

        /**
     * 基于笔记本内多篇文档内容回答用户问题（Day 30：带上对话历史）
     *
     * @param documents  文档列表，每个元素是 [标题, 内容] 的数组
     * @param question   用户问题
     * @param notebookId 笔记本 ID（用于隔离对话历史）
     * @param userId     用户 ID（用于隔离对话历史）
     * @return AI 基于所有文档内容的综合回答
     */
    @Retryable(
        retryFor = {RestClientException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1500, multiplier = 1.5)
    )
    public String askBasedOnDocuments(List<String[]> documents, String question,
                                      Long notebookId, Long userId) {
        // 先决定是否具备回答依据，避免无效请求触发模型或历史压缩。
        RagContextService.Context prepared = contextService.notebook(notebookId, question);
        if (prepared.message() != null) {
            return prepared.message();
        }
        String context = prepared.text();

        // ===== Day 30：读取对话历史 =====
        String sessionId = chatHistoryService.buildNotebookSessionId(notebookId, userId);
        List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);
        // ================================

        // ===== Day 30.5：上下文压缩 =====
        if (compressionService.needsCompression(history)) {
            history = compressionService.compress(history);
        }
        // ================================

        String systemPrompt = buildMultiDocSystemPrompt();
        String userPrompt = buildMultiDocUserPrompt(context, question);

        // 调用 AI
        ChatResponse chatResponse = chatClient.prompt()
        .system(systemPrompt)
        .messages(history)      // ← Day 30：传入历史消息
        .user(userPrompt)
        .call()
        .chatResponse();

        String answer = chatResponse.getResult().getOutput().getText();
        var usage = chatResponse.getMetadata().getUsage();
        if (usage != null) {
            log.info("[Token] 多文档问答 | 文档数: {} | 上下文长度: {} | 输入: {} | 输出: {} | 总计: {}",
                documents.size(), context.length(),
                usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
        }

        // ===== Day 30：保存本轮对话 =====
        chatHistoryService.saveTurn(sessionId, null, notebookId, userId, question, answer);
        // ================================

        return answer;
    }
    @Recover
    public String askBasedOnDocumentsRecover(RestClientException e, List<String[]> documents, String question,
                                             Long notebookId, Long userId) {
    log.error("[重试] 多文档问答失败，已重试 3 次: {}", e.getMessage());
    return "AI 服务暂时不可用，请稍后重试";
    }

    // ========== 新增：私有方法 + 流式方法 ==========
    
    // 1. 单文档 System Prompt 构建
    private String buildSingleDocSystemPrompt(boolean useDocumentContext) {
        String systemPrompt = useDocumentContext
                ? """
                  你是一位知识库问答助手。请严格遵循以下规则：
                  1. 只基于用户提供的【文档内容】回答问题
                  2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                  3. 回答要简洁，控制在 300 字以内
                  4. 不要添加文档中没有的信息
                  5. 每段内容前面标注了 [N] 来源：文档标题，回答时如果引用了某段内容，必须在引用处添加标记 [N]
                  6. 回答末尾必须用 "---" 分隔，然后列出参考来源，每个引用独占一行，格式为：[N] 【文档：标题】原文片段
                  """
                : """
                  你是一位通用知识问答助手。请遵循以下规则：
                  1. 基于你的知识库回答用户问题
                  2. 回答要简洁，控制在 300 字以内
                  3. 如果不确定，如实说明
                  """;
        return systemPrompt;
    }
    
    // 2. 单文档 User Prompt 构建
    private String buildSingleDocUserPrompt(String context, String question, boolean useDocumentContext) {
        String userPrompt = useDocumentContext && context != null
                ? """
                  【文档内容】
                  %s

                  【用户问题】
                  %s
                  """.formatted(context, question)
                : question;
        return userPrompt;
    }
    // 3. 多文档 Prompt 构建（System + User 可以分开或合并）
    private String buildMultiDocSystemPrompt() {
        String systemPrompt = """
                        你是一位知识库问答助手。请严格遵循以下规则：
                        1. 只基于用户提供的【文档内容】回答问题
                        2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                        3. 回答要简洁，控制在 300 字以内
                        4. 不要添加文档中没有的信息
                        5. 如果有多篇文档，综合各篇文档的信息进行回答
                        6. 每段内容前面标注了 [N] 来源：文档标题，回答时如果引用了某段内容，必须在引用处添加标记 [N]
                        7. 回答末尾必须用 "---" 分隔，然后列出所有参考来源，每个引用独占一行，格式为：[N] 【文档：标题】原文片段
                        """;
        return systemPrompt;
    }
    
    private String buildMultiDocUserPrompt(String context, String question) {
        String userPrompt ="""
                        【文档内容】    
                        %s
                        【用户问题】
                        %s
                        """.formatted(context, question);
        return userPrompt;
    }
    // 4. 流式方法 A：单文档（Day 30：带历史 + 流结束后保存）
    public Flux<ServerSentEvent<String>> askBasedOnDocumentStream(
            String documentContent, String question, boolean useDocumentContext,
            Long documentId, Long userId) {
        // 先决定是否具备回答依据，避免无效请求触发模型或历史压缩。
        RagContextService.Context prepared = useDocumentContext
                ? contextService.document(documentId, question)
                : new RagContextService.Context("", null);
        if (prepared.message() != null) {
            return Flux.just(ServerSentEvent.<String>builder().data(prepared.message()).build());
        }
        String context = prepared.text();

        // ===== Day 30：读取对话历史 =====
        String sessionId = chatHistoryService.buildDocSessionId(documentId, userId);
        List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);
        // ================================

        // ===== Day 30.5：上下文压缩 =====
        if (compressionService.needsCompression(history)) {
            history = compressionService.compress(history);
        }
        // ================================

        // 复用私有方法构建 Prompt
        String systemPrompt = buildSingleDocSystemPrompt(useDocumentContext);
        String userPrompt = buildSingleDocUserPrompt(context, question, useDocumentContext);
        
        AtomicReference<Usage> usageRef = new AtomicReference<>();
        // Day 30：收集完整回答，流结束后保存为历史
        StringBuilder fullAnswer = new StringBuilder();
        
        Flux<ServerSentEvent<String>> contentFlux = chatClient.prompt()
            .system(systemPrompt)
            .messages(history)      // ← Day 30：传入历史
            .user(userPrompt)
            .stream()
            .chatResponse()
            .doOnNext(chunk -> {
                var usage = chunk.getMetadata() != null ? chunk.getMetadata().getUsage() : null;
                if (usage != null) {
                    usageRef.set(usage);
                    log.info("[Token] 流式单文档问答 | 输入：{} | 输出：{} | 总计：{}",
                            usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
                }
            })
            .map(chunk -> {
                var result = chunk.getResult();
                if (result != null && result.getOutput() != null) {
                    String text = result.getOutput().getText();
                    if (text != null && !text.isEmpty()) {
                        fullAnswer.append(text);   // ← Day 30：累积完整回答
                    }
                    return text;
                }
                return "";  // 无内容的 chunk 返回空串
            })
            .filter(text -> !text.isEmpty())  // 过滤掉空串，避免前端收到多余空事件
            .map(text -> ServerSentEvent.<String>builder().data(text).build())
            .onErrorResume(e -> Flux.just(ServerSentEvent.<String>builder()
                    .data("AI 服务暂时不可用，请稍后重试")
                    .build()));
        
        return contentFlux
            // Day 30：流结束后发送 token-usage 事件
            .concatWith(Mono.fromCallable(() -> {
                Usage usage = usageRef.get();
                if (usage != null) {
                    String json = String.format("{\"prompt\":%d,\"completion\":%d,\"total\":%d}",
                            usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
                    return ServerSentEvent.<String>builder()
                            .event("token-usage")
                            .data(json)
                            .build();
                }
                return null;
            }).filter(java.util.Objects::nonNull))
            // Day 30：保存本轮对话（失败不影响用户体验）
            .concatWith(Mono.<ServerSentEvent<String>>fromCallable(() -> {
                String answer = fullAnswer.toString();
                if (!answer.isEmpty()) {
                    try {
                        chatHistoryService.saveTurn(sessionId, documentId, null, userId, question, answer);
                    } catch (Exception e) {
                        log.warn("[对话历史] 保存失败: {}", e.getMessage());
                    }
                }
                return null;
            }).filter(java.util.Objects::nonNull));
    }
    // 5. 流式方法 B：多文档（Day 30：带历史 + 流结束后保存）
    public Flux<ServerSentEvent<String>> askBasedOnDocumentsStream(
            List<String[]> documents, String question,
            Long notebookId, Long userId) {
        // 先决定是否具备回答依据，避免无效请求触发模型或历史压缩。
        RagContextService.Context prepared = contextService.notebook(notebookId, question);
        if (prepared.message() != null) {
            return Flux.just(ServerSentEvent.<String>builder().data(prepared.message()).build());
        }
        String context = prepared.text();

        // ===== Day 30：读取对话历史 =====
        String sessionId = chatHistoryService.buildNotebookSessionId(notebookId, userId);
        List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);
        // ================================

        // ===== Day 30.5：上下文压缩 =====
        if (compressionService.needsCompression(history)) {
            history = compressionService.compress(history);
        }
        // ================================

        String systemPrompt = buildMultiDocSystemPrompt();
        String userPrompt = buildMultiDocUserPrompt(context, question);
        
        AtomicReference<Usage> usageRef = new AtomicReference<>();
        // Day 30：收集完整回答，流结束后保存为历史
        StringBuilder fullAnswer = new StringBuilder();
        
        Flux<ServerSentEvent<String>> contentFlux = chatClient.prompt()
            .system(systemPrompt)
            .messages(history)      // ← Day 30：传入历史
            .user(userPrompt)
            .stream()
            .chatResponse()
            .doOnNext(chunk -> {
                var usage = chunk.getMetadata() != null ? chunk.getMetadata().getUsage() : null;
                if (usage != null) {
                    usageRef.set(usage);
                    log.info("[Token] 流式多文档问答 | 输入：{} | 输出：{} | 总计：{}",
                            usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
                }
            })
            .map(chunk -> {
                var result = chunk.getResult();
                if (result != null && result.getOutput() != null) {
                    String text = result.getOutput().getText();
                    if (text != null && !text.isEmpty()) {
                        fullAnswer.append(text);   // ← Day 30：累积完整回答
                    }
                    return text;
                }
                return "";  // 无内容的 chunk 返回空串
            })
            .filter(text -> !text.isEmpty())  // 过滤掉空串，避免前端收到多余空事件
            .map(text -> ServerSentEvent.<String>builder().data(text).build())
            .onErrorResume(e -> Flux.just(ServerSentEvent.<String>builder()
                    .data("AI 服务暂时不可用，请稍后重试")
                    .build()));
        
        return contentFlux
            // Day 30：流结束后发送 token-usage 事件
            .concatWith(Mono.fromCallable(() -> {
                Usage usage = usageRef.get();
                if (usage != null) {
                    String json = String.format("{\"prompt\":%d,\"completion\":%d,\"total\":%d}",
                            usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
                    return ServerSentEvent.<String>builder()
                            .event("token-usage")
                            .data(json)
                            .build();
                }
                return null;
            }).filter(java.util.Objects::nonNull))
            // Day 30：保存本轮对话（失败不影响用户体验）
            .concatWith(Mono.<ServerSentEvent<String>>fromCallable(() -> {
                String answer = fullAnswer.toString();
                if (!answer.isEmpty()) {
                    try {
                        chatHistoryService.saveTurn(sessionId, null, notebookId, userId, question, answer);
                    } catch (Exception e) {
                        log.warn("[对话历史] 保存失败: {}", e.getMessage());
                    }
                }
                return null;
            }).filter(java.util.Objects::nonNull));
    }
}
