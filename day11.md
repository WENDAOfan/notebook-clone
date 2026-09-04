# Day 11：创建 User 实体 — 建立三级实体关系

> **核心目标**：引入用户系统，建立 User → Notebook → Document 的三级一对多关系，为后续的用户认证和数据隔离打下基础。这是从"单用户演示"走向"多用户产品"的关键一步。

---

## 背景知识

### 当前数据模型（两级）
```
Notebook (1)  ←──→  (N) Document
```

### 目标数据模型（三级）
```
User (1)  ←──→  (N) Notebook (1)  ←──→  (N) Document
```

### 为什么要引入 User？

| 场景 | 无 User 系统 | 有 User 系统 |
|------|-------------|-------------|
| 数据归属 | 所有笔记本混在一起 | 每个用户只看到自己的笔记本 |
| 权限控制 | 无法区分 | 基于用户身份做权限判断 |
| AI 额度 | 无法统计 | 按用户统计调用次数、限流 |
| 多人使用 | 不可能 | 支持注册登录，各自独立 |

---

## 任务规划（共 5 步）

### 第 1 步：创建 User 实体类

**文件：** `src/main/java/com/example/notebookclone/user/User.java`

**要求：**
- 使用 Lombok `@Data` 注解
- 字段设计：
  - `id`：主键，自增
  - `username`：用户名，唯一，非空
  - `password`：密码，非空（后续存储 BCrypt 加密后的密码）
  - `email`：邮箱，可选
  - `createdAt`：创建时间
  - `updatedAt`：更新时间
- 建立与 Notebook 的一对多关系（先不配置双向关联，避免循环问题）

**参考代码结构：**
```java
@Entity
@Table(name = "users")
@Data
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(nullable = false, unique = true)
    private String username;
    
    @Column(nullable = false)
    private String password;
    
    private String email;
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
    
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<Notebook> notebooks = new ArrayList<>();
    
    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
```

**要学到的：**
- 实体设计时预留常用字段（createdAt/updatedAt）是工程好习惯
- 用户名设置唯一约束，数据库层防止重复注册
- `@PrePersist`/`@PreUpdate` 自动维护时间戳

---

### 第 2 步：改造 Notebook 实体，添加 User 关联

**文件：** `src/main/java/com/example/notebookclone/notebook/Notebook.java`

**修改内容：**
1. 添加 `user` 字段，建立多对一关系
2. 添加 `user_id` 外键字段

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "user_id")
@JsonIgnore  // 避免 JSON 循环引用
private User user;
```

**注意：**
- 必须加 `@JsonIgnore`，否则会出现 `User → notebooks → Notebook → user → User` 的无限递归
- 暂时保留 Notebook 和 Document 的双向关联，现在是三级关联了

**要学到的：**
- 多级关联中，每一段双向关系都要考虑 JSON 序列化问题
- 选择在哪一端加 `@JsonIgnore`：通常放在"多"端（Notebook.user, Document.notebook）

---

### 第 3 步：创建 UserRepository

**文件：** `src/main/java/com/example/notebookclone/user/UserRepository.java`

**代码：**
```java
package com.example.notebookclone.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    
    // 根据用户名查找用户（登录时用）
    Optional<User> findByUsername(String username);
    
    // 检查用户名是否已存在（注册时校验用）
    boolean existsByUsername(String username);
}
```

**要学到的：**
- `Optional<User>` 比 `User` 更适合可能为空的结果，避免 NullPointerException
- `existsByXxx` 是 JPA 方法名推导的特殊形式，返回 boolean

---

### 第 4 步：创建 UserController（基础版）

**文件：** `src/main/java/com/example/notebookclone/user/UserController.java`

**目标：** 实现用户的基础 CRUD，方便测试数据模型是否正确

**接口设计：**

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/users` | 获取所有用户列表 |
| GET | `/api/users/{id}` | 根据 ID 获取用户详情 |
| POST | `/api/users` | 创建用户（明文密码，仅测试用） |
| DELETE | `/api/users/{id}` | 删除用户 |

