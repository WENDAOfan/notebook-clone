# Day 12：Spring Security + BCrypt 实现用户注册与登录

> **核心目标**：引入 Spring Security 框架，使用 BCrypt 算法对密码进行加密存储，实现安全的用户注册和登录接口。理解为什么不能用明文存储密码，掌握单向散列（Hash）的基本概念。

---

## 背景知识

### 当前问题：明文密码

Day 11 的 UserController 创建用户时，密码是直接明文存储的：

```json
POST /api/users
{ "username": "zhangsan", "password": "123456" }  // 明文密码直接存数据库！
```

**明文存储的危害**：
| 风险 | 说明 |
|------|------|
| 数据库泄露 | 如果数据库被攻击，所有用户的密码直接暴露 |
| 内部人员风险 | 运维/DBA 可以直接看到用户密码 |
| 用户习惯问题 | 很多用户多个网站用同一个密码，一旦泄露影响巨大 |

### 解决方案：BCrypt 加密

**BCrypt** 是一种**单向散列算法**，特点：
- **单向性**：明文 → 密文容易，密文 → 明文几乎不可能
- **自动加盐**：每次加密都自动生成随机盐值，相同密码加密结果不同
- **慢计算**：故意设计得计算慢，增加暴力破解成本

```
明文密码: "123456"
         ↓ BCrypt 加密
密文: "$2a$10$N9qo8uLOickgx2ZMRZoMy.Mqrq..." (每次都不一样)
```

### Spring Security 是什么

Spring Security 是 Spring 生态的安全框架，提供：
- 认证（Authentication）：验证"你是谁"（用户名+密码校验）
- 授权（Authorization）：验证"你能做什么"（权限控制）
- 密码加密：内置 BCryptPasswordEncoder

**Day 12 只用到**：密码加密 + 最基础的登录验证（不配置复杂的过滤器链）

---

## 任务规划（共 5 步）

### 第 1 步：添加 Spring Security 依赖

**文件：** `pom.xml`

在 dependencies 中添加：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
```

**注意**：添加 Security 后，Spring Boot 会自动启用安全防护，所有接口默认需要登录。我们稍后在 SecurityConfig 中配置放行规则。

**要学到的**：
- Spring Security 是 Spring Boot 的"一等公民"依赖，添加即生效
- 默认行为是"先保护一切"，需要显式配置放行

---

### 第 2 步：配置 Spring Security

**文件：** `src/main/java/com/example/notebookclone/config/SecurityConfig.java`

创建配置类，做两件事：
1. 配置 BCryptPasswordEncoder Bean（用于加密/校验密码）
2. 配置 SecurityFilterChain（放行注册/登录接口，禁用 Session）

```java
package com.example.notebookclone.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /**
     * 配置密码加密器
     * BCrypt 是 Spring Security 推荐的加密方式
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /**
     * 配置安全过滤器链
     * Day 12 目标：放行注册和登录接口，禁用默认表单登录
     */
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 禁用 CSRF（因为我们后续用 JWT，不需要 Session）
            .csrf(csrf -> csrf.disable())
            
            // 配置无状态会话（不创建 Session）
            .sessionManagement(session -> 
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            
            // 配置授权规则
            .authorizeHttpRequests(auth -> auth
                // 放行注册和登录接口（无需认证）
                .requestMatchers("/api/auth/**").permitAll()
                // 放行 Day 11 的测试接口（临时）
                .requestMatchers("/api/users/**").permitAll()
                .requestMatchers("/api/notebooks/**").permitAll()
                .requestMatchers("/api/documents/**").permitAll()
                // 其他请求需要认证
                .anyRequest().authenticated()
            );
        
        return http.build();
    }
}
```

**配置说明**：
| 配置项 | 作用 |
|--------|------|
| `csrf().disable()` | 关闭跨站请求伪造保护（后续用 JWT 不需要） |
| `STATELESS` | 不创建 Session，每个请求独立（为 Day 13 JWT 做准备） |
| `requestMatchers().permitAll()` | 指定路径无需登录即可访问 |

**要学到的**：
- Spring Security 6+ 使用 Lambda 风格配置
- 链式配置的顺序很重要，`.anyRequest().authenticated()` 要放最后

---

### 第 3 步：改造 User 实体，添加密码相关方法

**文件：** `src/main/java/com/example/notebookclone/entity/User.java`

保持不变，但要知道 `password` 字段现在存储的是 BCrypt 密文，不再是明文。

---

### 第 4 步：创建认证服务 AuthService

**文件：** `src/main/java/com/example/notebookclone/service/AuthService.java`

将注册和登录的业务逻辑抽离到 Service 层，Controller 只负责接收请求和返回结果。

```java
package com.example.notebookclone.service;

