# Day 13：JWT 无状态认证 — Token 生成与校验

> **核心目标**：引入 JWT（JSON Web Token），实现无状态认证。登录成功后返回 Token，客户端后续请求携带 Token 访问受保护资源。深度理解 JWT 的三段式结构及无状态特性。

---

## 背景知识

### Day 12 的问题：Session 认证

Day 12 登录成功后，我们返回了完整的用户信息：

```json
{
  "code": 200,
  "data": {
    "id": 1,
    "username": "zhangsan",
    "password": "$2a$10$..."  // ⚠️ 密码也返回了！
  }
}
```

**问题**：
1. **返回了密码**（即使是密文，也不应该返回）
2. **服务端需要维护 Session** - 每次请求都要查数据库验证用户身份
3. **不适合分布式/前后端分离** - 多台服务器之间 Session 难以共享

### 解决方案：JWT 无状态认证

**JWT（JSON Web Token）** 是一种**无状态**的认证机制：

```
┌─────────────┐      登录      ┌─────────────┐
│   客户端     │ ───────────→  │   服务端     │
│  (浏览器)    │  username/    │  验证密码     │
│             │  password     │  生成 JWT     │
│             │ ←───────────  │             │
│   存储 JWT   │   返回 Token   │             │
└─────────────┘               └─────────────┘
        │
        │ 后续请求携带 Token
        ▼
┌─────────────┐      请求      ┌─────────────┐
│ Authorization:│ ───────────→  │   服务端     │
│ Bearer xxx   │               │  校验 Token  │
│              │ ←───────────  │  有效→放行   │
│   获取资源    │    返回数据    │  无效→拒绝   │
└─────────────┘               └─────────────┘
```

**无状态的含义**：服务端不存储任何会话信息，所有认证信息都在 Token 里。

### JWT 的三段式结构

JWT 字符串由三部分组成，用 `.` 分隔：

```
xxxxx.yyyyy.zzzzz
  ↑      ↑      ↑
Header  Payload  Signature
（头部） （载荷）  （签名）
```

**1. Header（头部）**
```json
{
  "alg": "HS256",  // 签名算法
  "typ": "JWT"     // Token 类型
}
```
Base64Url 编码 → `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`

**2. Payload（载荷）** - 存放数据
```json
{
  "sub": "zhangsan",    // 主题（用户名）
  "userId": 1,          // 自定义字段
  "iat": 1712380800,    // 签发时间
  "exp": 1712384400     // 过期时间
}
```
Base64Url 编码 → `eyJzdWIiOiJ6aGFuZ3NhbiIsInVzZXJJZCI6MX0`

**3. Signature（签名）** - 防篡改
```
HMACSHA256(
  base64Url(header) + "." + base64Url(payload),
  secret  // 密钥，只有服务端知道
)
```

**关键点**：
- Header 和 Payload 只是 Base64 编码，**可以被解码看到内容**（不要放敏感信息）
- Signature 是加密的，**用于验证 Token 是否被篡改**
- 没有密钥，无法伪造有效的 Signature

---

## 任务规划（共 4 步）

### 第 1 步：添加 JWT 依赖

**文件：** `pom.xml`

```xml
<!-- JWT 依赖（jjwt） -->
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-api</artifactId>
    <version>0.12.3</version>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-impl</artifactId>
    <version>0.12.3</version>
    <scope>runtime</scope>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-jackson</artifactId>
    <version>0.12.3</version>
    <scope>runtime</scope>
</dependency>
```

**说明**：
- `jjwt-api`：API 接口
- `jjwt-impl`：实现类（runtime 表示编译时不需要，运行时加载）
- `jjwt-jackson`：用于处理 JSON（runtime）

---

### 第 2 步：配置 JWT 密钥和过期时间

**文件：** `application.properties`

在原有配置基础上添加：

```properties
# JWT 配置
# 密钥（至少 256 位，建议用随机字符串）
jwt.secret=your-256-bit-secret-your-256-bit-secret
# Token 过期时间（毫秒），24 小时 = 86400000
jwt.expiration=86400000
```

**生产环境建议**：
- 密钥不要用简单的字符串，应该用随机生成的复杂字符串
- 密钥要保密，不要提交到 Git

---

### 第 3 步：创建 JwtUtil 工具类

**文件：** `src/main/java/com/example/notebookclone/util/JwtUtil.java`

