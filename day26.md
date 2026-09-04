# Day 26: AI 调用健壮化 — 重试机制 + Token 统计

**目标**：给 AI 调用加上两道"保险"——失败自动重试、Token 用量可观测。让 AI 调用从"能用"变成"可靠"。

---

## 当前状态

Day 25 完成后，异步摘要已经正常工作。但 AI 调用仍有两个隐患：

| 隐患 | 现状 | 后果 |
|:---|:---|:---|
| **网络抖动** | AI API 偶尔超时，调用直接失败 | 摘要丢失，用户看到"生成失败" |
| **Token 黑洞** | 不知道每次调用花了多少 Token | 成本不可控，无法做限额 |

**Day 26 的解决方案**：两件事一次搞定。

---

## 步骤 1/3: 认知学习 — "对外部依赖不信任"原则（前 15 分钟）

### 1.1 为什么外部依赖不可信

你的应用依赖 DeepSeek API（外部服务）。外部服务有三个特点：

1. **不可靠**：网络会抖、服务会超时、偶尔会返回 500
2. **不可控**：你不知道它什么时候限流、什么时候涨价
3. **不可见**：调用细节（Token 消耗、响应时间）是黑盒

**架构思维**：对外部依赖抱"不信任"态度，主动加防御层。

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

### 1.2 重试机制

**不是什么情况都应该重试**：

| 错误类型 | 是否重试 | 原因 |
|:---|:---|:---|
| **网络超时** `ReadTimeoutException` | ✅ 重试 | 网络抖动，下次可能成功 |
| **服务端 5xx** | ✅ 重试 | 服务器暂时过载 |
| **服务端 429** (限流) | ⚠️ 延迟重试 | 等几秒再试，避免更频繁触发限流 |
| **客户端 4xx** (参数错误) | ❌ 不重试 | 重试多少次都是错的 |
| **API Key 无效 401** | ❌ 不重试 | 配置问题，重试没用 |

**Spring Retry** 提供声明式重试：

```java
@Retryable(
    retryFor = {RestClientException.class, TimeoutException.class},  // 哪些异常重试
    maxAttempts = 3,          // 最多试 3 次
    backoff = @Backoff(delay = 1000)  // 每次间隔 1 秒（逐渐加长）
)
public String generateSummary(String content) { ... }
```

### 1.3 Token 统计

每次 AI 调用后，记录三个数：

```
输入 Token（Prompt）+ 输出 Token（生成的回答）= 总 Token
```

以 DeepSeek 当前价格为例：
- 输入：约 ¥0.001 / 1K tokens
- 输出：约 ¥0.002 / 1K tokens

一次摘要生成大约消耗 2000~5000 tokens，成本约 ¥0.005~0.01。**单次很便宜，但 1000 次就是 ¥5~10**。不做统计就不知道花了多少钱。

---

## 步骤 2/3: 引入 Spring Retry + AOP 依赖

### 2.1 添加 Maven 依赖

在 `pom.xml` 的 `<dependencies>` 中新增：

```xml
<!-- ===== Day 26 新增：Spring Retry 重试机制 ===== -->
<dependency>
    <groupId>org.springframework.retry</groupId>
    <artifactId>spring-retry</artifactId>
</dependency>

<!-- Spring AOP（@Retryable 底层依赖 AOP 切面） -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aop</artifactId>
</dependency>
<!-- =============================================== -->
```

### 2.2 启动类加 @EnableRetry

在 `NotebookCloneApplication.java` 上添加 `@EnableRetry`：

```java
@SpringBootApplication
@EnableAsync
@EnableRetry  // Day 26 新增：开启重试支持
public class NotebookCloneApplication {
    // ...
}
```

**注意**：Spring Retry 和 @Async 一样，底层也用 AOP 代理。加了 `@EnableRetry` 后 Spring 才能识别 `@Retryable` 注解。

---

## 步骤 3/3: 改造 AiSummaryService — 加重试 + Token 统计

### 3.1 理解 Spring Retry 的注解

```java
@Retryable(
    value = {RestClientException.class, TimeoutException.class},
    maxAttempts = 3,
    backoff = @Backoff(delay = 1500, multiplier = 1.5)
)
```

**参数说明**：

| 参数 | 含义 | Day 26 取值 |
|:---|:---|:---|
| `value` / `retryFor` | 哪些异常触发重试 | `RestClientException.class`（网络/超时） |
| `maxAttempts` | 总共执行几次（含第一次） | 3（失败后再试 2 次） |
| `delay` | 两次之间的间隔（ms） | 1500（1.5 秒） |
| `multiplier` | 间隔倍数（1.5 = 第 2 次等 1.5s，第 3 次等 2.25s） | 1.5（退避策略，避免压垮服务器） |

### 3.2 改造 generateSummary 方法

在 `AiSummaryService.java` 的 `generateSummary` 方法上加 `@Retryable`：

