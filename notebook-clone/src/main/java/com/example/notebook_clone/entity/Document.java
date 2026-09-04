package com.example.notebook_clone.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonProperty.Access;

import lombok.Data;
import lombok.ToString;
import lombok.EqualsAndHashCode;
import jakarta.validation.constraints.NotBlank;

@Data
@ToString(exclude = {"notebook", "user"})
@EqualsAndHashCode(exclude = {"notebook", "user"})
@Entity
public class Document {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 关键字段：记录这张资料纸属于哪个活页夹 (Notebook 的 ID)
    //private Long notebookId;
    // 第 13-14 行，把被注释的 notebookId 替换成：
    @ManyToOne
    @JoinColumn(name = "notebook_id")
    @JsonIgnore  // ← 添加这行：序列化时不输出 notebook 字段，避免死循环
    private Notebook notebook;

    // 关联用户（Day 15 新增）
    @ManyToOne
    @JoinColumn(name = "user_id")
    @JsonProperty(access = Access.WRITE_ONLY)
    private User user;

    // 资料的标题（比如：Spring教程.pdf）
    @NotBlank(message = "文档标题不能为空")
    private String title;

    // PostgreSQL 的 TEXT 类型可存无限文本（不像 MySQL 需要 LONGTEXT）
    // 注意：不能用 @Lob，PostgreSQL 的 @Lob 会走 Large Object 子系统，导致 JSON 序列化时报错
    @Column(columnDefinition = "TEXT")
    private String content;
    // ===== Day 20 新增：AI 生成的文档摘要 =====
    @Column(columnDefinition = "TEXT")
    private String summary;
    // =========================================
    private LocalDateTime createTime;

    // ===== Day 29 新增：文档分块数量（用于删除时清理向量库）=====
    private Integer chunkCount;
    // ============================================================

}