```java
package com.example.notebookclone.util;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

@Component
public class JwtUtil {

    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.expiration}")
    private Long expiration;

    private SecretKey getSigningKey() {
        return Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 生成 JWT Token
     * @param userId 用户ID
     * @param username 用户名
     * @return Token 字符串
     */
    public String generateToken(Long userId, String username) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + expiration);

        // 自定义声明（Payload 中的数据）
        Map<String, Object> claims = new HashMap<>();
        claims.put("userId", userId);
        claims.put("username", username);

        return Jwts.builder()
                .claims(claims)              // 自定义数据
                .subject(username)           // 主题
                .issuedAt(now)               // 签发时间
                .expiration(expiryDate)      // 过期时间
                .signWith(getSigningKey())   // 签名
                .compact();
    }

    /**
     * 从 Token 中提取用户ID
     */
    public Long getUserIdFromToken(String token) {
        Claims claims = parseToken(token);
        return claims.get("userId", Long.class);
    }

    /**
     * 从 Token 中提取用户名
     */
    public String getUsernameFromToken(String token) {
        Claims claims = parseToken(token);
        return claims.get("username", String.class);
    }

    /**
     * 解析 Token 获取 Claims
     */
    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    /**
     * 验证 Token 是否有效
     */
    public boolean validateToken(String token) {
        try {
            parseToken(token);
            return true;
        } catch (ExpiredJwtException e) {
            System.out.println("Token 已过期");
        } catch (UnsupportedJwtException e) {
            System.out.println("Token 格式不支持");
        } catch (MalformedJwtException e) {
            System.out.println("Token 格式错误");
        } catch (SignatureException e) {
            System.out.println("Token 签名验证失败");
        } catch (IllegalArgumentException e) {
            System.out.println("Token 为空或非法");
        }
        return false;
    }

    /**
     * 判断 Token 是否过期
     */
    public boolean isTokenExpired(String token) {
        try {
            Claims claims = parseToken(token);
            return claims.getExpiration().before(new Date());
        } catch (ExpiredJwtException e) {
            return true;
        }
    }
}
```

**核心方法解析**：

| 方法 | 作用 |
|------|------|
| `generateToken()` | 根据 userId 和 username 生成 JWT |
| `parseToken()` | 解析 Token，提取 Claims（会验证签名） |
| `validateToken()` | 验证 Token 是否有效（捕获各种异常） |
| `getUserIdFromToken()` | 从 Token 中提取用户ID |

---

### 第 4 步：改造登录接口，返回 Token

**文件：** `src/main/java/com/example/notebookclone/controller/AuthController.java`

**修改内容**：

1. 注入 `JwtUtil`
2. 修改 `login()` 方法，登录成功后返回 Token
3. 创建新的返回 DTO（只返回必要信息，不返回密码）

```java
package com.example.notebookclone.controller;

import com.example.notebookclone.common.Result;
import com.example.notebookclone.entity.User;
import com.example.notebookclone.service.AuthService;
import com.example.notebookclone.util.JwtUtil;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final JwtUtil jwtUtil;

    public AuthController(AuthService authService, JwtUtil jwtUtil) {
        this.authService = authService;
        this.jwtUtil = jwtUtil;
    }

    /**
     * 用户注册
     * POST /api/auth/register
     */
    @PostMapping("/register")
    public Result<User> register(@Valid @RequestBody RegisterRequest request) {
        User user = authService.register(request.username(), request.password());
        return Result.success(user);
    }

    /**
     * 用户登录
     * POST /api/auth/login
     * Day 13 版本：返回 JWT Token
     */
    @PostMapping("/login")
    public Result<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        // 1. 验证用户名密码
        User user = authService.login(request.username(), request.password());

        // 2. 生成 JWT Token
        String token = jwtUtil.generateToken(user.getId(), user.getUsername());

        // 3. 构造响应（不返回密码）
        LoginResponse response = new LoginResponse(
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                token
        );

        return Result.success(response);
    }

    /**
     * 获取当前登录用户信息（测试接口）
     * GET /api/auth/me
     * 需要在请求头中携带：Authorization: Bearer <token>
     */
    @GetMapping("/me")
    public Result<UserInfoResponse> getCurrentUser(
            @RequestHeader("Authorization") String authHeader) {
        
        // 1. 从 Header 中提取 Token（去掉 "Bearer " 前缀）
        String token = authHeader.replace("Bearer ", "");

        // 2. 验证 Token
        if (!jwtUtil.validateToken(token)) {
            return Result.fail("Token 无效或已过期");
        }

        // 3. 从 Token 中提取用户信息
        Long userId = jwtUtil.getUserIdFromToken(token);
        String username = jwtUtil.getUsernameFromToken(token);

        // 4. 返回用户信息
        UserInfoResponse response = new UserInfoResponse(userId, username);
        return Result.success(response);
    }

    // ========== DTO 定义 ==========

    public record RegisterRequest(
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}

    public record LoginRequest(
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}

    /**
     * 登录响应（包含 Token）
     */
    public record LoginResponse(
            Long id,
            String username,
            String email,
            String token  // JWT Token
    ) {}

    /**
     * 用户信息响应（不包含敏感信息）
     */
    public record UserInfoResponse(
            Long userId,
            String username
    ) {}
}
```

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `pom.xml` | 新增依赖 | jjwt-api、jjwt-impl、jjwt-jackson |
| `application.properties` | 新增配置 | jwt.secret、jwt.expiration |
| `util/JwtUtil.java` | **新建** | Token 生成、解析、校验工具类 |
| `controller/AuthController.java` | **修改** | login 返回 Token，新增 /me 测试接口 |

