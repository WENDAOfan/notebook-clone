package com.example.notebook_clone.repository;

import com.example.notebook_clone.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

// @Repository 标注这是一个数据访问组件（Spring 会自动扫描并注册）
@Repository
// 继承 JpaRepository 后，自动拥有 save/findById/findAll/deleteById 等基础方法
// <User, Long> 表示：管理 User 实体，主键类型是 Long
public interface UserRepository extends JpaRepository<User, Long> {

    // ========== 自定义查询方法（JPA 自动根据方法名生成 SQL）==========

    // 【登录场景】根据用户名查找用户 → 返回 Optional<User>
    // Optional 是一个容器：如果找到了就包装 User，没找到就是 Optional.empty()
    // 比直接返回 User 更安全，避免 NullPointerException！
    Optional<User> findByUsername(String username);

    // 【注册场景】检查用户名是否已存在 → 返回 boolean
    // true = 用户名已被占用，false = 用户名可用
    boolean existsByUsername(String username);
}
