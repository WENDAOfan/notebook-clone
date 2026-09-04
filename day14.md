# Day 14：JWT 过滤器 — 自动校验 Token

> **核心目标**：编写 JWT 认证过滤器，自动从请求头中提取并校验 Token，让受保护接口无需在每个 Controller 里手动校验。理解 Servlet Filter 链的工作原理。

---

## 背景知识

### Day 13 的问题：手动校验 Token

Day 13 我们在 `/api/auth/me` 接口里手动校验 Token：

```java
@GetMapping("/me")
public Result<UserInfoResponse> getCurrentUser(
        @RequestHeader("Authorization") String authHeader) {
    
    // 1. 提取 Token
    String token = authHeader.replace("Bearer ", "");
    
    // 2. 验证 Token
    if (!jwtUtil.validateToken(token)) {
        return Result.fail("Token 无效或已过期");
    }
    
    // 3. 提取用户信息
    Long userId = jwtUtil.getUserIdFromToken(token);
    // ...
}
```

**问题**：
- 每个需要保护的接口都要写一遍校验代码
- 重复代码多，容易遗漏
- Controller 里混入认证逻辑，不够纯粹

### 解决方案：过滤器（Filter）

**Filter 是什么**？

Filter 是 Java Web 的"守门员"，在请求到达 Controller **之前**拦截处理：

```
HTTP 请求 → [Filter 1] → [Filter 2] → [Security Filter] → Controller
                ↑
         在这里统一校验 Token
         校验通过 → 继续往后走
         校验失败 → 直接返回 401
```

**Filter 的优势**：
- 一处配置，全局生效
- Controller 只关心业务，不用管认证
- 符合"职责分离"原则

### Spring Security 的过滤器链

Spring Security 本身就是一个过滤器链：

```
┌─────────────────────────────────────────────────────────────┐
│                    Spring Security Filter Chain              │
├─────────────────────────────────────────────────────────────┤
│ 1. UsernamePasswordAuthenticationFilter  ← 处理表单登录      │
│ 2. BasicAuthenticationFilter              ← 处理 Basic 认证  │
│ 3. BearerTokenAuthenticationFilter        ← 处理 Bearer Token│
│ 4. JWT Authentication Filter (我们自定义)  ← 校验 JWT         │
│ 5. ...                                                      │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
                  Controller
```

我们今天的任务：**创建一个自定义 JWT Filter，插入到 Security 过滤器链中**。

---

## 任务规划（共 4 步）

### 第 1 步：创建 JWT 认证过滤器

**文件：** `src/main/java/com/example/notebookclone/filter/JwtAuthenticationFilter.java`

```java
package com.example.notebookclone.filter;

import com.example.notebookclone.util.JwtUtil;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;

/**
 * JWT 认证过滤器
 * 作用：每次请求时，从请求头中提取 JWT Token 并校验
 * 继承 OncePerRequestFilter 确保每个请求只执行一次
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;

    public JwtAuthenticationFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        
        // 1. 获取请求头中的 Authorization
        String authHeader = request.getHeader("Authorization");

        // 2. 判断是否有 Authorization 头，且以 "Bearer " 开头
        if (!StringUtils.hasText(authHeader) || !authHeader.startsWith("Bearer ")) {
            // 没有 Token，直接放行（后续的 Security 配置会处理无权限访问）
            filterChain.doFilter(request, response);
            return;
        }

        // 3. 提取 Token（去掉 "Bearer " 前缀）
        String token = authHeader.substring(7);

        // 4. 验证 Token
        if (!jwtUtil.validateToken(token)) {
            // Token 无效，返回 401 未授权
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":401,\"message\":\"Token 无效或已过期\",\"data\":null}");
            return;
        }

        // 5. Token 有效，提取用户信息
        Long userId = jwtUtil.getUserIdFromToken(token);
        String username = jwtUtil.getUsernameFromToken(token);

        // 6. 将用户信息存入 SecurityContext（关键！）
        // 这样后续的 Controller 中可以通过 SecurityContextHolder 获取当前用户
        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                        username,           // 主体（用户名）
                        null,               // 凭证（密码，已验证过，这里不传）
                        Collections.emptyList()  // 权限列表（暂时为空，Day 16 再完善）
                );
        
        // 将用户信息设置到 Security 上下文中
        SecurityContextHolder.getContext().setAuthentication(authentication);

        // 7. 放行，继续执行后续的过滤器链
        filterChain.doFilter(request, response);
    }
}
```

**代码解析**：

| 部分 | 作用 |
|------|------|
| `OncePerRequestFilter` | Spring 提供的基类，确保每个请求只过滤一次 |
| `doFilterInternal()` | 核心方法，每个请求都会执行 |
| `request.getHeader()` | 从请求头获取 Authorization |
| `jwtUtil.validateToken()` | 校验 Token 有效性 |
| `SecurityContextHolder` | Spring Security 的上下文，存储当前登录用户信息 |
| `filterChain.doFilter()` | 放行，继续执行后续过滤器或 Controller |