---

## 测试步骤

### 1. 测试登录（获取 Token）

```bash
POST http://localhost:8080/api/auth/login
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
    "email": null,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiemhhbmdzYW4iLCJzdWIiOiJ6aGFuZ3NhbiIsImlhdCI6MTcxMjM4MDgwMCwiZXhwIjoxNzEyMzgwODAwfQ.xxxxx"
  }
}
```

### 2. 测试携带 Token 访问 /me 接口

```bash
GET http://localhost:8080/api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx.yyyyy
```

**预期响应**：
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "userId": 1,
    "username": "zhangsan"
  }
}
```

### 3. 测试无效 Token

```bash
GET http://localhost:8080/api/auth/me
Authorization: Bearer invalid.token.here
```

**预期响应**：
```json
{
  "code": 500,
  "message": "Token 无效或已过期",
  "data": null
}
```

### 4. 解码 JWT（在线工具验证）

访问 [jwt.io](https://jwt.io)，把 token 粘贴进去，可以看到：

```json
// Header
{
  "alg": "HS256",
  "typ": "JWT"
}

// Payload
{
  "userId": 1,
  "username": "zhangsan",
  "sub": "zhangsan",
  "iat": 1712380800,
  "exp": 1712467200
}
```

---

## Day 13 完成标志

- [ ] `pom.xml` 已添加 jjwt 依赖
- [ ] `application.properties` 配置了 jwt.secret 和 jwt.expiration
- [ ] `JwtUtil.java` 创建完成，包含 generateToken、parseToken、validateToken 方法
- [ ] 登录接口返回的不再是用户信息，而是包含 token 的 LoginResponse
- [ ] `/api/auth/me` 接口可以校验 Token 并返回用户信息
- [ ] `api.http` 添加登录获取 Token、携带 Token 访问 /me 的测试
- [ ] 用 jwt.io 验证 Token 结构正确（Header、Payload、Signature）
- [ ] Git 提交：`git commit -m "feat: Day13 引入 JWT，实现 Token 生成与校验"`

---

## 核心知识点总结

### 1. Session vs JWT 对比

| 特性 | Session | JWT |
|------|---------|-----|
| 存储位置 | 服务端内存 | 客户端（浏览器 localStorage/cookie）|
| 服务端状态 | 有状态（需要维护 Session）| 无状态（不存储会话）|
| 分布式支持 | 差（需要共享 Session）| 好（每台服务器独立验证）|
| 性能 | 需要查数据库/缓存 | 直接解析 Token，更快 |
| 安全性 | 较好（Session ID 随机）| 依赖密钥保密 |
| 过期控制 | 服务端可控 | Token 签发后无法提前失效（需要黑名单机制）|

### 2. JWT 适合的场景

✅ **适合使用 JWT**：
- 分布式系统/微服务
- 前后端分离应用
- 单点登录（SSO）
- 移动端 App

❌ **不适合使用 JWT**：
- 需要随时撤销会话（比如后台踢人下线）
- Token 里需要存大量数据（Payload 有大小限制）

### 3. JWT 安全最佳实践

1. **密钥保密** - 不要提交到 Git，生产环境用环境变量
2. **设置过期时间** - 不要太长（建议 1-24 小时）
3. **使用 HTTPS** - 防止 Token 被中间人窃取
4. **不要存放敏感信息** - Payload 只是 Base64 编码，可以被解码
5. **刷新 Token 机制** - 短有效期 Token + 长有效期 Refresh Token

### 4. HTTP Header 中的 Authorization

```
Authorization: Bearer <token>
          ↑       ↑
        头部名   类型（Bearer 表示令牌）
```

这是标准的 HTTP 认证头部格式，前端发送请求时需要带上：

```javascript
fetch('/api/auth/me', {
  headers: {
    'Authorization': 'Bearer ' + localStorage.getItem('token')
  }
})
```

---

## 下节预告（Day 14）

> **JWT 过滤器**：编写 JWT 认证过滤器，自动从请求头中提取并校验 Token，让受保护接口无需在每个 Controller 里手动校验。理解 Servlet Filter 链的工作原理。
