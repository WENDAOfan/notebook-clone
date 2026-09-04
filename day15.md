# Day 15：改造现有接口 — 自动关联当前登录用户

> **核心目标**：改造创建笔记本和文档的接口，自动从 SecurityContext 获取当前登录用户并关联，不再需要前端传递 userId。理解 SecurityContextHolder 在实际业务中的应用。

---

## 背景知识

### 当前的问题：需要前端传递 userId

Day 11 创建笔记本时，请求体需要包含用户信息：

```json
POST /api/notebooks
{
  "name": "我的笔记本",
  "description": "学习笔记",
  "user": {
    "id": 3  // ⚠️ 需要前端传 userId，容易伪造！
  }
}
```

**问题**：
1. **前端需要知道 userId** - 增加了前端复杂度
2. **安全隐患** - 恶意用户可以传别人的 userId，创建笔记本到别人账号下
3. **用户体验差** - 每次创建都要处理用户关联

### 解决方案：后端自动获取当前用户

既然用户已经登录（携带了 JWT Token），后端完全知道"当前是谁"，不需要前端传：

```java
// 从 SecurityContext 获取当前登录用户
String username = SecurityContextHolder.getContext()
                       .getAuthentication().getName();

// 根据用户名查询用户实体
User currentUser = userRepository.findByUsername(username)
                       .orElseThrow(() -> new RuntimeException("用户不存在"));

// 设置关联
notebook.setUser(currentUser);
```

**改造后的请求**：
```json
POST /api/notebooks
{
  "name": "我的笔记本",
  "description": "学习笔记"
  // 不需要传 user 了！
}
```

**优势**：
- 前端更简单
- 无法伪造（Token 里是谁，就是谁）
- 更安全

---

## 任务规划（共 3 步）

### 第 1 步：改造 NotebookController — 创建笔记本时自动关联当前用户

**文件：** `src/main/java/com/example/notebookclone/controller/NotebookController.java`

**修改 `createNotebook` 方法**：

```java
@PostMapping
public Result<Notebook> createNotebook(
        @Valid @RequestBody Notebook notebook) {
    
    // ===== Day 15 新增：自动关联当前登录用户 =====
    // 1. 从 SecurityContext 获取当前登录用户名
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    
    // 2. 查询用户实体
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));
    
    // 3. 设置关联
    notebook.setUser(currentUser);
    // =============================================
    
    notebook.setCreateTime(LocalDateTime.now());
    return Result.success(notebookRepository.save(notebook));
}
```

**需要注意**：
- 注入 `UserRepository`（如果没有的话）
- 移除前端传 user 的相关逻辑

**完整 NotebookController 代码**：

```java
package com.example.notebookclone.controller;

import com.example.notebookclone.common.Result;
import com.example.notebookclone.entity.Notebook;
import com.example.notebookclone.entity.User;
import com.example.notebookclone.repository.NotebookRepository;
import com.example.notebookclone.repository.UserRepository;
import jakarta.validation.Valid;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/notebooks")
public class NotebookController {

    private final NotebookRepository notebookRepository;
    private final UserRepository userRepository;  // Day 15 新增

    public NotebookController(NotebookRepository notebookRepository,
                              UserRepository userRepository) {  // Day 15 新增
        this.notebookRepository = notebookRepository;
        this.userRepository = userRepository;  // Day 15 新增
    }

    @GetMapping
    public Result<List<Notebook>> getAllNotebooks() {
        return Result.success(notebookRepository.findAll());
    }

    @PostMapping
    public Result<Notebook> createNotebook(@Valid @RequestBody Notebook notebook) {
        // Day 15：自动关联当前登录用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在"));
        notebook.setUser(currentUser);
        
        notebook.setCreateTime(LocalDateTime.now());
        return Result.success(notebookRepository.save(notebook));
    }

    @PutMapping("/{id}")
    public Result<Notebook> updateNotebook(@PathVariable Long id,
                                           @Valid @RequestBody Notebook notebookDetails) {
        Notebook notebook = notebookRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("笔记本不存在"));
        notebook.setName(notebookDetails.getName());
        notebook.setDescription(notebookDetails.getDescription());
        return Result.success(notebookRepository.save(notebook));
    }

    @DeleteMapping("/{id}")
    public Result<Void> deleteNotebook(@PathVariable Long id) {
        notebookRepository.deleteById(id);
        return Result.success(null);
    }
}
```

---

### 第 2 步：改造 DocumentController — 创建文档时自动关联当前用户

**文件：** `src/main/java/com/example/notebookclone/controller/DocumentController.java`