**为什么要把用户信息存入 SecurityContext？**

```java
SecurityContextHolder.getContext().setAuthentication(authentication);
```

这样后续的 Controller 可以通过以下方式获取当前登录用户：

```java
// 在 Controller 中获取当前登录用户
String username = SecurityContextHolder.getContext()
                       .getAuthentication().getName();
```

---

### 第 2 步：修改 SecurityConfig，添加 JWT 过滤器

**文件：** `src/main/java/com/example/notebookclone/config/SecurityConfig.java`

修改现有配置，将 JWT 过滤器加入 Security 过滤器链：

```java
package com.example.notebookclone.config;

import com.example.notebookclone.filter.JwtAuthenticationFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 禁用 CSRF（前后端分离不需要）
            .csrf(csrf -> csrf.disable())
            
            // 配置无状态会话
            .sessionManagement(session -> 
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            
            // 配置授权规则
            .authorizeHttpRequests(auth -> auth
                // 放行注册和登录接口（无需认证）
                .requestMatchers("/api/auth/**").permitAll()
                
                // ❌ 移除之前的临时放行规则
                // .requestMatchers("/api/users/**").permitAll()  // 删除这行
                // .requestMatchers("/api/notebooks/**").permitAll()  // 删除这行
                // .requestMatchers("/api/documents/**").permitAll()  // 删除这行
                
                // 其他所有请求都需要认证
                .anyRequest().authenticated()
            )
            
            // ⭐ 添加 JWT 过滤器到 Security 过滤器链
            // 在 UsernamePasswordAuthenticationFilter 之前执行
            .addFilterBefore(jwtAuthenticationFilter, 
                    UsernamePasswordAuthenticationFilter.class);
        
        return http.build();
    }
}
```

**关键配置解析**：

| 配置 | 作用 |
|------|------|
| `authorizeHttpRequests` | 配置 URL 访问权限 |
| `.permitAll()` | 允许任何人访问（无需登录）|
| `.authenticated()` | 需要认证（已登录）才能访问 |
| `.addFilterBefore()` | 在指定过滤器之前插入我们的 JWT 过滤器 |

**重要变化**：
- 移除了 `/api/users/**`、`/api/notebooks/**`、`/api/documents/**` 的放行
- 现在这些接口**需要携带有效 Token** 才能访问
- 只有 `/api/auth/**`（注册/登录）是开放的

---

### 第 3 步：创建受保护的测试接口（验证过滤器）

**文件：** `src/main/java/com/example/notebookclone/controller/TestController.java`

创建一个简单的测试接口，验证 JWT 过滤器是否生效：

```java
package com.example.notebookclone.controller;

import com.example.notebookclone.common.Result;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 测试接口：验证 JWT 认证是否生效
 */
@RestController
@RequestMapping("/api/test")
public class TestController {

    /**
     * 获取当前登录用户信息
     * 需要携带有效 Token 才能访问
     */
    @GetMapping("/current-user")
    public Result<String> getCurrentUser() {
        // 从 SecurityContext 获取当前登录用户名
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        
        return Result.success("当前登录用户：" + username);
    }

    /**
     * 简单的受保护接口
     */
    @GetMapping("/protected")
    public Result<String> protectedEndpoint() {
        return Result.success("这是一个受保护的接口，你已成功访问！");
    }
}
```

**知识点**：`SecurityContextHolder.getContext().getAuthentication()`

- 在任何地方（Controller、Service）都可以通过这种方式获取当前登录用户
- 这是 Spring Security 提供的全局上下文
- 前提是 JWT 过滤器已经通过了认证并设置了 Authentication

---

### 第 4 步：更新 AuthController 的 /me 接口（简化版）

**文件：** `src/main/java/com/example/notebookclone/controller/AuthController.java`

现在有了过滤器自动校验 Token，`/me` 接口可以简化了：

```java
/**
 * 获取当前登录用户信息（简化版）
 * GET /api/auth/me
 * 
 * 由于 JWT 过滤器已经校验过 Token 并设置了 SecurityContext，
 * 这里直接从 SecurityContext 获取用户信息即可
 */
@GetMapping("/me")
public Result<UserInfoResponse> getCurrentUser() {
    // 从 SecurityContext 获取用户名（过滤器已经设置好了）
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    
    // 实际项目中，这里应该根据 username 查询数据库获取完整用户信息
    // 简化示例，直接返回用户名
    UserInfoResponse response = new UserInfoResponse(null, username);
    return Result.success(response);
}
```

**对比 Day 13**：

