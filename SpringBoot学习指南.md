# Spring Boot 项目学习指南

> 本文档用于系统学习 notebook-clone 项目的 Spring Boot 知识  
> 创建日期：2026-04-06  
> 适合人群：Spring Boot 初学者

---

## 目录

1. [项目整体结构](#第一步-项目整体结构)
2. [各文件夹作用详解](#第二步-各文件夹作用详解)
3. [Java 文件逐个解析](#第三步-java-文件逐个解析)
4. [核心知识点汇总](#第四步-核心知识点汇总)
   - [JPA 派生查询方法](#3-jpa-派生查询方法derived-query-methods)
   - [数据隔离与权限控制（Day 16）](#6-数据隔离与权限控制day-16)
5. [常用注解速查表](#第五步-常用注解速查表)

---

## 第一步：项目整体结构

```
notebook-clone/
├── src/main/java/com/example/notebook_clone/
│   ├── NotebookCloneApplication.java    ← 【入口】程序启动类
│   ├── controller/                      ← 【控制器层】接收 HTTP 请求
│   │   ├── AuthController.java          ← 登录/注册/获取当前用户接口
│   │   ├── TestController.java          ← 测试接口（验证JWT认证）
│   │   ├── DocumentController.java      ← 文档相关接口
│   │   ├── NotebookController.java      ← 笔记本相关接口
│   │   └── UserController.java          ← 用户相关接口
│   ├── service/                         ← 【业务层】处理业务逻辑
│   │   └── AuthService.java             ← 登录/注册业务
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
│   │   └── SecurityConfig.java          ← 安全配置（密码加密、权限、过滤器链）
│   ├── util/                            ← 【工具层】工具类
│   │   └── JwtUtil.java                 ← JWT Token 生成/校验工具
│   └── common/                          ← 【公共层】通用工具
│       ├── GlobalExceptionHandler.java  ← 全局异常处理
│       └── Result.java                  ← 统一返回结果包装
├── src/main/resources/
│   └── application.properties           ← 配置文件
└── pom.xml                              ← Maven 依赖配置
```

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

## 第三步：Java 文件逐个解析

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

## 第四步：核心知识点汇总

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

### 4. 校验注解

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

## 第五步：常用注解速查表

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
| `@EnableWebSecurity` | 启用 Spring Security Web 安全功能 | Config 类 |
| `@RestControllerAdvice` | 全局异常处理 | ExceptionHandler 类 |

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