import com.example.notebookclone.entity.User;
import com.example.notebookclone.repository.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    // 构造器注入（Spring 会自动注入 Bean）
    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * 用户注册
     * @param username 用户名
     * @param password 明文密码
     * @return 注册成功的用户（密码已加密）
     */
    public User register(String username, String password) {
        // 1. 检查用户名是否已存在
        if (userRepository.existsByUsername(username)) {
            throw new RuntimeException("用户名已被注册");
        }

        // 2. 创建用户实体
        User user = new User();
        user.setUsername(username);
        
        // 3. 使用 BCrypt 加密密码（关键！）
        String encryptedPassword = passwordEncoder.encode(password);
        user.setPassword(encryptedPassword);

        // 4. 保存到数据库
        return userRepository.save(user);
    }

    /**
     * 用户登录（校验用户名和密码）
     * @param username 用户名
     * @param password 明文密码（用户输入的）
     * @return 登录成功的用户
     */
    public User login(String username, String password) {
        // 1. 查找用户
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户名或密码错误"));

        // 2. 校验密码（关键！）
        // passwordEncoder.matches(明文, 密文) → 返回 true/false
        if (!passwordEncoder.matches(password, user.getPassword())) {
            throw new RuntimeException("用户名或密码错误");
        }

        // 3. 登录成功，返回用户信息
        return user;
    }
}
```

**核心方法解析**：
| 方法 | 作用 | 示例 |
|------|------|------|
| `passwordEncoder.encode(明文)` | 加密明文密码 | `"123456"` → `"$2a$10$..."` |
| `passwordEncoder.matches(明文, 密文)` | 校验密码是否匹配 | 比较用户输入 vs 数据库存储 |

**要学到的**：
- 永远不要自己实现加密算法，用框架提供的 `PasswordEncoder`
- 登录时统一返回"用户名或密码错误"，不要暴露是用户名不存在还是密码错误（防止枚举攻击）

---

### 第 5 步：创建 AuthController（注册/登录接口）

**文件：** `src/main/java/com/example/notebookclone/controller/AuthController.java`

```java
package com.example.notebookclone.controller;

import com.example.notebookclone.common.Result;
import com.example.notebookclone.entity.User;
import com.example.notebookclone.service.AuthService;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * 用户注册
     * POST /api/auth/register
     */
    @PostMapping("/register")
    public Result<User> register(@RequestBody RegisterRequest request) {
        User user = authService.register(request.username(), request.password());
        return Result.success(user);
    }

    /**
     * 用户登录
     * POST /api/auth/login
     * Day 12 版本：只返回用户信息（不含密码）
     * Day 13 版本：将返回 JWT Token
     */
    @PostMapping("/login")
    public Result<User> login(@RequestBody LoginRequest request) {
        User user = authService.login(request.username(), request.password());
        return Result.success(user);
    }

    /**
     * 内部类：注册请求 DTO
     */
    public record RegisterRequest(
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}

    /**
     * 内部类：登录请求 DTO
     */
    public record LoginRequest(
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}
}
```

**接口说明**：
| 接口 | 方法 | 请求体 | 响应 |
|------|------|--------|------|
| 注册 | POST /api/auth/register | `{ "username": "xxx", "password": "xxx" }` | `Result<User>`（密码已加密） |
| 登录 | POST /api/auth/login | `{ "username": "xxx", "password": "xxx" }` | `Result<User>`（Day 13 改为 Token） |

**要学到的**：
- 使用 Java Record 作为简单的 DTO（请求体映射）
- `@NotBlank` 校验配合 `@Valid` 使用（别忘了加！）

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `pom.xml` | 新增依赖 | spring-boot-starter-security |
| `config/SecurityConfig.java` | **新建** | Security 配置类（BCrypt Bean + 放行规则） |
| `service/AuthService.java` | **新建** | 注册/登录业务逻辑，含密码加密/校验 |
| `controller/AuthController.java` | **新建** | 注册/登录接口（/api/auth/register、/api/auth/login） |
| `controller/UserController.java` | 建议删除或标记废弃 | 被 AuthController 取代，建议后续删除 |

---

## 数据库表结构

`users` 表结构不变，但 `password` 字段存储的内容变了：

```
Day 11（明文）: password = "123456"
Day 12（密文）: password = "$2a$10$N9qo8uLOickgx2ZMRZoMy.Mqrq..."
                              ↑
                        BCrypt 加密后的结果（60位字符串）
