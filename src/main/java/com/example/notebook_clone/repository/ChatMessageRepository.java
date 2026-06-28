package com.example.notebook_clone.repository;

import com.example.notebook_clone.entity.ChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {

    /** 按会话 ID 查询历史，按时间升序 */
    List<ChatMessage> findBySessionIdOrderByCreateTimeAsc(String sessionId);

    /** 统计某个会话的消息数 */
    long countBySessionId(String sessionId);

    /** 删除某个文档的所有对话历史 */
    void deleteByDocumentIdAndUserId(Long documentId, Long userId);

    /** 删除某个笔记本的所有对话历史 */
    void deleteByNotebookIdAndUserId(Long notebookId, Long userId);

    /** 清理过期历史 */
    @Modifying
    @Query("DELETE FROM ChatMessage c WHERE c.createTime < :cutoff")
    void deleteExpired(@Param("cutoff") LocalDateTime cutoff);
}
