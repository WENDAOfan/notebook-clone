# Spring Boot 项目学习指南

> 本文档用于系统学习 notebook-clone 项目的 Spring Boot 知识  
> 创建日期：2026-04-06  
> 适合人群：Spring Boot 初学者

---

## 目录

1. [项目整体结构](#toc-step1)
   - [分层架构图](#toc-arch)
2. [各文件夹作用详解](#toc-step2)
3. [Java 文件逐个解析](#toc-step3)
   - [入口类](#toc-entry)
   - [Controller 层](#toc-controller)
   - [Service 层](#toc-service)
   - [Repository 层](#toc-repository)
   - [Entity 层](#toc-entity)
   - [Common 层](#toc-common)
   - [Filter 层](#toc-filter)
   - [Config 层](#toc-config)
4. [核心知识点汇总](#toc-step4)
   - [1. 什么是依赖注入（DI）？](#toc-di)
   - [2. 什么是 JPA？](#toc-jpa)
   - [认证流程详解（Session vs JWT）](#toc-auth-flow)
   - [什么是 JWT？](#toc-jwt)
   - [完整认证流程示例](#toc-auth-example)
   - [BCrypt 密码加密](#toc-bcrypt)
   - [JWT 认证过滤器机制（核心！）](#toc-jwt-filter)
   - [SecurityContextHolder 的实际应用（Day 15）](#toc-security-context)
   - [DTO 与 record 模式](#toc-dto)
   - [3. JPA 派生查询方法（Derived Query Methods）](#toc-derived-query)
   - [4. 关联关系注解](#toc-relation)
   - [5. 校验注解](#toc-validation)
   - [6. 数据隔离与权限控制（Day 16）](#toc-data-isolation)
   - [7. Spring AI 集成（Day 18/19）](#toc-spring-ai)
   - [8. ChatClient 调用与 Prompt 工程（Day 19）](#toc-chatclient)
   - [9. 同步阻塞与 @Async 异步实战（Day 25）](#toc-sync-blocking)
   - [10. AI 文档摘要自动生成（Day 20）](#toc-ai-summary)
   - [11. 基于单个文档的智能问答（Day 21）](#toc-ai-qa)
   - [12. 前端问答优化：回答框改大 + 智能问答开关（Day 21-5）](#toc-ai-qa-switch)
   - [13. 笔记本级多文档智能问答（Day 22）](#toc-ai-notebook-qa)
   - [14. AI 流式输出 SSE 打字机效果（Day 23）](#toc-ai-sse-streaming)
   - [15. AI 引用溯源 — 标注引用来源（Day 24）](#toc-ai-citation)
   - [16. @Async 异步摘要 + 前端轮询（Day 25）](#toc-async-summary)
   - [17. AI 调用健壮化：重试机制 @Retryable（Day 26）](#toc-ai-retry)
   - [18. AI 调用健壮化：Token 统计全覆盖（Day 26_5）](#toc-ai-token)
   - [19. PDF 文本提取与清洗 + 混合输入（Day 27）](#toc-pdf-extract)
   - [20. 文本分块 + 向量化（Day 28）](#toc-chunk-vector)
   - [21. RAG 检索增强问答 + 引用溯源（Day 29）](#toc-rag-qa)
5. [常用注解速查表](#toc-step5)
   - [类级别注解](#toc-class-annotations)
   - [方法级别注解](#toc-method-annotations)
   - [字段/参数注解](#toc-field-annotations)
6. [附录：HTTP 方法对应操作](#toc-appendix)

---

<a id="toc-step1"></a>
## 第一步：项目整体结构

```
notebook-clone/
├── src/main/java/com/example/notebook_clone/
│   ├── NotebookCloneApplication.java    ← 【入口】程序启动类
│   ├── controller/                      ← 【控制器层】接收 HTTP 请求
│   │   ├── AuthController.java          ← 登录/注册/获取当前用户接口
│   │   ├── TestController.java          ← 测试接口（验证JWT认证）
│   │   ├── TestAiController.java        ← AI 测试接口（Day 19）
│   │   ├── ChunkTestController.java     ← 分块+搜索测试接口（Day 28）
│   │   ├── DocumentController.java      ← 文档相关接口
│   │   ├── NotebookController.java      ← 笔记本相关接口
│   │   └── UserController.java          ← 用户相关接口
│   ├── service/                         ← 【业务层】处理业务逻辑
│   │   ├── AuthService.java             ← 登录/注册业务
│   │   ├── AiChatService.java           ← AI 问答服务（单文档 + 多文档 + 流式）
│   │   ├── AiSummaryService.java        ← AI 摘要生成服务
│   │   ├── AsyncSummaryService.java     ← 异步摘要生成（@Async，Day 25）
│   │   ├── DocumentExtractService.java  ← 文档内容提取 + 文本清洗（Day 27）
│   │   └── DocumentChunkService.java    ← 文本分块 + 向量化（Day 28）
│   ├── repository/                      ← 【数据层】数据库操作
│   │   ├── DocumentRepository.java      ← 文档数据访问
│   │   ├── NotebookRepository.java      ← 笔记本数据访问
│   │   └── UserRepository.java          ← 用户数据访问
│   ├── entity/                          ← 【实体层】数据模型（对应数据库表）
│   │   ├── Document.java                ← 文档实体（关联 Notebook、User）
│   │   ├── Notebook.java                ← 笔记本实体（关联 User）
│   │   └── User.java                    ← 用户实体
│   ├── filter/                          ← 【过滤器层】请求拦截与预处理
│   │   └── JwtAuthenticationFilter.java ← JWT认证过滤器（验证Token）
│   ├── config/                          ← 【配置层】Spring 配置
│   │   ├── SecurityConfig.java          ← 安全配置（密码加密、权限、过滤器链）
│   │   ├── AsyncConfig.java             ← 异步线程池配置（@EnableAsync，Day 25）
│   │   └── VectorStoreConfig.java       ← 向量存储 + Embedding 模型配置（Day 28）
│   ├── util/                            ← 【工具层】工具类
│   │   └── JwtUtil.java                 ← JWT Token 生成/校验工具
│   └── common/                          ← 【公共层】通用工具
│       ├── GlobalExceptionHandler.java  ← 全局异常处理
│       └── Result.java                  ← 统一返回结果包装
├── src/main/resources/
│   └── application.properties           ← 配置文件
└── pom.xml                              ← Maven 依赖配置
```

<a id="toc-arch"></a>
### 分层架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         前端 (Front-end)                     │
│                    (浏览器 / Postman / App)                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP 请求
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  Controller 层（控制器层）                                    │
│  • 接收 HTTP 请求                                            │
│  • 校验参数（@Valid）                                        │
│  • 调用 Service 处理业务                                     │
│  • 返回 Result 统一格式                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │ 调用
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  Service 层（业务层）                                         │
│  • 处理具体业务逻辑                                          │
│  • 如：密码加密、登录校验                                    │
│  • 调用 Repository 操作数据库                                │
└──────────────────────┬──────────────────────────────────────┘
                       │ 调用
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  Repository 层（数据访问层）                                  │
│  • 继承 JpaRepository，自动拥有 CRUD 方法                     │
│  • 与数据库直接交互                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ SQL
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                    数据库（MySQL/PostgreSQL）                 │
└─────────────────────────────────────────────────────────────┘
```

---

<a id="toc-step2"></a>
## 第二步：各文件夹作用详解

### 📁 1. controller/ - 控制器层

**作用**：接收前端的 HTTP 请求，调用下层处理，返回响应

**类比**：餐厅的服务员
- 接收顾客点单（接收请求）
- 把订单交给后厨（调用 Service）
- 把菜品端给顾客（返回结果）

**核心注解**：`@RestController`, `@GetMapping`, `@PostMapping`, `@RequestBody`

---

### 📁 2. service/ - 业务层

**作用**：处理具体的业务逻辑

**类比**：餐厅的厨师
- 真正的"做菜"逻辑在这里
- 如：注册时要检查用户名是否已存在、密码要加密等

**核心注解**：`@Service`

---

### 📁 3. repository/ - 数据访问层

**作用**：与数据库交互，执行增删改查

**类比**：仓库管理员
- 专门负责存取数据
- 继承 `JpaRepository` 后，一行代码不用写就有所有基础方法

**核心**：`extends JpaRepository<Entity, ID>`

---

### 📁 4. entity/ - 实体层

**作用**：定义数据模型，对应数据库表结构

**类比**：货物清单
- 每一张清单定义了一种货物的属性（名称、数量等）
- `@Entity` 标记的类 = 数据库中的一张表

**核心注解**：`@Entity`, `@Table`, `@Id`, `@GeneratedValue`, `@Column`

---

### 📁 5. filter/ - 过滤器层

**作用**：在请求到达 Controller 之前，进行拦截和预处理

**类比**：大楼门口的保安
- 每个进来的人都要先过保安这一关
- 保安检查你的通行证（Token），验证通过才放行
- 没有通行证的人，保安不管（交给门禁规则判断）

**核心类**：`JwtAuthenticationFilter`（继承 `OncePerRequestFilter`）

**关键机制**：过滤器在 Spring Security 过滤器链中执行，在 Controller 之前运行

---

### 📁 6. config/ - 配置层

**作用**：配置 Spring Boot 的各种组件

**例子**：
- `SecurityConfig.java`：配置密码加密方式、哪些接口需要登录才能访问、JWT过滤器的位置

**核心注解**：`@Configuration`, `@Bean`, `@EnableWebSecurity`

---

### 📁 7. common/ - 公共层

**作用**：放置项目中通用的工具类

**包含**：
- `Result.java`：统一返回格式（所有接口都返回这个结构）
- `GlobalExceptionHandler.java`：全局异常处理（统一处理各种错误）

---

<a id="toc-step3"></a>
## 第三步：Java 文件逐个解析

<a id="toc-entry"></a>
### 🔹 入口类

#### `NotebookCloneApplication.java`

```java
@SpringBootApplication  // ← 标记这是 Spring Boot 主程序
public class NotebookCloneApplication {
    public static void main(String[] args) {
        SpringApplication.run(NotebookCloneApplication.class, args);
    }
}
```

**作用**：程序的入口，运行 `main()` 方法启动整个 Spring Boot 应用

---

<a id="toc-controller"></a>
### 🔹 Controller 层

#### `NotebookController.java` - 笔记本接口控制器

```java
@RestController                              // ← 我是 REST API 控制器
@RequestMapping("/api/notebooks")            // ← 接口统一前缀
public class NotebookController {

    // 构造器注入：Spring 自动把 Repository 传进来
    private final NotebookRepository notebookRepository;
    
    public NotebookController(NotebookRepository notebookRepository) {
        this.notebookRepository = notebookRepository;
    }

    // ========== 查询所有笔记本 ==========
    @GetMapping                               // ← 处理 GET 请求
    public Result<List<Notebook>> getAllNotebooks() {
        return Result.success(notebookRepository.findAll());
    }

    // ========== 创建笔记本 ==========
    @PostMapping                              // ← 处理 POST 请求
    public Result<Notebook> createNotebook(
            @Valid                           // ← 先校验参数
            @RequestBody                     // ← JSON 转对象
            Notebook notebook) {
        
        notebook.setCreateTime(LocalDateTime.now());
        return Result.success(notebookRepository.save(notebook));
    }

    // ========== 修改笔记本 ==========
    @PutMapping("/{id}")                      // ← {id} 是路径变量
    public Result<Notebook> updateNotebook(
            @PathVariable Long id,            // ← 从 URL 路径取 id
            @Valid @RequestBody Notebook notebook) {
        // ... 修改逻辑
    }

    // ========== 删除笔记本 ==========
    @DeleteMapping("/{id}")                   // ← 处理 DELETE 请求
    public Result<Void> deleteNotebook(@PathVariable Long id) {
        notebookRepository.deleteById(id);
        return Result.success(null);
    }
}
```

**知识点**：
- `@RestController` = `@Controller` + `@ResponseBody`
- `@RequestMapping("/api/notebooks")` 给所有接口加前缀
- 构造器注入：Spring 会自动传入需要的 Repository

---

#### `UserController.java` - 用户接口控制器

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserRepository userRepository;

    public UserController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @GetMapping
    public Result<List<User>> getAllUsers() {
        return Result.success(userRepository.findAll());
    }

    @GetMapping("/{id}")
    public Result<User> getUserById(@PathVariable Long id) {
        // orElseThrow：找不到就抛异常
        User user = userRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("用户不存在"));
        return Result.success(user);
    }

    @PostMapping
    public Result<User> createUser(@RequestBody User user) {
        // 检查用户名是否已存在
        if (userRepository.existsByUsername(user.getUsername())) {
            return Result.fail("用户名已被占用");
        }
        return Result.success(userRepository.save(user));
    }

    @DeleteMapping("/{id}")
    public Result<Void> deleteUser(@PathVariable Long id) {
        userRepository.deleteById(id);
        return Result.success(null);
    }
}
```

---

#### `AuthController.java` - 认证接口控制器

> 处理用户的注册、登录、获取当前用户信息。登录成功后返回 JWT Token。

```java
@RestController
@RequestMapping("/api/auth")                  // ← 路径前缀（SecurityConfig 对此路径 permitAll）
public class AuthController {

    private final AuthService authService;    // ← 业务层（验证密码等）
    private final JwtUtil jwtUtil;            // ← JWT 工具（生成Token）

    // 构造器注入
    public AuthController(AuthService authService, JwtUtil jwtUtil) {
        this.authService = authService;
        this.jwtUtil = jwtUtil;
    }

    // ===== 注册接口 =====
    @PostMapping("/register")                 // POST /api/auth/register
    public Result<User> register(@Valid @RequestBody RegisterRequest request) {
        User user = authService.register(request.username(), request.password());
        return Result.success(user);
    }

    // ===== 登录接口（核心！）=====
    @PostMapping("/login")                    // POST /api/auth/login
    public Result<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        // 1. 验证用户名密码
        User user = authService.login(request.username(), request.password());
        // 2. 生成 JWT Token
        String token = jwtUtil.generateToken(user.getId(), user.getUsername());
        // 3. 返回用户信息 + Token（不返回密码！）
        return Result.success(new LoginResponse(user.getId(), user.getUsername(),
                                                 user.getEmail(), token));
    }

    // ===== 获取当前登录用户信息 =====
    @GetMapping("/me")                        // GET /api/auth/me
    public Result<UserInfoResponse> getCurrentUser() {
        // 从 SecurityContext 取用户名（JwtAuthenticationFilter 已存好）
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        return Result.success(new UserInfoResponse(null, username));
    }

    // ===== DTO 定义（内部 record 类）=====
    public record RegisterRequest(            // 注册请求
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}

    public record LoginRequest(               // 登录请求
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}

    public record LoginResponse(              // 登录响应（含Token）
            Long id, String username, String email, String token
    ) {}

    public record UserInfoResponse(           // 用户信息响应
            Long userId, String username
    ) {}
}
```

**知识点**：
- 登录接口不需要 Token，因为它就是"获取Token"的入口（不能鸡生蛋蛋生鸡）
- `@Valid` + `@NotBlank`：自动校验参数，为空则返回 400 错误
- `record`：Java 16+ 的纯数据类简写，自动生成构造器、getter、equals 等
- `SecurityContextHolder.getContext().getAuthentication().getName()`：从安全上下文取当前用户名
- 响应中**永远不返回密码**，这是安全基本原则

---

#### `TestController.java` - 测试接口控制器

> 专门用来验证 JWT 认证是否生效。只有带有效 Token 的请求才能访问。

```java
@RestController
@RequestMapping("/api/test")
public class TestController {

    // 获取当前登录用户信息
    @GetMapping("/current-user")
    public Result<String> getCurrentUser() {
        // 从 SecurityContext 获取用户名（JwtAuthenticationFilter 已经存好）
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        return Result.success("当前登录用户：" + username);
    }

    // 简单的受保护接口
    @GetMapping("/protected")
    public Result<String> protectedEndpoint() {
        return Result.success("这是一个受保护的接口，你已成功访问！");
    }
}
```

**测试效果**：
- 不带 Token 访问 → 403 拒绝（SecurityConfig 要求认证）
- 带有效 Token 访问 → 成功返回数据

---

<a id="toc-service"></a>
### 🔹 Service 层

#### `AuthService.java` - 登录注册业务

```java
@Service                                    // ← 标记这是业务类
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;  // ← 密码加密器

    // 构造器注入
    public AuthService(UserRepository userRepository, 
                       PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    // ========== 注册 ==========
    public User register(String username, String password) {
        // 1. 检查用户名
        if (userRepository.existsByUsername(username)) {
            throw new RuntimeException("用户名已被注册");
        }
        
        // 2. 创建用户
        User user = new User();
        user.setUsername(username);
        
        // 3. 加密密码（关键！）
        user.setPassword(passwordEncoder.encode(password));
        
        // 4. 保存
        return userRepository.save(user);
    }

    // ========== 登录 ==========
    public User login(String username, String password) {
        // 1. 查找用户
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户名或密码错误"));
        
        // 2. 校验密码（明文 vs 密文）
        if (!passwordEncoder.matches(password, user.getPassword())) {
            throw new RuntimeException("用户名或密码错误");
        }
        
        return user;
    }
}
```

**知识点**：
- `@Service` 标记业务类
- `PasswordEncoder` 是 Spring Security 提供的密码加密工具
- `BCrypt` 是推荐的加密算法

---

<a id="toc-repository"></a>
### 🔹 Repository 层

#### `NotebookRepository.java` - 笔记本数据访问

```java
// 只要继承 JpaRepository，Spring 自动生成所有 CRUD 方法
public interface NotebookRepository extends JpaRepository<Notebook, Long> {
    // 这里不写任何代码！但已经拥有以下方法：
    // save()           - 新增或更新
    // findById()       - 按 ID 查询
    // findAll()        - 查询所有
    // deleteById()     - 按 ID 删除
    // existsById()     - 判断是否存在
    // count()          - 统计数量
}
```

**知识点**：
- `JpaRepository<实体类, 主键类型>`
- 接口不用写实现，Spring 自动创建

---

#### `UserRepository.java` - 用户数据访问

```java
public interface UserRepository extends JpaRepository<User, Long> {
    
    // 自定义方法：按用户名查询（Spring Data JPA 自动实现）
    Optional<User> findByUsername(String username);
    
    // 自定义方法：检查用户名是否存在
    boolean existsByUsername(String username);
}
```

**知识点**：
- 按规则命名方法，Spring 自动实现查询
- `findByXxx` → 按某个字段查询
- `existsByXxx` → 判断某个字段是否存在

---

<a id="toc-entity"></a>
### 🔹 Entity 层

#### `User.java` - 用户实体

```java
@Data                                       // ← Lombok：自动生成 getter/setter
@Entity                                     // ← 这是数据库表对应的实体
@Table(name = "users")                      // ← 指定表名（默认是 user）
public class User {

    @Id                                     // ← 主键
    @GeneratedValue(strategy = GenerationType.IDENTITY)  // ← 自增
    private Long id;

    @Column(nullable = false, unique = true)  // ← 非空、唯一
    private String username;

    @Column(nullable = false)
    private String password;

    private String email;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ========== 关联关系 ==========
    // 一个用户有多个笔记本
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL)
    private List<Notebook> notebooks = new ArrayList<>();

    // ========== 生命周期回调 ==========
    @PrePersist                               // ← 插入前自动调用
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate                                // ← 更新前自动调用
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
```

**知识点**：
- `@Data`：Lombok 注解，省去写 getter/setter
- `@Entity`：标记这是数据库实体
- `@Id` + `@GeneratedValue`：主键自增
- `@Column`：字段约束
- `@OneToMany`：一对多关联
- `@PrePersist` / `@PreUpdate`：自动维护时间戳

---

#### `Notebook.java` - 笔记本实体

```java
@Data
@Entity
public class Notebook {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "名称不能为空")         // ← 校验：不能为空字符串
    @Size(max = 100, message = "名称过长")      // ← 校验：长度限制
    private String name;

    @Size(max = 500, message = "描述过长")
    private String description;

    private LocalDateTime createTime;

    // ========== 关联关系 ==========
    // 一个笔记本属于一个用户
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    @JsonProperty(access = Access.WRITE_ONLY)  // ← 只接收，不输出到 JSON
    private User user;

    // 一个笔记本有多篇文档
    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, 
               mappedBy = "notebook")
    private List<Document> documents = new ArrayList<>();
}
```

**知识点**：
- `@NotBlank` / `@Size`：参数校验注解
- `@ManyToOne`：多对一关联（多个笔记本属于一个用户）
- `@JoinColumn`：指定外键列名
- `@JsonProperty(access = Access.WRITE_ONLY)`：防止 JSON 死循环

---

#### `Document.java` - 文档实体

```java
@Data
@Entity
public class Document {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "标题不能为空")
    private String title;

    @Column(columnDefinition = "LONGTEXT")     // ← 长文本字段
    private String content;

    private LocalDateTime createTime;

    // 一篇文档属于一个笔记本
    @ManyToOne
    @JoinColumn(name = "notebook_id")
    @JsonIgnore                                 // ← JSON 中忽略此字段
    private Notebook notebook;
}
```

---

<a id="toc-common"></a>
### 🔹 Common 层

#### `Result.java` - 统一返回结果

```java
@Data
public class Result<T> {                       // ← 泛型类

    private int code;                          // 状态码：200成功，400失败
    private String message;                    // 提示信息
    private T data;                            // 实际数据

    // 成功静态方法
    public static <T> Result<T> success(T data) {
        Result<T> result = new Result<>();
        result.setCode(200);
        result.setMessage("操作成功");
        result.setData(data);
        return result;
    }

    // 失败静态方法
    public static <T> Result<T> fail(String message) {
        Result<T> result = new Result<>();
        result.setCode(400);
        result.setMessage(message);
        result.setData(null);
        return result;
    }
}
```

**返回格式示例**：
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "id": 1,
    "name": "学习笔记"
  }
}
```

---

#### `GlobalExceptionHandler.java` - 全局异常处理

```java
@RestControllerAdvice                          // ← 全局异常处理器
public class GlobalExceptionHandler {

    // 拦截参数校验失败的异常
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<?> handleValidation(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .map(err -> err.getField() + ": " + err.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return Result.fail(message);
    }

    // 拦截运行时异常
    @ExceptionHandler(RuntimeException.class)
    public Result<?> handleRuntime(RuntimeException e) {
        return Result.fail(e.getMessage());
    }
}
```

**作用**：
- 统一处理所有 Controller 抛出的异常
- 返回统一的错误格式

---

<a id="toc-filter"></a>
### 🔹 Filter 层

#### `JwtAuthenticationFilter.java` - JWT 认证过滤器

> 这是整个 JWT 认证的**核心执行者**，相当于门口的保安。
> 每个请求进来时，它负责：检查 Token → 验证 Token → 提取用户信息 → 存入安全上下文

```java
@Component                                      // ← Spring 管理的组件
public class JwtAuthenticationFilter extends OncePerRequestFilter {  // ← 每个请求只过滤一次

    private final JwtUtil jwtUtil;               // ← JWT 工具类（构造器注入）

    public JwtAuthenticationFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,      // ← HTTP 请求
                                    HttpServletResponse response,     // ← HTTP 响应
                                    FilterChain filterChain)           // ← 过滤器链（用于放行）
            throws ServletException, IOException {

        // ===== 第1步：从请求头获取 Authorization =====
        String authHeader = request.getHeader("Authorization");
        // 前端格式：Authorization: Bearer eyJhbGciOiJ...

        // ===== 第2步：判断是否有合法的 Token 前缀 =====
        if (!StringUtils.hasText(authHeader) || !authHeader.startsWith("Bearer ")) {
            // 没有 Token → 放行（不是拒绝！后续 SecurityConfig 决定是否拦截）
            filterChain.doFilter(request, response);
            return;                              // ← 退出，不执行后续验证
        }

        // ===== 第3步：提取纯 Token（去掉 "Bearer " 前缀）=====
        String token = authHeader.substring(7);  // "Bearer " 正好7个字符

        // ===== 第4步：验证 Token 是否有效 =====
        if (!jwtUtil.validateToken(token)) {
            // Token 无效 → 返回 401 未授权，请求到此结束
            response.setStatus(401);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":401,\"message\":\"Token 无效或已过期\"}");
            return;                              // ← 不放行！
        }

        // ===== 第5步：Token 有效，提取用户信息 =====
        Long userId = jwtUtil.getUserIdFromToken(token);
        String username = jwtUtil.getUsernameFromToken(token);

        // ===== 第6步：将用户信息存入 SecurityContext（关键！）=====
        // 相当于保安在"访客登记表"上写下你的名字
        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                        username,                    // 主体（你是谁）
                        null,                        // 凭证（密码，已验证过不传）
                        Collections.emptyList()      // 权限列表（暂为空）
                );
        SecurityContextHolder.getContext().setAuthentication(authentication);

        // ===== 第7步：放行，请求继续走向 Controller =====
        filterChain.doFilter(request, response);
    }
}
```

**知识点**：
- `OncePerRequestFilter`：保证每个请求只经过一次此过滤器
- `filterChain.doFilter()`：放行，让请求继续走；不放行则请求到此结束
- `SecurityContextHolder`：Spring Security 的"安全上下文"，存储当前登录用户信息
- 没有 Token 时**放行而不是拒绝**，因为有些接口（登录/注册）本身不需要 Token

---

<a id="toc-config"></a>
### 🔹 Config 层

#### `SecurityConfig.java` - 安全配置

> 这是整个安全体系的**指挥中心**，相当于大楼的门禁管理规章制度。
> 它定义了：用什么锁（密码加密）、哪些门不需要刷卡（放行规则）、谁来检查通行证（JWT过滤器位置）。

```java
@Configuration                                  // ← 配置类
@EnableWebSecurity                             // ← 启用 Web 安全功能
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;  // ← JWT 过滤器

    // 构造器注入 JWT 过滤器
    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
    }

    // ===== 密码加密器 =====
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();     // BCrypt 加密（推荐）
    }

    // ===== 安全过滤器链（核心配置）=====
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 1. 禁用 CSRF（JWT 不需要，因为不用 Cookie）
            .csrf(csrf -> csrf.disable())

            // 2. 无状态会话（不创建 Session，JWT 是无状态的）
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )

            // 3. 配置授权规则
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()    // ← 放行（注册/登录）
                .requestMatchers("/", "/css/**", "/js/**").permitAll()  // ← 放行静态资源
                .anyRequest().authenticated()                    // ← 其他需认证
            )

            // 4. 将 JWT 过滤器加入安全链（在默认的表单登录过滤器之前）
            .addFilterBefore(jwtAuthenticationFilter,
                    UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }
}
```

**知识点**：
- `csrf.disable()`：JWT 不用 Cookie，不受 CSRF 攻击，所以禁用
- `STATELESS`：不创建 Session，每次请求靠 Token 自行证明身份
- `permitAll()`：允许所有人访问（不需要 Token）
- `authenticated()`：需要已认证才能访问
- `addFilterBefore(A, B)`：把过滤器 A 插到 B 之前，确保 JWT 验证在授权检查之前执行

---

<a id="toc-step4"></a>
## 第四步：核心知识点汇总

<a id="toc-di"></a>
### 1. 什么是依赖注入（DI）？

**传统写法**：
```java
// 自己创建对象
UserRepository repo = new UserRepository();
```

**Spring 写法**：
```java
// Spring 自动传进来
private final UserRepository userRepository;

public UserController(UserRepository userRepository) {
    this.userRepository = userRepository;
}
```

**好处**：
- 不用自己 `new`，Spring 统一管理对象生命周期
- 方便替换实现（如换数据库）
- 便于单元测试

---

<a id="toc-jpa"></a>
### 2. 什么是 JPA？

**JPA**（Java Persistence API）是 Java 的持久化规范，让你用操作对象的方式操作数据库。

**对比**：
| 操作 | JDBC 写法 | JPA 写法 |
|-----|----------|---------|
| 查询 | 写 SQL → 执行 → 手动封装对象 | `repository.findById(id)` |
| 插入 | 写 INSERT SQL | `repository.save(entity)` |
| 删除 | 写 DELETE SQL | `repository.deleteById(id)` |

**Spring Data JPA**：在 JPA 基础上进一步封装，连实现类都不用写了！

---

<a id="toc-auth-flow"></a>
### 认证流程详解（Session vs JWT）

#### 传统 Session 认证（有状态）

```
┌─────────┐      登录      ┌─────────┐      创建      ┌─────────┐
│  浏览器  │ ───────────→  │  服务端  │ ───────────→  │ Session │
│         │  username/    │  验证密码 │               │ 存储用户 │
│         │  password     │  创建会话 │               │ 信息    │
│         │ ←───────────  │  返回     │               │         │
│  存     │   Set-Cookie: │  SessionID│               │         │
│ Cookie  │   sessionId=xxx│         │               │         │
└─────────┘               └─────────┘               └─────────┘
        │
        │ 后续请求自动携带 Cookie
        ↓
┌─────────┐      请求      ┌─────────┐      查询      ┌─────────┐
│ Cookie: │ ───────────→  │  服务端  │ ───────────→  │ Session │
│sessionId│               │  提取    │               │ 获取用户 │
│ =xxx    │ ←───────────  │  sessionId│              │ 信息    │
│         │    返回数据    │  查 Session│             │         │
└─────────┘               └─────────┘               └─────────┘
```

**Session 的缺点**：
- 服务端需要存储 Session 数据（内存/Redis）
- 分布式环境下 Session 共享麻烦
- 每次请求都要查 Session，性能开销

---

#### JWT 无状态认证（推荐）

```
┌─────────┐      登录      ┌─────────┐      生成      ┌─────────┐
│  浏览器  │ ───────────→  │  服务端  │ ───────────→  │  JWT    │
│         │  username/    │  验证密码 │               │ Token   │
│         │  password     │  生成 Token│              │ (含签名) │
│         │ ←───────────  │           │               │         │
│  存     │   { token:    │               ┌─────────┐ │         │
│ Token   │     "xxx" }   │               │  不存储  │ │         │
│         │               │               │  任何会话 │ │         │
└─────────┘               └─────────┘     └─────────┘ └─────────┘
        │
        │ 后续请求携带 Token
        │ Authorization: Bearer <token>
        ↓
┌─────────┐      请求      ┌─────────┐               ┌─────────┐
│ Header: │ ───────────→  │  服务端  │               │  不查   │
│Bearer   │               │  提取    │               │  数据库 │
│<token>  │               │  Token   │               │  不查   │
│         │ ←───────────  │  验签名   │               │  Session│
│         │    返回数据    │  解析用户信息              │         │
└─────────┘               └─────────┘               └─────────┘
```

**JWT 的优势**：
- 服务端不存储会话信息（无状态）
- 天然适合分布式/微服务
- 减少数据库查询，性能更好

---

<a id="toc-jwt"></a>
### 什么是 JWT？

**JWT**（JSON Web Token）是一个包含用户信息的加密字符串，由三部分组成：

```
xxxxx.yyyyy.zzzzz
  ↑      ↑      ↑
Header  Payload  Signature
(头部)  (载荷)   (签名)
```

#### 1. Header（头部）
```json
{
  "alg": "HS256",  // 签名算法
  "typ": "JWT"     // Token 类型
}
```
Base64 编码 → `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`

#### 2. Payload（载荷）- 存放数据
```json
{
  "userId": 1,          // 用户ID
  "username": "zhangsan", // 用户名
  "iat": 1712380800,    // 签发时间
  "exp": 1712384400     // 过期时间
}
```
Base64 编码 → `eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiemhhbmdzYW4ifQ`

**⚠️ 注意**：Payload 只是 Base64 编码，**可以被解码看到内容**，不要放敏感信息（如密码）！

#### 3. Signature（签名）- 防篡改
```
HMACSHA256(
  base64Url(header) + "." + base64Url(payload),
  secret  // 密钥，只有服务端知道
)
```

**签名的作用**：
- 没有密钥，无法生成有效的签名
- Token 被篡改后，签名验证会失败
- 保证 Token 是服务端签发的，不是伪造的

---

<a id="toc-auth-example"></a>
### 完整认证流程示例

#### 第一步：注册（密码加密存储）
```java
// 用户发送：{ "username": "zhangsan", "password": "123456" }

User user = new User();
user.setUsername("zhangsan");
user.setPassword(passwordEncoder.encode("123456"));  
// 存储：$2a$10$bvPuZtGy6gIdo6L9DaopVuOLdIf7eLcWRd6Os9SYj03zYkS/.SEBi

userRepository.save(user);
```

#### 第二步：登录（生成 JWT）
```java
// 1. 验证用户名密码
User user = authService.login("zhangsan", "123456");

// 2. 生成 JWT Token
String token = jwtUtil.generateToken(user.getId(), user.getUsername());
// 返回：eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiemhhbmdzYW4ifQ.xxxxx

// 3. 返回给客户端
return Result.success(new LoginResponse(user.getId(), user.getUsername(), token));
```

#### 第三步：后续请求（携带 Token）
```http
GET /api/notebooks
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiemhhbmdzYW4ifQ.xxxxx
```

#### 第四步：服务端验证 Token
```java
// 从 Header 提取 Token
String token = authHeader.replace("Bearer ", "");

// 验证 Token 有效性
if (!jwtUtil.validateToken(token)) {
    return Result.fail("Token 无效或已过期");
}

// 解析用户信息
Long userId = jwtUtil.getUserIdFromToken(token);  // 1
String username = jwtUtil.getUsernameFromToken(token);  // "zhangsan"

// 使用用户信息执行业务逻辑...
```

---

<a id="toc-bcrypt"></a>
### BCrypt 密码加密

**为什么不能用明文存储密码？**

| 风险 | 说明 |
|-----|------|
| 数据库泄露 | 明文密码直接暴露 |
| 内部人员风险 | DBA/运维可以看到所有密码 |
| 用户习惯问题 | 很多人多个网站用同一密码 |

**BCrypt 特点**：
- **单向性**：明文 → 密文容易，密文 → 明文几乎不可能
- **自动加盐**：相同密码每次加密结果不同
- **慢计算**：增加暴力破解成本

```java
// 加密
String encrypted = passwordEncoder.encode("123456");
// 结果：$2a$10$bvPuZtGy6gIdo6L9DaopVuOLdIf7eLcWRd6Os9SYj03zYkS/.SEBi

// 校验
boolean match = passwordEncoder.matches("123456", encrypted);
// 返回：true
```

---

<a id="toc-jwt-filter"></a>
### JWT 认证过滤器机制（核心！）

整个 JWT 认证由**三个组件协作完成**，各司其职：

```
┌──────────────────────────────────────────────────────────────────┐
│                    三个组件的分工                                  │
├──────────────────────┬───────────────────────────────────────────┤
│ JwtAuthenticationFilter │ 保安：检查每个请求的 Token               │
│ （过滤器）               │ 有效 → 存用户信息 → 放行                 │
│                        │ 无效 → 返回401                          │
│                        │ 没带 → 放行（交给门禁规则判断）            │
├──────────────────────┼───────────────────────────────────────────┤
│ SecurityConfig        │ 门禁规则：决定哪些路径需要认证              │
│ （配置类）              │ /api/auth/** → 放行                     │
│                       │ 其他 → 需要认证                          │
├──────────────────────┼───────────────────────────────────────────┤
│ JwtUtil              │ 工具人：生成/解析/验证 Token                │
│ （工具类）              │ 被过滤器和 Controller 调用               │
└──────────────────────┴───────────────────────────────────────────┘
```

#### 请求处理的完整流程

```
HTTP 请求进来
    │
    ▼
┌─────────────────────────────────────────┐
│ JwtAuthenticationFilter（保安检查）       │
│                                         │
│  有 Token？                             │
│  ├─ 没有 → 放行（不拦截）               │
│  ├─ 有但无效 → 返回 401（拦截！）        │
│  └─ 有且有效 → 存入 SecurityContext → 放行│
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│ SecurityConfig 授权检查（门禁规则）       │
│                                         │
│  路径匹配 /api/auth/**？                │
│  ├─ 是 → permitAll()，直接放行 ✅        │
│  └─ 否 → 检查 SecurityContext           │
│       ├─ 有用户信息 → authenticated() ✅ │
│       └─ 无用户信息 → 拒绝访问 ❌ (403)  │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│ Controller（处理业务）                   │
│                                         │
│  可通过 SecurityContextHolder            │
│  获取当前登录用户信息                     │
└─────────────────────────────────────────┘
```

#### SecurityContext 机制

`SecurityContext` 是 Spring Security 的"访客登记表"，整个认证的关键桥梁：

```
JwtAuthenticationFilter 写入                    Controller 读取
        │                                            │
        ▼                                            ▼
SecurityContextHolder                    SecurityContextHolder
    .getContext()                           .getContext()
    .setAuthentication(authentication)      .getAuthentication()
                                            .getName()
        │                                            │
        ▼                                            ▼
  存入用户名 "zhangsan"                        取出用户名 "zhangsan"
```

- **谁写入**：`JwtAuthenticationFilter`（第6步）
- **谁读取**：任何 Controller，通过 `SecurityContextHolder.getContext().getAuthentication()`
- **生命周期**：每次请求创建，请求结束销毁（线程隔离）

---

<a id="toc-security-context"></a>
### SecurityContextHolder 的实际应用（Day 15）

#### 场景：创建资源时自动关联当前用户

**Day 11 的做法**（前端传 userId）：
```json
POST /api/notebooks
{
  "name": "我的笔记本",
  "user": { "id": 3 }  // ⚠️ 需要前端传，可被伪造！
}
```

**Day 15 的做法**（后端自动获取）：
```json
POST /api/notebooks
Authorization: Bearer xxx
{
  "name": "我的笔记本"
  // 不需要传 user！
}
```

**Controller 代码**：
```java
@PostMapping
public Result<Notebook> createNotebook(@Valid @RequestBody Notebook notebook) {
    // ===== 自动关联当前登录用户 =====
    // 1. 从 SecurityContext 获取当前登录用户名
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    
    // 2. 查询用户实体
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));
    
    // 3. 设置关联
    notebook.setUser(currentUser);
    // =================================
    
    notebook.setCreateTime(LocalDateTime.now());
    return Result.success(notebookRepository.save(notebook));
}
```

**好处**：
- 前端更简单（少传一个字段）
- 无法伪造（Token 里是谁，就是谁）
- 更安全（防止恶意用户把资源关联到别人账号）

#### 完整的数据流转

```
用户登录
    ↓
后端返回 JWT Token（包含用户名）
    ↓
前端存储 Token
    ↓
前端请求创建笔记本（Header 携带 Token）
    ↓
JWT Filter 校验 Token，提取用户名存入 SecurityContext
    ↓
Controller 从 SecurityContextHolder 获取用户名
    ↓
查询 User 实体，设置到 Notebook 对象
    ↓
保存到数据库（自动关联 user_id）
```

#### 为什么没 Token 也放行？

`JwtAuthenticationFilter` 的原则是："**我只验证有 Token 的请求，没 Token 的不归我管**"。

这是因为：
- 登录、注册接口本身不需要 Token
- 静态资源（HTML/CSS/JS）不需要 Token
- 是否需要认证由 `SecurityConfig` 的 `permitAll()` / `authenticated()` 来决定

如果过滤器把没 Token 的请求直接拒绝，那登录接口就永远无法访问了。

---

<a id="toc-dto"></a>
### DTO 与 record 模式

**DTO**（Data Transfer Object）是专门用于接收请求或返回响应的数据对象。

#### 为什么需要 DTO？

| 不用 DTO（直接用 Entity） | 用 DTO |
|--------------------------|--------|
| 返回 User 对象时，密码也会被返回 | LoginResponse 中不包含密码字段 |
| 请求和响应混用同一个类 | 请求和响应各用各的类，职责清晰 |
| 无法对请求和响应分别校验 | RegisterRequest 有 @NotBlank，Entity 不需要 |

#### record 语法（Java 16+）

```java
// record 写法（一行搞定）
public record LoginRequest(
    @NotBlank String username,
    @NotBlank String password
) {}

// 等价于传统写法（一大堆代码）
public class LoginRequest {
    private final String username;
    private final String password;
    public LoginRequest(String username, String password) { ... }
    public String username() { return username; }
    public String password() { return password; }
    // 还自动生成 equals()、hashCode()、toString()
}
```

#### 项目中的 DTO 设计

| DTO | 用途 | 包含字段 |
|-----|------|---------|
| `RegisterRequest` | 注册请求 | username, password |
| `LoginRequest` | 登录请求 | username, password |
| `LoginResponse` | 登录响应 | id, username, email, **token** |
| `UserInfoResponse` | 用户信息响应 | userId, username |

> 注意：所有响应 DTO 中都**没有 password 字段**，这是安全的基本原则。

---

<a id="toc-derived-query"></a>
### 3. JPA 派生查询方法（Derived Query Methods）

Spring Data JPA 最强大的特性之一：**只需按规则命名方法，Spring 自动生成对应的 SQL，无需手写实现。**

#### 3.1 命名规则结构

```
[操作前缀] + By + [属性名] + [操作] + [连接词] + [属性名] + [操作] + [OrderBy...]
```

#### 3.2 操作前缀（开头关键字）

| 前缀 | 作用 | 返回类型 | 示例 |
|-----|------|---------|------|
| `findBy` / `findAllBy` | **查询** | 实体 / `List` / `Optional` | `findByName` |
| `findFirstBy` | 查第一条 | 单个实体 | `findFirstByUserId` |
| `findTop3By` | 查前 N 条 | `List` | `findTop3ByCreateTimeDesc` |
| `getBy` / `readBy` | 查询（同 `findBy`） | 实体 | `getById` |
| `countBy` | **统计数量** | `long` | `countByUserId` |
| `existsBy` | **判断存在** | `boolean` | `existsByIdAndUserId` |
| `deleteBy` / `removeBy` | **删除** | `void` / `long` | `deleteByStatus` |

#### 3.3 条件关键字（中间连接）

**逻辑连接：**

| 关键字 | SQL 对应 | 示例 | 生成的 SQL |
|-------|---------|------|-----------|
| `And` | `AND` | `findByNameAndAge` | `WHERE name = ? AND age = ?` |
| `Or` | `OR` | `findByNameOrEmail` | `WHERE name = ? OR email = ?` |

**比较操作：**

| 关键字 | SQL 对应 | 示例 | 生成的 SQL |
|-------|---------|------|-----------|
| `Equals` / 省略 | `=` | `findByName` | `WHERE name = ?` |
| `GreaterThan` | `>` | `findByAgeGreaterThan` | `WHERE age > ?` |
| `GreaterThanEqual` | `>=` | `findByAgeGreaterThanEqual` | `WHERE age >= ?` |
| `LessThan` | `<` | `findByAgeLessThan` | `WHERE age < ?` |
| `LessThanEqual` | `<=` | `findByAgeLessThanEqual` | `WHERE age <= ?` |
| `Between` | `BETWEEN` | `findByAgeBetween` | `WHERE age BETWEEN ? AND ?` |
| `In` | `IN` | `findByIdIn` | `WHERE id IN (?, ?, ?)` |
| `NotIn` | `NOT IN` | `findByIdNotIn` | `WHERE id NOT IN (?, ?, ?)` |
| `IsNull` | `IS NULL` | `findByNameIsNull` | `WHERE name IS NULL` |
| `IsNotNull` | `IS NOT NULL` | `findByNameIsNotNull` | `WHERE name IS NOT NULL` |
| `Like` | `LIKE` | `findByNameLike` | `WHERE name LIKE ?`（需自己加 `%`） |
| `NotLike` | `NOT LIKE` | `findByNameNotLike` | `WHERE name NOT LIKE ?` |
| `StartingWith` | `LIKE 'xxx%'` | `findByNameStartingWith` | `WHERE name LIKE ?%`（自动加 `%`） |
| `EndingWith` | `LIKE '%xxx'` | `findByNameEndingWith` | `WHERE name LIKE %?`（自动加 `%`） |
| `Containing` | `LIKE '%xxx%'` | `findByNameContaining` | `WHERE name LIKE %?%`（自动加 `%`） |
| `Not` / `IsNot` | `<>` | `findByNameNot` | `WHERE name <> ?` |
| `True` | `= true` | `findByActiveTrue` | `WHERE active = true` |
| `False` | `= false` | `findByActiveFalse` | `WHERE active = false` |

**排序和分页：**

| 关键字 | 作用 | 示例 | 生成的 SQL |
|-------|------|------|-----------|
| `OrderBy` | 排序 | `findByUserIdOrderByCreateTimeDesc` | `ORDER BY create_time DESC` |
| `Asc` | 升序 | `OrderByNameAsc` | `ORDER BY name ASC` |
| `Desc` | 降序 | `OrderByNameDesc` | `ORDER BY name DESC` |

> **分页**：方法参数加 `Pageable pageable`，返回 `Page<T>`

#### 3.4 项目中的实际应用

本项目 `NotebookRepository` 中的三个自定义方法：

```java
public interface NotebookRepository extends JpaRepository<Notebook, Long> {
    
    // findBy → 查询列表
    List<Notebook> findByUserId(Long userId);
    // SQL: SELECT * FROM notebook WHERE user_id = ?
    
    // findBy + And → 精确匹配两个条件，返回 Optional（可能为空）
    Optional<Notebook> findByIdAndUserId(Long id, Long userId);
    // SQL: SELECT * FROM notebook WHERE id = ? AND user_id = ?
    // 用途：修改/查看详情前校验归属（防越权）
    
    // existsBy + And → 判断是否存在，返回布尔值（性能更好，不查具体数据）
    Boolean existsByIdAndUserId(Long id, Long userId);
    // SQL: SELECT COUNT(*) FROM notebook WHERE id = ? AND user_id = ?
    // 用途：删除前快速判断是否存在且属于自己
}
```

#### 3.5 完整示例

```java
public interface UserRepository extends JpaRepository<User, Long> {
    
    // 基础查询
    Optional<User> findByEmail(String email);
    List<User> findByStatus(String status);
    
    // 多条件 And / Or
    Optional<User> findByNameAndAge(String name, Integer age);
    List<User> findByNameOrEmail(String name, String email);
    
    // 比较
    List<User> findByAgeGreaterThan(Integer age);
    List<User> findByAgeBetween(Integer min, Integer max);
    
    // 模糊查询
    List<User> findByNameContaining(String keyword);     // %keyword%
    List<User> findByNameStartingWith(String prefix);    // prefix%
    
    // Null 判断
    List<User> findByEmailIsNull();
    
    // In 查询
    List<User> findByIdIn(List<Long> ids);
    
    // 统计
    long countByStatus(String status);
    
    // 判断存在
    boolean existsByEmail(String email);
    
    // 排序
    List<User> findByStatusOrderByCreateTimeDesc(String status);
    
    // 分页（参数传入 Pageable）
    Page<User> findByStatus(String status, Pageable pageable);
    
    // 查第一条
    User findFirstByStatusOrderByCreateTimeDesc(String status);
    
    // 删除
    void deleteByStatus(String status);
    long deleteByCreateTimeBefore(LocalDateTime time);
}
```

#### 3.6 与 Optional 的配合使用

`findByXxx` 返回 `Optional<T>` 时，需要"拆包"才能拿到实体：

```java
// ✅ 正确：.orElseThrow() 拆开 Optional，拿到 Notebook
Notebook notebook = notebookRepository
        .findByIdAndUserId(notebookId, currentUser.getId())
        .orElseThrow(() -> new RuntimeException("笔记本不存在或无权限"));

// 拆包后 notebook 的类型是 Notebook，可以直接操作
notebook.setName("新名称");
notebookRepository.save(notebook);
```

| 方法 | 作用 | 空值时的行为 |
|-----|------|-----------|
| `.get()` | 取出值 | 抛 `NoSuchElementException`（不安全，不推荐） |
| `.orElse(defaultValue)` | 取出值，或使用默认值 | 返回默认值 |
| `.orElseGet(() -> ...)` | 取出值，或延迟计算默认值 | 执行 Lambda 返回默认值 |
| `.orElseThrow(() -> ...)` | 取出值，或抛自定义异常 | 抛出自定义异常 |

#### 3.7 注意事项

1. **属性名必须和实体类字段一致**（区分大小写，按驼峰命名）
2. **参数顺序必须和方法名中的条件顺序一致**
3. **太复杂的查询不适合派生方法**，可以用 `@Query` 注解手写 SQL/JPQL
4. **避免方法名过长**，超过 3-4 个条件建议改用 `@Query`
5. **`existsBy`** 只判断有无，不查具体数据，**性能更好**，适合删除前校验

---

<a id="toc-relation"></a>
### 4. 关联关系注解

| 注解 | 关系 | 示例 |
|-----|------|------|
| `@OneToOne` | 一对一 | 用户 ↔ 用户详情 |
| `@OneToMany` | 一对多 | 用户 → 多个笔记本 |
| `@ManyToOne` | 多对一 | 多个笔记本 → 一个用户 |
| `@ManyToMany` | 多对多 | 学生 ↔ 课程 |

**属性说明**：
- `mappedBy`：由哪一方维护关系
- `cascade = CascadeType.ALL`：级联操作（删除父级同时删除子级）
- `fetch = FetchType.LAZY`：懒加载（用到时才查询）

---

<a id="toc-validation"></a>
### 5. 校验注解

| 注解 | 作用 |
|-----|------|
| `@NotNull` | 不能为 null |
| `@NotBlank` | 不能为 null，且不能为空字符串（"") |
| `@NotEmpty` | 不能为 null，且不能为空（对集合有效） |
| `@Size(min, max)` | 长度限制 |
| `@Min` / `@Max` | 数值范围 |
| `@Email` | 邮箱格式 |

**使用方式**：
```java
@PostMapping
public Result<User> create(@Valid @RequestBody User user) {
    // @Valid 会触发 User 类中所有字段的校验
}
```

---

<a id="toc-data-isolation"></a>
### 6. 数据隔离与权限控制（Day 16）

> **核心目标**：确保每个用户只能看到和操作属于自己的资源。这是从"功能实现"走向"生产安全"的关键一步。

#### 6.1 为什么需要数据隔离？

Day 15 实现了**写入时自动关联用户**，但**读取和修改时没有做权限校验**。

想象一下这个场景：

```
用户 A 登录后，调用 GET /api/notebooks
→ 返回的不仅是 A 的笔记本，还有 B、C、D 所有人的！

用户 A 调用 DELETE /api/notebooks/5
→ 如果 ID=5 是用户 B 的笔记本，A 直接把它删了！
```

这就像你进了一家银行，柜员把所有客户的存折都拿给你看——显然不行！

#### 6.2 数据隔离的两个层面

| 层面 | 说明 | 示例 |
|------|------|------|
| **查询隔离** | 列表接口只返回当前用户的数据 | `SELECT * FROM notebooks WHERE user_id = ?` |
| **操作隔离** | 修改/删除前先校验资源归属 | 先查出 notebook，判断 user.id 是否匹配 |

#### 6.3 实现策略：SQL 层面过滤

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

#### 6.4 项目中实际应用

**Repository 层扩展**：

```java
public interface NotebookRepository extends JpaRepository<Notebook, Long> {
    // 查询隔离：只查当前用户的笔记本
    List<Notebook> findByUserId(Long userId);
    
    // 操作隔离：校验某个笔记本是否属于当前用户
    Optional<Notebook> findByIdAndUserId(Long id, Long userId);
    
    // 删除前快速判断（不需要查出完整实体，性能更好）
    Boolean existsByIdAndUserId(Long id, Long userId);
}
```

**Controller 层改造**：

```java
// ========== 查询隔离示例 ==========
@GetMapping
public Result<List<Notebook>> getAllNotebooks() {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));
    
    // 只返回当前用户的笔记本
    return Result.success(notebookRepository.findByUserId(currentUser.getId()));
}

// ========== 操作隔离示例（修改） ==========
@PutMapping("/{id}")
public Result<Notebook> updateNotebook(@PathVariable Long id,
                                        @Valid @RequestBody Notebook updatedNotebook) {
    // 获取当前用户
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));
    
    // 同时校验：id 存在 AND 属于当前用户
    Notebook existingNotebook = notebookRepository
            .findByIdAndUserId(id, currentUser.getId())
            .orElseThrow(() -> new RuntimeException("笔记本不存在或无权操作"));
    
    existingNotebook.setName(updatedNotebook.getName());
    existingNotebook.setDescription(updatedNotebook.getDescription());
    return Result.success(notebookRepository.save(existingNotebook));
}

// ========== 操作隔离示例（删除） ==========
@DeleteMapping("/{id}")
public Result<Void> deleteNotebook(@PathVariable Long id) {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));
    
    // 快速判断是否存在且属于自己
    boolean exists = notebookRepository.existsByIdAndUserId(id, currentUser.getId());
    if (!exists) {
        throw new RuntimeException("笔记本不存在或无权删除");
    }
    
    notebookRepository.deleteById(id);
    return Result.success(null);
}
```

#### 6.5 数据隔离的三层防线

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

#### 6.6 Day 15 vs Day 16 对比

|| Day 15 | Day 16 |
|--|--------|--------|
| **目标** | 写入时自动关联用户 | 读写都做权限控制 |
| **关注点** | 创建资源时设好 owner | 查询/修改/删除时校验 owner |
| **比喻** | 给文件贴上主人标签 | 进门前检查门牌号 |
| **SecurityContext 用途** | 获取 username 来 set User | 获取 username 来做 WHERE 条件 |

#### 6.7 常见错误提醒

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

<a id="toc-spring-ai"></a>
### 7. Spring AI 集成（Day 18/19）

> 将大模型能力接入 Spring Boot 项目，实现 AI 功能。
> ⚠️ 本节基于项目实际运行环境编写，包含完整的踩坑记录和解决方案。

#### 7.1 为什么要用 Spring AI？

直接调用各厂商的 API，格式不统一、代码混乱：
- OpenAI 一套接口格式
- DeepSeek 一套接口格式
- 智谱 GLM 又是一套格式

**Spring AI 的作用**：提供统一抽象层，一套代码调用所有模型。

```
你的代码 → ChatClient.prompt().user().call().content()
                    ↓
               Spring AI（统一接口）
                    ↓
        ┌──────────┬───────────┬─────────┐
        ↓          ↓           ↓
     DeepSeek    OpenAI      智谱GLM
```

**类比**：

| 场景 | 统一框架 | 底层实现 |
|------|---------|---------|
| 数据库访问 | JDBC | MySQL、PostgreSQL |
| 大模型调用 | **Spring AI** | DeepSeek、OpenAI |

---

#### 7.2 ⚠️⚠️⚠️ 版本兼容性（最重要的坑！）

这是 Day 18/19 过程中**踩过的最大的坑**，务必仔细阅读！

##### 问题背景

| 组件 | 教程原始版本 | 项目实际使用版本 | 兼容？ |
|------|------------|----------------|:------:|
| Spring Boot | 3.4.2 | 3.4.2 | — |
| Spring AI | 1.0.0-M6（里程碑）| **1.0.0 GA（正式版）** | ⚠️ API 变了！ |

##### 三次踩坑经历

**❌ 第 1 次：ChatClient Bean 找不到**
```
错误: Parameter 0 of constructor required a bean of type 'ChatClient' that could not be found
原因: application.properties 写在了 target/ 目录而不是 src/main/resources/
教训: 永远只改 src/ 下的源文件，target/ 是编译产物会被覆盖！
```

**❌ 第 2 次：Spring AI M6 与 Boot 3.4.2 不兼容**
```
错误: 同上（ChatClient 找不到）
原因: spring-ai-bom 1.0.0-M6 只兼容 Spring Boot 3.3.x
解决: 尝试升级 BOM 到 1.0.0 GA
```

**❌ 第 3 次：升级到 1.0.0 后依赖名变了**
```
错误: dependencies.dependency.version for spring-ai-openai-spring-boot-starter is missing
原因: 1.0.0 GA 重命名了所有 starter artifactId！
解决: 改用新的名字
```

| 旧名称 (M6) | 新名称 (**1.0.0 GA**) |
|-------------|---------------------|
| `spring-ai-openai-spring-boot-starter` | **`spring-ai-starter-model-openai`** |
| （无） | **`spring-ai-starter-model-deepseek`**（新增原生支持）|

**✅ 第 4 次：终于成功 —— 但 ChatClient 注入方式也变了**
```
旧方式(M6):  直接注入 ChatClient
新方式(GA):  必须注入 ChatClient.Builder，然后 .build()
```

##### ✅ 最终可用配置（经过验证！）

**pom.xml 关键配置**：
```xml
<!-- Spring Boot 保持 3.4.2 -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.4.2</version>    <!-- 不降级 -->
</parent>

<!-- BOM 使用 1.0.0 GA 正式版 -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-bom</artifactId>
            <version>1.0.0</version>    <!-- 不是 M6！-->
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<!-- 依赖使用新名字 -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-openai</artifactId>    <!-- 新名字！-->
</dependency>
```

**application.properties 配置**：
```properties
# DeepSeek API 地址
spring.ai.openai.base-url=https://api.deepseek.com
# 你的 API Key
spring.ai.openai.api-key=sk-你的真实key
# 模型名称
spring.ai.openai.chat.options.model=deepseek-chat
```

> 💡 **1.0.0 GA 已发布到 Maven 中央仓库**，不再需要 milestone 仓库配置。

##### Controller 注入方式（1.0.0 GA 专用写法）

```java
// ❌ M6 写法（1.0.0 里不行了）
private final ChatClient chatClient;
public MyController(ChatClient chatClient) {
    this.chatClient = chatClient;
}

// ✅ GA 写法（必须用 Builder）
private final ChatClient chatClient;
public MyController(ChatClient.Builder chatClientBuilder) {
    this.chatClient = chatClientBuilder.build();   // 注意 .build()！
}
```

---

#### 7.3 为什么用 `openai-starter` 调用 DeepSeek？

**关键原因：DeepSeek 的 API 设计完全兼容 OpenAI 格式！**

| 对比项 | OpenAI | DeepSeek |
|--------|--------|---------|
| 请求路径 | `/v1/chat/completions` | `/v1/chat/completions` ✅ |
| 请求参数 | `model`, `messages`, `temperature` | 一样 ✅ |
| 响应格式 | `choices[].message.content` | 一样 ✅ |

**结论**：只需改 `base-url` 和 `api-key`，其他代码完全不用动。

---

#### 7.4 API Key 安全原则

```mermaid
flowchart LR
    A["❌ 错误做法"] --> B["把 Key 写死在 Java 代码里"]
    B --> C["提交到 Git → 全世界都能看到你的 Key"]

    D["✅ 正确做法"] --> E["写在 application.properties 中"]
    E --> F["文件加入 .gitignore → 不提交到版本控制"]

    G["✅ 最佳实践"] --> H["使用环境变量或密钥管理服务"]
```

**记住一句话：API Key = 你的银行卡密码，泄露了别人会花你的钱！**

| 原则 | 做法 |
|------|------|
| ❌ 禁止 | 硬编码在 Java 代码里 |
| ✅ 正确 | 写在 `application.properties`，并加入 `.gitignore` |
| 🔐 最佳 | 生产环境使用环境变量或密钥管理服务 |

---

#### 7.5 Spring Security 放行规则

添加 AI 测试接口后，必须在 `SecurityConfig.java` 中放行 `/test/**` 路径：

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/", "/index.html", "/css/**", "/js/**").permitAll()
    .requestMatchers("/api/auth/**").permitAll()
    .requestMatchers("/test/**").permitAll()      // ← 新增！放行测试接口
    .anyRequest().authenticated()
)
```

否则访问 `/test/ai` 会返回 **401 未授权**或被重定向到登录页。

---

#### 7.6 启动验证

配置完成后启动项目，成功标志：
1. 控制台没有红色错误（没有 "ChatClient not found"）
2. 最终显示 `Started NotebookCloneApplication in x.xxx seconds`
3. 访问 `GET /test/ai` 返回 AI 回复（约 3~5 秒延迟是正常的）

> 启动时只会初始化 ChatClient，不会立即调用 DeepSeek API。真正的 API 调用在收到 HTTP 请求时才发生。

---

<a id="toc-chatclient"></a>
### 8. ChatClient 调用与 Prompt 工程（Day 19）

> 核心目标：使用 Spring AI 的 ChatClient 编写第一个 AI 接口，掌握 Prompt 的基本结构（System + User）。

#### 8.1 ChatClient 调用链（必须背诵！）

```
chatClient
    .prompt()              // ① 开始构造请求
    .system("...")         // ② (可选) 设置系统提示——给 AI 定人设
    .user("...")           // ③ (必填) 设置用户问题
    .call()                // ④ 同步阻塞调用模型
    .content();            // ⑤ 提取文本回复
```

| 方法 | 作用 | 是否必填 | 类比 |
|------|------|:-------:|------|
| `.prompt()` | 开始构造对话请求 | ✅ | "我要发消息了" |
| `.system("...")` | 设定 AI 身份/风格 | ❌ 可选 | "入职培训手册" |
| `.user("...")` | 用户的具体问题 | ✅ 必填 | "日常工作任务" |
| `.call()` | 发送并等待回复（**线程阻塞**）| ✅ | "发送！等回信..." |
| `.content()` | 取出文字回答 | ✅ | "把信的内容给我" |

---

#### 8.2 Prompt 的两种角色

和大模型对话时，消息分为两种角色：

| 角色 | 作用 | 示例 | 是否必填 |
|------|------|------|:-------:|
| **System**（系统提示） | 设定 AI 的身份、能力边界、回答风格 | "你是一位技术文档助手，回答简洁" | ❌ 可选 |
| **User**（用户提示） | 用户的具体问题 | "什么是 RESTful API？" | ✅ 必填 |

```
┌─────────────────────────────────────────────┐
│ Prompt（提示词）                            │
├─────────────────────────────────────────────┤
│ System: 你是一个资深后端工程师               │ ← 给 AI "定人设"
├─────────────────────────────────────────────┤
│ User: 什么是 RESTful API？                  ← 用户的真实问题
└─────────────────────────────────────────────┘
                    │
                    ▼
              大模型生成回复
```

##### System Prompt vs User Prompt 对比

|| System Prompt | User Prompt |
|--|---------------|-------------|
| **次数** | 通常一次 | 可以多次（多轮对话历史）|
| **作用** | 给 AI "定规矩"、设定身份 | 用户的具体问题 |
| **类比** | 入职培训手册 | 日常具体工作任务 |
| **是否必填** | 否 | 是 |

##### 💡 Prompt 工程实战：同一问题不同人设的效果对比

同样的 `"question": "什么是 Spring Boot？"`，不同的 System Prompt 会得到天差地别的回答：

| System Prompt | 回答风格 | 示例 |
|--------------|---------|------|
| `"你是一位大学教授"` | 很长、严谨、有定义有背景有优缺点... | "Spring Boot 是基于 Spring Framework 的开源框架..." |
| `"你是一位短视频博主"` | 口语化、简短、"兄弟们..." | "兄弟们，Spring Boot 就是个脚手架..." |
| `"你是一位幽默的程序员诗人"` | 诗歌/段子形式 | "Spring Boot 似春风，自动配置乐无穷..." |

**这就是 Prompt 工程的基础：通过 System Prompt 控制输出风格。**

---

#### 8.3 实际代码示例：TestAiController

##### GET 接口（硬编码提问，用于快速验证连通性）

```java
@GetMapping("/ai")
public Result<String> testAi() {
    String answer = chatClient.prompt()
            .user("你好，请用一句话介绍你自己")
            .call()
            .content();
    return Result.success(answer);
}
```

##### POST 接口（支持自定义问题 + System Prompt）

```java
@PostMapping("/ai")
public Result<String> chat(@RequestBody ChatRequest request) {
    // 参数校验
    if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
        return Result.fail("问题不能为空");
    }

    // 构建 Prompt
    ChatClient.ChatClientRequestSpec prompt = chatClient.prompt();

    // 如果传了 systemPrompt，就设置 System 角色（可选）
    if (request.getSystemPrompt() != null && !request.getSystemPrompt().trim().isEmpty()) {
        prompt.system(request.getSystemPrompt());
    }

    // 设置 User 问题并发起调用
    String answer = prompt
            .user(request.getQuestion())
            .call()
            .content();

    return Result.success(answer);
}
```

##### 请求 DTO（ChatRequest.java）

```java
@Data
public class ChatRequest {
    private String question;       // 用户的问题（必填）
    private String systemPrompt;   // 系统提示词（可选）
}
```

**调用逻辑流程**：
```
用户传了 systemPrompt？
    ├─ 是 → prompt.system("用户自定义的系统提示")
    └─ 否 → 不设置 System（模型用默认身份）

prompt.user("用户的具体问题")  ← 必须有
.call().content()              ← 同步阻塞调用
```

---

#### 8.4 完整的 api.http 测试用例

```http
### Day19-1. 基础测试：固定问题（GET 请求）
GET http://localhost:8080/test/ai

### Day19-2. 自定义问题（不带 System Prompt）
POST http://localhost:8080/test/ai
Content-Type: application/json

{
  "question": "Java 和 Python 有什么区别？用一句话概括"
}

### Day19-3. 自定义问题 + System Prompt（教授人设）
POST http://localhost:8080/test/ai
Content-Type: application/json

{
  "question": "什么是 RESTful API？",
  "systemPrompt": "你是一位大学教授，回答要严谨详尽，控制在200字以内"
}

### Day19-4. 测试空问题（应该返回错误）
POST http://localhost:8080/test/ai
Content-Type: application/json

{
  "question": ""
}

### Day19-5. 让 AI 写一首诗（诗人人设）
POST http://localhost:8080/test/ai
Content-Type: application/json

{
  "question": "写一首关于编程的短诗，4句话",
  "systemPrompt": "你是一位幽默的程序员诗人"
}
```

---

<a id="toc-sync-blocking"></a>
### 9. 同步阻塞与 @Async 异步实战（Day 25）

#### 9.1 什么是同步阻塞？

Day 24 的文档上传流程中，AI 摘要生成会阻塞接口：

```java
// 同步模式：用户要一直等
String summary = aiSummaryService.generateSummary(content);  // ← 阻塞 3~10 秒
document.setSummary(summary);
return Result.success(documentRepository.save(document));
```

**问题**：AI 调用是外部网络请求，往返 + 推理需要好几秒。这期间 Tomcat 线程被占用，用户看着页面转圈。

#### 9.2 异步的思路

发起慢任务后**不等它完成**，立刻返回。慢任务在后台线程自己跑。

```
用户上传 → 保存文件 → 立刻返回"上传成功"
                ↓
         后台线程：慢慢调 AI → 更新摘要字段
```

#### 9.3 @Async 核心机制

Spring 提供的**声明式异步注解**。方法上加 `@Async`，Spring 自动用线程池执行它。

| 要点 | 说明 |
|:---|:---|
| 启用方式 | 启动类加 `@EnableAsync` |
| 必须跨类调用 | `@Async` 方法写在 **另一个类** 里才生效（AOP 代理机制） |
| 自定义线程池 | 默认 `SimpleAsyncTaskExecutor` 每次新建线程，不推荐 |

#### 9.4 启动类加 @EnableAsync

```java
@SpringBootApplication
@EnableAsync  // 开启异步支持
public class NotebookCloneApplication {
    public static void main(String[] args) {
        SpringApplication.run(NotebookCloneApplication.class, args);
    }
}
```

#### 9.5 自定义线程池（AsyncConfig）

```java
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "aiTaskExecutor")
    public Executor aiTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);       // 常驻 2 个线程
        executor.setMaxPoolSize(5);        // 最多扩到 5 个
        executor.setQueueCapacity(50);     // 队列最多 50 个
        executor.setThreadNamePrefix("ai-async-");
        executor.setRejectedExecutionHandler(
            new ThreadPoolExecutor.CallerRunsPolicy()
        );
        executor.initialize();
        return executor;
    }
}
```

**线程池工作流程**：

```
来了任务 → core 线程(2个) → 满了进队列(50个) → 满了扩线程(最多5个) → 还是满的走拒绝策略
```

| 参数 | 取值 | 原因 |
|:---|:---|:---|
| `corePoolSize` | 2 | AI 调用依赖外部 API，并发太高易限流 |
| `maxPoolSize` | 5 | 峰值时多开几个兜底 |
| `queueCapacity` | 50 | 连续上传多文档时排队，不丢任务 |
| `CallerRunsPolicy` | 队列满后调用者自己跑 | 变同步，天然减速带，不抛异常 |

#### 9.6 异步摘要服务（AsyncSummaryService）

```java
@Slf4j
@Service
@RequiredArgsConstructor
public class AsyncSummaryService {

    private final AiSummaryService aiSummaryService;
    private final DocumentRepository documentRepository;

    @Async("aiTaskExecutor")  // 用自定义线程池
    public void generateSummaryAsync(Long documentId) {
        log.info("[异步摘要] 开始生成文档 {} 的摘要", documentId);
        try {
            Document document = documentRepository.findById(documentId).orElse(null);
            if (document == null || document.getContent() == null
                    || document.getContent().isEmpty()) {
                return;
            }
            String summary = aiSummaryService.generateSummary(document.getContent());
            document.setSummary(summary);
            documentRepository.save(document);
            log.info("[异步摘要] 文档 {} 摘要生成成功", documentId);
        } catch (Exception e) {
            log.error("[异步摘要] 文档 {} 摘要生成失败: {}", documentId, e.getMessage());
        }
    }
}
```

**为什么 @Async 方法必须跨类调用？**

```java
// ❌ 错误：同类中调用，this.foo() 不走 Spring AOP 代理
@Service
public class XxxService {
    public void upload() {
        this.generateSummaryAsync(docId);  // @Async 不生效！
    }
    @Async
    public void generateSummaryAsync(Long docId) { ... }
}

// ✅ 正确：注入另一个 Service 来调用
@RestController
public class DocumentController {
    private final AsyncSummaryService asyncSummaryService;  // 注入

    public void upload() {
        asyncSummaryService.generateSummaryAsync(docId);  // 走代理，真正异步
    }
}
```

#### 9.7 改造上传接口

```java
@PostMapping("/upload")
public Result<Document> uploadDocumentFile(...) {
    // ... 解析文件、构建 Document 实体 ...
    document.setSummary("摘要生成中...");               // 占位符
    Document saved = documentRepository.save(document); // 先存，获得自增 ID
    asyncSummaryService.generateSummaryAsync(saved.getId());  // 异步，不阻塞
    return Result.success(saved);                       // 立刻返回
}
```

**为什么先 save 再调 async？** JPA 的 `@GeneratedValue` 自增 ID 在 `save()` 之后才有值。先 save 再传 ID 给 async，async 线程才能通过 `findById(id)` 查到文档。

#### 9.8 常见踩坑

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| `@Async` 没生效 | 同类中直接调用，没走代理 | 注入另一个 Service 来调用 |
| 用的还是默认线程池 | `@Async` 没指定名称 | 写成 `@Async("aiTaskExecutor")` |
| 异常吞掉了看不到 | 异步线程异常不抛给调用方 | 方法内部 try-catch 并记日志 |

#### 9.9 效果对比

| | 改造前 | 改造后 |
|:---|:---|:---|
| 上传响应时间 | 3~10 秒 | < 200ms |
| 摘要何时出现 | 等接口返回 | 几秒后自动更新（前端轮询） |
| 用户体验 | 干等，转圈 | 上传成功，摘要自动刷新 |

---

<a id="toc-ai-summary"></a>
### 10. AI 文档摘要自动生成（Day 20）

> 核心目标：把 Day 19 的"测试接口"变成真正的业务功能——用户上传文档后，自动调用 AI 生成摘要并存入数据库。

#### 10.1 从"测试接口"到"业务功能"

Day 19 的 `TestAiController` 只是一个**技术验证**，证明我们能调通大模型。Day 20 要把它**嵌入真实业务流程**：

```
用户上传文件 → 提取文本 → 【调用 AI 生成摘要】→ 保存文档（含摘要）→ 返回结果
                                    ↑
                              Day 20 新增这一步
```

**关键区别**：

| 维度 | Day 19 测试接口 | Day 20 业务功能 |
|------|----------------|----------------|
| 目的 | 验证 AI 能调通 | 解决真实业务问题 |
| 触发方式 | 手动调用 `/test/ai` | 上传文件时**自动触发** |
| 输出 | 直接返回给前端 | 存入数据库，持久化 |
| Prompt | 用户随意输入 | 精心设计的 System Prompt |

---

#### 10.2 Prompt 工程三板斧（进阶）

Day 19 初步接触了 System Prompt，Day 20 把它用到**生产级**水准。

##### 10.2.1 三板斧框架

```
┌─────────────────────────────────────────┐
│  1. 定角色（System Prompt）              │
│     "你是一位专业的文档摘要助手"          │
├─────────────────────────────────────────┤
│  2. 定规则（输出格式/长度/风格）          │
│     "用 2~4 句话，控制在 200 字以内"      │
├─────────────────────────────────────────┤
│  3. 给约束（禁止事项）                    │
│     "不要复述原文，用自己的话总结"        │
└─────────────────────────────────────────┘
```

##### 10.2.2 Day 20 实际使用的 System Prompt

```java
.system("""
    你是一位专业的文档摘要助手。请遵循以下规则：
    1. 用 2~4 句话概括文档的核心内容
    2. 回答控制在 200 字以内
    3. 语言简洁，突出关键信息（主题、核心观点、用途）
    4. 不要复述原文，用自己的话总结
    """)
```

##### 10.2.3 不同 Prompt 风格的效果对比

同样的文档内容，不同的 System Prompt 输出天差地别：

| Prompt 风格 | 输出特点 | 适用场景 |
|------------|---------|---------|
| **专业摘要助手**（默认）| 结构化、客观、聚焦核心 | 文档列表展示 ✅ |
| 大学教授 | 学术化、严谨、术语多 | 论文阅读助手 |
| 短视频博主 | 口语化、轻松、带梗 | 社交媒体分享 |
| JSON 结构化 | `{"topic":"","keyPoints":[]}` | 机器处理、后续解析 |

> 💡 **思考**：为什么我们的 NotebookLM Clone 用"专业摘要助手"风格最合适？
> - 用户打开文档列表时，需要**快速判断内容相关性**
> - 摘要要**客观、简洁、无偏见**
> - 200 字以内，一眼看完

---

#### 10.3 上下文窗口保护（内容截断）

大模型有 **Token 上限**（类似"一次最多读多少字"），超长内容需要截断：

```java
// 如果内容超长，只取前 8000 字
String truncatedContent = content.length() > 8000
    ? content.substring(0, 8000) + "\n...（内容已截断）"
    : content;
```

**为什么选 8000 字？**

| 语言 | 大约 Token 比例 | 8000 字 ≈ |
|------|----------------|----------|
| 中文 | 1 字 ≈ 1~1.5 Token | 8000~12000 Token |
| 英文 | 1 词 ≈ 1~2 Token | — |

DeepSeek 等常见模型的上下文窗口在 **32K~64K Token**，取 8000 字（约 12K Token）非常安全，同时控制响应时间。

**不截断的风险**：
- Token 超限 → API 报错或自动截断（不可控）
- 响应时间剧增 → 用户等待 10 秒以上
- 费用飙升 → 按 Token 计费，越长越贵

---

#### 10.4 为什么抽成单独的 `AiSummaryService`？

Day 20 没有直接把 AI 调用写在 Controller 里，而是新建了 `AiSummaryService`：

```java
@Service
public class AiSummaryService {
    private final ChatClient chatClient;

    public AiSummaryService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    public String generateSummary(String content) {
        // 边界判断 + 截断 + Prompt + 调用
    }
}
```

**三层好处**：

| 好处 | 说明 |
|------|------|
| **复用** | 文件上传、手动创建、后续重新生成，都调用同一个方法 |
| **可测试** | 可以单独测试摘要生成功能，不依赖 HTTP 请求 |
| **可扩展** | Day 25 改成异步时，只需要改这一个类 |

**设计原则**：
- Controller 负责"接收请求、校验权限、调用 Service、返回结果"
- Service 负责"具体业务逻辑"（如：怎么生成摘要）

---

#### 10.5 在业务流程中集成 AI 调用

##### 10.5.1 注入 Service

```java
private final AiSummaryService aiSummaryService;

public DocumentController(/* ... */, AiSummaryService aiSummaryService) {
    // ...
    this.aiSummaryService = aiSummaryService;
}
```

##### 10.5.2 在 `save()` 之前生成摘要

```java
// 在 upload 方法中
document.setTitle(fileName);
document.setContent(extractedText);
document.setCreateTime(LocalDateTime.now());

// ===== Day 20 新增：自动生成摘要 =====
// 注意：这是同步调用，会阻塞 2~5 秒！
String summary = aiSummaryService.generateSummary(extractedText);
document.setSummary(summary);
// =====================================

return Result.success(documentRepository.save(document));
```

**关键点**：必须在 `save()` 之前设置 `summary`，否则数据库里存的是"无摘要版"。

---

#### 10.6 独立"补生成"接口的设计

除了上传时自动生成，还需要一个**独立接口**，为已有文档补生成/重新生成摘要：

```java
@PostMapping("/{id}/summary")
public Result<Document> generateSummary(@PathVariable Long id) {
    // 1. 获取当前用户
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在"));

    // 2. 查询文档并校验归属（数据隔离！）
    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));
    
    if (!document.getUser().getId().equals(currentUser.getId())) {
        throw new RuntimeException("无权操作该文档");
    }

    // 3. 调用 AI 生成摘要
    String summary = aiSummaryService.generateSummary(document.getContent());
    document.setSummary(summary);

    // 4. 保存并返回
    return Result.success(documentRepository.save(document));
}
```

**为什么需要这个接口？**

| 场景 | 说明 |
|------|------|
| 手动创建文档 | `POST /api/documents` 只存了 content，没有 summary，后续可调用补生成 |
| 重新生成 | 内容编辑后，可以重新调用生成新的摘要 |
| 失败补偿 | 上传时 AI 调用失败（网络问题），可以后续补生成 |

---

#### 10.7 同步生成的利弊

Day 20 采用**同步生成**（上传时立即调用 AI，等结果返回再给前端响应）：

| 优点 | 缺点 |
|------|------|
| 实现简单，代码线性直观 | 上传接口变慢 2~5 秒 |
| 数据一致性高（存库即完整） | 高并发时线程池压力大 |
| 错误处理直接（上传失败 = 摘要失败）| AI 服务挂了，上传也跟着挂 |

**未来优化方向**：Day 25 引入 `@Async` + 任务队列，上传后立即返回，后台慢慢生成摘要。

---

#### 10.8 边界情况处理

```java
public String generateSummary(String content) {
    // 内容太短，没必要浪费 API 调用
    if (content == null || content.trim().length() < 50) {
        return "内容过短，无需摘要";
    }
    // ... 正常生成
}
```

**测试边界**：
- 空内容文档 → 返回 `"内容过短，无需摘要"`
- 50 字以内的文档 → 同上
- 8000 字以上的文档 → 自动截断，只取前 8000 字

---

#### 10.9 Day 20 完成标志自查

- [ ] `Document` 实体已添加 `summary` 字段（`LONGTEXT` 类型），数据库表结构已更新
- [ ] `AiSummaryService` 已创建，含合理的 System Prompt 和内容截断保护
- [ ] 上传文件后，返回的文档数据包含 AI 生成的 `summary`
- [ ] `POST /api/documents/{id}/summary` 接口可用，且做了数据权限校验
- [ ] 测试了"内容过短不生成摘要"的边界情况
- [ ] 体会了不同 System Prompt 对输出风格的影响

---

<a id="toc-ai-qa"></a>
### 11. 基于单个文档的智能问答（Day 21）

> 核心目标：实现"基于单个文档内容回答问题"的接口。用户上传了一篇 Spring Boot 教程，然后问"Spring Boot 的自动配置原理是什么？"——AI 只基于这篇文档的内容来回答，而不是泛泛而谈。

#### 11.1 什么是上下文拼接（Context Concatenation）

把文档内容作为"背景信息"，和用户问题一起发给大模型：

```
System: "你是一位知识库问答助手。请严格基于以下文档内容回答问题。"

User: """
【文档内容】
（这里放文档的完整/截断内容）

【用户问题】
Spring Boot 的自动配置原理是什么？
"""
```

大模型看到"请严格基于以下文档内容"的指令后，会优先从文档里找答案，而不是调用自己的通用知识。

**这就是 RAG（Retrieval-Augmented Generation，检索增强生成）的最简形式。**

---

#### 11.2 核心设计：System Prompt + 上下文拼接

```java
public String askBasedOnDocument(String documentContent, String question) {
    // 内容截断保护（同 Day 20）
    String context = documentContent.length() > 8000
        ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
        : documentContent;

    // 调用 AI
    String answer = chatClient.prompt()
        .system("""
            你是一位知识库问答助手。请严格遵循以下规则：
            1. 只基于用户提供的【文档内容】回答问题
            2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
            3. 回答要简洁，控制在 300 字以内
            4. 不要添加文档中没有的信息
            """)
        .user("""
            【文档内容】
            %s

            【用户问题】
            %s
            """.formatted(context, question))
        .call()
        .content();

    return answer;
}
```

**System Prompt 的四条规则设计**：

| 规则 | 作用 |
|------|------|
| "只基于文档内容回答" | **核心指令**：限制 AI 只能用文档内容 |
| "如果文档中没有..." | **诚实指令**：防止 AI 编造答案（hallucination）|
| "回答简洁，300字以内" | **长度控制**：避免啰嗦 |
| "不要添加文档中没有的信息" | **安全护栏**：避免用通用知识补充 |

---

#### 11.3 接口设计：`POST /api/documents/{id}/ask`

```java
@PostMapping("/{id}/ask")
public Result<String> askDocument(@PathVariable Long id,
                                   @RequestBody AskRequest request) {
    // 1. 参数校验
    if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
        return Result.fail("问题不能为空");
    }

    // 2. 获取当前用户
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 3. 查询文档并校验归属（数据隔离！）
    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));

    if (!document.getUser().getId().equals(currentUser.getId())) {
        throw new RuntimeException("无权访问该文档");
    }

    // 4. 调用 AI 基于文档内容回答问题
    String answer = aiChatService.askBasedOnDocument(
            document.getContent(),
            request.getQuestion()
    );

    return Result.success(answer);
}
```

**为什么路径是 `/{id}/ask`？**

| 设计选择 | 说明 |
|---------|------|
| `POST /api/documents/{id}/ask` | RESTful 风格，表示"对某个文档执行 ask 操作" |
| 文档 ID 在路径里 | 明确标识"基于哪篇文档"问答 |
| 问题在请求体里 | 问题可能很长，放 body 更合适 |

---

#### 11.4 防止 AI Hallucination（幻觉）

**Hallucination**：AI 编造文档中没有的信息。

**防御手段**：
1. **System Prompt 明确限制**："只基于文档内容回答"
2. **诚实指令**："如果文档中没有相关信息，明确回答无法找到"
3. **安全护栏**："不要添加文档中没有的信息"

> 💡 大模型不是 100% 听话的。如果发生幻觉，可以加强 System Prompt 的约束语气，或在 User Prompt 中重复强调"只基于文档内容"。

---

#### 11.5 RAG 的最简形式

Day 21 实现的是 **RAG** 的最基础版本：

| 完整 RAG 流程 | Day 21 实现 |
|-------------|------------|
| 1. 文档切分成小块 | ❌ 未实现（整篇文档直接传入）|
| 2. 向量化存入向量数据库 | ❌ 未实现 |
| 3. 用户问题向量化 | ❌ 未实现 |
| 4. 相似度检索找相关块 | ❌ 未实现 |
| 5. 把相关块拼进 Prompt | ✅ **直接传入整篇文档** |
| 6. 大模型生成回答 | ✅ 已实现 |

> 为什么 Day 21 不用向量数据库？
> - 单篇文档通常几千字，直接传入 Token 够用
> - 向量数据库增加复杂度，Day 28+ 再引入
> - 先理解"上下文拼接"的核心原理，再优化检索效率

---

#### 11.6 Day 21 完成标志自查

- [ ] `AskRequest` DTO 已创建（含 `question` 字段）
- [ ] `AiChatService` 已创建，含"只基于文档内容回答"的 System Prompt
- [ ] `POST /api/documents/{id}/ask` 接口可用，且做了数据权限校验
- [ ] 前端查看弹窗增加了问答区域，可以输入问题并显示答案
- [ ] 测试了"文档中有答案"和"文档中无答案"两种情况
- [ ] 测试了空问题和跨用户访问的边界情况

---

<a id="toc-ai-qa-switch"></a>
### 12. 前端问答优化：回答框改大 + 智能问答开关（Day 21-5）

> 核心目标：优化前端问答区域的交互体验。1）将回答区域扩大，提升可读性；2）新增一个开关，让用户自主选择是否"基于当前文档内容回答"。

#### 12.1 为什么需要开关

| 场景 | 开关状态 | AI 行为 |
|------|---------|---------|
| 用户想查文档里的具体内容 | ✅ 开启 | 只基于文档回答，文档里没有就说"找不到" |
| 用户想围绕文档主题自由扩展提问 | ❌ 关闭 | 不受文档约束，用通用知识自由回答 |

**举例**：文档内容是《Java 基础教程》
- 开关开启时问"Java 的封装是什么？" → AI 从文档里找答案
- 开关关闭时问"Java 和 Python 哪个更好？" → AI 用自己的知识自由对比

---

#### 12.2 后端改造：支持开关切换 Prompt

##### 12.2.1 DTO 新增字段

```java
@Data
public class AskRequest {
    private String question;
    
    // 是否基于文档内容回答（可选，默认 true，向后兼容）
    private Boolean useDocumentContext = true;
}
```

> `useDocumentContext` 默认 `true`，保证旧请求（没传这个字段）仍然按"基于文档"工作。

##### 12.2.2 Service 层根据开关选择 Prompt

```java
public String askBasedOnDocument(String documentContent, String question, 
                                  boolean useDocumentContext) {
    // 根据开关选择 System Prompt
    String systemPrompt = useDocumentContext
        ? """  // 基于文档
          你是一位知识库问答助手...
          """
        : """  // 自由回答
          你是一位通用知识问答助手...
          """;

    // 根据开关构建 User Prompt
    String userPrompt = useDocumentContext && documentContent != null
        ? "【文档内容】%s\n\n【用户问题】%s".formatted(documentContent, question)
        : question;  // 关闭时只传问题，不拼接文档

    return chatClient.prompt()
        .system(systemPrompt)
        .user(userPrompt)
        .call()
        .content();
}
```

**核心设计**：
- 开关开启 → System Prompt 限制"只基于文档"，User Prompt 拼接文档+问题
- 开关关闭 → System Prompt 放开限制，User Prompt 只传问题（不拼接文档）

##### 12.2.3 Controller 传递开关状态

```java
@PostMapping("/{id}/ask")
public Result<String> askDocument(@PathVariable Long id,
                                   @RequestBody AskRequest request) {
    // ... 参数校验、获取用户、校验文档归属 ...
    
    // 传递开关状态（如果请求没传，默认为 true）
    boolean useDocumentContext = request.getUseDocumentContext() != null
            ? request.getUseDocumentContext()
            : true;

    String answer = aiChatService.askBasedOnDocument(
            document.getContent(),
            request.getQuestion(),
            useDocumentContext
    );
    return Result.success(answer);
}
```

---

#### 12.3 前端改造：开关控件 + 回答区域扩大

##### 12.3.1 HTML 结构

```html
<div class="document-qa-section">
    <!-- 开关区域 -->
    <div class="qa-switch-area">
        <label class="switch">
            <input type="checkbox" id="qaContextSwitch" checked>
            <span class="slider round"></span>
        </label>
        <span class="switch-label">基于当前文档内容回答</span>
    </div>
    
    <div class="qa-header">
        <span>💬 智能问答</span>
    </div>
    <div class="qa-input-area">
        <input type="text" id="qaInput" placeholder="输入你的问题..." 
               onkeypress="if(event.key==='Enter') askDocument()">
        <button class="btn btn-primary" onclick="askDocument()">提问</button>
    </div>
    <!-- 回答区域：改为 textarea，支持显示长文本 -->
    <div id="qaAnswer" class="qa-answer" style="display: none;">
        <div class="qa-answer-label">🤖 回答：</div>
        <textarea id="qaAnswerText" class="qa-answer-text" readonly rows="8"></textarea>
    </div>
</div>
```

##### 12.3.2 JS 传递开关状态

```javascript
async function askDocumentAPI(documentId, question, useDocumentContext) {
    return fetchAPI(`/api/documents/${documentId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question, useDocumentContext }),
    });
}

async function askDocument() {
    // ... 获取 question 和 currentDocId ...
    
    // 读取开关状态
    const useDocumentContext = document.getElementById('qaContextSwitch').checked;
    
    const answer = await askDocumentAPI(currentDocId, question, useDocumentContext);
    
    // textarea 用 .value 赋值
    document.getElementById('qaAnswerText').value = answer;
}
```

---

#### 12.4 开关背后的 Prompt 切换原理

```
┌─────────────────────────────────────────────────┐
│  开关开启（基于文档）                              │
│  ─────────────────────                           │
│  System: "只基于文档内容回答..."                   │
│  User: "【文档内容】xxx...【用户问题】yyy..."       │
│                       ↓                         │
│              AI 优先从文档找答案                  │
├─────────────────────────────────────────────────┤
│  开关关闭（自由回答）                              │
│  ─────────────────────                           │
│  System: "基于你的知识库回答..."                   │
│  User: "yyy..." （只有问题，无文档）               │
│                       ↓                         │
│              AI 使用通用知识回答                  │
└─────────────────────────────────────────────────┘
```

---

#### 12.5 Day 21-5 完成标志自查

- [ ] `AskRequest` 新增了 `useDocumentContext` 字段（默认 true）
- [ ] `AiChatService` 能根据开关选择不同的 System Prompt 和 User Prompt
- [ ] `DocumentController` 把开关状态正确传递给 Service
- [ ] 前端问答区域增加了开关控件，默认开启
- [ ] 回答展示区域改为 `<textarea>`，高度足够显示长文本
- [ ] 开关关闭时，AI 不再受文档约束，可以自由回答通用问题
- [ ] 样式美化完成，输入框和回答区域大小合适

---

<a id="toc-ai-notebook-qa"></a>
### 13. 笔记本级多文档智能问答（Day 22）

> 核心目标：实现"基于笔记本内所有文档内容回答问题"的接口。用户在一个笔记本里上传了 3 篇 Spring 相关教程，问"这个笔记本里学过的 Spring 核心概念有哪些？"——AI 需要综合多篇文档的内容来回答。

#### 13.1 从单文档到多文档：核心变化

| 维度 | Day 21（单文档） | Day 22（笔记本级） |
|------|----------------|-------------------|
| **接口** | `POST /api/documents/{id}/ask` | `POST /api/notebooks/{id}/ask` |
| **Service 方法** | `askBasedOnDocument` | `askBasedOnDocuments` |
| **上下文** | 1 篇文档 | N 篇文档拼接 |
| **适用问题** | "这篇文档讲了什么？" | "这些文档的共同主题是什么？" |
| **截断策略** | 单文档截断到 8000 字 | 多文档**累计**截断到 50000 字 |

#### 13.2 多文档上下文拼接策略

把笔记本里的所有文档按顺序拼接，每篇文档标注标题：

```
System: "你是一位知识库问答助手。请严格基于以下文档内容回答问题。"

User: """
【文档：Spring Boot 入门.txt】
Spring Boot 是 Spring 框架的扩展...

【文档：Spring MVC 教程.txt】
Spring MVC 是一种基于 Java 的 Web 框架...

【文档：Spring Data JPA 指南.txt】
JPA（Java Persistence API）是...

【用户问题】
这个笔记本里的 Spring 核心概念有哪些？
"""
```

#### 13.3 长文本截断策略（50000 字上限）

现代大模型（DeepSeek、Kimi）已支持 1M+ Token 上下文，Day 22 将上限放宽到 **50000 字符**（约 2-3 万 Token，在 1M 上下文中仅占 2-3%）。

```java
StringBuilder contextBuilder = new StringBuilder();
int totalLength = 0;
final int MAX_LENGTH = 50000;  // 50000 字符 ≈ 2-3 万 Token
boolean truncated = false;

for (String[] doc : documents) {
    String title = doc[0];
    String content = doc[1];
    
    String docSection = "\n【文档：" + title + "】\n" + content.trim() + "\n";
    
    if (totalLength + docSection.length() > MAX_LENGTH) {
        // 超限处理：截断当前文档，标记 truncated = true，break
        int remaining = MAX_LENGTH - totalLength;
        if (remaining > 100) {
            contextBuilder.append(docSection.substring(0, remaining))
                         .append("\n...（内容已截断）");
        }
        truncated = true;
        break;  // 后续文档不再处理
    } else {
        contextBuilder.append(docSection);
        totalLength += docSection.length();
    }
}
```

**为什么还设上限？**

| 原因 | 说明 |
|------|------|
| **成本** | 输入 Token 按量计费，100 万字费用很高 |
| **响应时间** | Token 越多，模型处理时间越长 |
| **防御性设计** | 防止恶意/误操作上传超大文本 |

> 💡 Day 28 引入向量检索后，将升级为"只拿和用户问题最相关的段落"，彻底摆脱长度限制。

#### 13.4 Service 层：新增 `askBasedOnDocuments`

```java
@Service
public class AiChatService {
    
    // Day 21 原有方法保留（略）
    public String askBasedOnDocument(String documentContent, String question, 
                                      boolean useDocumentContext) { ... }
    
    // Day 22 新增：基于多篇文档回答
    public String askBasedOnDocuments(List<String[]> documents, String question) {
        if (documents == null || documents.isEmpty()) {
            return "该笔记本下没有文档，无法回答问题。";
        }
        
        // ... 拼接文档内容（见 13.3 截断逻辑）...
        String context = contextBuilder.toString();
        
        String answer = chatClient.prompt()
            .system("""
                你是一位知识库问答助手。请严格遵循以下规则：
                1. 只基于用户提供的【文档内容】回答问题
                2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                3. 回答要简洁，控制在 300 字以内
                4. 不要添加文档中没有的信息
                5. 如果有多篇文档，综合各篇文档的信息进行回答
                """)
            .user("""
                %s
                
                【用户问题】
                %s
                """.formatted(context, question))
            .call()
            .content();
        
        return answer;
    }
}
```

**关键点**：
- 参数用 `List<String[]>` 而非 `List<Document>`：每篇传 `[标题, 内容]`，轻量且语义清晰
- System Prompt 新增第 5 条规则：`"综合各篇文档的信息进行回答"`，提醒 AI 要跨文档分析
- 每篇文档标注 `【文档：标题】`，让 AI 知道答案来源

#### 13.5 Controller 层：NotebookController 新增问答接口

```java
@RestController
@RequestMapping("/api/notebooks")
public class NotebookController {
    
    private final NotebookRepository notebookRepository;
    private final UserRepository userRepository;
    private final DocumentRepository documentRepository;  // Day 22 新增
    private final AiChatService aiChatService;             // Day 22 新增
    
    // 构造器注入（4 个依赖）
    public NotebookController(NotebookRepository notebookRepository,
                              UserRepository userRepository,
                              DocumentRepository documentRepository,
                              AiChatService aiChatService) {
        this.notebookRepository = notebookRepository;
        this.userRepository = userRepository;
        this.documentRepository = documentRepository;
        this.aiChatService = aiChatService;
    }
    
    // ... 原有接口（getAllNotebooks、createNotebook 等）...
    
    // Day 22 新增：笔记本级智能问答
    @PostMapping("/{id}/ask")
    public Result<String> askNotebook(@PathVariable Long id,
                                      @RequestBody AskRequest request) {
        // 1. 参数校验
        if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
            return Result.fail("问题不能为空");
        }
        
        // 2. 获取当前用户
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        
        // 3. 查询笔记本并校验归属（一步完成存在性+权限校验）
        Notebook notebook = notebookRepository.findByIdAndUserId(id, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));
        
        // 4. 获取该笔记本下的所有文档
        List<Document> documents = documentRepository.findByNotebook_Id(id);
        
        // 5. 构建 [标题, 内容] 列表
        List<String[]> docList = documents.stream()
                .map(doc -> new String[]{doc.getTitle(), doc.getContent()})
                .toList();
        
        // 6. 调用 AI 基于多篇文档回答
        String answer = aiChatService.askBasedOnDocuments(
                docList,
                request.getQuestion()
        );
        
        return Result.success(answer);
    }
}
```

**设计要点**：
- 复用 `AskRequest` DTO（和 Day 21 同一个），前端无改造成本
- `findByIdAndUserId` 一步完成"存在性 + 归属权"校验
- `findByNotebook_Id` 利用 JPA 派生查询，自动查某笔记本下所有文档

#### 13.6 前端设计：笔记本级问答面板

在文档列表区域上方，放置一个**可展开/收起的紫色渐变卡片**：

```
┌─────────────────────────────────────────┐
│  ✨ AI 笔记本问答              ▼ 3篇文档  │  ← 点击展开
├─────────────────────────────────────────┤
│  基于当前笔记本内的所有文档内容综合回答    │
│  ┌─────────────────────────┐ ┌────────┐ │
│  │ 这些文档的共同主题是...  │ │ 🚀提问 │ │
│  └─────────────────────────┘ └────────┘ │
│  ┌─────────────────────────────────────┐│
│  │ 🤖 AI 综合回答                       ││
│  │ 根据这些文档，核心概念包括...        ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

**交互设计**：
- 选中笔记本后自动显示面板，默认收起（不占空间）
- 点击顶部 bar 展开/收起内容区
- 切换笔记本时自动重置问答状态
- 删除笔记本或退出登录时隐藏面板

#### 13.7 不同截断策略对比

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| **全量传入 + 宽松上限**（Day 22） | 充分利用大上下文，答案完整 | 超长文本仍有成本 | 单笔记本几十篇文档以内 |
| 按文档顺序截断 | 简单、可预期 | 后面的文档永远进不来 | 文档极多且按重要性排序 |
| 只取相关段落（Day 28） | 精准、省 Token、无上限 | 需要向量检索 | 文档数量多、内容长 |

#### 13.8 Day 22 完成标志自查

- [ ] `AiChatService.askBasedOnDocuments` 已创建，支持多篇文档拼接和按文档顺序截断
- [ ] `POST /api/notebooks/{id}/ask` 接口可用，且做了数据权限校验
- [ ] 前端文档列表区域出现笔记本问答面板，可展开/收起
- [ ] 问答面板显示当前笔记本内文档数量
- [ ] 测试了"多文档综合问答"和"空笔记本"两种情况
- [ ] 测试了空问题和跨用户访问的边界情况

---

<a id="toc-ai-sse-streaming"></a>
### 14. AI 流式输出 SSE 打字机效果（Day 23）

> 核心目标：将现有的同步阻塞式 AI 问答改为 SSE 流式输出，实现"打字机"效果——AI 每生成一个 token 就立刻推送给用户，像 ChatGPT 那样逐字显示。

#### 14.1 SSE vs WebSocket 认知

| 特性 | **SSE**（本项目选用） | WebSocket |
|:---|:---|:---|
| 通信方向 | **单向**：服务器 → 客户端 | **双向**：服务器 ↔ 客户端 |
| 协议基础 | **标准 HTTP** | `ws://` / `wss://`，需 Upgrade 握手 |
| 断线重连 | 浏览器原生自动重连 | 需自己实现心跳和重连 |
| 复杂度 | 轻量、简单 | 更重、心智负担高 |
| 典型场景 | AI 流式输出、股票行情、进度条 | 聊天室、协作编辑、在线游戏 |

**为什么选 SSE？** AI 问答是"问完就等回答"的单向场景，不需要客户端再回发数据，SSE 够用了。

#### 14.2 `Flux<String>` 响应式基础

- `Flux<T>` 是 Reactor 中的 **0~N 个元素的异步序列**（对比 `List<T>` 是"拉取"，Flux 是"推送"）
- Spring AI 的 `ChatClient` 提供 `.stream().content()` 直接返回 `Flux<String>`，每个元素是一个 token/chunk
- Spring MVC 原生支持 `Flux` 作为返回值，框架自动转为 SSE 格式

**同步 vs 流式调用对比**：

```java
// 同步：阻塞等待完整结果
String answer = chatClient.prompt()
        .system(systemPrompt)
        .user(userPrompt)
        .call()          // ← 阻塞！等 AI 全部说完
        .content();

// 流式：逐 token 推送
Flux<String> stream = chatClient.prompt()
        .system(systemPrompt)
        .user(userPrompt)
        .stream()        // ← 不阻塞！流式输出
        .content();
```

#### 14.3 Service 层改造：新增流式方法 + 抽取私有方法

**设计原则**：
1. **保留原有同步方法不动**（向后兼容）
2. **抽取 Prompt 构建逻辑为私有方法**（DRY 原则，同步/流式复用）
3. **新增流式方法**，返回 `Flux<String>`
4. **空文档返回**从 `return "xxx"` 改为 `return Flux.just("xxx")`

```java
@Service
public class AiChatService {
    
    private final ChatClient chatClient;
    
    public AiChatService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }
    
    // ========== Day 21/22 原有同步方法（保留不动）==========
    public String askBasedOnDocument(String documentContent, String question, 
                                      boolean useDocumentContext) { ... }
    
    public String askBasedOnDocuments(List<String[]> documents, String question) { ... }
    
    // ========== Day 23 新增：私有方法抽取 ==========
    
    private String buildSingleDocSystemPrompt(boolean useDocumentContext) {
        return useDocumentContext
            ? """你是一位知识库问答助手..."""
            : """你是一位通用知识问答助手...""";
    }
    
    private String buildSingleDocUserPrompt(String context, String question, 
                                             boolean useDocumentContext) {
        return useDocumentContext && context != null
            ? """【文档内容】\n%s\n\n【用户问题】\n%s""".formatted(context, question)
            : question;
    }
    
    private String buildMultiDocSystemPrompt() {
        return """你是一位知识库问答助手...5. 综合各篇文档回答...""";
    }
    
    private String buildMultiDocUserPrompt(String context, String question) {
        return """【文档内容】\n%s\n【用户问题】\n%s""".formatted(context, question);
    }
    
    // ========== Day 23 新增：单文档流式问答 ==========
    public Flux<String> askBasedOnDocumentStream(
            String documentContent, String question, boolean useDocumentContext) {
        
        // 空文档判断（流式返回 Flux.just）
        if ((documentContent == null || documentContent.trim().isEmpty()) 
                && useDocumentContext) {
            return Flux.just("文档内容为空，无法回答问题。");
        }
        
        // 截断逻辑（和同步方法一致）
        String context = documentContent != null && documentContent.length() > 8000
                ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
                : documentContent;
        
        // 复用私有方法构建 Prompt
        String systemPrompt = buildSingleDocSystemPrompt(useDocumentContext);
        String userPrompt = buildSingleDocUserPrompt(context, question, useDocumentContext);
        
        return chatClient.prompt()
                .system(systemPrompt)
                .user(userPrompt)
                .stream()      // ← 唯一区别：stream 替代 call
                .content();
    }
    
    // ========== Day 23 新增：多文档流式问答 ==========
    public Flux<String> askBasedOnDocumentsStream(
            List<String[]> documents, String question) {
        
        if (documents == null || documents.isEmpty()) {
            return Flux.just("该笔记本下没有文档，无法回答问题。");
        }
        
        // ... 文档拼接逻辑（和同步方法一致，含 50000 字截断）...
        String context = contextBuilder.toString();
        if (context.isEmpty()) {
            return Flux.just("该笔记本下的文档内容均为空，无法回答问题。");
        }
        
        String systemPrompt = buildMultiDocSystemPrompt();
        String userPrompt = buildMultiDocUserPrompt(context, question);
        
        return chatClient.prompt()
                .system(systemPrompt)
                .user(userPrompt)
                .stream()
                .content();
    }
}
```

**关键注意点**：
- 空文档/空内容判断必须 `return Flux.just(...)`，不能 `return String`（类型不匹配）
- User Prompt 必须传**截断后**的 `context`，不能传原始 `documentContent`
- 多文档方法末尾别忘了 `if (truncated) { context += "\n...（更多文档内容因长度限制未纳入上下文）"; }`

#### 14.4 Controller 层：新增流式端点

**同步 vs 流式端点的核心差异**：

| 特性 | 同步端点 | 流式端点 |
|:---|:---|:---|
| HTTP 方法 | `POST` + `@RequestBody` | `GET` + `@RequestParam` |
| 返回类型 | `Result<String>` | `Flux<String>` |
| `produces` | 默认 `application/json` | `MediaType.TEXT_EVENT_STREAM_VALUE` |
| 为什么 GET？ | | 浏览器 `EventSource` 只支持 GET，方便前端直接调用 |

**三个 Controller 分别新增**：

```java
// TestAiController.java — 公开测试端点（无需登录）
@GetMapping(value = "/ai/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<String> testStream(
        @RequestParam String question,
        @RequestParam(required = false) String systemPrompt) {
    
    if (question == null || question.trim().isEmpty()) {
        return Flux.just("问题不能为空");
    }
    
    ChatClient.ChatClientRequestSpec prompt = chatClient.prompt();
    if (systemPrompt != null && !systemPrompt.trim().isEmpty()) {
        prompt.system(systemPrompt);
    }
    
    return prompt.user(question).stream().content();
}
```

```java
// DocumentController.java — 文档级流式问答（需登录）
@GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<String> askDocumentStream(
        @PathVariable Long id,
        @RequestParam String question,
        @RequestParam(defaultValue = "true") boolean useDocumentContext) {
    
    // 1. question 空校验
    // 2. 获取当前用户（SecurityContext）
    // 3. 查文档 + 权限校验（document.getUser().getId().equals(currentUser.getId())）
    // 4. 调用 aiChatService.askBasedOnDocumentStream(...)
}
```

```java
// NotebookController.java — 笔记本级流式问答（需登录）
@GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<String> askNotebookStream(
        @PathVariable Long id,
        @RequestParam String question) {
    
    // 1. question 空校验
    // 2. 获取当前用户
    // 3. 查笔记本 + 权限校验
    // 4. 获取所有文档 → 转成 List<String[]>
    // 5. 调用 aiChatService.askBasedOnDocumentsStream(...)
}
```

> ⚠️ 流式方法**不包 `Result.success()`**，直接返回 `Flux<String>`，Spring 自动转成 SSE 流。

#### 14.5 中文乱码修复

Windows 环境下，Spring Boot 默认可能使用系统编码（GBK），导致 SSE 中文乱码。

在 `application.properties` 末尾添加：

```properties
# 强制所有 HTTP 请求/响应使用 UTF-8 编码
server.servlet.encoding.charset=UTF-8
server.servlet.encoding.enabled=true
server.servlet.encoding.force=true
server.servlet.encoding.force-response=true
```

#### 14.6 测试方式

| 方式 | 命令/操作 | 观察重点 |
|:---|:---|:---|
| **curl**（推荐） | `curl -N "http://localhost:8080/test/ai/stream?question=xxx"` | 逐字"蹦"出来 |
| **浏览器** | 地址栏直接访问 | 观察文字逐段出现 |
| **api.http** | IntelliJ HTTP Client 发送 GET | 每行显示一个 `data: xxx` |

SSE 响应格式：
```
data: Spring
data: Boot
data: 是
data: Spring
data: 框架
data: 的
data: 扩展
data: ...
```

#### 14.7 三种截断策略对比（Day 22 vs Day 23 vs Day 28）

| 维度 | Day 21（单文档） | Day 22（多文档同步） | Day 23（多文档流式） |
|:---|:---|:---|:---|
| 调用方式 | `.call()` | `.call()` | `.stream()` |
| 返回类型 | `String` | `String` | `Flux<String>` |
| 用户体验 | 白屏等待 → 一次性显示 | 白屏等待 → 一次性显示 | **逐字显示打字机效果** |
| Service 方法 | `askBasedOnDocument` | `askBasedOnDocuments` | `askBasedOnDocumentStream` / `askBasedOnDocumentsStream` |
| Controller 端点 | `POST /ask` | `POST /ask` | `GET /ask/stream` |
| 前端适配 | 已完成 | 已完成 | 需改用 `EventSource` |

#### 14.8 Day 23 完成标志自查

- [ ] 能说出 SSE 和 WebSocket 的核心区别（单向 vs 双向）
- [ ] 理解 `.call().content()` vs `.stream().content()` 的区别
- [ ] 知道 `Flux<String>` 为什么能实现流式推送（异步序列、框架自动转 SSE）
- [ ] 了解 `produces = MediaType.TEXT_EVENT_STREAM_VALUE` 的作用
- [ ] Service 层抽取了 Prompt 构建私有方法，同步/流式复用
- [ ] 流式方法正确处理空文档返回（`Flux.just(...)`）
- [ ] 三个 Controller 都新增了流式端点
- [ ] curl / 浏览器 / api.http 测试确认能看到逐字输出效果
- [ ] application.properties 已配置 UTF-8 编码防止中文乱码

---

<a id="toc-ai-citation"></a>
### 15. AI 引用溯源 — 标注引用来源（Day 24）

> 核心目标：在 AI 流式回答中标注引用的原文段落来源，实现 NotebookLM 式的引用体验——用户不仅看到答案，还能知道答案来自哪篇文档的哪段内容。

#### 15.1 为什么需要引用溯源

| 问题 | 没有引用溯源 | 有引用溯源 |
|:---|:---|:---|
| **AI 幻觉** | 用户无法分辨真假 | 用户可点击引用跳转原文验证 |
| **可信度** | "AI 说的，不一定对" | "AI 引用了我的文档，可信" |
| **深度阅读** | 看完回答就结束 | 可定位到原文深入阅读 |
| **多文档场景** | 不知道答案来自哪篇 | 清楚看到各篇文档的贡献 |

#### 15.2 技术路线：Prompt 引导（文档级别）

| 路线 | 原理 | 精度 | 复杂度 |
|:---|:---|:---|:---|
| **Prompt 引导**（今天用） | 在 System Prompt 中要求 AI 自行标注来源 | 中等（到文档级别） | 低 ✅ |
| **RAG + 向量检索**（Day 28） | 先检索相关段落，再让 AI 基于检索结果回答 | 高（到段落级别） | 高 |

#### 15.3 引用格式设计

前后端约定的引用标记格式：

```
AI 回答正文...这里引用了某段内容[1]...继续回答...

---
参考来源：
[1] 【文档：Spring Boot 入门.txt】Spring Boot 是 Spring 框架的扩展...
```

- `[N]`：引用标记，插在正文引用处（简洁美观）
- `---`：分隔线，明确区分"回答正文"和"参考来源"
- 参考来源列表：编号 + 文档标题 + 原文片段

#### 15.4 后端改造：System Prompt 增加引用要求

**单文档**（`buildSingleDocSystemPrompt`）：

```java
? """
  你是一位知识库问答助手。请严格遵循以下规则：
  1. 只基于用户提供的【文档内容】回答问题
  2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
  3. 回答要简洁，控制在 300 字以内
  4. 不要添加文档中没有的信息
  5. 引用文档具体内容时，必须在引用处添加标记 [1]
  6. 回答末尾必须用 "---" 分隔，然后列出参考来源：[1] 原文片段
  """
```

**多文档**（`buildMultiDocSystemPrompt`）：

```java
"""
你是一位知识库问答助手。请严格遵循以下规则：
1. 只基于用户提供的【文档内容】回答问题
2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
3. 回答要简洁，控制在 300 字以内
4. 不要添加文档中没有的信息
5. 如果有多篇文档，综合各篇文档的信息进行回答
6. 引用某篇文档的具体内容时，必须在引用处添加标记 [N]，N 从 1 开始递增
7. 回答末尾必须用 "---" 分隔，然后列出所有参考来源，格式为：
   [N] 【文档：标题】原文片段
""";
```

#### 15.5 前端改造：解析引用标记并渲染

**`parseCitations(rawText, defaultTitle)`** — 分割解析函数：

```javascript
function parseCitations(rawText, defaultTitle) {
    const parts = rawText.split('---');
    let answer = parts[0].trim();
    const citations = [];

    if (parts.length > 1) {
        const citationText = parts[1].trim();
        // 匹配多文档格式：[N] 【文档：标题】原文片段
        const regex = /\[(\d+)\]\s*【?文档?：?([^】]+)】?\s*(.+)/g;
        let match;
        while ((match = regex.exec(citationText)) !== null) {
            citations.push({
                id: match[1],
                title: match[2].trim(),
                snippet: match[3].trim()
            });
        }
        // 简化格式兜底（单文档没有【文档：标题】时）
        if (citations.length === 0) {
            const simpleRegex = /\[(\d+)\]\s*(.+)/g;
            let simpleMatch;
            while ((simpleMatch = simpleRegex.exec(citationText)) !== null) {
                citations.push({
                    id: simpleMatch[1],
                    title: defaultTitle || '参考来源',
                    snippet: simpleMatch[2].trim()
                });
            }
        }
    }

    // 如果正文中有 [N] 标记但 citations 为空，fallback 兜底
    if (citations.length === 0) {
        const inlineRegex = /\[(\d+)\]/g;
        let inlineMatch;
        while ((inlineMatch = inlineRegex.exec(answer)) !== null) {
            citations.push({
                id: inlineMatch[1],
                title: defaultTitle || '未知来源',
                snippet: ''
            });
        }
    }

    return { answer, citations };
}
```

**关键设计点**：
- `defaultTitle` 参数：单文档场景传入当前文档标题，解决"未知来源"问题
- 三层解析策略：多文档格式 → 简化格式 → inline 标记兜底
- 优雅降级：AI 不输出引用时，正常显示回答正文

**`renderCitationCards(citations, container)`** — 卡片渲染函数：

```javascript
function renderCitationCards(citations, container) {
    if (!citations || citations.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    let html = '<div class="citation-header">参考来源</div>';
    html += '<div class="citation-list">';

    citations.forEach(cite => {
        html += `
            <div class="citation-card" data-cite-id="${cite.id}">
                <div class="citation-number">[${cite.id}]</div>
                <div class="citation-content">
                    <div class="citation-title">${escapeHtml(cite.title)}</div>
                    <div class="citation-snippet">${escapeHtml(cite.snippet)}</div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
    container.style.display = 'block';
}
```

#### 15.6 调用位置

在 `askDocument()` 和 `askNotebook()` 的 `finally` 块中，流式输出完成后调用：

```javascript
const rawAnswer = answerEl.value;
const currentDocTitle = document.getElementById('viewDocumentTitle').textContent;
const { answer, citations } = parseCitations(rawAnswer, currentDocTitle);

if (citations.length > 0) {
    answerEl.value = answer;  // 只保留正文部分（去掉 --- 后面的来源列表）
    const citationContainer = document.getElementById('qaCitations');
    renderCitationCards(citations, citationContainer);
}
```

#### 15.7 样式设计

```css
.citations-container {
    margin-top: 12px;
    padding: 12px 16px;
    background: #f8f9fa;
    border-radius: 8px;
    border-left: 3px solid #4a90d9;
}

.citation-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 12px;
    background: white;
    border-radius: 6px;
    border: 1px solid #e1e4e8;
    transition: all 0.2s ease;
}

.citation-card:hover {
    border-color: #4a90d9;
    box-shadow: 0 2px 4px rgba(74, 144, 217, 0.1);
}

.citation-number {
    min-width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #4a90d9;
    color: white;
    border-radius: 50%;
    font-size: 0.8em;
    font-weight: 600;
    flex-shrink: 0;
}
```

#### 15.8 Day 24 完成标志自查

- [ ] 能解释什么是引用溯源（Citation）及其重要性
- [ ] 理解 Prompt 工程实现引用溯源的原理和局限性
- [ ] 知道 `[N]` 和 `---` 分隔线的设计意图
- [ ] 理解 `parseCitations()` 的三层解析策略（多文档格式 → 简化格式 → inline 兜底）
- [ ] 知道为什么需要 `escapeHtml()`（防止 XSS 攻击）
- [ ] 测试确认能看到 `[1]` 引用标记和引用卡片
- [ ] 测试确认无引用时前端优雅降级（不报错、不显示空卡片）
- [ ] 单文档场景引用卡片显示真实文档标题（非"未知来源"）

---

<a id="toc-async-summary"></a>
### 16. @Async 异步摘要 + 前端轮询自动更新（Day 25）

> 核心目标：将文档上传后的 AI 摘要生成改为异步，上传立刻返回不阻塞；前端自动轮询等待摘要就绪，无需用户手动刷新。

#### 16.1 改造前后对比

```
改造前（同步）：
  上传 → 保存文件 → 调 AI 生成摘要（阻塞 3~10 秒！）→ 返回响应

改造后（异步 + 轮询）：
  上传 → 保存文件（summary="摘要生成中..."）→ 立刻返回（< 200ms）
           ↓
    后台线程调 AI → 更新 summary
           ↓
    前端每 2 秒轮询 → 摘要变了 → 自动更新 UI
```

#### 16.2 后端新增：GET /{id} 查询单个文档

轮询需要一个按 ID 查文档的接口：

```java
@GetMapping("/{id}")
public Result<Document> getDocument(@PathVariable Long id) {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    Document document = documentRepository.findByIdAndUserId(id, currentUser.getId())
            .orElseThrow(() -> new RuntimeException("文档不存在或无权访问"));

    return Result.success(document);  // 包含 summary 字段
}
```

#### 16.3 前端：轮询函数

```javascript
// 每 2 秒查一次，摘要就绪后自动更新列表
function pollSummaryReady(docId, attempt, maxAttempts) {
    if (attempt > maxAttempts) {
        console.warn('[轮询] 摘要生成超时，docId=' + docId);
        return;  // 超过 12 次（24 秒）放弃
    }

    setTimeout(async () => {
        try {
            const doc = await fetchAPI(`/api/documents/${docId}`);
            if (doc && doc.summary !== '摘要生成中...') {
                // 摘要已就绪，原地更新列表中的文档数据
                const idx = currentDocuments.findIndex(d => d.id === docId);
                if (idx !== -1) {
                    currentDocuments[idx] = doc;
                }
                renderDocumentList();  // 重新渲染，摘要自动替换
            } else {
                pollSummaryReady(docId, attempt + 1, maxAttempts);
            }
        } catch (e) {
            console.warn('[轮询] 查询摘要失败: ' + e.message);
        }
    }, 2000);
}
```

#### 16.4 前端：上传成功回调改造

```javascript
const uploadedDoc = await uploadDocumentFileAPI(file, currentNotebookId);
showToast('文件上传成功，摘要生成中...', 'success');
currentDocuments.push(uploadedDoc);  // 直接加到列表（显示"摘要生成中..."）
renderDocumentList();
pollSummaryReady(uploadedDoc.id, 1, 12);  // 启动轮询，最多 24 秒
```

#### 16.5 前端：摘要状态 UI

```javascript
const isGenerating = doc.summary === '摘要生成中...';
if (isGenerating) {
    summaryHtml = '<span class="summary-loading">AI 摘要正在生成中...</span>';
}
```

CSS 呼吸动画：
```css
.summary-loading {
    color: #999;
    font-style: italic;
    animation: summaryPulse 1.5s ease-in-out infinite;
}
@keyframes summaryPulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
}
```

#### 16.6 设计决策：为什么选前端轮询而不是 WebSocket/SSE 推送

| 方案 | 复杂度 | 实时性 | 适合场景 |
|:---|:---|:---|:---|
| **前端轮询**（选用） | 低 | 2 秒延迟 | 摘要生成 3~10 秒，轮 2~4 次就够了 |
| SSE 推送 | 中 | 实时 | 需要服务端主动推，但跨请求推送较复杂 |
| WebSocket | 高 | 实时 | 双向频繁通信 |

选轮询的理由：改动最小（只加一个后端接口 + 前端函数），用户感知不到 2 秒延迟，实现简单可靠。

#### 16.7 完成效果

| | 改造前 | 改造后 |
|:---|:---|:---|
| 上传响应时间 | 3~10 秒 | < 200ms |
| 摘要何时出现 | 等接口返回 | 几秒后自动出现 |
| 用户操作 | 干等、手动刷新 | 上传后摘要自动出现 |
| 用户体验 | "API 挂了吗？" | "摘要自动出来了" |

#### 16.8 Day 25 完成标志自查

- [ ] 理解同步 vs 异步（等 vs 不等）
- [ ] `@EnableAsync` 已加到启动类
- [ ] `AsyncConfig` 配置类已创建，自定义了 `aiTaskExecutor` 线程池
- [ ] `AsyncSummaryService` 已创建，使用 `@Async("aiTaskExecutor")`
- [ ] `DocumentController.uploadDocumentFile()` 已改造为异步生成摘要
- [ ] `GET /{id}` 接口已添加，支持按 ID 查询单个文档
- [ ] 前端 `pollSummaryReady` 轮询函数已实现
- [ ] 上传文档后摘要自动出现，无需手动刷新
- [ ] 日志中看到 `[ai-async-1]` 前缀的线程名
- [ ] 上传接口响应时间从 3~10 秒降到 < 200ms

---

<a id="toc-ai-retry"></a>
### 17. AI 调用健壮化：重试机制 @Retryable（Day 26）

> 核心目标：给 AI 调用加上自动重试保护——网络抖动不再导致摘要或问答丢失。

#### 17.1 对外部依赖"不信任"原则

AI API 是外部服务，有三个不可：不可靠、不可控、不可见。应在调用前加防御层。

```
你的代码
   ↓
┌── 防御层 ──────────────────────────┐
│ ① 重试机制   → 失败了再试几次       │
│ ② Token 统计 → 每次调用都记一笔     │
└────────────────────────────────────┘
   ↓
DeepSeek API（外部，不可信）
```

#### 17.2 什么该重试，什么不该

| 错误场景 | HTTP 状态码 | 是否重试 | 原因 |
|:---|:---|:---|:---|
| 网络超时 | 无响应 | ✅ 重试 | 网络抖动是暂时的 |
| 服务器挂了 | 500/502/503 | ✅ 重试 | 服务器暂时过载 |
| 请求频率太高 | 429 | ⚠️ 延迟重试 | 立即重试会让限流更严重 |
| 参数有问题 | 400 | ❌ 不重试 | 重试 100 次也是错 |
| API Key 无效 | 401 | ❌ 不重试 | 配置问题 |

#### 17.3 退避策略：为什么越等越久

```
请求 1：发送 → 超时
         ↓ 等 1.5 秒（给服务器喘息时间）
请求 2：发送 → 还是超时
         ↓ 等 2.25 秒（问题严重，等更久）
请求 3：发送 → 还是失败
         ↓ 不试了，调 @Recover 兜底
```

公式：`第 N 次重试等待 = delay × multiplier^(N-1)`

#### 17.4 Maven 依赖

```xml
<dependency>
    <groupId>org.springframework.retry</groupId>
    <artifactId>spring-retry</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aop</artifactId>
</dependency>
```

**为什么需要 AOP 依赖？** `@Retryable` 和 `@Async` 一样，底层靠 Spring AOP 代理实现，不加不生效。

#### 17.5 启动类加 @EnableRetry

```java
@SpringBootApplication
@EnableAsync
@EnableRetry  // 开启重试支持
public class NotebookCloneApplication { ... }
```

#### 17.6 改造 AiSummaryService — @Retryable + @Recover

```java
@Slf4j
@Service
public class AiSummaryService {

    private final ChatClient chatClient;

    @Retryable(
        retryFor = {RestClientException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1500, multiplier = 1.5)
    )
    public String generateSummary(String content) {
        if (content == null || content.trim().length() < 50) {
            return "内容过短，无需摘要";
        }
        // ... 截断逻辑 ...

        ChatResponse chatResponse = chatClient.prompt()
                .system(...)
                .user(...)
                .call()
                .chatResponse();  // ← 改用 chatResponse() 拿 Token

        String summary = chatResponse.getResult().getOutput().getText();

        // Token 日志
        var usage = chatResponse.getMetadata().getUsage();
        if (usage != null) {
            log.info("[Token] 摘要生成 | 输入: {} | 输出: {} | 总计: {}",
                usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
        }
        return summary;
    }

    @Recover
    public String generateSummaryRecover(RestClientException e, String content) {
        log.error("[重试] 摘要生成失败，已重试 3 次: {}", e.getMessage());
        return "摘要生成失败，请稍后重试";
    }
}
```

#### 17.7 @Recover 签名规则

- 必须和 `@Retryable` 方法在同一个类里
- 第一个参数是触发重试的异常类型
- 后面所有参数（类型 + 顺序）和返回值类型必须和 `@Retryable` 方法一致

#### 17.8 核心注解对照

| 注解 | 作用 |
|:---|:---|
| `@EnableRetry` | 启动类开启重试支持 |
| `@Retryable(retryFor=..., maxAttempts=..., backoff=...)` | 标记方法为可重试 |
| `@Backoff(delay=, multiplier=)` | 退避策略：等多久、间隔倍数 |
| `@Recover` | 全部重试失败后的兜底方法 |
| `RestClientException` | Spring HTTP 调用异常，作为重试触发条件 |

#### 17.9 常见踩坑

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| `@Retryable` 不生效 | 没加 `@EnableRetry` 或没引入 AOP 依赖 | 两者缺一不可 |
| `@Recover` 没被调用 | 返回值类型或参数不匹配 | 确保签名一致 |
| `.chatResponse()` 找不到方法 | Spring AI 版本差异 | 确认版本 >= 1.0 |

---

<a id="toc-ai-token"></a>
### 18. AI 调用健壮化：Token 统计全覆盖（Day 26_5）

> 核心目标：将重试 + Token 统计从摘要扩展到所有问答方法，包括流式方法。

#### 18.1 改造前后对比

**改造前（Day 26 刚完成时）**：

| AI 调用场景 | 重试保护 | Token 统计 |
|:---|:---|:---|
| 摘要生成 `AiSummaryService` | ✅ | ✅ |
| 同步单文档问答 | ❌ | ❌ |
| 同步多文档问答 | ❌ | ❌ |
| 流式单文档问答 | ❌ | ❌ |
| 流式多文档问答 | ❌ | ❌ |

**改造后（Day 26_5 完成）**：

| AI 调用场景 | 重试保护 | Token 统计 |
|:---|:---|:---|
| 摘要生成 | ✅ `@Retryable` | ✅ `.chatResponse()` |
| 同步单文档问答 | ✅ `@Retryable` | ✅ `.chatResponse()` |
| 同步多文档问答 | ✅ `@Retryable` | ✅ `.chatResponse()` |
| 流式单文档问答 | ❌ 前端兜底 | ✅ `.stream().chatResponse()` + `.doOnNext()` |
| 流式多文档问答 | ❌ 前端兜底 | ✅ `.stream().chatResponse()` + `.doOnNext()` |

#### 18.2 同步方法改造（照搬 Day 26 方案）

`askBasedOnDocument` 和 `askBasedOnDocuments` 的改法和 `generateSummary` 完全一样：加 `@Retryable` + `.call().chatResponse()` 替代 `.call().content()` + Token 日志 + `@Recover` 兜底。

#### 18.3 流式方法的特殊性

**同步方法**用 `.call().chatResponse()` 拿到完整 `ChatResponse`，直接取 `Usage`。

**流式方法**用 `.stream().content()` 返回 `Flux<String>`——不断吐出文字片段的数据流，不包含 `Usage` 元数据。

**解决方案**：`.stream().chatResponse()` 替代 `.stream().content()`

```java
return chatClient.prompt()
        .system(systemPrompt)
        .user(userPrompt)
        .stream()
        .chatResponse()          // ← 返回 Flux<ChatResponse>
        .doOnNext(chunk -> {     // 每个 chunk 都进这里
            var usage = chunk.getMetadata() != null
                ? chunk.getMetadata().getUsage() : null;
            if (usage != null) { // 只有最后一个 chunk 的 usage 不为 null
                log.info("[Token] 流式... | 输入: {} | 输出: {} | 总计: {}",
                    usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
            }
        })
        .map(chunk -> {          // 还原为 Flux<String>，前端无感
            var result = chunk.getResult();
            if (result != null && result.getOutput() != null) {
                return result.getOutput().getText();
            }
            return "";
        })
        .filter(text -> !text.isEmpty())
        .onErrorReturn("AI 服务暂时不可用，请稍后重试");
```

**为什么只用 `.onErrorReturn()` 而不是 `.retryWhen()`？** 流式重试会导致前端重复显示文字——AI 已经推了半截回答，网络断了重试会从头再推一遍。

#### 18.4 为什么流式方法不用 @Retryable

`@Retryable` 只能捕获**方法执行时**抛出的异常。流式方法立即返回 `Flux` 对象，真正的 HTTP 请求在 Flux 被订阅后才发生——此时方法早已返回，异常通过 Flux 的 error 信号传播，`@Retryable` 看不到。

#### 18.5 典型 Token 消耗对比

完成 Day 26_5 后可以在日志中观察到：

```
[Token] 摘要生成    | 输入: 461   | 输出: 88   | 总计: 549     ← 很省
[Token] 单文档问答  | 输入: 3200  | 输出: 520  | 总计: 3720    ← 问答费多了
[Token] 多文档问答  | 输入: 15000 | 输出: 680  | 总计: 15680   ← 最费
```

#### 18.6 改动文件一览

| 文件 | 改动 |
|:---|:---|
| `pom.xml` | `spring-retry` + `spring-boot-starter-aop` |
| `NotebookCloneApplication.java` | `@EnableRetry` |
| `AiSummaryService.java` | `@Retryable` + `@Recover` + `.chatResponse()` + Token 日志 |
| `AiChatService.java` — 同步方法 | `@Retryable` + `@Recover` + `.chatResponse()` + Token 日志 |
| `AiChatService.java` — 流式方法 | `.stream().chatResponse()` + `.doOnNext()` + Token 日志 + `.onErrorReturn()` |

#### 18.7 Day 26 完成标志自查

- [ ] 理解"对外部依赖不信任"的架构思维
- [ ] 理解哪些异常该重试（超时/5xx）、哪些不该（400/401）
- [ ] 理解退避策略（backoff + multiplier）
- [ ] 理解 `@Recover` 兜底机制和签名规则
- [ ] `spring-retry` + `spring-boot-starter-aop` 依赖已添加
- [ ] `@EnableRetry` 已加到启动类
- [ ] `AiSummaryService.generateSummary()` 加了 `@Retryable` + Token 日志
- [ ] `AiChatService` 两个同步方法加了 `@Retryable` + Token 日志
- [ ] `AiChatService` 两个流式方法加了 `.chatResponse()` + Token 日志 + `.onErrorReturn()`
- [ ] 理解为什么流式方法不能用 `@Retryable`（Flux 的异步特性）
- [ ] 理解为什么流式方法不加重试（重复内容风险），只用 `.onErrorReturn()` 兜底
- [ ] Token 日志覆盖了所有 AI 调用场景（摘要 + 单文档问答 + 多文档问答 + 流式）
- [ ] 测试上传文档后日志出现 `[Token] 摘要生成`
- [ ] 测试流式问答后日志出现 `[Token] 流式单文档问答` 或 `[Token] 流式多文档问答`

---

<a id="toc-pdf-extract"></a>
### 19. PDF 文本提取与清洗 + 混合输入（Day 27）

> 核心目标：让文档上传支持"文本 + 文件"混合输入，并对提取的文本做清洗（去水印、去噪声），为后续 RAG 提供干净输入。

#### 19.1 为什么需要文本清洗

PDF/Word 提取出的"原文"并不干净，直接存库会污染后续 RAG 分块质量：

```
PDF 提取常见问题：
  1. 控制字符（NUL \x00、退格 \x08 等）→ PDF 内部编码残留
  2. 连续大量空行 → PDF 页面间距被转成换行
  3. 水印文本 → "S e c r e t @ L e v e l" 每个字符间带空格
  4. 每页重复的页眉页脚 → 同一行出现几十次
```

#### 19.2 cleanText() 清洗管线

在 `DocumentExtractService` 中新增 `cleanText()` 方法，在 `extractText()` 返回前统一调用：

```java
private String cleanText(String raw) {
    // 第一步：去除控制字符（保留换行\n、回车\r、制表符\t）
    String cleaned = raw.replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "");
    // 第二步：连续3个以上换行合并为2个
    cleaned = cleaned.replaceAll("\\n{3,}", "\n\n");
    // 第三步：过滤PDF水印行（字符间大量空格）
    cleaned = removeWatermarkLines(cleaned);
    // 第四步：去除重复出现3次以上的行（每页重复的水印、页眉页脚）
    cleaned = removeRepeatedLines(cleaned);
    // 第五步：每行首尾空白去除
    cleaned = Arrays.stream(cleaned.split("\\n", -1))
            .map(String::strip)
            .collect(Collectors.joining("\n"));
    return cleaned.trim();
}
```

**五步流水线**的设计思路：每一步解决一类噪声，互不干扰，便于后续单独调优。

#### 19.3 水印行过滤原理

PDF 中的水印层每个字符单独定位（坐标级别），PDFBox 逐字提取时会在字符之间插入空格：

```
正常文本："卫星通信资源调度"       → 空格占比 < 5%
水印文本："S e c r e t @ L e v e l" → 空格占比 > 50%
```

```java
private boolean isWatermarkLine(String line) {
    String trimmed = line.strip();
    if (trimmed.length() < 12) return false;  // 太短的不是水印
    long spaceCount = trimmed.chars().filter(c -> c == ' ').count();
    double spaceRatio = (double) spaceCount / trimmed.length();
    return spaceRatio > 0.4;  // 空格占比超过40% → 大概率是水印
}
```

**为什么阈值选 0.4？** 正常中英文混合文本空格占比通常不到 20%，水印文本可达 50%+。0.4 是一个保守的中间值，几乎不会误伤正文。

#### 19.4 重复行去重原理

学位论文的水印在每一页都重复出现，页眉页脚也是。如果同一行文本在全文中出现 3 次以上，大概率不是正文：

```java
private String removeRepeatedLines(String text) {
    // 1. 统计每行出现次数（忽略空行）
    Map<String, Long> lineCounts = Arrays.stream(text.split("\\n"))
            .filter(line -> !line.strip().isEmpty())
            .collect(Collectors.groupingBy(String::strip, Collectors.counting()));
    // 2. 过滤掉出现 ≥ 3 次的行
    return Arrays.stream(text.split("\\n", -1))
            .filter(line -> {
                String stripped = line.strip();
                if (stripped.isEmpty()) return true;  // 保留空行
                return lineCounts.getOrDefault(stripped, 0L) < 3;
            })
            .collect(Collectors.joining("\\n"));
}
```

**注意**：这里用 `Collectors.groupingBy` + `Collectors.counting()` 做频率统计，是 Java Stream API 的经典用法。

#### 19.5 PDF 提取开启位置排序

PDFBox 默认按 PDF 内容流顺序提取文本（不一定是视觉顺序）。加上 `setSortByPosition(true)` 后按坐标排序，减少水印/页眉混入正文：

```java
private String extractFromPdf(MultipartFile file) throws IOException {
    try (PDDocument document = Loader.loadPDF(file.getBytes())) {
        PDFTextStripper stripper = new PDFTextStripper();
        stripper.setSortByPosition(true);  // ← 按视觉位置排序
        stripper.setStartPage(1);
        stripper.setEndPage(document.getNumberOfPages());
        return stripper.getText(document);
    }
}
```

#### 19.6 混合输入：upload 端点支持 additionalContent

用户可能同时输入文本（笔记/备注）和上传文件（原始材料）。upload 端点新增可选参数：

```java
@PostMapping("/upload")
public Result<Document> uploadDocumentFile(
        @RequestParam("notebookId") Long notebookId,
        @RequestParam("file") MultipartFile file,
        @RequestParam(value = "additionalContent", required = false)
                String additionalContent  // ← Day 27 新增
) {
    String extractedText = extractService.extractText(file);
    // 合并用户手动输入 + 文件提取文本
    String finalContent = mergeContent(extractedText, additionalContent);
    // ...
}
```

**内容合并策略**：手动内容放前面（用户的笔记），文件文本放后面（原始材料），用 `---` 分隔：

```java
private String mergeContent(String fileText, String additionalContent) {
    if (additionalContent == null || additionalContent.isBlank()) {
        return fileText;
    }
    return additionalContent.trim() + "\n\n---\n\n" + fileText;
}
```

#### 19.7 文件上传大小限制

Spring Boot 默认 multipart 上传限制 **1MB**（单文件）/ **10MB**（整个请求）。PDF 经常超限，需要改配置：

```properties
# ===== Day 27：文件上传大小限制 =====
spring.servlet.multipart.max-file-size=50MB
spring.servlet.multipart.max-request-size=50MB
```

#### 19.8 已知局限

| 局限 | 原因 | 影响 |
|:---|:---|:---|
| 封面/扉页 □ 替换字符 | 装饰字体编码无法映射 Unicode | 正文不受影响，AI 摘要正常 |
| 扫描版 PDF 提取为空 | PDFBox 只能提取文字型 PDF | 返回提示文本，不会崩溃 |
| 繁体字映射（如"密級"） | PDF 字体编码映射结果 | 提取层无法修复 |

#### 19.9 改动文件一览

| 文件 | 改动 |
|:---|:---|
| `DocumentExtractService.java` | 新增 `cleanText()`、`removeWatermarkLines()`、`removeRepeatedLines()`、PDF 异常兜底、`setSortByPosition(true)` |
| `DocumentController.java` | upload 端点加 `additionalContent` 参数 + `mergeContent()`，catch 扩大到 Exception |
| `application.properties` | 加 `max-file-size=50MB` 和 `max-request-size=50MB` |
| `index.html` | 选项卡改复选框，两区域可同时显示 |
| `style.css` | 复选框样式替换选项卡样式 |
| `app.js` | `createDocument()` 三种模式，`uploadDocumentFileAPI` 支持额外文本 |

#### 19.10 常见坑

| 坑 | 原因 | 解决 |
|:---|:---|:---|
| PDF 上传报 "Maximum upload size exceeded" | Spring Boot 默认 multipart 限制 1MB | `application.properties` 加 `max-file-size=50MB` |
| PDF 上传报 "Failed to fetch" | PDFBox 抛非 IO 异常，controller catch 只接 IOException | catch 扩大到 Exception + 服务层加 try-catch 兜底 |
| 提取文本含 "S e c r e t..." 水印 | PDFBox 逐字提取水印层，字符间插入空格 | `removeWatermarkLines()` 过滤空格占比 > 40% 的行 |
| 每页重复的页眉页脚混入正文 | PDFBox 不区分正文和页眉 | `removeRepeatedLines()` 去除出现 3 次以上的行 |

#### 19.11 Day 27 完成标志自查

- [ ] 理解为什么需要文本清洗（PDF 提取的噪声会影响 RAG 分块质量）
- [ ] 理解 `cleanText()` 五步流水线的设计思路
- [ ] 理解水印过滤的启发式算法（空格占比 > 40%）
- [ ] 理解重复行去重的逻辑（`Collectors.groupingBy` + `counting()`）
- [ ] 理解 `setSortByPosition(true)` 的作用（按视觉位置排序）
- [ ] `DocumentExtractService` 已加 `cleanText()` 管线
- [ ] `DocumentController` upload 端点支持 `additionalContent` 参数
- [ ] `application.properties` 加了文件上传大小限制
- [ ] 前端选项卡改复选框，支持混合输入
- [ ] 测试上传 PDF 后提取文本不含水印和重复行

---

<a id="toc-chunk-vector"></a>
### 20. 文本分块 + 向量化（Day 28）

> 核心目标：把 Day 27 提取的干净文本切成小块（chunks），用 Embedding 模型生成向量，存入向量存储。这是 RAG 管线中"索引"阶段的完整实现。

#### 20.1 为什么要分块

Day 27 完成后，文档以完整文本存在 MySQL。但当前 AI 问答的做法是把整篇文档塞进 prompt：

```
问题：
  全文塞进 prompt → Token 超限 / 噪声太多 / Token 浪费

解决：
  切成小块 → 提问时只检索最相关的几个块 → 精准上下文 + Token 省 90%
```

#### 20.2 分块策略对比

| 策略 | 做法 | 优缺点 |
|:---|:---|:---|
| **固定长度** | 每 500 字符切一刀 | 简单粗暴，可能在句子中间断开 |
| **按段落** | 按 `\n\n` 切 | 保留语义完整性，但段落长度不一 |
| **Token 分块** | 按 Token 数量切（如 512 Token），带重叠 | 最常用的平衡方案 ✅ |
| **语义分块** | 用 Embedding 检测语义边界 | 效果最好，但计算成本高 |

**Day 28 使用 Token 分块 + 重叠**，Spring AI 内置支持（`TokenTextSplitter`），也是 RAG 实践中最常用的起点。

#### 20.3 重叠（Overlap）为什么重要

```
不重叠：
  块 1: "切片技术是一种网络虚拟化方法，它将物理网络..."
  块 2: "资源划分为多个逻辑切片，每个切片独立管理..."
                    ↑
         "它"指什么？块 2 丢失了上下文

重叠 50 Token：
  块 1: "...它将物理网络划分为多个逻辑"
  块 2: "划分为多个逻辑切片，每个切片独立管理..."
              ↑
     重叠部分保留了上下文衔接
```

#### 20.4 Embedding 的核心思想

Embedding 把文本变成一个高维向量（如 2048 维的浮点数数组）。语义相近的文本，向量在空间中的距离也近：

```
"卫星通信资源调度"  → [0.82, 0.15, 0.73, ..., 0.41]  (2048维)
"GEO卫星波束分配"  → [0.79, 0.18, 0.71, ..., 0.38]  ← 语义相近，距离小
"今天天气不错"      → [0.02, 0.91, 0.05, ..., 0.87]  ← 语义无关，距离大
```

**RAG 的完整检索流程**：

```
索引阶段（Day 28）：
  文档 → 分块 → 每个块调 Embedding 模型 → 生成向量 → 存入向量存储

检索阶段（Day 29）：
  用户问题 → 调同一个 Embedding 模型 → 生成问题向量
           → 在向量存储中找最相似的 Top-K 个块
           → 把这 K 个块拼进 prompt 给 LLM
```

#### 20.5 双模型架构：DeepSeek 聊天 + 智谱 AI Embedding

当前项目用 DeepSeek 做聊天，但 **DeepSeek 不提供 Embedding API**。所以 Embedding 需要单独指向智谱 AI：

```
Chat      → DeepSeek（spring.ai.openai.base-url → api.deepseek.com）
Embedding → 智谱 AI（zhipuai.embedding.base-url → open.bigmodel.cn）
```

两个模型各管各的，通过 `VectorStoreConfig` 单独配置 Embedding Bean。

#### 20.6 Maven 依赖

```xml
<!-- Day 28 新增：文本分块工具（内含 TokenTextSplitter） -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-tika-document-reader</artifactId>
</dependency>
<!-- Day 28 新增：向量存储（SimpleVectorStore 等） -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-vector-store</artifactId>
</dependency>
```

**为什么需要单独加 `spring-ai-vector-store`？** `spring-ai-starter-model-openai` 只包含聊天相关的类，`VectorStore` 和 `SimpleVectorStore` 在独立的 artifact 里。

#### 20.7 Embedding 配置（VectorStoreConfig.java）

```java
@Configuration
public class VectorStoreConfig {

    @Value("${zhipuai.embedding.api-key}")
    private String apiKey;
    @Value("${zhipuai.embedding.base-url}")
    private String baseUrl;
    @Value("${zhipuai.embedding.model}")
    private String model;

    /**
     * 创建智谱 AI 的 Embedding 模型
     * 使用 OpenAI 兼容格式调用智谱的 /v1/embeddings 接口
     */
    @Bean
    public EmbeddingModel embeddingModel() {
        OpenAiApi openAiApi = OpenAiApi.builder()
                .baseUrl(baseUrl)
                .apiKey(apiKey)
                .build();
        return new OpenAiEmbeddingModel(openAiApi);
    }

    /**
     * 创建内存向量存储（开发阶段用，重启后数据丢失）
     */
    @Bean
    public VectorStore vectorStore(EmbeddingModel embeddingModel) {
        return SimpleVectorStore.builder(embeddingModel).build();
    }
}
```

**为什么不复用 spring.ai.openai 的配置？** 因为 `spring.ai.openai.*` 已经指向 DeepSeek（用于聊天），智谱 AI 是不同的服务端点。两个 Bean 各用各的 `OpenAiApi` 实例，互不干扰。

对应的 `application.properties` 配置：

```properties
# ===== Day 28：智谱 AI Embedding 配置 =====
zhipuai.embedding.base-url=https://open.bigmodel.cn/api/paas
zhipuai.embedding.api-key=your-api-key
zhipuai.embedding.model=embedding-3
```

**注意**：`base-url` 不要带 `/v4`，因为 OpenAI 客户端会自动拼 `/v1/embeddings`。如果写了 `/v4`，最终请求路径会变成 `/v4/v1/embeddings`（404）。

#### 20.8 分块 + 向量化服务（DocumentChunkService.java）

```java
@Slf4j
@Service
@RequiredArgsConstructor
public class DocumentChunkService {

    private final VectorStore vectorStore;
    private final DocumentRepository documentRepository;

    @Async("aiTaskExecutor")
    public void chunkAndStoreAsync(Long documentId) {
        try {
            log.info("[分块] 开始处理文档 ID: {}", documentId);

            // 1. 从数据库重新读取文档（异步线程中的实体可能已过期）
            Document document = documentRepository.findById(documentId).orElse(null);
            if (document == null) {
                log.warn("[分块] 文档不存在，跳过 | ID: {}", documentId);
                return;
            }

            String content = document.getContent();
            if (content == null || content.isBlank()) {
                log.info("[分块] 文档内容为空，跳过 | 标题: {}", document.getTitle());
                return;
            }

            // 2. 分块：使用默认参数（512 Token / 块，50 Token 重叠）
            TokenTextSplitter splitter = new TokenTextSplitter();
            org.springframework.ai.document.Document sourceDoc =
                    new org.springframework.ai.document.Document(content);
            List<org.springframework.ai.document.Document> chunks =
                    splitter.apply(List.of(sourceDoc));

            // 3. 给每个块附加元数据（Day 29 检索时用来溯源）
            List<org.springframework.ai.document.Document> enrichedChunks =
                    chunks.stream().map(chunk -> {
                        Map<String, Object> metadata = new HashMap<>(chunk.getMetadata());
                        metadata.put("documentId", documentId);
                        metadata.put("documentTitle", document.getTitle());
                        return new org.springframework.ai.document.Document(
                                chunk.getText(), metadata);
                    }).collect(Collectors.toList());

            // 4. 存入向量存储（内部自动调 Embedding API 生成向量）
            vectorStore.add(enrichedChunks);

            log.info("[分块] 完成 | 文档: {} | 共 {} 块",
                    document.getTitle(), enrichedChunks.size());
        } catch (Exception e) {
            log.error("[分块] 处理失败 | 文档 ID: {} | 错误: {}",
                    documentId, e.getMessage(), e);
        }
    }
}
```

**几个设计要点**：

- **`@Async("aiTaskExecutor")`**：和 `AsyncSummaryService` 一样复用已有的异步线程池，不阻塞上传响应。
- **从数据库重新读取**：异步线程执行时，Controller 返回的实体可能已过期或被 Hibernate 会话关闭，必须重新查。
- **全限定名 `org.springframework.ai.document.Document`**：因为项目已有 `com.example.notebook_clone.entity.Document` 实体类，Java 不支持 `import ... as ...`，只能用全限定名避免冲突。
- **元数据 `documentId` / `documentTitle`**：Day 29 做检索时，用这些元数据追溯分块属于哪篇文档。

#### 20.9 上传时触发分块

在 `DocumentController.uploadDocumentFile` 末尾，摘要生成之后加入分块调用：

```java
Document saved = documentRepository.save(document);
asyncSummaryService.generateSummaryAsync(saved.getId());   // Day 25
documentChunkService.chunkAndStoreAsync(saved.getId());    // Day 28 新增
return Result.success(saved);
```

两个异步任务（摘要 + 分块）**并行执行**，互不阻塞。

#### 20.10 测试接口（ChunkTestController.java）

```java
@RestController
@RequestMapping("/test/chunk")
public class ChunkTestController {

    private final DocumentChunkService documentChunkService;
    private final VectorStore vectorStore;

    /** 手动触发文档分块 */
    @GetMapping("/{documentId}")
    public Result<String> triggerChunk(@PathVariable Long documentId) {
        documentChunkService.chunkAndStoreAsync(documentId);
        return Result.success("分块任务已提交，请查看控制台日志确认完成");
    }

    /** 测试向量相似度搜索 */
    @GetMapping("/search")
    public Result<List<Map<String, Object>>> search(
            @RequestParam String query,
            @RequestParam(defaultValue = "3") int topK) {
        List<org.springframework.ai.document.Document> results =
                vectorStore.similaritySearch(SearchRequest.builder()
                        .query(query).topK(topK).build());
        // ... 返回截断文本 + 元数据 + 相似度分数 ...
    }
}
```

`/test/**` 路径在 `SecurityConfig` 中已放行，无需 JWT。

#### 20.11 改动文件一览

| 文件 | 改动 |
|:---|:---|
| `pom.xml` | 加 `spring-ai-tika-document-reader` + `spring-ai-vector-store` |
| `application.properties` | 加智谱 AI Embedding 配置（base-url、api-key、model） |
| `VectorStoreConfig.java` | **新建** — EmbeddingModel + SimpleVectorStore Bean |
| `DocumentChunkService.java` | **新建** — 异步分块 + 向量化 + 元数据注入 |
| `ChunkTestController.java` | **新建** — 手动触发分块 + 相似度搜索测试 |
| `DocumentController.java` | 注入 `DocumentChunkService`，上传后触发分块 |

#### 20.12 常见坑

| 坑 | 原因 | 解决 |
|:---|:---|:---|
| `VectorStore` / `SimpleVectorStore` 找不到类 | `spring-ai-starter-model-openai` 不含向量存储类 | 额外加 `spring-ai-vector-store` 依赖 |
| Embedding API 404，路径 `/v4/v1/embeddings` | base-url 带了 `/v4`，OpenAI 客户端又拼了 `/v1/` | base-url 改为不带版本号的地址 |
| Java `import X as Y` 语法报错 | Java 不支持 import 别名 | 用全限定名 `org.springframework.ai.document.Document` |
| 分块阻塞上传接口 | 没有用 `@Async` | 加 `@Async("aiTaskExecutor")` 异步执行 |

#### 20.13 Day 28 完成标志自查

- [ ] 理解为什么要文本分块（全文塞 prompt 的三大问题）
- [ ] 理解 Token 分块 + 重叠的策略（512 Token / 块，50 Token 重叠）
- [ ] 理解 Embedding 的核心思想（文本 → 高维向量，语义相近则距离近）
- [ ] 理解双模型架构（DeepSeek 聊天 + 智谱 AI Embedding 各管各的）
- [ ] 理解为什么 base-url 不能带 `/v4`（OpenAI 客户端自动拼 `/v1/`）
- [ ] 理解 Java 不支持 import 别名，用全限定名解决类名冲突
- [ ] `VectorStoreConfig.java` 已创建，EmbeddingModel + SimpleVectorStore Bean 正常
- [ ] `DocumentChunkService.java` 已创建，`@Async` 异步分块 + 向量化
- [ ] `ChunkTestController.java` 已创建，测试搜索返回相关分块
- [ ] `DocumentController` 上传后触发分块，控制台日志显示 `[分块] 完成`
- [ ] 测试上传 PDF 后日志出现 `[分块] 完成 | 文档: xxx | 共 N 块`
- [ ] 测试 `/test/chunk/search?query=关键词` 返回相关文本片段

---

<a id="toc-rag-qa"></a>
### 21. RAG 检索增强问答 + 引用溯源（Day 29）

> 核心目标：改造 AI 问答流程，用户提问时先从向量存储检索最相关的文档块，只把这些块送进 prompt。完成 RAG 的"检索 + 生成"阶段，实现 RAG 完整闭环。

#### 21.1 RAG 三步走

Day 28 完成了 R（Retrieve）的索引阶段，Day 29 补齐 A（Augment）和 G（Generate）：

```
R（Retrieve）：用户问题 → Embedding → 向量检索 → 找到最相关的 K 个文档块
A（Augment）：把 K 个块 + 用户问题 + 系统指令 → 拼成增强 prompt
G（Generate）：LLM 基于增强 prompt 生成回答
```

#### 21.2 RAG vs 全文塞入 prompt

| | 全文塞入（Day 21-28） | RAG 检索（Day 29） |
|:---|:---|:---|
| Token 消耗 | 高（整篇文档） | 低（3-5 个块） |
| 回答质量 | 噪声多，容易"走神" | 精准上下文，回答聚焦 |
| 支持文档数 | 只能处理 1-2 篇 | 可跨几十篇文档检索 |
| 延迟 | 长文档处理慢 | 检索快 + 短 prompt 生成快 |
| 局限性 | 超出 Token 限制就截断 | 检索不到就答不上来 |

#### 21.3 注入 VectorStore

`AiChatService` 构造函数新增 `VectorStore` 参数：

```java
@Service
public class AiChatService {

    private final ChatClient chatClient;
    private final VectorStore vectorStore;  // Day 29 新增

    public AiChatService(ChatClient.Builder chatClientBuilder, VectorStore vectorStore) {
        this.chatClient = chatClientBuilder.build();
        this.vectorStore = vectorStore;  // Day 29 新增
    }
}
```

`VectorStore` Bean 在 Day 28 的 `VectorStoreConfig` 中已创建，Spring 自动注入。

#### 21.4 核心方法：retrieveRelevantChunks()

新增私有方法，封装向量检索 + 来源标注：

```java
private List<String> retrieveRelevantChunks(String question, int topK) {
    List<Document> results = vectorStore.similaritySearch(
            SearchRequest.builder()
                    .query(question)
                    .topK(topK)
                    .build());

    List<String> chunksWithSource = new ArrayList<>();
    for (int i = 0; i < results.size(); i++) {
        Document doc = results.get(i);
        String title = (String) doc.getMetadata()
                .getOrDefault("documentTitle", "未知文档");
        String source = String.format("[%d] 来源：%s\n%s",
                i + 1, title, doc.getText());
        chunksWithSource.add(source);
    }
    return chunksWithSource;
}
```

**关键设计**：

- **`SearchRequest.builder()`**：Spring AI 1.0.0 的搜索请求构建器，`.query()` 设置查询文本，`.topK()` 设置返回数量。
- **来源标注 `[N] 来源：文档标题`**：利用 Day 28 存入的元数据 `documentTitle`，在每个块前面标注编号和来源，为后续 Prompt 引用做准备。

#### 21.5 改造单文档问答

```java
public String askBasedOnDocument(String documentContent, String question,
        boolean useDocumentContext) {

    // ===== Day 29：RAG 检索替代全文塞入 =====
    List<String> relevantChunks = retrieveRelevantChunks(question, 5);

    String context;
    if (relevantChunks.isEmpty()) {
        // 降级：向量存储中还没有块（可能分块任务还没跑完），用全文截断
        context = documentContent != null && documentContent.length() > 8000
                ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
                : documentContent;
    } else {
        context = String.join("\n\n---\n\n", relevantChunks);
    }
    // ========================================

    // Prompt 和调用不变，只是 context 从全文变成了检索到的块
}
```

**优雅降级**：如果向量存储返回空（分块任务异步还没跑完、或者 SimpleVectorStore 重启后数据丢失），自动回退到全文截断模式，保证问答功能不受影响。

#### 21.6 改造多文档问答 — RAG 的最大亮点

笔记本级问答是 RAG 最有价值的场景——可以**跨文档检索**：

```java
public String askBasedOnDocuments(List<String[]> documents, String question) {

    // ===== Day 29：用 RAG 替代"拼接所有文档" =====
    List<String> relevantChunks = retrieveRelevantChunks(question, 8);

    String context;
    if (relevantChunks.isEmpty()) {
        // 降级为旧逻辑：拼接所有文档（50000 字截断上限）
        // ... 原来的拼接逻辑 ...
    } else {
        context = String.join("\n\n---\n\n", relevantChunks);
    }
    // ============================================
}
```

**改造前**：把笔记本里所有文档拼成一个巨大字符串（可能超 Token 限制）。
**改造后**：从向量存储里检索最相关的 8 个块（可能来自不同文档），精准且省 Token。

#### 21.7 流式方法同步改造

四个问答方法（同步单文档、同步多文档、流式单文档、流式多文档）都接入了 RAG。流式方法的改造和同步方法完全一样——在构建 prompt 之前插入 `retrieveRelevantChunks()` 调用，后续的 `.stream().chatResponse()` 不变：

```java
public Flux<ServerSentEvent<String>> askBasedOnDocumentStream(...) {
    // ===== Day 29：RAG 检索（流式）=====
    List<String> relevantChunks = retrieveRelevantChunks(question, 5);
    String context = relevantChunks.isEmpty()
            ? /* 降级全文截断 */ : String.join("\n\n---\n\n", relevantChunks);

    // 复用私有方法构建 Prompt → 流式调用不变
    String systemPrompt = buildSingleDocSystemPrompt(useDocumentContext);
    String userPrompt = buildSingleDocUserPrompt(context, question, useDocumentContext);
    // ... .stream().chatResponse() ...
}
```

#### 21.8 Prompt 工程：引用溯源

改造 System Prompt，要求 AI 在回答中标注来源：

```
你是一位知识库问答助手。请严格遵循以下规则：
1. 只基于用户提供的【文档内容】回答问题
2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
3. 回答要简洁，控制在 300 字以内
4. 不要添加文档中没有的信息
5. 每段内容前面标注了 [N] 来源：文档标题，回答时如果引用了某段内容，
   必须在引用处添加标记 [N]
6. 回答末尾必须用 "---" 分隔，然后列出参考来源，每个引用独占一行，
   格式为：[N] 【文档：标题】原文片段
```

**效果**：AI 回答中会出现 `[1]`、`[2]` 等引用标记，末尾附带来源列表，用户可以追溯答案出自哪个文档。

#### 21.9 可预测的块 ID：buildChunkId()

Day 28 的分块没有给每个块设置固定 ID。Day 29 需要按 ID 删除块（删除文档时），所以引入可预测的 ID 命名规则：

```java
private String buildChunkId(Long documentId, int chunkIndex) {
    return String.format("doc:%d:chunk:%d", documentId, chunkIndex);
}
// 示例：doc:14:chunk:0, doc:14:chunk:1, doc:14:chunk:2 ...
```

**为什么要可预测？** 删除文档时需要知道该文档有哪些块的 ID。如果 ID 是随机 UUID，就无法拼出来。用 `doc:{id}:chunk:{index}` 格式，只要知道文档 ID 和块数量，就能生成所有块的 ID。

#### 21.10 Document 实体新增 chunkCount 字段

```java
@Entity
public class Document {
    // ... 原有字段 ...

    // Day 29 新增：记录分块数量，删除时用来生成块 ID 列表
    private Integer chunkCount;
}
```

分块完成后，`DocumentChunkService` 自动更新这个字段：

```java
// chunkAndStoreAsync() 末尾
document.setChunkCount(enrichedChunks.size());
documentRepository.save(document);
```

JPA 的 `ddl-auto=update` 会自动在数据库里加这个列。

#### 21.11 删除文档时清理向量库

```java
public void deleteDocumentChunks(Long documentId) {
    Document document = documentRepository.findById(documentId).orElse(null);
    if (document == null) return;

    Integer chunkCount = document.getChunkCount();
    if (chunkCount == null || chunkCount == 0) return;

    // 根据 chunkCount 生成所有块 ID，调 vectorStore.delete() 批量删除
    List<String> chunkIds = IntStream.range(0, chunkCount)
            .mapToObj(i -> buildChunkId(documentId, i))
            .collect(Collectors.toList());

    vectorStore.delete(chunkIds);
}
```

`DocumentController.deleteDocument` 改为**先删向量、再删数据库**：

```java
// Day 29：先清理向量库中的分块（再删数据库文档）
documentChunkService.deleteDocumentChunks(id);
documentRepository.deleteById(id);
```

**为什么要先删向量？** 如果先删数据库记录，`chunkCount` 就查不到了，无法生成块 ID 来清理向量库。

#### 21.12 重新索引

文档内容更新时，先删旧块再建新块：

```java
@Async("aiTaskExecutor")
public void reindexDocument(Long documentId) {
    deleteDocumentChunks(documentId);
    chunkAndStoreAsync(documentId);
}
```

#### 21.13 改动文件一览

| 文件 | 改动 |
|:---|:---|
| `AiChatService.java` | 注入 `VectorStore`，新增 `retrieveRelevantChunks()`，四个问答方法全部改用 RAG + 降级机制，System Prompt 加引用溯源要求 |
| `DocumentChunkService.java` | 新增 `deleteDocumentChunks()`、`reindexDocument()`、`buildChunkId()`，分块时设置可预测 ID + 保存 `chunkCount` |
| `Document.java` | 新增 `chunkCount` 字段 |
| `DocumentController.java` | 删除文档时先调 `deleteDocumentChunks()` 再删数据库 |

#### 21.14 常见坑

| 坑 | 原因 | 解决 |
|:---|:---|:---|
| RAG 检索不到相关内容 | 问题表述和文档用词差异大，或 Embedding 模型中文效果一般 | 换一种问法；增大 Top-K；后续换中文专用 Embedding |
| AI 回答中没出现引用标记 | Prompt 没有明确要求引用格式 | System Prompt 加第 5、6 条规则 |
| 删除文档后仍能检索到 | 没调 `deleteDocumentChunks()`，或者 SimpleVectorStore 重启后 ID 对不上 | 删除时先清向量再删数据库 |
| 新上传的文档检索不到 | 分块任务是异步的，还没跑完 | 等几秒，或看后端日志确认 `[分块] 完成` |
| `chunkCount` 为 null | 老文档在 Day 29 之前上传，没有这个字段 | 手动调 `/test/chunk/{id}` 重新分块 |

#### 21.15 RAG 完整管线回顾

```
Day 27: 文档上传 → 文本提取 + 清洗（cleanText 管线）
Day 28: 文本分块 → Embedding 向量化 → 存入 VectorStore
Day 29: 用户提问 → 向量检索 Top-K → 拼进 prompt → LLM 生成带引用的回答

索引阶段（离线）：上传 → 提取 → 分块 → 向量化 → 存储
检索阶段（在线）：提问 → 检索 → 增强 prompt → 生成 → 返回
```

#### 21.16 Day 29 完成标志自查

- [ ] 理解 RAG 三步走（Retrieve → Augment → Generate）
- [ ] 理解 RAG vs 全文塞入的优劣对比
- [ ] 理解优雅降级机制（向量为空时回退全文截断）
- [ ] 理解引用溯源的 Prompt 工程（`[N] 来源` 标注 + 末尾参考列表）
- [ ] 理解可预测块 ID 的设计（`doc:{id}:chunk:{index}`）
- [ ] 理解为什么要先删向量再删数据库（保留 chunkCount 用于生成 ID）
- [ ] `AiChatService` 注入了 `VectorStore`，新增 `retrieveRelevantChunks()`
- [ ] 四个问答方法（同步×2 + 流式×2）都接入了 RAG
- [ ] `DocumentChunkService` 新增 `deleteDocumentChunks()` + `reindexDocument()`
- [ ] `Document` 实体新增 `chunkCount` 字段
- [ ] `DocumentController` 删除文档时先清向量库
- [ ] 测试单文档问答：回答中出现 `[1]` 引用标记，Token 消耗明显降低
- [ ] 测试多文档问答：回答能综合多篇文档的信息
- [ ] 测试删除文档后，被删文档的内容不再出现在搜索结果中

---

<a id="toc-step5"></a>
## 第五步：常用注解速查表

<a id="toc-class-annotations"></a>
### 类级别注解

| 注解 | 作用 | 使用位置 |
|-----|------|---------|
| `@SpringBootApplication` | 标记 Spring Boot 入口类 | 主类 |
| `@RestController` | REST API 控制器 | Controller 类 |
| `@RequestMapping("/api")` | 接口前缀 | Controller 类 |
| `@Service` | 业务层 | Service 类 |
| `@Repository` | 数据访问层 | Repository 类 |
| `@Entity` | 数据库实体 | Entity 类 |
| `@Table(name = "xxx")` | 指定表名 | Entity 类 |
| `@Configuration` | 配置类 | Config 类 |
| `@EnableWebSecurity` | 启用 Spring Security | Config 类 |
| `@EnableAsync` | 开启异步支持（Day 25） | 启动类 / Config 类 |
| `@EnableRetry` | 开启重试支持（Day 26） | 启动类 |
| `@Slf4j` | Lombok 自动生成 Logger | 任何类 |
| `@RestControllerAdvice` | 全局异常处理 | ExceptionHandler 类 |

<a id="toc-method-annotations"></a>
### 方法级别注解

| 注解 | 作用 | HTTP 方法 |
|-----|------|-----------|
| `@GetMapping` | 处理查询请求 | GET |
| `@PostMapping` | 处理创建请求 | POST |
| `@PutMapping` | 处理更新请求 | PUT |
| `@DeleteMapping` | 处理删除请求 | DELETE |
| `@RequestMapping` | 通用映射 | 任意 |
| `@ExceptionHandler` | 处理特定异常 | - |
| `@Bean` | 注册 Spring Bean | Config 方法 |
| `@Async("poolName")` | 异步执行方法，使用指定线程池（Day 25） | Service 方法 |
| `@Retryable(retryFor=..., maxAttempts=..., backoff=...)` | 失败自动重试（Day 26） | Service 方法 |
| `@Recover` | 重试全部失败后的兜底方法（Day 26） | Service 方法 |
| `@Backoff(delay=, multiplier=)` | 重试退避策略（Day 26） | `@Retryable` 参数 |

<a id="toc-field-annotations"></a>
### 字段/参数注解

| 注解 | 作用 | 使用位置 |
|-----|------|---------|
| `@Id` | 主键 | Entity 字段 |
| `@GeneratedValue` | 自增策略 | 主键字段 |
| `@Column` | 列约束 | Entity 字段 |
| `@RequestBody` | JSON 转对象 | 方法参数 |
| `@PathVariable` | URL 路径参数 | 方法参数 |
| `@RequestParam` | URL 查询参数 | 方法参数 |
| `@Valid` | 触发参数校验 | 方法参数 |
| `@NotBlank` | 非空校验（不能为null、空串、纯空格） | Entity/DTO 字段 |
| `@Size` | 长度校验 | Entity 字段 |
| `@ManyToOne` | 多对一关联 | Entity 字段 |
| `@OneToMany` | 一对多关联 | Entity 字段 |
| `@JoinColumn` | 外键列 | 关联字段 |
| `@JsonIgnore` | JSON 忽略 | Entity 字段 |
| `@Component` | 通用组件 | Util 工具类 |
| `@Value` | 读取配置 | 字段上 |

---

<a id="toc-appendix"></a>
<a id="toc-appendix"></a>
## 附录：HTTP 方法对应操作

| HTTP 方法 | 操作 | 示例 URL | 作用 |
|----------|------|---------|------|
| GET | 查询 | `/api/notebooks` | 查询所有 |
| GET | 查询 | `/api/notebooks/1` | 查询 ID=1 的 |
| POST | 创建 | `/api/notebooks` | 新建笔记本 |
| PUT | 更新 | `/api/notebooks/1` | 修改 ID=1 的 |
| DELETE | 删除 | `/api/notebooks/1` | 删除 ID=1 的 |

---

> **更新记录**：
> - 2026-04-06：初始版本，覆盖 controller、service、repository、entity、common、config 各层
> - 2026-04-06：新增 Spring Security + BCrypt 密码加密详解
> - 2026-04-06：新增 JWT 无状态认证完整流程说明（Session vs JWT 对比、JWT 结构、完整认证流程示例）
> - 2026-04-08：新增 JWT 认证过滤器机制详解（过滤器链协作、SecurityContext 机制、请求完整流程图）
> - 2026-04-08：新增 JwtAuthenticationFilter 逐行解析
> - 2026-04-08：新增 AuthController、TestController 逐行解析（含 DTO record 模式说明）
> - 2026-04-08：修复 SecurityConfig 章节（拆分与 JwtUtil 混合的代码，完善 addFilterBefore 说明）
> - 2026-04-08：更新项目结构图（新增 filter/ 文件夹、TestController）
> - 2026-04-08：新增 DTO 与 record 模式知识点
> - 2026-04-08：注解速查表补充 @EnableWebSecurity 等注解
> - 2026-04-17：新增 SecurityContextHolder 实际应用（Day 15）：创建资源时自动关联当前用户、完整数据流转图
> - 2026-04-19：新增 JPA 派生查询方法（Derived Query Methods）完整知识体系：操作前缀、条件关键字、排序分页、Optional 拆包、项目中实际应用
> - 2026-04-19：新增数据隔离与权限控制（Day 16）：查询隔离与操作隔离、三层防线、SQL 层面过滤策略、项目中实际应用、Day 15 vs Day 16 对比
> - 2026-04-22：新增 Spring AI 集成（Day 18）：Spring AI 统一抽象层、依赖引入方式（仓库+BOM+starter）、DeepSeek 兼容 OpenAI 格式、application.properties 配置、Spring Boot 4.x→3.4.2 版本兼容性踩坑、依赖名称变更、API Key 安全原则
> - 2026-04-22：大幅更新 Spring AI 集成章节：修正为 1.0.0 GA 正式版配置、记录四次完整踩坑经历（target vs src、M6不兼容Boot 3.4.2、依赖名变更、Builder注入方式变更）、最终可用配置方案
> - 2026-04-22：新增第 8 章 ChatClient 调用与 Prompt 工程（Day 19）：调用链拆解、System/User 两种角色详解、Prompt 工程实战效果对比、TestAiController 完整代码（GET+POST）、ChatRequest DTO、api.http 测试用例
> - 2026-04-22：新增第 9 章同步阻塞与异步优化预告：线程状态变化图、优缺点对比表、实测耗时数据、SSE流式/@Async异步方案预告、完成标志自查清单
> - 2026-04-22：新增 SecurityConfig 放行 /test/** 路径说明
> - 2026-04-23：新增第 10 章 AI 文档摘要自动生成（Day 20）：Prompt 工程三板斧、上下文窗口保护、Service 层封装设计、业务流程集成、独立补生成接口设计、同步生成利弊分析、边界情况处理
> - 2026-04-26：新增第 11 章 基于单个文档的智能问答（Day 21）：上下文拼接原理、System Prompt 四条规则设计、RESTful 接口设计、AI Hallucination 防御、RAG 最简形式对比表、完成标志自查清单
> - 2026-04-26：新增第 12 章 前端问答优化（Day 21-5）：智能问答开关设计、后端 Prompt 动态切换原理、DTO 向后兼容设计、前端开关控件 + textarea 回答区改造、CSS 滑块样式
> - 2026-04-27：新增第 13 章 笔记本级多文档智能问答（Day 22）：多文档上下文拼接策略、50000 字宽松截断上限、List<String[]> 参数设计、NotebookController 新增 /{id}/ask 接口、前端渐变卡片式问答面板、三种截断策略对比
> - 2026-04-28：新增第 14 章 AI 流式输出 SSE 打字机效果（Day 23）：SSE vs WebSocket 认知、Flux<String> 响应式基础、Service 层抽取私有方法 + 新增流式方法、Controller 层三个流式端点、 produces = TEXT_EVENT_STREAM_VALUE、中文乱码修复、api.http SSE 测试
> - 2026-04-30：新增第 15 章 AI 引用溯源（Day 24）：Prompt 工程实现引用标记 [N]、前后端引用格式约定、parseCitations 分割解析逻辑、renderCitationCards 卡片渲染、单文档标题自动填充、优雅降级设计

> - 2026-05-14：新增第 16 章 前端 Token 用量显示与页面布局改造（Day 26）：SSE 自定义事件 `event: token-usage` 传递 Token 用量、`ServerSentEvent<T>` 返回类型改造、`Flux.concatWith` 流末尾追加事件、前端 SSE 事件块解析增强、Token 用量卡片独立渲染、会话级 Token 累计（方案 A：纯前端内存）、页面布局改造（右侧功能面板 + Tab 切换）、`.app` 去掉 `max-width` 实现横向铺满

> - 2026-06-22：新增第 19 章 PDF 文本提取与清洗 + 混合输入（Day 27）：`cleanText()` 五步清洗管线、水印行过滤（空格占比启发式算法）、重复行去重（`Collectors.groupingBy` + `counting()`）、PDFBox `setSortByPosition(true)` 位置排序、upload 端点 `additionalContent` 混合输入参数、`mergeContent()` 内容合并策略、文件上传大小限制 50MB、前端选项卡改复选框
> - 2026-06-22：新增第 20 章 文本分块 + 向量化（Day 28）：Token 分块策略 + 重叠原理、Embedding 向量化核心思想、双模型架构（DeepSeek 聊天 + 智谱 AI Embedding）、`VectorStoreConfig` 独立配置 EmbeddingModel + SimpleVectorStore、`DocumentChunkService` 异步分块 + 元数据注入、`ChunkTestController` 测试搜索、base-url 不带版本号的踩坑、Java 全限定名解决类名冲突
> - 2026-06-23：新增第 21 章 RAG 检索增强问答 + 引用溯源（Day 29）：RAG 三步走（Retrieve → Augment → Generate）、`VectorStore` 注入 `AiChatService`、`retrieveRelevantChunks()` 向量检索 + 来源标注、四个问答方法全部改用 RAG + 优雅降级机制、System Prompt 引用溯源（`[N] 来源` 标注）、可预测块 ID `doc:{id}:chunk:{index}`、`Document.chunkCount` 字段、`deleteDocumentChunks()` 先删向量再删数据库、`reindexDocument()` 重新索引

---

## 第 16 章：前端 Token 用量显示与页面布局改造（Day 26）

### 16.1 需求背景

流式问答完成后，用户看不到这次调用消耗了多少 Token。需要：
1. 把 Token 用量从后端传到前端，**独立显示**（不混在 AI 回答正文里）。
2. 改造页面布局，主内容左移，右侧新增功能面板。
3. 右侧面板显示**当前会话**的累计 Token 用量（刷新清零，不持久化）。

### 16.2 核心方案：SSE 自定义事件

**问题**：流式响应开始后无法修改 HTTP 响应头，不能把 Token 放在 Header 里传。

**解决**：SSE 支持自定义事件类型。在流末尾追加一个 `event: token-usage` 的事件：

```
data: AI 回答的最后一段文字...

event: token-usage
data: {"prompt":3200,"completion":520,"total":3720}
```

前端用 `fetch + ReadableStream` 手动解析 SSE，识别到 `event: token-usage` 就单独处理。

### 16.3 后端实现

#### 16.3.1 Service 层改造

**返回类型变更**：`Flux<String>` → `Flux<ServerSentEvent<String>>`

```java
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.ai.chat.metadata.Usage;
import java.util.concurrent.atomic.AtomicReference;

public Flux<ServerSentEvent<String>> askBasedOnDocumentStream(...) {
    // ... 校验和 Prompt 构建 ...
    
    AtomicReference<Usage> usageRef = new AtomicReference<>();
    
    Flux<ServerSentEvent<String>> contentFlux = chatClient.prompt()
        .system(systemPrompt)
        .user(userPrompt)
        .stream()
        .chatResponse()
        .doOnNext(chunk -> {
            var usage = chunk.getMetadata() != null ? chunk.getMetadata().getUsage() : null;
            if (usage != null) {
                usageRef.set(usage);  // 暂存最后一个 chunk 的 usage
                log.info("[Token] 输入：{} | 输出：{} | 总计：{}",
                    usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
            }
        })
        .map(chunk -> {
            var result = chunk.getResult();
            if (result != null && result.getOutput() != null) {
                return result.getOutput().getText();
            }
            return "";
        })
        .filter(text -> !text.isEmpty())
        .map(text -> ServerSentEvent.<String>builder().data(text).build())
        .onErrorResume(e -> Flux.just(
            ServerSentEvent.<String>builder().data("AI 服务暂时不可用").build()
        ));
    
    // 在内容流末尾追加 token-usage 事件
    return contentFlux.concatWith(Mono.fromCallable(() -> {
        Usage usage = usageRef.get();
        if (usage != null) {
            String json = String.format(
                "{\"prompt\":%d,\"completion\":%d,\"total\":%d}",
                usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens()
            );
            return ServerSentEvent.<String>builder()
                    .event("token-usage")
                    .data(json)
                    .build();
        }
        return null;
    }).filter(Objects::nonNull));
}
```

**关键点**：
- `AtomicReference<Usage>` 暂存最后一个 chunk 的 usage（只有最后一个 chunk 有值）。
- `.concatWith()` 在内容流**彻底结束后**追加 token-usage 事件。
- 如果模型没返回 usage，不追加事件，前端静默跳过。

#### 16.3.2 Controller 层适配

```java
@GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<ServerSentEvent<String>> askDocumentStream(...) {
    // 校验分支也要包装成 ServerSentEvent
    if (question == null || question.trim().isEmpty()) {
        return Flux.just(ServerSentEvent.<String>builder()
                .data("问题不能为空").build());
    }
    // ...
    return aiChatService.askBasedOnDocumentStream(...);
}
```

**注意**：所有 `return Flux.just("字符串")` 都要改成 `Flux.just(ServerSentEvent.<String>builder().data("字符串").build())`，否则类型不匹配。

### 16.4 前端实现

#### 16.4.1 SSE 解析增强

原来的 `fetchStream()` 按行扫描，只识别 `data:`。现在需要按**SSE 事件块**（以 `\n\n` 分隔）解析，区分 `event:` 和 `data:`：

```javascript
async function fetchStream(url, params, onChunk, onTokenUsage, onError) {
    // ... fetch 请求 ...
    
    function processBuffer() {
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop(); // 保留不完整的块
        
        for (const block of blocks) {
            const lines = block.split('\n');
            let eventName = 'message';
            let data = '';
            
            for (const line of lines) {
                if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    data += line.slice(5).trim();
                }
            }
            
            if (!data) continue;
            
            if (eventName === 'token-usage') {
                try {
                    const usage = JSON.parse(data);
                    if (onTokenUsage) onTokenUsage(usage);
                } catch (e) {
                    console.warn('token-usage 解析失败:', data);
                }
            } else {
                onChunk(data);
            }
        }
    }
    
    // 在 while 循环中：buffer += decoder.decode(value, { stream: true });
    // 然后调用 processBuffer();
}
```

#### 16.4.2 Token 用量卡片渲染

```javascript
function renderTokenUsageCard(containerId, usage) {
    const container = document.getElementById(containerId);
    if (!container || !usage) return;
    const cost = (usage.total * 0.0015 / 1000).toFixed(4);
    container.innerHTML = `
        <div class="token-usage-card">
            <span class="token-usage-icon">📊</span>
            <span class="token-usage-text">
                Token | 输入：${usage.prompt} | 输出：${usage.completion} | 总计：${usage.total}
            </span>
            <span class="token-usage-cost">💰 约 ¥${cost}</span>
        </div>
    `;
    container.style.display = 'block';
}
```

调用时机：流结束后 `finally` 块中，如果收到了 `currentUsage` 就渲染。

#### 16.4.3 会话 Token 累计（方案 A）

```javascript
window.sessionTokenTotal = 0; // 页面加载时初始化

function accumulateSessionTokens(tokens) {
    window.sessionTokenTotal += tokens;
    updateSessionTotalDisplay();
}

function updateSessionTotalDisplay() {
    const el = document.getElementById('sessionTotalTokens');
    if (el) {
        el.textContent = window.sessionTokenTotal.toLocaleString() + ' tokens';
    }
}
```

**特点**：纯前端内存累计，刷新页面清零。不依赖后端存储。

### 16.5 页面布局改造

#### 16.5.1 目标

去掉 `.app` 的 `max-width: 1400px` 和 `margin: 0 auto`，让内容横向铺满屏幕。右侧新增 300px 功能面板。

#### 16.5.2 HTML 结构

```html
<div class="main-container">
    <aside class="sidebar">...</aside>
    <main class="content">...</main>
    <aside class="right-panel">
        <div class="right-panel-tabs">
            <button class="tab-btn active" onclick="switchRightPanelTab('userSettings')">
                用户设置
            </button>
            <button class="tab-btn" onclick="switchRightPanelTab('console')">
                功能台
            </button>
        </div>
        <div class="right-panel-content">
            <div id="userSettingsTab" class="tab-panel active">
                <h3>⚙️ 用户设置</h3>
                <div class="token-stat-box">
                    <div class="token-stat-label">本次会话总用量</div>
                    <div class="token-stat-value" id="sessionTotalTokens">0 tokens</div>
                </div>
            </div>
            <div id="consoleTab" class="tab-panel" style="display: none;">
                <h3>🛠️ 功能台</h3>
                <p>功能开发中，敬请期待...</p>
            </div>
        </div>
    </aside>
</div>
```

#### 16.5.3 Tab 切换逻辑

```javascript
function switchRightPanelTab(tabName) {
    const userSettingsTab = document.getElementById('userSettingsTab');
    const consoleTab = document.getElementById('consoleTab');
    const tabUserSettings = document.getElementById('tabUserSettings');
    const tabConsole = document.getElementById('tabConsole');

    if (tabName === 'userSettings') {
        userSettingsTab.style.display = 'block';
        consoleTab.style.display = 'none';
        tabUserSettings.classList.add('active');
        tabConsole.classList.remove('active');
    } else {
        userSettingsTab.style.display = 'none';
        consoleTab.style.display = 'block';
        tabUserSettings.classList.remove('active');
        tabConsole.classList.add('active');
    }
}
```

### 16.6 改动文件清单

| 文件 | 改动 |
|:---|:---|
| `AiChatService.java` | 两个流式方法返回 `Flux<ServerSentEvent<String>>`，末尾追加 `token-usage` 事件 |
| `DocumentController.java` | 流式接口返回类型适配，错误分支包装 `ServerSentEvent` |
| `NotebookController.java` | 同上 |
| `index.html` | 问答区增加 Token 容器；`.main-container` 增加 `.right-panel` |
| `style.css` | `.app` 去掉居中限制；新增右侧面板、Token 卡片样式 |
| `app.js` | SSE 事件块解析、`onTokenUsage` 回调、Token 卡片渲染、会话累计、Tab 切换 |

### 16.7 常见坑

| 坑 | 原因 | 解决 |
|:---|:---|:---|
| `Type mismatch: cannot convert from Flux<String> to Flux<ServerSentEvent<String>>` | Controller 校验分支返回了裸字符串 `Flux.just("...")` | 全部改成 `Flux.just(ServerSentEvent.<String>builder().data("...").build())` |
| 前端收不到 token-usage | SSE 解析还是按行扫描，没按事件块分割 | 重写解析逻辑，按 `\n\n` 分割事件块 |
| 模型没返回 usage | 某些 provider 流式结尾不带 usage | 加 null 检查，不返回时不推事件，前端静默跳过 |

---