```

---

## 测试步骤

### 1. 测试注册

```bash
POST http://localhost:8080/api/auth/register
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}
```

**预期响应**：
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "id": 1,
    "username": "zhangsan",
    "password": "$2a$10$N9qo8uLOickgx2ZMRZoMy.Mqrq...",  // 密文！
    "email": null,
    "createdAt": "2026-04-06T10:00:00",
    "updatedAt": "2026-04-06T10:00:00"
  }
}
```

### 2. 测试登录（正确密码）

```bash
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}
```

**预期响应**：返回用户信息（200 成功）

### 3. 测试登录（错误密码）

```bash
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "wrongpassword"
}
```

**预期响应**：
```json
{
  "code": 500,
  "message": "用户名或密码错误",
  "data": null
}
```

### 4. 验证数据库

```sql
SELECT * FROM users WHERE username = 'zhangsan';
```

确认 `password` 字段是以 `$2a$` 开头的 60 位字符串（BCrypt 特征）。

---

## Day 12 完成标志

- [ ] `pom.xml` 已添加 spring-boot-starter-security 依赖
- [ ] `SecurityConfig.java` 创建完成，配置了 BCryptPasswordEncoder Bean
- [ ] `/api/auth/**` 路径已放行，其他接口需要认证
- [ ] `AuthService.java` 实现 register() 和 login()，使用 BCrypt 加密和校验
- [ ] `AuthController.java` 提供注册/登录 REST 接口
- [ ] 注册新用户后，数据库中 password 字段存储的是 BCrypt 密文（非明文）
- [ ] 登录时，正确密码返回成功，错误密码返回"用户名或密码错误"
- [ ] `api.http` 添加注册/登录接口测试
- [ ] Git 提交：`git commit -m "feat: Day12 引入 Spring Security + BCrypt 实现用户注册登录"`

---

## 核心知识点总结

### 1. 为什么不能明文存储密码？

| 明文存储 | 加密存储 |
|---------|---------|
| 数据库泄露 = 密码全暴露 | 数据库泄露 = 拿到的是密文，难以破解 |
| 内部人员可直接看到密码 | 内部人员也看不到原始密码 |
| 用户在其他网站的账号也危险 | 即使密文泄露，也难以反推出原始密码 |

### 2. 什么是单向散列（Hash）？

```
明文 → [Hash 算法] → 密文（固定长度）
         ↑
    单向！不可逆！

就像把肉绞成肉馅，无法从肉馅还原成原来的肉
```

常用 Hash 算法：MD5（已淘汰）、SHA-256、BCrypt（推荐）

### 3. 为什么用 BCrypt 而不是 MD5？

| 特性 | MD5 | BCrypt |
|------|-----|--------|
| 速度 | 极快（不安全） | 慢（安全） |
| 盐值 | 无（相同输入相同输出） | 自动加盐（相同输入不同输出） |
| 抗彩虹表 | 弱 | 强 |

**慢是优点**：让暴力破解成本变高，攻击者算不起

### 4. Spring Security 的密码校验流程

```
用户登录
  ↓
输入: username="zhangsan", password="123456"（明文）
  ↓
查询数据库: user.password = "$2a$10$..."（密文）
  ↓
passwordEncoder.matches("123456", "$2a$10$...")
  ↓
BCrypt 提取密文中的盐值，用"123456"+盐值计算哈希
  ↓
比较结果是否匹配密文
  ↓
匹配 → 登录成功 / 不匹配 → 登录失败
```

---

## 下节预告（Day 13）

> **JWT（JSON Web Token）**：实现无状态认证，登录成功后返回 Token，后续请求携带 Token 访问受保护接口。理解 JWT 的三段式结构及无状态特性。