**注意事项：**
- 返回值统一使用 `Result<T>` 包装
- 创建用户时设置创建时间和更新时间
- **Day 11 不实现真正的注册/登录**，只是测试实体关系是否正确

**要学到的：**
- 先验证数据模型正确，再添加业务逻辑（循序渐进）
- 明文密码仅用于测试，Day 12 会引入 BCrypt 加密

---

### 第 5 步：数据库迁移 + 测试

#### 5.1 数据库自动迁移

确保 `application.properties` 中：
```properties
spring.jpa.hibernate.ddl-auto=update
```

启动应用，Hibernate 会自动：
1. 创建 `users` 表
2. 在 `notebooks` 表添加 `user_id` 外键字段

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `user/User.java` | 新建 | User 实体类，含三级关联配置 |
| `user/UserRepository.java` | 新建 | 用户数据访问层 |
| `user/UserController.java` | 新建 | 用户基础 CRUD 接口 |
| `notebook/Notebook.java` | 修改 | 添加 `user` 字段和 `@JsonIgnore` |

---

## 数据库表结构变化

### 新增 users 表
```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    created_at DATETIME,
    updated_at DATETIME
);
```

### notebooks 表新增外键
```sql
ALTER TABLE notebooks ADD COLUMN user_id BIGINT;
ALTER TABLE notebooks ADD FOREIGN KEY (user_id) REFERENCES users(id);
```

---

## 预期效果

```
请求：GET /api/users
响应：{
  "code": 200,
  "message": "操作成功",
  "data": [
    {
      "id": 1,
      "username": "testuser",
      "email": "test@example.com",
      "createdAt": "2026-04-05T10:30:00",
      "updatedAt": "2026-04-05T10:30:00",
      "notebooks": []  // 初始为空列表
    }
  ]
}

请求：POST /api/notebooks (带 user.id)
响应：笔记本成功创建，数据库中 notebooks.user_id 有值

请求：GET /api/users/1
响应：能看到该用户的所有 notebooks 列表
```

---

## Day 11 完成标志

- [ ] User 实体类创建完成，包含所有必要字段
- [ ] Notebook 实体添加 user 字段，使用 `@JsonIgnore` 避免循环
- [ ] UserRepository 创建完成，包含 `findByUsername` 和 `existsByUsername`
- [ ] UserController 基础 CRUD 接口可用
- [ ] 数据库成功生成 users 表和 notebooks.user_id 外键
- [ ] Postman 测试通过：能创建用户、创建笔记本并关联用户
- [ ] 返回数据中不包含密码字段（可以用 `@JsonIgnore` 或 DTO 处理）
- [ ] Git 提交：`git commit -m "feat: Day11 添加 User 实体，建立三级一对多关系"`

---

## 实际完成记录

### 一、今天做了什么

| 文件 | 操作 | 说明 |
|------|------|------|
| `entity/User.java` | **新建** | User 实体类，含 username、password、email、时间戳、与 Notebook 的一对多关系 |
| `repository/UserRepository.java` | **新建** | 用户数据访问层，含 `findByUsername`、`existsByUsername` |
| `controller/UserController.java` | **新建** | 用户 CRUD 接口（GET/POST/DELETE） |
| `entity/Notebook.java` | **修改** | 添加 `user` 字段（@ManyToOne），解决 JSON 循环引用 |
| `controller/NotebookController.java` | **修改** | 注入 UserRepository，创建笔记本时根据 `user.id` 查找真实 User 对象并关联 |
| `api.http` | **修改** | 新增用户创建、用户查询、带 user 关联的笔记本创建测试 |

### 二、数据模型变化

```
改造前（两级）：                改造后（三级）：
Notebook (1) ←→ (N) Document   User (1) ←→ (N) Notebook (1) ←→ (N) Document
```