**修改 `createDocument` 方法**：

```java
@PostMapping
public Result<Document> createDocument(@RequestBody Document document) {
    // Day 15：自动关联当前登录用户
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));
    document.setUser(currentUser);
    
    // 原有的笔记本关联逻辑保持不变
    if (document.getNotebook() != null && document.getNotebook().getId() != null) {
        Notebook notebook = notebookRepository.findById(document.getNotebook().getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在"));
        document.setNotebook(notebook);
    }
    
    document.setCreateTime(LocalDateTime.now());
    return Result.success(documentRepository.save(document));
}
```

**同样需要注意**：
- 注入 `UserRepository`
- 确保能获取到当前用户

---

### 第 3 步：更新 api.http 测试用例

改造后的测试用例不再需要传 user：

```http
### Day15-1. 创建笔记本（不需要传 user，自动关联当前登录用户）
POST http://localhost:8080/api/notebooks
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxxxx.yyyyy

{
  "name": "Day15 自动关联测试",
  "description": "这个笔记本会自动关联到当前登录用户"
}

### Day15-2. 查询所有笔记本，验证是否关联了用户
GET http://localhost:8080/api/notebooks
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxxxx.yyyyy

### Day15-3. 创建文档（自动关联当前用户）
POST http://localhost:8080/api/documents
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxxxx.yyyyy

{
  "title": "Day15 测试文档",
  "content": "这个文档会自动关联到当前登录用户",
  "notebook": {
    "id": 1
  }
}
```

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `NotebookController.java` | **修改** | 创建笔记本时自动关联当前用户 |
| `DocumentController.java` | **修改** | 创建文档时自动关联当前用户 |
| `api.http` | **修改** | 更新测试用例，移除 user 字段 |

---

## 测试步骤

### 1. 登录获取 Token

```bash
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}
```

记录返回的 token。

### 2. 创建笔记本（不带 user 字段）

```bash
POST http://localhost:8080/api/notebooks
Content-Type: application/json
Authorization: Bearer <你的token>

{
  "name": "我的新笔记本",
  "description": "自动关联测试"
}
```

**预期响应**：
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "id": 1,
    "name": "我的新笔记本",
    "description": "自动关联测试",
    "user": {
      "id": 1,
      "username": "zhangsan"
    }
  }
}
```

### 3. 验证数据库

```sql
SELECT n.id, n.name, u.username 
FROM notebooks n 
JOIN users u ON n.user_id = u.id 
WHERE n.name = '我的新笔记本';
```

确认 `user_id` 字段已正确设置为当前登录用户的 ID。

---

## Day 15 完成标志

- [ ] `NotebookController` 修改完成，创建笔记本时自动关联当前用户
- [ ] `DocumentController` 修改完成，创建文档时自动关联当前用户
- [ ] 创建笔记本/文档的请求体不再需要传 user 字段
- [ ] 创建成功后，数据库中正确记录了 user_id
- [ ] 不同用户创建的资源，自动关联到各自的用户下
- [ ] `api.http` 更新为新的请求格式
- [ ] Git 提交：`git commit -m "feat: Day15 创建资源时自动关联当前登录用户"`

---

## 核心知识点总结

### 1. SecurityContextHolder 的实际应用

**在 Filter 中设置**（Day 14）：
```java
// JwtAuthenticationFilter
SecurityContextHolder.getContext().setAuthentication(authentication);
```

**在 Controller 中使用**（Day 15）：
```java
// NotebookController
String username = SecurityContextHolder.getContext()
        .getAuthentication().getName();
```

### 2. 前后端分离项目的用户关联最佳实践

| 方式 | 是否推荐 | 说明 |
|------|---------|------|
| 前端传 userId | ❌ 不推荐 | 可被伪造，不安全 |
| 后端从 Token 解析 | ✅ 推荐 | 安全可靠，前端无感知 |

### 3. 完整的数据流转

```
用户登录
  ↓
后端返回 JWT Token（包含用户名）
  ↓
前端存储 Token（localStorage/cookie）
  ↓
前端请求创建笔记本（Header 携带 Token）
  ↓
JWT Filter 校验 Token，提取用户名存入 SecurityContext
  ↓
Controller 从 SecurityContext 获取用户名
  ↓
查询用户实体，设置到笔记本对象
  ↓
保存到数据库（自动关联 user_id）
```

---

## 下节预告（Day 16）

> **数据隔离**：实现"用户只能查看/操作自己的笔记本和文档"。改造查询接口，只返回当前用户的数据，实现数据权限控制。
