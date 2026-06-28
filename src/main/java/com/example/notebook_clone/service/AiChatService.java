package com.example.notebook_clone.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.model.ChatResponse;//替代 String 接收 AI 返回值，包含文本 + Token 信息
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
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
    private final VectorStore vectorStore;
    private final ChatHistoryService chatHistoryService;  // Day 30 新增：对话历史
    private final ContextCompressionService compressionService;  // Day 30.5 新增：上下文压缩

    public AiChatService(ChatClient.Builder chatClientBuilder, VectorStore vectorStore,
                         ChatHistoryService chatHistoryService,
                         ContextCompressionService compressionService) {
        this.chatClient = chatClientBuilder.build();
        this.vectorStore = vectorStore;
        this.chatHistoryService = chatHistoryService;
        this.compressionService = compressionService;
    }

    /**
     * Day 29：从向量存储中检索与问题最相关的文档块
     *
     * @param question 用户问题
     * @param topK     返回最相关的块数量
     * @return 带来源标注的文档块列表
     */
    private List<String> retrieveRelevantChunks(String question, int topK) {
        List<Document> results = vectorStore.similaritySearch(
                SearchRequest.builder()
                        .query(question)
                        .topK(topK)
                        .build());

        List<String> chunksWithSource = new java.util.ArrayList<>();
        for (int i = 0; i < results.size(); i++) {
            Document doc = results.get(i);
            String title = (String) doc.getMetadata().getOrDefault("documentTitle", "未知文档");
            String source = String.format("[%d] 来源：%s\n%s", i + 1, title, doc.getText());
            chunksWithSource.add(source);
        }
        return chunksWithSource;
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
        // 如果文档内容为空，且用户要求基于文档回答
        if ((documentContent == null || documentContent.trim().isEmpty()) && useDocumentContext) {
            return "文档内容为空，无法回答问题。";
        }

        // ===== Day 30：读取对话历史 =====
        String sessionId = chatHistoryService.buildDocSessionId(documentId, userId);
        List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);
        // ================================

        // ===== Day 30.5：上下文压缩 =====
        if (compressionService.needsCompression(history)) {
            history = compressionService.compress(history);
        }
        // ================================

        // ===== Day 29：RAG 检索替代全文塞入 =====
        List<String> relevantChunks = retrieveRelevantChunks(question, 5);

        String context;
        if (relevantChunks.isEmpty()) {
            // 向量存储中还没有该文档的块（可能分块任务还没跑完）
            // 降级为全文截断模式
            context = documentContent != null && documentContent.length() > 8000
                    ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
                    : documentContent;
        } else {
            context = String.join("\n\n---\n\n", relevantChunks);
        }
        // ========================================

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
        // 如果没有文档
        if (documents == null || documents.isEmpty()) {
            return "该笔记本下没有文档，无法回答问题。";
        }

        // ===== Day 30：读取对话历史 =====
        String sessionId = chatHistoryService.buildNotebookSessionId(notebookId, userId);
        List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);
        // ================================

        // ===== Day 30.5：上下文压缩 =====
        if (compressionService.needsCompression(history)) {
            history = compressionService.compress(history);
        }
        // ================================

        // ===== Day 29：用 RAG 替代"拼接所有文档" =====
        List<String> relevantChunks = retrieveRelevantChunks(question, 8);

        String context;
        if (relevantChunks.isEmpty()) {
            // 降级为旧逻辑：拼接所有文档
            StringBuilder contextBuilder = new StringBuilder();
            int totalLength = 0;
            final int MAX_LENGTH = 50000;
            boolean truncated = false;

            for (String[] doc : documents) {
                String title = doc[0];
                String content = doc[1];

                if (content == null || content.trim().isEmpty()) {
                    continue;
                }

                String docSection = "\n【文档：" + title + "】\n" + content.trim() + "\n";

                if (totalLength + docSection.length() > MAX_LENGTH) {
                    int remaining = MAX_LENGTH - totalLength;
                    if (remaining > 100) {
                        String partial = docSection.substring(0, remaining);
                        contextBuilder.append(partial).append("\n...（内容已截断）");
                        totalLength = MAX_LENGTH;
                    }
                    truncated = true;
                    break;
                } else {
                    contextBuilder.append(docSection);
                    totalLength += docSection.length();
                }
            }

            context = contextBuilder.toString();
            if (context.isEmpty()) {
                return "该笔记本下的文档内容均为空，无法回答问题。";
            }

            if (truncated) {
                context += "\n...（更多文档内容因长度限制未纳入上下文）";
            }
        } else {
            context = String.join("\n\n---\n\n", relevantChunks);
        }
        // ============================================

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
        
        // 空文档判断
        if ((documentContent == null || documentContent.trim().isEmpty()) && useDocumentContext) {
            return Flux.just(ServerSentEvent.<String>builder()
                    .data("文档内容为空，无法回答问题。")
                    .build());
        }

        // ===== Day 30：读取对话历史 =====
        String sessionId = chatHistoryService.buildDocSessionId(documentId, userId);
        List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);
        // ================================

        // ===== Day 30.5：上下文压缩 =====
        if (compressionService.needsCompression(history)) {
            history = compressionService.compress(history);
        }
        // ================================

        // ===== Day 29：RAG 检索替代全文塞入（流式）=====
        List<String> relevantChunks = retrieveRelevantChunks(question, 5);

        String context;
        if (relevantChunks.isEmpty()) {
            context = documentContent != null && documentContent.length() > 8000
                    ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
                    : documentContent;
        } else {
            context = String.join("\n\n---\n\n", relevantChunks);
        }
        // ============================================
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
        
        // 如果没有文档
        if (documents == null || documents.isEmpty()) {
            return Flux.just(ServerSentEvent.<String>builder()
                    .data("该笔记本下没有文档，无法回答问题。")
                    .build());//注意！流式返回 Flux.just(...)
        }

        // ===== Day 30：读取对话历史 =====
        String sessionId = chatHistoryService.buildNotebookSessionId(notebookId, userId);
        List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);
        // ================================

        // ===== Day 30.5：上下文压缩 =====
        if (compressionService.needsCompression(history)) {
            history = compressionService.compress(history);
        }
        // ================================

        // ===== Day 29：用 RAG 替代"拼接所有文档"（流式）=====
        List<String> relevantChunks = retrieveRelevantChunks(question, 8);

        String context;
        if (relevantChunks.isEmpty()) {
            // 降级为旧逻辑：拼接所有文档
            StringBuilder contextBuilder = new StringBuilder();
            int totalLength = 0;
            final int MAX_LENGTH = 50000;
            boolean truncated = false;

            for (String[] doc : documents) {
                String title = doc[0];
                String content = doc[1];

                if (content == null || content.trim().isEmpty()) {
                    continue;
                }

                String docSection = "\n【文档：" + title + "】\n" + content.trim() + "\n";

                if (totalLength + docSection.length() > MAX_LENGTH) {
                    int remaining = MAX_LENGTH - totalLength;
                    if (remaining > 100) {
                        String partial = docSection.substring(0, remaining);
                        contextBuilder.append(partial).append("\n...（内容已截断）");
                        totalLength = MAX_LENGTH;
                    }
                    truncated = true;
                    break;
                } else {
                    contextBuilder.append(docSection);
                    totalLength += docSection.length();
                }
            }
            context = contextBuilder.toString();
            if (context.isEmpty()) {
                return Flux.just(ServerSentEvent.<String>builder()
                        .data("该笔记本下的文档内容均为空，无法回答问题。")
                        .build());
            }
            if (truncated) {
                context += "\n...（更多文档内容因长度限制未纳入上下文）";
            }
        } else {
            context = String.join("\n\n---\n\n", relevantChunks);
        }
        // ============================================
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
