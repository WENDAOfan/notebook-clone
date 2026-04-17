# Day 16：实现数据隔离 — 用户只能查看/操作自己的资源

> **核心目标**：改造所有接口，确保每个用户只能看到和操作属于自己的笔记本与文档。理解"数据权限控制"在实际项目中的实现思路。

---

## 背景知识

### 为什么需要数据隔离？

Day 15 我们已经实现了**写入时自动关联用户**，但**读取和修改时没有做权限校验**。

想象一下这个场景：

```
用户 A 登录后，调用 GET /api/notebooks
→ 返回的不仅是 A 的笔记本，还有 B、C、D 所有人的！

用户 A 调用 DELETE /api/notebooks/5
→ 如果 ID=5 是用户 B 的笔记本，A 直接把它删了！
```

这就像你进了一家银行，柜员把所有客户的存折都拿给你看——显然不行！

### 数据隔离的两个层面

| 层面 | 说明 | 示例 |
|------|------|------|
| **查询隔离** | 列表接口只返回当前用户的数据 | `SELECT * FROM notebooks WHERE user_id = ?` |
| **操作隔离** | 修改/删除前先校验资源归属 | 先查出 notebook，判断 user.id 是否匹配 |

### 实现策略

**不要在 Controller 里写一堆 if-else**，而是利用 JPA Repository 的方法名推导，让查询本身就带用户过滤条件：

```java
// ❌ 旧方式：先查全部，再在内存里过滤（性能差且不安全）
List<Notebook> all = notebookRepository.findAll();
List<Notebook> mine = all.stream()
    .filter(n -> n.getUser().getId().equals(currentUserId))
    .toList();

// ✅ 新方式：SQL 层面就带上 WHERE 条件（高效且安全）
List<Notebook> mine = notebookRepository.findByUserId(currentUserId);
```

---

## 任务规划（共 4 步）

---

### 第 1 步：Repository 层扩展 — 添加按用户查询的方法

#### 1.1 扩展 NotebookRepository

**文件：** `src/main/java/com/example/notebookclone/repository/NotebookRepository.java`

添加两个新方法：

```java
package com.example.notebookclone.repository;

import com.example.notebookclone.entity.Notebook;
import com.example.notebookclone.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface NotebookRepository extends JpaRepository<Notebook, Long> {

    // Day 16 新增：查询某用户的所有笔记本
    List<Notebook> findByUserId(Long userId);

    // Day 16 新增：查询某个笔记本是否属于指定用户（用于修改/删除时的权限校验）
    Optional<Notebook> findByIdAndUserId(Long id, Long userId);
}
```

**JPA 自动生成的 SQL**：
```sql
-- findByUserId →
SELECT * FROM notebooks WHERE user_id = ?

-- findByIdAndUserId →
SELECT * FROM notebooks WHERE id = ? AND user_id = ?
```

#### 1.2 扩展 DocumentRepository

**文件：** `src/main/java/com/example/notebookclone/repository/DocumentRepository.java`

```java
package com.example.notebookclone.repository;

import com.example.notebookclone.entity.Document;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DocumentRepository extends JpaRepository<Document, Long> {

    // Day 16 新增：查询某用户的所有文档
    List<Document> findByUserId(Long userId);

    // Day 16 新增：查询某个文档是否属于指定用户
    Optional<Document> findByIdAndUserId(Long id, Long userId);

    // 已有的方法保持不变
    List<Document> findByNotebook_Id(Long notebookId);
}
```

**💡 小提示**：JPA 方法名推导规则：
- `findByXxx` → `WHERE xxx = ?`
- `findByIdAndUserId` → `WHERE id = ? AND user_id = ?`
- `findByXxxAndYyy` → 多条件 AND 查询

---

### 第 2 步：改造「查询」接口 — 只返回当前用户的数据

#### 2.1 改造 NotebookController 的查询接口

**文件：** `src/main/java/com/example/notebookclone/controller/NotebookController.java`

**修改 `getAllNotebooks` 方法**：

