package com.example.notebook_clone.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class AiSummaryService {

    private final ChatClient chatClient;

    public AiSummaryService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    /**
     * 为文档内容生成 AI 摘要
     *
     * @param content 文档原始内容
     * @return AI 生成的摘要文本
     */
    public String generateSummary(String content) {
        // 如果内容为空或太短，没必要生成摘要
        if (content == null || content.trim().length() < 50) {
            return "内容过短，无需摘要";
        }

        // 如果内容超长，只取前 8000 字（控制 Token 消耗和响应时间）
        String truncatedContent = content.length() > 8000
                ? content.substring(0, 8000) + "\n...（内容已截断）"
                : content;

        // 调用 AI 生成摘要
        String summary = chatClient.prompt()
                .system("""
                        你是一位专业的文档摘要助手。请遵循以下规则：
                        1. 用 2~4 句话概括文档的核心内容
                        2. 回答控制在 200 字以内
                        3. 语言简洁，突出关键信息（主题、核心观点、用途）
                        4. 不要复述原文，用自己的话总结
                        """)
                .user("请为以下文档生成摘要：\n\n" + truncatedContent)
                .call()
                .content();

        return summary;
    }
}