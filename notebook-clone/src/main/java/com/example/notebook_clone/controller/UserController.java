package com.example.notebook_clone.controller;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.repository.UserRepository;
import org.springframework.web.bind.annotation.*;

import java.util.List;

// @RestController = @Controller + @ResponseBody
// 表示这个类的每个方法返回值都会自动转成 JSON 格式
@RestController
@RequestMapping("/api/users")
public class UserController {

    // 通过构造器注入 UserRepository（依赖注入）
    private final UserRepository userRepository;

    public UserController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    // ========== 接口 1：获取所有用户列表 ==========
    @GetMapping
    public Result<List<User>> getAllUsers() {
        // 调用管家的 findAll()，查出所有用户
        return Result.success(userRepository.findAll());
    }

    // ========== 接口 2：根据 ID 获取用户详情 ==========
    // {id} 是路径变量，比如 /api/users/1 → id = 1
    @GetMapping("/{id}")
    public Result<User> getUserById(@PathVariable Long id) {
        // findById 返回 Optional<User>
        // .orElseThrow()：如果找不到就抛异常
        User user = userRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("用户不存在，ID: " + id));
        return Result.success(user);
    }

    // ========== 接口 3：创建用户（注册的基础版本）==========
    // @RequestBody：把请求体中的 JSON 自动转成 User 对象
    @PostMapping
    public Result<User> createUser(@RequestBody User user) {
        // 检查用户名是否已被注册
        if (userRepository.existsByUsername(user.getUsername())) {
            return Result.fail("用户名 \"" + user.getUsername() + "\" 已被占用！");
        }
        // 保存到数据库（@PrePersist 会自动设置 createdAt 和 updatedAt）
        return Result.success(userRepository.save(user));
    }

    // ========== 接口 4：删除用户 ==========
    @DeleteMapping("/{id}")
    public Result<Void> deleteUser(@PathVariable Long id) {
        if (!userRepository.existsById(id)) {
            return Result.fail("删除失败：用户不存在，ID: " + id);
        }
        // 删除用户（由于 cascade = CascadeType.ALL，用户的笔记本也会被级联删除）
        userRepository.deleteById(id);
        return Result.success(null);
    }
}
