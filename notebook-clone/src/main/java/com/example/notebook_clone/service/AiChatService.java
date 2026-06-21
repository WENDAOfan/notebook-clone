package com.example.notebook_clone.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import reactor.core.publisher.Flux;  //day23"推送式"的数据流
import reactor.core.publisher.Mono;
import lombok.extern.slf4j.Slf4j;//Lombok 自动生成 log 对象，让你能写 log.info(...)
import org.springframework.ai.chat.model.ChatResponse;//替代 String 接收 AI 返回值，包含文本 + Token 信息
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.retry.annotation.Backoff;//@Retryable 的退避参数（等多久、间隔倍数）
import org.springframework.retry.annotation.Recover;//标记兜底方法——重试全部失败后自动调用
import org.springframework.retry.annotation.Retryable;//标记方法为可重试
import org.springframework.web.client.RestClientException;//	HTTP 调用层的异常，作为重试触发条件

@Slf4j
@Service
public class AiChatService {

    private final ChatClient chatClient;

    public AiChatService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }
    /**
     * 基于单个文档内容回答用户问题
     *
     * @param documentContent 文档内容
     * @param question        用户问题
     * @param useDocumentContext 是否基于文档内容进行回答
     * @return AI 基于文档内容的回答
     */
    @Retryable(
        retryFor = {RestClientException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1500, multiplier = 1.5)
    )
    public String askBasedOnDocument(String documentContent, String question, boolean useDocumentContext) {
        // 如果文档内容为空，且用户要求基于文档回答
        if ((documentContent == null || documentContent.trim().isEmpty()) && useDocumentContext) {
            return "文档内容为空，无法回答问题。";
        }

        // 如果内容超过 8000 字，截断
        String context = documentContent != null && documentContent.length() > 8000
                ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
                : documentContent;

        // 根据开关选择 System Prompt
        String systemPrompt = useDocumentContext
                ? """
                  你是一位知识库问答助手。请严格遵循以下规则：
                  1. 只基于用户提供的【文档内容】回答问题
                  2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                  3. 回答要简洁，控制在 300 字以内
                  4. 不要添加文档中没有的信息
                  """
                : """
                  你是一位通用知识问答助手。请遵循以下规则：
                  1. 基于你的知识库回答用户问题
                  2. 回答要简洁，控制在 300 字以内
                  3. 如果不确定，如实说明
                  """;

        // 构建 User Prompt：如果基于文档，则拼接文档内容；否则只传问题
        String userPrompt = useDocumentContext && context != null
                ? """
                  【文档内容】
                  %s

                  【用户问题】
                  %s
                  """.formatted(context, question)
                : question;

        // String answer = chatClient.prompt()
        //         .system(systemPrompt)
        //         .user(userPrompt)
        //         .call()
        //         .content();
        ChatResponse chatResponse = chatClient.prompt()
        .system(systemPrompt)
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
        return answer;
    }
    @Recover
    public String askBasedOnDocumentRecover(RestClientException e, String documentContent, String question, boolean useDocumentContext) {
    log.error("[重试] 单文档问答失败，已重试 3 次: {}", e.getMessage());
    return "AI 服务暂时不可用，请稍后重试";
    }

        /**
     * 基于笔记本内多篇文档内容回答用户问题
     *
     * @param documents     文档列表，每个元素是 [标题, 内容] 的数组
     * @param question      用户问题
     * @return AI 基于所有文档内容的综合回答
     */
    @Retryable(
        retryFor = {RestClientException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1500, multiplier = 1.5)
    )
    public String askBasedOnDocuments(List<String[]> documents, String question) {
        // 如果没有文档
        if (documents == null || documents.isEmpty()) {
            return "该笔记本下没有文档，无法回答问题。";
        }

        // 拼接所有文档内容，每篇标注标题
        StringBuilder contextBuilder = new StringBuilder();
        int totalLength = 0;
        // 现代模型上下文可达 1M+ Token，这里放宽到 50000 字符
        final int MAX_LENGTH = 50000;
        boolean truncated = false;

        for (String[] doc : documents) {
            String title = doc[0];// 提取文档标题(数组第一个元素)
            String content = doc[1];// 提取文档内容(数组第二个元素)

            if (content == null || content.trim().isEmpty()) {
                continue;// 如果内容为空,跳过这篇文档,处理下一篇
            }

            // 构建这篇文档的片段
            String docSection = "\n【文档：" + title + "】\n" + content.trim() + "\n";

            // 检查加入后是否超限
            if (totalLength + docSection.length() > MAX_LENGTH) {
                int remaining = MAX_LENGTH - totalLength;
                if (remaining > 100) {/// 如果剩余空间大于100字符
                    String partial = docSection.substring(0, remaining);//// 截取部分内容
                    contextBuilder.append(partial).append("\n...（内容已截断）");
                    totalLength = MAX_LENGTH;
                }
                truncated = true;//// 标记已发生截断
                break;  //// 跳出循环,不再处理后续文档
            } else {
                contextBuilder.append(docSection);
                totalLength += docSection.length();
            }
        }

        String context = contextBuilder.toString();
        if (context.isEmpty()) {
            return "该笔记本下的文档内容均为空，无法回答问题。";
        }

        if (truncated) {
            context += "\n...（更多文档内容因长度限制未纳入上下文）";
        }

        // 调用 AI
        ChatResponse chatResponse = chatClient.prompt()
        .system("""
                你是一位知识库问答助手。请严格遵循以下规则：
                1. 只基于用户提供的【文档内容】回答问题
                2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                3. 回答要简洁，控制在 300 字以内
                4. 不要添加文档中没有的信息
                5. 如果有多篇文档，综合各篇文档的信息进行回答
                """)
        .user("""
                【文档内容】    
                %s
                【用户问题】
                %s
                """.formatted(context, question))
        .call()
        .chatResponse();

        String answer = chatResponse.getResult().getOutput().getText();
        var usage = chatResponse.getMetadata().getUsage();
        if (usage != null) {
            log.info("[Token] 多文档问答 | 文档数: {} | 上下文长度: {} | 输入: {} | 输出: {} | 总计: {}",
                documents.size(), context.length(),
                usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
        }

        return answer;
    }
    @Recover
    public String askBasedOnDocumentsRecover(RestClientException e, List<String[]> documents, String question) {
        log.error("[重试] 多文档问答失败，已重试 3 次: {}", e.getMessage());
        return "AI 服务暂时不可用，请稍后重试";
    }

    // ========== 新增：私有方法 + 流式方法 ==========
    
    // 1. 单文档 System Prompt 构建
    private String buildSingleDocSystemPrompt(boolean useDocumentContext) {
        // 从原 askBasedOnDocument 第 27-40 行提取
        String systemPrompt = useDocumentContext
                ? """
                  你是一位知识库问答助手。请严格遵循以下规则：
                  1. 只基于用户提供的【文档内容】回答问题
                  2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                  3. 回答要简洁，控制在 300 字以内
                  4. 不要添加文档中没有的信息
                  5. 引用文档具体内容时，必须在引用处添加标记 [1]
                  6. 回答末尾必须用 "---" 分隔，然后列出参考来源：[1] 原文片段
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
        // 从原 askBasedOnDocument 第 43-51 行提取
        // 构建 User Prompt：如果基于文档，则拼接文档内容；否则只传问题
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
        // 从原 askBasedOnDocuments 第 119-126 行提取
        String systemPrompt = """
                        你是一位知识库问答助手。请严格遵循以下规则：
                        1. 只基于用户提供的【文档内容】回答问题
                        2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                        3. 回答要简洁，控制在 300 字以内
                        4. 不要添加文档中没有的信息
                        5. 如果有多篇文档，综合各篇文档的信息进行回答
                        6. 引用某篇文档的具体内容时，必须在引用处添加标记 [N]，N 从 1 开始递增
                        7. 回答末尾必须用 "---" 分隔，然后列出所有参考来源，格式为：[N] 【文档：标题】原文片段
                        """;
        return systemPrompt;
    }
    
    private String buildMultiDocUserPrompt(String context, String question) {
        // 从原 askBasedOnDocuments 第 127-132 行提取
        String userPrompt ="""
                        【文档内容】    
                        %s
                        【用户问题】
                        %s
                        """.formatted(context, question);
        return userPrompt;
    }
    // 4. 流式方法 A：单文档
    public Flux<ServerSentEvent<String>> askBasedOnDocumentStream(
            String documentContent, String question, boolean useDocumentContext) {
        
        // 文档截断逻辑（和同步一样）
        // 空文档判断 → return Flux.just("...");
        if ((documentContent == null || documentContent.trim().isEmpty()) && useDocumentContext) {
            return Flux.just(ServerSentEvent.<String>builder()
                    .data("文档内容为空，无法回答问题。")
                    .build());  // 空文档判断
        }
        String context = documentContent != null && documentContent.length() > 8000
                ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
                : documentContent;  // 截断逻辑
        // 复用私有方法构建 Prompt
        String systemPrompt = buildSingleDocSystemPrompt(useDocumentContext);
        String userPrompt = buildSingleDocUserPrompt(context, question, useDocumentContext);
        
        AtomicReference<Usage> usageRef = new AtomicReference<>();
        
        Flux<ServerSentEvent<String>> contentFlux = chatClient.prompt()
            .system(systemPrompt)
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
                    return result.getOutput().getText();
                }
                return "";  // 无内容的 chunk 返回空串
            })
            .filter(text -> !text.isEmpty())  // 过滤掉空串，避免前端收到多余空事件
            .map(text -> ServerSentEvent.<String>builder().data(text).build())
            .onErrorResume(e -> Flux.just(ServerSentEvent.<String>builder()
                    .data("AI 服务暂时不可用，请稍后重试")
                    .build()));
        
        return contentFlux.concatWith(Mono.fromCallable(() -> {
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
        }).filter(java.util.Objects::nonNull));
    }
    // 5. 流式方法 B：多文档
    public Flux<ServerSentEvent<String>> askBasedOnDocumentsStream(
            List<String[]> documents, String question) {
        
        // 空文档判断 → return Flux.just("...");
        // 文档拼接逻辑（和同步一样）
                // 如果没有文档
        if (documents == null || documents.isEmpty()) {
            return Flux.just(ServerSentEvent.<String>builder()
                    .data("该笔记本下没有文档，无法回答问题。")
                    .build());//注意！流式返回 Flux.just(...)
        }

        // 拼接所有文档内容，每篇标注标题
        StringBuilder contextBuilder = new StringBuilder();
        int totalLength = 0;
        // 现代模型上下文可达 1M+ Token，这里放宽到 50000 字符
        final int MAX_LENGTH = 50000;
        boolean truncated = false;

        for (String[] doc : documents) {
            String title = doc[0];// 提取文档标题(数组第一个元素)
            String content = doc[1];// 提取文档内容(数组第二个元素)

            if (content == null || content.trim().isEmpty()) {
                continue;// 如果内容为空,跳过这篇文档,处理下一篇
            }

            // 构建这篇文档的片段
            String docSection = "\n【文档：" + title + "】\n" + content.trim() + "\n";

            // 检查加入后是否超限
            if (totalLength + docSection.length() > MAX_LENGTH) {
                int remaining = MAX_LENGTH - totalLength;
                if (remaining > 100) {/// 如果剩余空间大于100字符
                    String partial = docSection.substring(0, remaining);//// 截取部分内容
                    contextBuilder.append(partial).append("\n...（内容已截断）");
                    totalLength = MAX_LENGTH;
                }
                truncated = true;//// 标记已发生截断
                break;  //// 跳出循环,不再处理后续文档
            } else {
                contextBuilder.append(docSection);
                totalLength += docSection.length();
            }
        }
        String context = contextBuilder.toString();
        if (context.isEmpty()) {
        return Flux.just(ServerSentEvent.<String>builder()
                .data("该笔记本下的文档内容均为空，无法回答问题。")
                .build());
        }
        if (truncated) {
            context += "\n...（更多文档内容因长度限制未纳入上下文）";
        }
        String systemPrompt = buildMultiDocSystemPrompt();
        String userPrompt = buildMultiDocUserPrompt(context, question);
        
        AtomicReference<Usage> usageRef = new AtomicReference<>();
        
        Flux<ServerSentEvent<String>> contentFlux = chatClient.prompt()
            .system(systemPrompt)
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
                    return result.getOutput().getText();
                }
                return "";  // 无内容的 chunk 返回空串
            })
            .filter(text -> !text.isEmpty())  // 过滤掉空串，避免前端收到多余空事件
            .map(text -> ServerSentEvent.<String>builder().data(text).build())
            .onErrorResume(e -> Flux.just(ServerSentEvent.<String>builder()
                    .data("AI 服务暂时不可用，请稍后重试")
                    .build()));
        
        return contentFlux.concatWith(Mono.fromCallable(() -> {
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
        }).filter(java.util.Objects::nonNull));
    }
}