package com.example.notebook_clone.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;
//day26
import lombok.extern.slf4j.Slf4j;
import org.springframework.retry.annotation.Retryable;
import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Recover;
import org.springframework.web.client.RestClientException;
import org.springframework.ai.chat.model.ChatResponse;
@Slf4j
@Service
public class AiSummaryService {

    private final ChatClient chatClient;

    public AiSummaryService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

        @Retryable(
        retryFor = {RestClientException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1500, multiplier = 1.5)
        )
    public String generateSummary(String content) {
        if (content == null || content.trim().length() < 50) {
            return "内容过短，无需摘要";
        }

        String truncatedContent = content.length() > 8000
                ? content.substring(0, 8000) + "\n...（内容已截断）"
                : content;

        // call().chatResponse() 替代 call().content()，可以拿到 Token 信息
        ChatResponse chatResponse = chatClient.prompt()
                .system("""
                        你是一位专业的文档摘要助手。请遵循以下规则：
                        1. 用 2~4 句话概括文档的核心内容
                        2. 回答控制在 200 字以内
                        3. 语言简洁，突出关键信息（主题、核心观点、用途）
                        4. 不要复述原文，用自己的话总结
                        """)
                .user("请为以下文档生成摘要：\n\n" + truncatedContent)
                .call()
                .chatResponse();

        String summary = chatResponse.getResult().getOutput().getText();

        // Token 用量日志
        var usage = chatResponse.getMetadata().getUsage();
        if (usage != null) {
            log.info("[Token] 摘要生成 | 输入: {} | 输出: {} | 总计: {}",
                usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
        }

        return summary;
    }
    @Recover
    public String generateSummaryRecover(RestClientException e, String content) {
        log.error("[重试] 摘要生成失败，已重试 3 次: {}", e.getMessage());
        return "摘要生成失败，请稍后重试";
    }

}