package com.example.notebook_clone.entity;
import java.util.List;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Data;  // ← 在文件顶部加这个 import
import lombok.ToString;
import lombok.EqualsAndHashCode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonProperty.Access;


// @Entity 告诉 JPA：这是一个要映射到数据库里的表
@Data
@ToString(exclude = {"documents", "user"})
@EqualsAndHashCode(exclude = {"documents", "user"})
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
    // ===== 多对一关系：笔记本属于某个用户 =====
    // @ManyToOne 表示：多个笔记本可以属于同一个用户
    // @JoinColumn(name = "user_id") → 在 notebooks 表创建 user_id 外键列
    // @JsonIgnore → 避免 JSON 序列化时出现 User ↔ Notebook 无限循环
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    @JsonProperty(access = Access.WRITE_ONLY)
    private User user;
}