```java
// 接口 1：查看当前登录用户的笔记本 (GET 请求)
@GetMapping
public Result<List<Notebook>> getAllNotebooks() {
    // ===== Day 16：数据隔离 —— 只查询当前用户的笔记本 =====
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));
    
    return Result.success(notebookRepository.findByUserId(currentUser.getId()));
    // =======================================================
}
```

**改动前后对比**：

| | 改动前 | 改动后 |
|--|--------|--------|
| 查询方式 | `findAll()` | `findByUserId(userId)` |
| SQL | `SELECT * FROM notebooks` | `SELECT * FROM notebooks WHERE user_id = 3` |
| 安全性 | ❌ 返回所有人的 | ✅ 只返回当前用户的 |

#### 2.2 改造 DocumentController 的查询接口

**文件：** `src/main/java/com/example/notebookclone/controller/DocumentController.java`

**修改 `getDocumentsByNotebook` 方法**：

```java
// 接口 2：查看某个笔记本下的文档（同时校验该笔记本是否属于当前用户）
@GetMapping("/notebook/{notebookId}")
public Result<List<Document>> getDocumentsByNotebook(@PathVariable Long notebookId) {
    // ===== Day 16 新增：校验笔记本归属 =====
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));

    // 先确认这个笔记本属于当前用户
    Notebook notebook = notebookRepository.findByIdAndUserId(notebookId, currentUser.getId())
            .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));
    // ======================================

    return Result.success(documentRepository.findByNotebook_Id(notebookId));
}
```

**为什么这里要校验？**
因为如果不校验，用户 A 只要猜到了用户 B 的 notebookId，就能通过 `/api/documents/notebook/5` 看到 B 笔记本下的所有文档内容！

---

### 第 3 步：改造「写操作」接口 — 修改/删除前必须校验归属

这是**最关键的一步**，防止越权操作。

#### 3.1 改造 updateNotebook（修改）

**文件：** `NotebookController.java`

```java
@PutMapping("/{id}")
public Result<Notebook> updateNotebook(
        @PathVariable Long id,
        @Valid @RequestBody Notebook updatedNotebook) {
    
    // ===== Day 16：数据隔离 —— 先校验归属 =====
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));

    Notebook existingNotebook = notebookRepository
            .findByIdAndUserId(id, currentUser.getId())
            .orElseThrow(() -> new RuntimeException("笔记本不存在或无权操作"));
    // ==========================================

    existingNotebook.setName(updatedNotebook.getName());
    existingNotebook.setDescription(updatedNotebook.getDescription());
    // 注意：不需要手动设置 user，因为查出来的对象本来就带着正确的 user 关联
    
    return Result.success(notebookRepository.save(existingNotebook));
}
```

**关键变化**：
- 原来：`findById(id)` → 只判断存不存在
- 现在：`findByIdAndUserId(id, currentUser.getId())` → 同时判断存在**且**属于当前用户

#### 3.2 改造 deleteNotebook（删除）

```java
@DeleteMapping("/{id}")
public Result<Void> deleteNotebook(@PathVariable Long id) {
    // ===== Day 16：数据隔离 —— 校验归属后才能删除 =====
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));

    boolean exists = notebookRepository.existsByIdAndUserId(id, currentUser.getId());
    if (!exists) {
        throw new RuntimeException("笔记本不存在或无权删除");
    }
    // ================================================

    notebookRepository.deleteById(id);
    return Result.success(null);
}
```

> **💡 提示**：JPA 也支持 `existsByIdAndUserId()` 这种布尔查询方法，可以避免先把实体查出来再删除。

#### 3.3 改造 deleteDocument（删除文档）

**文件：** `DocumentController.java`

```java
@DeleteMapping("/{id}")
public Result<Void> deleteDocument(@PathVariable Long id) {
    // ===== Day 16：数据隔离 —— 校验归属后才能删除 =====
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));

    boolean exists = documentRepository.existsByIdAndUserId(id, currentUser.getId());
    if (!exists) {
        throw new RuntimeException("文档不存在或无权删除");
    }
    // ================================================

    documentRepository.deleteById(id);
    return Result.success(null);
}
```