```java
@Service
public class AiSummaryService {

    private final ChatClient chatClient;

    public AiSummaryService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    @Retryable(
        retryFor = {RestClientException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1500, multiplier = 1.5)
    )
    public String generateSummary(String content) {
        // ... 原有逻辑不变 ...
    }

    // 兜底：全部重试失败后的降级方法
    @Recover
    public String generateSummaryRecover(RestClientException e, String content) {
        log.error("摘要生成失败（已重试 3 次）: {}", e.getMessage());
        return "摘要生成失败，请稍后重试";
    }
}
```

**`@Recover` 注解的作用**：当 `@Retryable` 方法重试全部失败后，自动调用同类的 `@Recover` 方法作为兜底。方法签名要匹配：
- 第一个参数是异常类型
- 后面的参数和 `@Retryable` 方法一致

### 3.3 Token 用量统计（轻量版）

目前 DeepSeek API 通过 OpenAI 兼容接口调用，返回体中包含 `usage` 字段。Spring AI 的 `ChatResponse` 对象提供了：

```java
// ChatResponse 中包含 Token 信息
ChatResponse response = chatClient.prompt()
    .system(...)
    .user(...)
    .call()
    .chatResponse();  // 注意：用 .chatResponse() 而不是 .content()

// 获取 Token 用量
Usage usage = response.getMetadata().getUsage();
int inputTokens = (int) usage.getPromptTokens();     // 输入 Token
int outputTokens = (int) usage.getGenerationTokens(); // 输出 Token
long totalTokens = usage.getTotalTokens();            // 总 Token
```

**但对于 Day 26，先做简单的日志级统计**，不建数据表——后续 Day 29 限流时再建存储表：

```java
// 在原来 .call().content() 的位置，改成两步调用
var chatResponse = chatClient.prompt()
    .system(...)
    .user(...)
    .call()
    .chatResponse();

String summary = chatResponse.getResult().getOutput().getContent();

// 记录 Token 用量
var usage = chatResponse.getMetadata().getUsage();
if (usage != null) {
    log.info("[Token] 摘要生成 | 输入: {} | 输出: {} | 总计: {}",
        usage.getPromptTokens(), usage.getGenerationTokens(), usage.getTotalTokens());
}

return summary;
```

> ⚠️ **注意**：你的 `AiChatService` 用 `.call().content()` 直接拿字符串，需要改成 `.call().chatResponse()` 才能拿到 Usage。这涉及 `AiChatService` 中多个方法的改动。

---

## 改造范围总览

| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `pom.xml` | 加依赖 | `spring-retry` + `spring-boot-starter-aop` |
| `NotebookCloneApplication.java` | 加注解 | `@EnableRetry` |
| `AiSummaryService.java` | 改方法 | 加 `@Retryable` + `@Recover` + Token 日志 |
| `AiChatService.java` | 改方法 | Token 日志（可选） |

---

## 测试验证

### 测试 1：重试生效
- 临时把 DeepSeek API 的 URL 改错（模拟网络故障）
- 观察日志：应该看到 3 次重试日志，最后触发 `@Recover` 兜底返回

### 测试 2：Token 统计
- 正常上传文档，等摘要生成
- 观察后端日志：看到 `[Token]` 开头的 Token 用量记录

---

## 今日复盘 Checklist

- [ ] 理解"对外部依赖不信任"的架构思维
- [ ] 理解哪些异常该重试、哪些不该重试
- [ ] 理解 `@Retryable` 的退避策略（backoff + multiplier）
- [ ] 理解 `@Recover` 兜底机制
- [ ] `spring-retry` 和 `spring-boot-starter-aop` 依赖已添加
- [ ] `@EnableRetry` 已添加到启动类
- [ ] `AiSummaryService.generateSummary()` 加了 `@Retryable` + Token 日志
- [ ] Token 日志能看到每次调用的输入/输出/总计

---

## 踩坑记录（常见错误）

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| `@Retryable` 不生效 | 没加 `@EnableRetry` 或没引入 AOP 依赖 | 启动类加注解 + pom.xml 加 `spring-boot-starter-aop` |
| `@Recover` 没被调用 | 返回值类型不匹配（`@Recover` 返回 void 但 `@Retryable` 返回 String） | 确保返回值类型一致 |
| `ChatResponse.getMetadata().getUsage()` 返回 null | DeepSeek 某些场景不返回 usage | 加 null 检查，不报错即可 |

---

## 后续衔接

Day 26 完成后，AI 调用具备了基本的健壮性。Day 27 将进入**第四阶段**：

- **Day 27**：安装 Redis（Docker），Spring Boot 集成 Redis
- **Day 28**：缓存 AI 回答——相同问题直接返回缓存，省 Token 省时间

> 📚 **扩展阅读**：
> - Spring Retry 官方文档：[spring.io/projects/spring-retry](https://spring.io/projects/spring-retry)
> - 退避策略详解：线性退避 vs 指数退避 vs 随机退避
