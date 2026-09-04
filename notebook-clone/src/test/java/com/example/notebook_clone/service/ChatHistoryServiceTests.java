package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.ChatMessage;
import com.example.notebook_clone.repository.ChatMessageRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * ChatHistoryService 的纯单元测试。
 *
 * Repository 使用 Mock，因此不会读写真实聊天记录。测试重点是服务层如何构造隔离键、
 * 转换消息、保存一轮对话，以及何时触发历史清理。
 */
@ExtendWith(MockitoExtension.class)
class ChatHistoryServiceTests {

    @Mock
    private ChatMessageRepository chatMessageRepository;

    private ChatHistoryService chatHistoryService;

    @BeforeEach
    void setUp() {
        chatHistoryService = new ChatHistoryService(chatMessageRepository);
    }

    /** 同一资源下，不同用户必须得到不同会话 ID，防止聊天上下文串号。 */
    @Test
    void sessionIdsContainBothResourceIdAndUserId() {
        String aliceDocSession = chatHistoryService.buildDocSessionId(10L, 1L);
        String bobDocSession = chatHistoryService.buildDocSessionId(10L, 2L);
        String aliceNotebookSession = chatHistoryService.buildNotebookSessionId(20L, 1L);

        assertEquals("doc:10:1", aliceDocSession);
        assertEquals("doc:10:2", bobDocSession);
        assertEquals("notebook:20:1", aliceNotebookSession);
        assertNotEquals(aliceDocSession, bobDocSession);
    }

    /** 数据库实体应按原顺序转换成 Spring AI 能识别的用户消息和助手消息。 */
    @Test
    void historyIsConvertedToSpringAiMessagesInOrder() {
        ChatMessage user = message("user", "问题");
        ChatMessage assistant = message("assistant", "回答");
        when(chatMessageRepository.findBySessionIdOrderByCreateTimeAsc("doc:10:1"))
                .thenReturn(List.of(user, assistant));

        List<Message> result = chatHistoryService.getHistoryAsMessages("doc:10:1");

        assertEquals(2, result.size());
        assertInstanceOf(UserMessage.class, result.get(0));
        assertEquals("问题", result.get(0).getText());
        assertInstanceOf(AssistantMessage.class, result.get(1));
        assertEquals("回答", result.get(1).getText());
    }

    /** 保存一轮对话时，第一条必须是用户问题，第二条必须是 AI 回答。 */
    @Test
    void saveTurnStoresQuestionThenAnswerWithSameScope() {
        String sessionId = "doc:10:1";
        when(chatMessageRepository.findBySessionIdOrderByCreateTimeAsc(sessionId))
                .thenReturn(List.of());

        chatHistoryService.saveTurn(sessionId, 10L, null, 1L, "问题", "回答");

        // 捕获两次 save() 的实际参数，检查保存顺序和归属字段
        ArgumentCaptor<ChatMessage> captor = ArgumentCaptor.forClass(ChatMessage.class);
        verify(chatMessageRepository, times(2)).save(captor.capture());
        List<ChatMessage> saved = captor.getAllValues();

        assertEquals("user", saved.get(0).getRole());
        assertEquals("问题", saved.get(0).getContent());
        assertEquals("assistant", saved.get(1).getRole());
        assertEquals("回答", saved.get(1).getContent());

        for (ChatMessage message : saved) {
            assertEquals(sessionId, message.getSessionId());
            assertEquals(10L, message.getDocumentId());
            assertEquals(1L, message.getUserId());
        }
        // 同一轮的两条消息使用相同时间，Repository 再通过 id 保证先问后答
        assertEquals(saved.get(0).getCreateTime(), saved.get(1).getCreateTime());
    }

    /** 最大保留 1000 轮（2000 条）；出现 2002 条时只删除最旧的 2 条。 */
    @Test
    void saveTurnDeletesOnlyOldestOverflowMessages() {
        String sessionId = "doc:10:1";
        List<ChatMessage> history = new ArrayList<>();
        for (int i = 0; i < 2002; i++) {
            ChatMessage item = message(i % 2 == 0 ? "user" : "assistant", "消息-" + i);
            item.setId((long) i + 1);
            history.add(item);
        }
        when(chatMessageRepository.findBySessionIdOrderByCreateTimeAsc(sessionId))
                .thenReturn(history);

        chatHistoryService.saveTurn(sessionId, 10L, null, 1L, "新问题", "新回答");

        // subList(0, 2) 正是排序后最旧的两条，较新的 2000 条应继续保留
        verify(chatMessageRepository).deleteAll(history.subList(0, 2));
    }

    /** 清空操作必须带用户 ID，不能只按资源 ID 删除所有人的历史。 */
    @Test
    void clearHistoryIsScopedByResourceAndUser() {
        chatHistoryService.clearDocHistory(10L, 1L);
        chatHistoryService.clearNotebookHistory(20L, 1L);

        verify(chatMessageRepository).deleteByDocumentIdAndUserId(10L, 1L);
        verify(chatMessageRepository).deleteByNotebookIdAndUserId(20L, 1L);
    }

    /** 定时任务应把“当前时间减 7 天”作为过期删除截止时间。 */
    @Test
    void expiredHistoryUsesSevenDayCutoff() {
        LocalDateTime earliestExpected = LocalDateTime.now().minusDays(7).minusSeconds(1);

        chatHistoryService.cleanExpiredHistory();

        LocalDateTime latestExpected = LocalDateTime.now().minusDays(7).plusSeconds(1);
        ArgumentCaptor<LocalDateTime> cutoffCaptor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(chatMessageRepository).deleteExpired(cutoffCaptor.capture());
        LocalDateTime actualCutoff = cutoffCaptor.getValue();

        assertTrue(actualCutoff.isAfter(earliestExpected));
        assertTrue(actualCutoff.isBefore(latestExpected));
    }

    /** 创建最小化聊天实体，供角色转换和截断测试复用。 */
    private ChatMessage message(String role, String content) {
        ChatMessage message = new ChatMessage();
        message.setRole(role);
        message.setContent(content);
        message.setCreateTime(LocalDateTime.now());
        return message;
    }
}