#### 3.4 改造 uploadDocumentFile（上传文档）

上传文档时也要检查目标笔记本是否属于当前用户：

```java
@PostMapping("/upload")
public Result<Document> uploadDocumentFile(
        @RequestParam("notebookId") Long notebookId,
        @RequestParam("file") MultipartFile file) {
    try {
        // ===== Day 16：校验目标笔记本归属 =====
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在"));

        Notebook notebook = notebookRepository
                .findByIdAndUserId(notebookId, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权操作"));
        // =====================================

        String fileName = file.getOriginalFilename();
        String extractedText = new String(file.getBytes(), StandardCharsets.UTF_8);

        Document document = new Document();
        document.setNotebook(notebook);      // 已经验证过归属了
        document.setUser(currentUser);        // Day 15 保留
        notebook.getDocuments().add(document);
        
        document.setTitle(fileName);
        document.setContent(extractedText);
        document.setCreateTime(LocalDateTime.now());

        return Result.success(documentRepository.save(document));

    } catch (IOException e) {
        throw new RuntimeException("文件读取失败！" + e.getMessage());
    }
}
```

---

### 第 4 步：更新 api.http 测试用例 + 跨用户验证

#### 4.1 更新后的 api.http

```http
### ========== Day 16 数据隔离测试 ==========

### 0. 用户 zhangsan 登录获取 Token
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}

# > {%
# client.global.set("zhangsan_token", response.body.data.token);
# %}

### 0b. 用户 lisi 登录获取 Token（用于跨用户测试）
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "lisi",
  "password": "123456"
}

# > {%
# client.global.set("lisi_token", response.body.data.token);
# %}

### 1. 【zhangsan】创建一个笔记本
POST http://localhost:8080/api/notebooks
Content-Type: application/json
Authorization: Bearer {{zhangsan_token}}

{
  "name": "zhangsan的私密笔记本",
  "description": "只有我能看到"
}

### 2. 【zhangsan】查询笔记本 — 应该能看到刚创建的
GET http://localhost:8080/api/notebooks
Authorization: Bearer {{zhangsan_token}}

### 3. 【lisi】查询笔记本 — 应该看不到 zhangsan 的！（数据隔离验证 ✅）
GET http://localhost:8080/api/notebooks
Authorization: Bearer {{lisi_token}}

### 4. 【lisi】尝试删除 zhangsan 的笔记本 — 应该失败！（权限拦截 ✅）
DELETE http://localhost:8080/api/notebooks/1
Authorization: Bearer {{lisi_token}}

### 5. 【lisi】尝试修改 zhangsan 的笔记本 — 应该失败！（权限拦截 ✅）
PUT http://localhost:8080/api/notebooks/1
Content-Type: application/json
Authorization: Bearer {{lisi_token}}

{
  "name": "被篡改的名字",
  "description": "恶意修改"
}

### 6. 【zhangsan】正常修改自己的笔记本 — 应该成功 ✅
PUT http://localhost:8080/api/notebooks/1
Content-Type: application/json
Authorization: Bearer {{zhangsan_token}}

{
  "name": "改名后的笔记本",
  "description": "合法修改"
}

### 7. 【zhangsan】正常删除自己的笔记本 — 应该成功 ✅
DELETE http://localhost:8080/api/notebooks/1
Authorization: Bearer {{zhangsan_token}}
```

#### 4.2 跨用户验证清单

用**两个不同账号**分别执行上述测试，预期结果如下：