| | Day 13（手动校验） | Day 14（过滤器自动校验）|
|---|---|---|
| 参数 | `@RequestHeader("Authorization") String authHeader` | 无参数 |
| Token 提取 | 手动 `authHeader.replace("Bearer ", "")` | 过滤器已处理 |
| Token 校验 | 手动 `jwtUtil.validateToken(token)` | 过滤器已处理 |
| 用户信息获取 | 手动 `jwtUtil.getUserIdFromToken(token)` | `SecurityContextHolder.getContext().getAuthentication()` |

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `filter/JwtAuthenticationFilter.java` | **新建** | JWT 认证过滤器，自动校验 Token |
| `config/SecurityConfig.java` | **修改** | 添加 JWT 过滤器，收紧权限规则 |
| `controller/TestController.java` | **新建** | 测试受保护接口 |
| `controller/AuthController.java` | **修改** | 简化 `/me` 接口 |

---

## 测试步骤

### 1. 测试未携带 Token 访问受保护接口（应该失败）

```bash
GET http://localhost:8080/api/test/protected
```

**预期响应**：
```json
{
  "code": 401,
  "message": "Unauthorized",
  "data": null
}
```

### 2. 登录获取 Token

```bash
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}
```

**记录返回的 token**。

### 3. 携带 Token 访问受保护接口（应该成功）

```bash
GET http://localhost:8080/api/test/protected
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx.yyyyy
```

**预期响应**：
```json
{
  "code": 200,
  "message": "操作成功",
  "data": "这是一个受保护的接口，你已成功访问！"
}
```

### 4. 测试 /api/auth/me（简化版）

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
    "userId": null,
    "username": "zhangsan"
  }
}
```

### 5. 测试无效 Token

```bash
GET http://localhost:8080/api/test/protected
Authorization: Bearer invalid.token.here
```

**预期响应**：401 Unauthorized

---

## Day 14 完成标志

- [ ] `JwtAuthenticationFilter.java` 创建完成，继承 `OncePerRequestFilter`
- [ ] 过滤器能从请求头提取 Token 并校验
- [ ] 校验通过后，将用户信息存入 `SecurityContextHolder`
- [ ] `SecurityConfig.java` 添加了 `.addFilterBefore()` 配置
- [ ] 移除了 `/api/notebooks/**` 等接口的 `permitAll()`，现在需要认证
- [ ] 未携带 Token 访问受保护接口返回 401
- [ ] 携带有效 Token 可以正常访问受保护接口
- [ ] `/api/auth/me` 接口简化为从 `SecurityContextHolder` 获取用户
- [ ] `api.http` 添加受保护接口的测试用例
- [ ] Git 提交

---

## 核心知识点总结

### 1. Servlet Filter 机制

```
HTTP Request
    ↓
[Filter 1]  ← 第一个拦截点
    ↓
[Filter 2]  ← 第二个拦截点
    ↓
[Filter 3]  ← 第三个拦截点
    ↓
Servlet / Controller
    ↓
HTTP Response（按相反顺序经过过滤器）
```

- 过滤器可以拦截请求和响应
- 多个过滤器组成"过滤器链"
- 通过 `filterChain.doFilter()` 决定是否放行

### 2. Spring Security Filter Chain

Spring Security 本质上就是一个 Filter：

```
DelegatingFilterProxy (Spring Security 入口)
    ↓
FilterChainProxy (管理多个 Security Filter)
    ↓
[UsernamePasswordAuthenticationFilter]  ← 处理表单登录
[BasicAuthenticationFilter]              ← 处理 Basic 认证
[JwtAuthenticationFilter]                ← 我们的 JWT 过滤器（插入在这里）
[ExceptionTranslationFilter]             ← 处理异常
[AuthorizationFilter]                    ← 最终权限校验
    ↓
Controller
```

### 3. SecurityContextHolder —— 当前用户信息的"全局变量"

```java
// 在任何地方获取当前登录用户
Authentication auth = SecurityContextHolder.getContext().getAuthentication();
String username = auth.getName();  // 用户名
```

- 存储当前线程的认证信息
- 默认使用 `ThreadLocal` 实现，线程安全
- Controller、Service 都可以通过它获取当前用户

### 4. 认证 vs 授权

| 概念 | 英文 | 含义 | 示例 |
|------|------|------|------|
| 认证 | Authentication | 验证"你是谁" | 校验用户名密码、校验 Token |
| 授权 | Authorization | 验证"你能做什么" | 判断是否有权限访问某个接口 |

**Day 14 做的是认证** —— 验证 Token 是否有效，确认用户身份。

**Day 16 会做授权** —— 判断用户能否查看/修改某个笔记本。

---

## 下节预告（Day 15）

> **改造现有接口**：创建笔记本/文档时，自动从 SecurityContext 获取当前登录用户并关联，不再需要前端传递 userId。
