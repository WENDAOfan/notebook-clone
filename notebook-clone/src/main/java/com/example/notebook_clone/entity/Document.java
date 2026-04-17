package com.example.notebook_clone.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonProperty.Access;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;

@Data
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

    // 🌟 核心魔法：默认的 String 在 MySQL 里只能存 255 个字符
    // 加上这个注解，告诉 MySQL 把这个字段设为 LONGTEXT，可以存 40 亿个字符！
    @Column(columnDefinition = "LONGTEXT")
    private String content;

    private LocalDateTime createTime;

}