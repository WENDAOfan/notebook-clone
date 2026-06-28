package com.example.notebook_clone.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Day 30.5：上下文智能压缩服务
 * 对话太长时，用 AI 把旧消息压缩成摘要，既保留关键信息，又不超出模型的上下文窗口。
 * DeepSeek API 有 1M（1000000 Token）上下文窗口，给历史留 300K 预算。
 */
@Slf4j
@Service
public class ContextCompressionService {

    private final ChatClient chatClient;

    public ContextCompressionService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    /** 历史消息的 Token 预算上限（DeepSeek API 有 1M 上下文窗口，给历史留 300K） */
    private static final int HISTORY_TOKEN_BUDGET = 300000;

    /** 压缩后保留的完整消息条数（最近的 N 条不压缩） */
    private static final int KEEP_RECENT_MESSAGES = 200;  // 最近 100 轮（200 条消息）

    /**
     * 粗略估算文本的 Token 数量
     * 中文约 1.5 Token/字，英文约 1.3 Token/词
     * 混合文本取 1.3 Token/字符作为折中
     */
    public int estimateTokens(String text) {
        if (text == null || text.isEmpty()) return 0;
        return (int) (text.length() * 1.3);
    }

    /**
     * 估算一组消息的总 Token 数
     */
    public int estimateHistoryTokens(List<Message> messages) {
        return messages.stream()
                .mapToInt(msg -> estimateTokens(msg.getText()))
                .sum();
    }

    /**
     * 判断是否需要压缩
     */
    public boolean needsCompression(List<Message> messages) {
        return estimateHistoryTokens(messages) > HISTORY_TOKEN_BUDGET;
    }

    /**
     * 压缩对话历史：把旧消息用 AI 总结成摘要，保留最近几条完整消息
     *
     * @param messages 完整的对话历史（按时间升序）
     * @return 压缩后的消息列表（摘要 + 最近 N 条完整消息）
     */
    public List<Message> compress(List<Message> messages) {
        if (messages.size() <= KEEP_RECENT_MESSAGES) {
            return messages;  // 消息太少，不需要压缩
        }

        // 1. 拆分：旧消息（要压缩）+ 新消息（保留完整）
        int splitIndex = messages.size() - KEEP_RECENT_MESSAGES;
        List<Message> oldMessages = messages.subList(0, splitIndex);
        List<Message> recentMessages = messages.subList(splitIndex, messages.size());

        // 2. 用 AI 把旧消息压缩成一段摘要
        String summary = summarizeMessages(oldMessages);

        // 3. 把摘要包装成一条 AssistantMessage，放在最前面
        Message summaryMessage = new AssistantMessage(
                "【对话摘要】以下是之前对话的概要：\n" + summary
        );

        // 4. 拼接：摘要 + 最近完整消息
        List<Message> compressed = new ArrayList<>();
        compressed.add(summaryMessage);
        compressed.addAll(recentMessages);

        log.info("[上下文压缩] {} 条消息 → 摘要 + {} 条完整消息 | 估算 Token: {} → {}",
                messages.size(), recentMessages.size(),
                estimateHistoryTokens(messages),
                estimateHistoryTokens(compressed));

        return compressed;
    }

    /**
     * 用 AI 将一组消息压缩成一段文字摘要
     */
    private String summarizeMessages(List<Message> messages) {
        // 把消息列表拼成文本
        StringBuilder sb = new StringBuilder();
        for (Message msg : messages) {
            String role = msg instanceof UserMessage ? "用户" : "AI";
            sb.append(role).append(": ").append(msg.getText()).append("\n\n");
        }

        // 调 AI 做摘要
        String summary = chatClient.prompt()
                .system("""
                        你是一个对话摘要助手。请将以下对话历史压缩为一段简洁的摘要。
                        要求：
                        1. 保留用户问过的所有问题和 AI 回答的关键要点
                        2. 保留具体的术语、数字、名称等细节
                        3. 控制在 300 字以内
                        4. 用中文输出
                        5. 不要添加任何解释，直接输出摘要内容
                        """)
                .user("请压缩以下对话历史：\n\n" + sb.toString())
                .call()
                .content();

        return summary;
    }
}
