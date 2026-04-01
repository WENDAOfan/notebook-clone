package com.example.notebook_clone.entity;
import java.util.List;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Data;  // ← 在文件顶部加这个 import
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;


// @Entity 告诉 JPA：这是一个要映射到数据库里的表
@Data
@Entity
public class Notebook {

    // @Id 表示这是主键
    // @GeneratedValue 表示 ID 是自动递增的
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    //笔记的标题/名称
    @NotBlank(message = "笔记本名称不能为空")
    @Size(max = 100, message = "名称不能超过100个字符")
    private String name;
    //笔记的描述/详细内容
    @Size(max = 500, message = "描述不能超过500个字符")
    private String description;
    //创建时间
    private LocalDateTime createTime;

    // 🌟 企业级魔法：建立一对多关联，并开启级联删除
    // @OneToMany 表示：一个活页夹 (Notebook) 对应多张资料纸 (Document)
    // cascade = CascadeType.ALL 表示：对我（活页夹）做的所有操作（包括删除），都要牵连到里面的资料纸
    // orphanRemoval = true 启用级联操作，对父实体的所有操作（增删改查）都会自动应用到关联的子实体
    // 表示：如果活页夹没了，里面的资料纸就成了孤儿，直接从数据库里抹除
    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, mappedBy = "notebook")
    private List<Document> documents = new java.util.ArrayList<>();

    // --- 下面是标准的 Getter 和 Setter 方法，用于读取和修改属性 ---
    // (在企业开发中通常会用 Lombok 插件来省略这些代码，但今天我们手写最底层的逻辑)
    //3.31,已使用Lombok
    // public Long getId() { return id; }
    // public void setId(Long id) { this.id = id; }

    // public String getName() { return name; }
    // public void setName(String name) { this.name = name; }

    // public String getDescription() { return description; }
    // public void setDescription(String description) { this.description = description; }

    // public LocalDateTime getCreateTime() { return createTime; }
    // public void setCreateTime(LocalDateTime createTime) { this.createTime = createTime; }
    // public List<Document> getDocuments() { return documents; }
    // public void setDocuments(List<Document> documents) { this.documents = documents; }
}
