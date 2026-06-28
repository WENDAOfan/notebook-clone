package com.example.notebook_clone.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

import lombok.Data;

/**
 * Day 30：对话消息实体
 * 用于存储用户与 AI 的多轮对话历史，实现上下文连续对话
 */
@Data
@Entity
@Table(name = "chat_message", indexes = {
    @Index(name = "idx_chat_session", columnList = "sessionId"),
    @Index(name = "idx_chat_created", columnList = "createTime")
})
public class ChatMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 会话 ID：格式为 "doc:{documentId}:{userId}" 或 "notebook:{notebookId}:{userId}" */
    @Column(nullable = false)
    private String sessionId;

    /** 消息角色：user / assistant */
    @Column(nullable = false, length = 20)
    private String role;

    /** 消息内容 */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    /** 关联的文档 ID（文档级对话时） */
    private Long documentId;

    /** 关联的笔记本 ID（笔记本级对话时） */
    private Long notebookId;

    /** 关联的用户 ID */
    @Column(nullable = false)
    private Long userId;

    @Column(nullable = false)
    private LocalDateTime createTime;
}