| 测试场景 | 操作者 | 目标资源归属 | 预期结果 |
|---------|--------|-------------|---------|
| 查询列表 | zhangsan | — | 只看到 zhangsan 自己的笔记本 ✅ |
| 查询列表 | lisi | — | 只看到 lisi 自己的笔记本 ✅ |
| lisi 查看 zhangsan 笔记本详情 | lisi | zhangsan | 返回"不存在或无权访问" ✅ |
| lisi 修改 zhangsan 笔记本 | lisi | zhangsan | 返回"不存在或无权操作" ✅ |
| lisi 删除 zhangsan 笔记本 | lisi | zhangsan | 返回"不存在或无权删除" ✅ |
| zhangsan 修改自己笔记本 | zhangsan | zhangsan | 正常成功 ✅ |
| zhangsan 删除自己笔记本 | zhangsan | zhangsan | 正常成功 ✅ |

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `NotebookRepository.java` | **修改** | 添加 `findByUserId`、`findByIdAndUserId` |
| `DocumentRepository.java` | **修改** | 添加 `findByUserId`、`findByIdAndUserId` |
| `NotebookController.java` | **修改** | 所有接口增加数据隔离逻辑 |
| `DocumentController.java` | **修改** | 所有接口增加数据隔离逻辑 |
| `api.http` | **修改** | 添加跨用户隔离测试用例 |

---

## Day 16 完成标志

- [ ] Repository 层新增按用户查询的方法
- [ ] `GET /api/notebooks` 只返回当前用户的笔记本
- [ ] `GET /api/documents/notebook/{id}` 会校验笔记本归属
- [ ] `PUT/DELETE /api/notebooks/{id}` 会校验笔记本归属
- [ ] `DELETE /api/documents/{id}` 会校验文档归属
- [ ] `POST /api/documents/upload` 会校验目标笔记本归属
- [ ] 用两个账号做跨用户测试，确认无法越权操作
- [ ] Git 提交：`git commit -m "feat: Day16 实现数据隔离，用户只能操作自己的资源"`

---

## 核心知识点总结

### 1. 数据隔离的三层防线

```
          ┌──────────────────────────────────┐
  第 1 层  │  Repository 层                   │  ← SQL 层面就过滤
          │  findByUserId / findByIdAndUserId │
          ├──────────────────────────────────┤
  第 2 层  │  Service/Controller 层           │  ← 业务层面兜底
          │  归属不匹配就抛异常               │
          ├──────────────────────────────────┤
  第 3 层  │  前端层（可选）                  │  ← 体验优化
          │  不展示其他用户的 ID 入口          │
          └──────────────────────────────────┘
```

我们目前实现了**第 1 层 + 第 2 层**，这对后端来说已经足够安全。

### 2. JPA 方法命名速查

| 方法名 | 生成的 SQL | 使用场景 |
|--------|-----------|---------|
| `findAll()` | `SELECT * FROM table` | 管理员后台 |
| `findByUserId(id)` | `SELECT * WHERE user_id = ?` | 查我的列表 |
| `findByIdAndUserId(id, uid)` | `SELECT * WHERE id = ? AND user_id = ?` | 操作前校验归属 |
| `existsByIdAndUserId(id, uid)` | `SELECT COUNT(*) WHERE id = ? AND user_id = ?` | 删除前快速判断 |

### 3. Day 15 vs Day 16 对比

|| Day 15 | Day 16 |
|--|--------|--------|
| **目标** | 写入时自动关联用户 | 读写都做权限控制 |
| **关注点** | 创建资源时设好 owner | 查询/修改/删除时校验 owner |
| **比喻** | 给文件贴上主人标签 | 进门前检查门牌号 |
| **SecurityContext 用途** | 获取 username 来 set User | 获取 username 来做 WHERE 条件 |

### 4. 常见错误提醒

```java
// ❌ 错误：先 findAll 再内存过滤
List<Notebook> all = notebookRepository.findAll();
return all.stream()
    .filter(n -> n.getUser().getUsername().equals(username))
    .toList();
// 问题：如果数据量大，会把整张表加载到内存！

// ✅ 正确：让数据库层面就过滤
return notebookRepository.findByUserId(currentUserId);
// SQL 直接带 WHERE，效率高且安全
```

---

## 下节预告（Day 17）

> **阶段联调**：Postman 完整流程测试——注册→登录→Token→创建笔记本→上传文档→数据隔离验证。掌握完整的认证授权链路，为进入第三阶段 AI 功能做好准备。
