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
5. [常用注解速查表](#第五步-常用注解速查表)

---

## 第一步：项目整体结构

```
notebook-clone/
├── src/main/java/com/example/notebook_clone/
│   ├── NotebookCloneApplication.java    ← 【入口】程序启动类
│   ├── controller/                      ← 【控制器层】接收 HTTP 请求
│   │   ├── AuthController.java          ← 登录/注册接口
│   │   ├── DocumentController.java      ← 文档相关接口
│   │   ├── NotebookController.java      ← 笔记本相关接口
│   │   ├── UserController.java          ← 用户相关接口
│   │   └── HelloController.java         ← 测试用 Hello 接口
│   ├── service/                         ← 【业务层】处理业务逻辑
│   │   └── AuthService.java             ← 登录/注册业务
│   ├── repository/                      ← 【数据层】数据库操作
│   │   ├── DocumentRepository.java      ← 文档数据访问
│   │   ├── NotebookRepository.java      ← 笔记本数据访问
│   │   └── UserRepository.java          ← 用户数据访问
│   ├── entity/                          ← 【实体层】数据模型（对应数据库表）
│   │   ├── Document.java                ← 文档实体
│   │   ├── Notebook.java                ← 笔记本实体
│   │   └── User.java                    ← 用户实体
│   ├── config/                          ← 【配置层】Spring 配置
│   │   └── SecurityConfig.java          ← 安全配置（密码加密、权限）
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

### 📁 5. config/ - 配置层

**作用**：配置 Spring Boot 的各种组件

**例子**：
- `SecurityConfig.java`：配置密码加密方式、哪些接口需要登录才能访问

**核心注解**：`@Configuration`, `@Bean`, `@EnableWebSecurity`

---

### 📁 6. common/ - 公共层

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

### 🔹 Config 层

#### `SecurityConfig.java` - 安全配置

```java
@Configuration                                  // ← 配置类
@EnableWebSecurity                             // ← 启用安全功能
public class SecurityConfig {

    @Bean                                       // ← 注册为 Spring Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();     // BCrypt 加密器
    }
```

**知识点**：
- `@Configuration`：标记配置类
- `@Bean`：将方法返回值注册为 Spring 管理的对象
- `PasswordEncoder`：密码加密接口

---

#### `JwtUtil.java` - JWT Token 工具类

```java
@Component                                      // ← Spring 管理的组件
public class JwtUtil {

    @Value("${jwt.secret}")                     // ← 从配置文件读取密钥
    private String secret;

    @Value("${jwt.expiration}")                 // ← 从配置文件读取过期时间
    private Long expiration;

    /**
     * 生成 JWT Token
     */
    public String generateToken(Long userId, String username) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + expiration);

        Map<String, Object> claims = new HashMap<>();
        claims.put("userId", userId);
        claims.put("username", username);

        return Jwts.builder()
                .claims(claims)              // 自定义数据（Payload）
                .subject(username)           // 主题
                .issuedAt(now)               // 签发时间
                .expiration(expiryDate)      // 过期时间
                .signWith(getSigningKey())   // 签名
                .compact();                  // 生成字符串
    }

    /**
     * 从 Token 中提取用户ID
     */
    public Long getUserIdFromToken(String token) {
        Claims claims = parseToken(token);
        return claims.get("userId", Long.class);
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
        } catch (SecurityException e) {
            System.out.println("Token 签名验证失败");
        }
        return false;
    }

    /**
     * 解析 Token
     */
    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 禁用 CSRF
            .csrf(csrf -> csrf.disable())
            
            // 无状态会话（不创建 Session）
            .sessionManagement(session -> 
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            
            // 配置权限
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()    // 放行
                .requestMatchers("/api/users/**").permitAll()   // 放行
                .anyRequest().authenticated()                    // 其他需登录
            );
        
        return http.build();
    }
}
```

**知识点**：
- `@Configuration`：标记配置类
- `@Bean`：将方法返回值注册为 Spring 管理的对象
- `PasswordEncoder`：密码加密接口

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

### 3. 关联关系注解

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
| `@NotBlank` | 非空校验 | Entity 字段 |
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
