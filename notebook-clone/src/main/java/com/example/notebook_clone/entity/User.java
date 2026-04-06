package com.example.notebook_clone.entity;
import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
// @Entity 告诉 JPA：这是一个要映射到数据库的表
@Data
@Entity
@Table(name = "users")  // 明确指定表名为 users（默认会是 user）
// 如果不写，JPA 默认用类名小写 → 表名会是 "user"
public class User {
    // ===== 主键 =====
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    // ===== 用户基本信息 =====
    // unique = true → 数据库层面保证用户名不重复！
    // nullable = false → 不能为空
    @Column(nullable = false, unique = true)
    private String username;
     // 密码字段（Day 12 会用 BCrypt 加密存储）
    @Column(nullable = false)
    private String password;
    // 邮箱是可选的，不加约束
    private String email;

    // ===== 时间戳（工程好习惯）=====
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ===== 关联关系：一个用户拥有多个笔记本 =====
    // mappedBy = "user" → 告诉 JPA：关系的维护端在 Notebook 那边的 user 字段
    // cascade = CascadeType.ALL → 删除用户时，级联删除他的所有笔记本（后续可以调整）
    // FetchType.LAZY → 懒加载，查询用户时不立即查出所有笔记本（性能优化）
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<Notebook> notebooks = new ArrayList<>();
    // ===== 生命周期回调（自动维护时间戳）=====
    // @PrePersist → 在第一次保存到数据库之前自动调用
    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }
    // @PreUpdate → 在每次更新数据库之前自动调用
    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