### 三、遇到的困难与踩坑记录

#### 坑 1：`@JsonIgnore` 导致前端传的 user 被丢弃

**现象**：创建笔记本时，请求 JSON 里明明写了 `"user": {"id": 3}`，但 Controller 里收到的 `notebook.getUser()` 始终是 `null`。

```json
// 请求发了 user
{ "name": "我的第1个笔记本", "user": { "id": 3 } }

// 但 Controller 打印出来：
// name: 我的第1个笔记本
// user: null  ← 这里是 null！
```

**原因**：`@JsonIgnore` 这个注解是**双向的**，不只是"不输出"，还会"不接收"：

```
序列化（Java → JSON）：Notebook 对象转成 JSON 时，跳过 user 字段  ← 这个是我们想要的 ✅
反序列化（JSON → Java）：前端 JSON 转成 Notebook 对象时，也跳过 user 字段 ← 这个导致了 bug ❌
```

**修复**：把 `@JsonIgnore` 换成 `@JsonProperty(access = Access.WRITE_ONLY)`

```java
// 修复前（Day 9 学的写法，在单向关联时没问题）
@JsonIgnore
private User user;

// 修复后
@JsonProperty(access = Access.WRITE_ONLY)
private User user;
```

| 注解 | 返回 JSON 时 | 接收 JSON 时 | 适合场景 |
|------|-------------|-------------|---------|
| `@JsonIgnore` | 跳过 user | **跳过 user** | 只需单向忽略（如 Document → Notebook） |
| `@JsonProperty(access = WRITE_ONLY)` | 跳过 user | **接受 user** | 需要接收前端传的关联 ID |

#### 坑 2：前端传的 User 对象是"假的"

**现象**：即使 JSON 能正确反序列化成 `Notebook` 对象，里面的 `user` 也不是数据库里的真实对象，只是一个只有 `id=3` 的"空壳"。

**解决**：在 Controller 里手动查出真实 User 对象，替换掉请求中传进来的"假 User"：

```java
if (notebook.getUser() != null && notebook.getUser().getId() != null) {
    User realUser = userRepository.findById(notebook.getUser().getId())
            .orElseThrow(() -> new RuntimeException("用户不存在"));
    notebook.setUser(realUser);  // 把"假 User"替换成"真 User"
}
```

**为什么不直接用前端传的？** 因为前端传的 User 对象只有 `id`，其他字段（username、password 等）全是 `null`。如果直接存，数据库里的外键虽然能对上，但 JPA 管理的实体对象是不完整的，后续操作可能出问题。

---

### 四、核心知识点详解

#### 1. 什么是"序列化"和"反序列化"？

用一张图说清楚：

```
┌──────────────┐                    ┌──────────────┐
│   Java 对象   │  ── 序列化 ──→    │   JSON 字符串  │
│ (后端内存里)  │                    │ (网络上传输)   │
└──────────────┘                    └──────────────┘
  Notebook nb =                      {"id":1,
    new Notebook();                   "name":"笔记本",
  nb.setName("笔记本");               "user":{"id":3}}

┌──────────────┐                    ┌──────────────┐
│   Java 对象   │  ←─ 反序列化 ──   │   JSON 字符串  │
│ (后端内存里)  │                    │ (网络上传输)   │
└──────────────┘                    └──────────────┘
  收到一个 Notebook                   请求体里带着的
  对象，字段都有值                     JSON 数据
```

**什么时候用哪个？**

| 方向 | 专业术语 | 通俗理解 | 何时发生 |
|------|---------|---------|---------|
| Java → JSON | **序列化** (Serialization) | 把 Java 对象"打包"成 JSON 给前端 | Controller **返回**数据时 |
| JSON → Java | **反序列化** (Deserialization) | 把前端发来的 JSON"拆包"成 Java 对象 | Controller **接收** `@RequestBody` 时 |

