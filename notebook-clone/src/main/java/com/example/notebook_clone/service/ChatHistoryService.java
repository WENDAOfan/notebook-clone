package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.ChatMessage;
import com.example.notebook_clone.repository.ChatMessageRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Day 30：对话历史服务
 * 负责：构建会话 ID、读取历史、保存一轮对话、截断超长历史、定期清理过期记录
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ChatHistoryService {

    private final ChatMessageRepository chatMessageRepository;

    /** 最大保留轮数（一问一答算 1 轮 = 2 条消息） */
    private static final int MAX_ROUNDS = 1000;  // Day 30.5：从 10 调大到 1000，配合上下文压缩服务
    /** 历史保留天数 */
    private static final int HISTORY_DAYS = 7;

    // ========== Key 构建 ==========

    public String buildDocSessionId(Long documentId, Long userId) {
        return "doc:" + documentId + ":" + userId;
    }

    public String buildNotebookSessionId(Long notebookId, Long userId) {
        return "notebook:" + notebookId + ":" + userId;
    }

    // ========== 读取历史 ==========

    /**
     * 获取对话历史，转为 Spring AI 的 Message 列表（按时间升序）
     */
    public List<Message> getHistoryAsMessages(String sessionId) {
        List<ChatMessage> messages = chatMessageRepository
                .findBySessionIdOrderByCreateTimeAsc(sessionId);

        return messages.stream()
                .map(msg -> {
                    if ("user".equals(msg.getRole())) {
                        return (Message) new UserMessage(msg.getContent());
                    } else {
                        return (Message) new AssistantMessage(msg.getContent());
                    }
                })
                .toList();
    }

    /**
     * 获取原始历史消息列表（给前端展示用）
     */
    public List<ChatMessage> getHistory(String sessionId) {
        return chatMessageRepository.findBySessionIdOrderByCreateTimeAsc(sessionId);
    }

    // ========== 保存历史 ==========

    /**
     * 保存一轮对话（用户问题 + AI 回答）
     */
    @Transactional
    public void saveTurn(String sessionId, Long documentId, Long notebookId,
                         Long userId, String question, String answer) {
        LocalDateTime now = LocalDateTime.now();

        // 保存用户消息
        ChatMessage userMsg = new ChatMessage();
        userMsg.setSessionId(sessionId);
        userMsg.setRole("user");
        userMsg.setContent(question);
        userMsg.setDocumentId(documentId);
        userMsg.setNotebookId(notebookId);
        userMsg.setUserId(userId);
        userMsg.setCreateTime(now);
        chatMessageRepository.save(userMsg);

        // 保存 AI 回答
        ChatMessage assistantMsg = new ChatMessage();
        assistantMsg.setSessionId(sessionId);
        assistantMsg.setRole("assistant");
        assistantMsg.setContent(answer);
        assistantMsg.setDocumentId(documentId);
        assistantMsg.setNotebookId(notebookId);
        assistantMsg.setUserId(userId);
        assistantMsg.setCreateTime(now);
        chatMessageRepository.save(assistantMsg);

        // 截断：只保留最近 MAX_ROUNDS 轮
        truncateHistory(sessionId);
    }

    /**
     * 截断历史消息，只保留最近 MAX_ROUNDS 轮
     */
    private void truncateHistory(String sessionId) {
        List<ChatMessage> allMessages = chatMessageRepository
                .findBySessionIdOrderByCreateTimeAsc(sessionId);
        int maxMessages = MAX_ROUNDS * 2;
        if (allMessages.size() > maxMessages) {
            List<ChatMessage> toDelete = allMessages.subList(0, allMessages.size() - maxMessages);
            chatMessageRepository.deleteAll(toDelete);
        }
    }

    // ========== 清空历史 ==========

    @Transactional
    public void clearDocHistory(Long documentId, Long userId) {
        chatMessageRepository.deleteByDocumentIdAndUserId(documentId, userId);
    }

    @Transactional
    public void clearNotebookHistory(Long notebookId, Long userId) {
        chatMessageRepository.deleteByNotebookIdAndUserId(notebookId, userId);
    }

    // ========== 定期清理 ==========

    @Scheduled(cron = "0 0 3 * * ?")  // 每天凌晨 3 点
    @Transactional
    public void cleanExpiredHistory() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(HISTORY_DAYS);
        chatMessageRepository.deleteExpired(cutoff);
        log.info("[对话历史] 清理 7 天前的过期记录");
    }
}
