package com.example.notebook_clone.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
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
    private Notebook notebook;
    // 资料的标题（比如：Spring教程.pdf）
    @NotBlank(message = "文档标题不能为空")
    private String title;

    // 🌟 核心魔法：默认的 String 在 MySQL 里只能存 255 个字符
    // 加上这个注解，告诉 MySQL 把这个字段设为 LONGTEXT，可以存 40 亿个字符！
    @Column(columnDefinition = "LONGTEXT")
    private String content;

    private LocalDateTime createTime;

    // --- 下面是标准的 Getter 和 Setter 方法 ---
    //只注释不删除是为了记录过程
    // public Long getId() { return id; }
    // public void setId(Long id) { this.id = id; }

    // // public Long getNotebookId() { return notebookId; }
    // // public void setNotebookId(Long notebookId) { this.notebookId = notebookId; }
    // public Notebook getNotebook() { return notebook; }
    // public void setNotebook(Notebook notebook) { this.notebook = notebook; }
    // public String getTitle() { return title; }
    // public void setTitle(String title) { this.title = title; }

    // public String getContent() { return content; }
    // public void setContent(String content) { this.content = content; }

    // public LocalDateTime getCreateTime() { return createTime; }
    // public void setCreateTime(LocalDateTime createTime) { this.createTime = createTime; }
}