**一句话记忆**：
- 序列化 = 后端打包给前端（输出）
- 反序列化 = 前端打包给后端（输入）

#### 2. Jackson 注解与序列化的关系

Spring Boot 默认使用 **Jackson** 库来做 JSON 的序列化和反序列化。Jackson 提供了多个注解来控制这个过程：

```
@JsonProperty(access = Access.WRITE_ONLY)  的含义：

  WRITE_ONLY = 只允许写入（反序列化时接受这个字段）
             = 不允许读取（序列化时不输出这个字段）

  所以它等价于：
    接收请求时 → ✅ 接受 JSON 中的 user 字段，转成 Java 对象的 user 属性
    返回响应时 → ❌ 不把 Java 对象的 user 属性输出到 JSON 中
```

#### 3. 双向关联为什么会导致循环？

```
User 对象：
  ├── id: 1
  ├── username: "张三"
  └── notebooks: [           ← User 里有 Notebook 列表
        ├── id: 1
        ├── name: "笔记本1"
        └── user: {          ← Notebook 里有 User 对象
              ├── id: 1
              ├── username: "张三"
              └── notebooks: [  ← 又回到了 User 的 notebooks...
                    ├── id: 1
                    ├── name: "笔记本1"
                    └── user: { ... }  ← 又又又循环了！
              ]
        }
      ]

如果不打断，这个嵌套会无限进行下去，直到栈溢出（StackOverflowError）。
```

**打断循环的策略**：在"多"的那一端加注解，不让它输出对"一"的引用：

```
User (1) ←──→ (N) Notebook    → 在 Notebook.user 上加注解
Notebook (1) ←──→ (N) Document → 在 Document.notebook 上加注解
```

#### 4. @PrePersist 和 @PreUpdate — 自动时间戳

```java
@PrePersist   // 第一次保存（INSERT）之前自动执行
protected void onCreate() {
    createdAt = LocalDateTime.now();
    updatedAt = LocalDateTime.now();
}

@PreUpdate    // 每次更新（UPDATE）之前自动执行
protected void onUpdate() {
    updatedAt = LocalDateTime.now();
}
```

不需要手动 `setCreatedAt()`，JPA 会在保存/更新时自动调用这些方法。

---

### 五、Day 11 文件结构（更新后）

```
notebook-clone/src/main/java/com/example/notebook_clone/
├── NotebookCloneApplication.java      # 启动类
├── common/
│   ├── Result.java                    # 统一返回结果
│   └── GlobalExceptionHandler.java    # 全局异常处理
├── entity/
│   ├── Notebook.java                  # ✅ 已加 user 字段 + WRITE_ONLY
│   ├── Document.java                  # 笔记文档实体
│   └── User.java                      # 🆕 用户实体（含双向关联）
├── repository/
│   ├── NotebookRepository.java
│   ├── DocumentRepository.java
│   └── UserRepository.java            # 🆕 含 findByUsername
└── controller/
    ├── NotebookController.java        # ✅ 已加 User 关联处理逻辑
    ├── DocumentController.java
    └── UserController.java            # 🆕 用户 CRUD
```

---

### 六、Day 11 检查清单

- [x] User 实体类创建完成，包含 username、password、email、时间戳
- [x] Notebook 实体添加 user 字段，用 `@JsonProperty(WRITE_ONLY)` 避免循环
- [x] UserRepository 创建完成，包含 `findByUsername` 和 `existsByUsername`
- [x] UserController 基础 CRUD 接口可用
- [x] 数据库成功生成 users 表和 notebooks.user_id 外键
- [x] 测试通过：能创建用户、创建笔记本并关联用户
- [ ] 返回数据中不包含密码字段（可以用 `@JsonIgnore` 或 DTO 处理）← 待优化
- [ ] Git 提交

---

## 下节预告（Day 12）

> **Spring Security + BCrypt**：实现真正的用户注册/登录，密码加密存储，理解为什么不能用明文存密码。
