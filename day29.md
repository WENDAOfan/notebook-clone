# Day 29: Redis 限流 — 保护你的 AI API 额度

**目标**：用 Redis 实现用户级 AI 问答频率限流（如 10 次/小时），防止用户无限调用 AI，保护 API 额度和费用。

---

## 当前状态

Day 28 完成后，AI 问答已有缓存，相同问题不会重复花钱。但还有一个风险：

```
用户 A（正常使用）：每小时问 5 个问题 → 花费合理
用户 B（恶意/无意）：写个循环每秒调一次 /api/documents/1/ask → 1 小时调用 3600 次 → 账单爆炸！
                                              ↑
                                    没有任何限制！
```

**Day 29 的解决方案**：用 Redis 的计数器 + 过期时间，实现"每个用户每小时最多调用 N 次 AI"。

---

## 步骤 1/5: 认知学习 — 什么是限流（前 10 分钟，不写代码）

### 1.1 为什么要限流

| 场景 | 不限流的后果 |
|:---|:---|
| 用户疯狂调用 AI | API 费用暴涨，DeepSeek 账单可能上百 |
| 程序 Bug 导致死循环调用 | 一次 Bug 可能消耗你一整天的 API 额度 |
| 多人同时使用 | 共享的 API Key 被少数人占满，其他人用不了 |
| 恶意攻击 | 刷接口，拖垮服务器 |

**一句话**：限流不是限制用户，而是保护你的钱包和系统的稳定性。

### 1.2 限流的维度

限流可以按不同维度来限制：

| 维度 | 示例 | 适用场景 |
|:---|:---|:---|
| **全局** | 整个系统每秒最多 100 次 | 保护服务器 |
| **用户级** | 每个用户每小时最多 10 次 | 我们选这个 |
| **IP 级** | 每个 IP 每分钟最多 5 次 | 防爬虫 |
| **接口级** | 某个接口每秒最多 50 次 | 保护核心接口 |

**本项目选择"用户级限流"**——每个登录用户每小时最多调用 AI N 次。这样既保护了 API 额度，又不影响正常使用。

### 1.3 限流算法介绍

有三种常见限流算法，我们选最简单的一种：

#### 固定窗口计数器（我们选这个）

```
时间轴：|---- 第1小时 ----|---- 第2小时 ----|---- 第3小时 ----|
用户A：   ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■
          1 2 3 4 5 6 7 8 9 10 11  ← 第11次被拒绝！
                                        ↑
                              计数器在第2小时自动重置

Redis 实现：
  Key:   ai:ratelimit:{userId}
  Value: 当前计数（如 5）
  TTL:   1 小时（到期自动清零）
```

**优点**：实现最简单，Redis 一个计数器搞定
**缺点**：窗口边界处可能有 2 倍突发流量（第1小时末尾用了10次 + 第2小时开头又用了10次 = 短时间内20次），但对我们的场景影响不大

#### 滑动窗口计数器（更精确但更复杂）

```
把1小时细分为6个10分钟的小窗口，统计最近6个窗口的总和
精确但实现复杂，本项目不需要
```

#### 令牌桶算法（工业级）

```
一个桶以固定速率放入令牌（如每秒放1个），桶满则丢弃
每次请求取一个令牌，桶空则拒绝
允许突发流量（桶里有积累的令牌）
实现较复杂，适合网关级别的限流
```

**本项目用固定窗口就够了**——用户量小，不需要工业级限流。

### 1.4 Redis 实现固定窗口限流的原理

```
用户首次调用 AI：
  1. 检查 Redis 中是否存在 ai:ratelimit:1
  2. 不存在 → 设置 ai:ratelimit:1 = 1，TTL = 1 小时
  3. 允许调用

用户第 N 次调用 AI（N ≤ 10）：
  1. 读取 ai:ratelimit:1 → 值为 N-1
  2. N-1 < 10 → 允许调用
  3. 自增 ai:ratelimit:1 → N

用户第 11 次调用 AI：
  1. 读取 ai:ratelimit:1 → 值为 10
  2. 10 >= 10 → 拒绝调用，返回"请求过于频繁"

1 小时后：
  ai:ratelimit:1 自动过期 → 下次请求重新计数
```

**关键 Redis 命令**：

```redis
# 检查 Key 是否存在
EXISTS ai:ratelimit:1

# 如果不存在，初始化计数器并设置过期时间
SET ai:ratelimit:1 1 EX 3600

# 如果存在，自增计数器
INCR ai:ratelimit:1

# 注意：INCR 后 TTL 不变！过期时间只在 SET 时设置
```

### 1.5 限流和缓存如何协同

```
用户请求 AI 问答
    ↓
检查限流 ──超限──→ 返回"请求过于频繁"（429 Too Many Requests）
    ↓ 未超限
检查缓存 ──命中──→ 直接返回缓存（不消耗限流次数！）
    ↓ 未命中
调用 AI → 返回回答 → 写入缓存 → 限流计数 +1
```

**重要设计决策**：缓存命中时，**不应该消耗限流次数**。因为缓存命中意味着没有调用 AI，没花钱，不应该算作一次 AI 调用。

---

## 步骤 2/5: 创建限流服务类

### 2.1 新建 RateLimitService

新建文件：`notebook-clone/src/main/java/com/example/notebook_clone/service/RateLimitService.java`

```java
package com.example.notebook_clone.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

/**
 * 限流服务
 * 
 * 基于 Redis 的固定窗口计数器实现用户级限流。
 * 每个用户在指定时间窗口内，最多允许调用 AI 多少次。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RateLimitService {

    private final RedisTemplate<String, Object> redisTemplate;

    /** 默认限流：每小时最多 10 次 */
    private static final int DEFAULT_MAX_REQUESTS = 10;
    /** 默认窗口：1 小时 */
    private static final long DEFAULT_WINDOW_SECONDS = 3600;

    /**
     * 检查用户是否超过限流
     *
     * @param userId 用户 ID
     * @return true = 允许调用，false = 超过限流
     */
    public boolean isAllowed(Long userId) {
        return isAllowed(userId, DEFAULT_MAX_REQUESTS, DEFAULT_WINDOW_SECONDS);
    }

    /**
     * 检查用户是否超过限流（可自定义参数）
     *
     * @param userId        用户 ID
     * @param maxRequests   时间窗口内最大请求次数
     * @param windowSeconds 时间窗口（秒）
     * @return true = 允许调用，false = 超过限流
     */
    public boolean isAllowed(Long userId, int maxRequests, long windowSeconds) {
        String key = "ai:ratelimit:" + userId;
        
        // 1. 获取当前计数
        Object countObj = redisTemplate.opsForValue().get(key);
        int currentCount = 0;
        if (countObj != null) {
            // Redis 中存的是数字，反序列化后可能是 Integer 或 Long
            currentCount = ((Number) countObj).intValue();
        }
        
        // 2. 判断是否超限
        if (currentCount >= maxRequests) {
            Long ttl = redisTemplate.getExpire(key, TimeUnit.SECONDS);
            log.warn("[限流] 用户 {} 已达上限 {}/{}次，剩余冷却时间: {}秒",
                    userId, currentCount, maxRequests, ttl);
            return false;
        }
        
        // 3. 计数 +1
        if (currentCount == 0) {
            // 首次请求：设置计数为 1，并设置过期时间
            redisTemplate.opsForValue().set(key, 1, windowSeconds, TimeUnit.SECONDS);
            log.debug("[限流] 用户 {} 首次请求, 计数: 1/{}", userId, maxRequests);
        } else {
            // 非首次：自增计数（TTL 不变）
            redisTemplate.opsForValue().increment(key);
            log.debug("[限流] 用户 {} 计数: {}/{}", userId, currentCount + 1, maxRequests);
        }
        
        return true;
    }

    /**
     * 获取用户当前的限流状态
     *
     * @param userId 用户 ID
     * @return 限流状态信息
     */
    public RateLimitStatus getStatus(Long userId) {
        return getStatus(userId, DEFAULT_MAX_REQUESTS, DEFAULT_WINDOW_SECONDS);
    }

    /**
     * 获取用户当前的限流状态（可自定义参数）
     */
    public RateLimitStatus getStatus(Long userId, int maxRequests, long windowSeconds) {
        String key = "ai:ratelimit:" + userId;
        
        Object countObj = redisTemplate.opsForValue().get(key);
        int currentCount = countObj != null ? ((Number) countObj).intValue() : 0;
        
        Long ttlSeconds = redisTemplate.getExpire(key, TimeUnit.SECONDS);
        if (ttlSeconds == null || ttlSeconds < 0) {
            ttlSeconds = 0L;
        }
        
        return new RateLimitStatus(
            currentCount,
            maxRequests,
            currentCount < maxRequests,
            ttlSeconds
        );
    }

    /**
     * 重置用户的限流计数（管理员功能）
     */
    public void reset(Long userId) {
        String key = "ai:ratelimit:" + userId;
        redisTemplate.delete(key);
        log.info("[限流] 已重置用户 {} 的限流计数", userId);
    }

    /**
     * 限流状态 DTO
     */
    public record RateLimitStatus(
        int currentCount,      // 当前已使用次数
        int maxRequests,       // 最大允许次数
        boolean allowed,       // 是否允许继续调用
        long remainingSeconds  // 窗口剩余秒数（冷却时间）
    ) {}
}
```

**理解 `isAllowed` 方法的逻辑**：

```
isAllowed(userId=1, maxRequests=10, windowSeconds=3600)

第一次调用：Redis 里没有 key
  → currentCount = 0
  → 0 < 10，允许
  → SET key=1, TTL=3600s
  → 返回 true

第二次调用：Redis 里 key=1
  → currentCount = 1
  → 1 < 10，允许
  → INCR key → key=2（TTL 不变，还是大约 3599s）
  → 返回 true

...

第 10 次调用：Redis 里 key=9
  → currentCount = 9
  → 9 < 10，允许
  → INCR key → key=10
  → 返回 true

第 11 次调用：Redis 里 key=10
  → currentCount = 10
  → 10 >= 10，拒绝！
  → 日志：[限流] 用户 1 已达上限 10/10次
  → 返回 false

1 小时后：key 过期自动删除
  → 下次调用又从 0 开始
```

### 2.2 一个重要的细节：并发安全

如果有两个请求**同时**到达，都可能读到 `currentCount=9`，都认为没超限，然后都 +1，最终计数变成 11 而不是 10。

**本项目不处理这个问题**，原因：
1. 个人项目，并发量极低，几乎不会出现
2. 即使偶尔多放行 1~2 次，影响很小
3. 要解决需要用 Redis 的 Lua 脚本保证原子性，复杂度不匹配

如果你好奇工业级做法，核心是用 Lua 脚本把"读计数 + 判断 + 自增"合成一个原子操作：

```lua
-- Lua 脚本（了解即可，本项目不用）
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
if count > tonumber(ARGV[2]) then
    return 0
else
    return 1
end
```

---

## 步骤 3/5: 在 Controller 中加入限流检查

### 3.1 在 DocumentController 中加入限流

打开 `DocumentController.java`，注入 `RateLimitService`，并在 AI 问答接口中加入限流检查。

**注入 RateLimitService**：

```java
private final RateLimitService rateLimitService;  // Day 29 新增

public DocumentController(DocumentRepository documentRepository, NotebookRepository notebookRepository,
        UserRepository userRepository, DocumentExtractService extractService,
        AiSummaryService aiSummaryService, AiChatService aiChatService,
        AsyncSummaryService asyncSummaryService, RedisService redisService,
        RateLimitService rateLimitService) {  // Day 29 新增
    // ... 原有赋值 ...
    this.rateLimitService = rateLimitService;  // Day 29 新增
}
```

**改造 `askDocument` 方法**：

```java
/**
 * 基于单个文档内容进行智能问答
 */
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

    // ===== Day 29 新增：限流检查 =====
    if (!rateLimitService.isAllowed(currentUser.getId())) {
        var status = rateLimitService.getStatus(currentUser.getId());
        return Result.fail("AI 问答次数已达上限（" + status.currentCount() + "/" 
                + status.maxRequests() + "次），请 " + status.remainingSeconds() / 60 
                + " 分钟后再试");
    }
    // ================================

    // 3. 查询文档并校验归属（数据隔离！）
    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));

    if (!document.getUser().getId().equals(currentUser.getId())) {
        throw new RuntimeException("无权访问该文档");
    }

    // 4. 传递开关状态
    boolean useDocumentContext = request.getUseDocumentContext() != null
            ? request.getUseDocumentContext()
            : true;

    // 5. 调用 AI 基于文档内容回答问题
    String answer = aiChatService.askBasedOnDocument(
            document.getContent(),
            request.getQuestion(),
            useDocumentContext,
            document.getId()
    );
    return Result.success(answer);
}
```

### 3.2 在 NotebookController 中加入限流

同样地，在 `NotebookController.java` 中注入并使用 `RateLimitService`。

**注入 RateLimitService**：

```java
private final RateLimitService rateLimitService;  // Day 29 新增

public NotebookController(NotebookRepository notebookRepository, UserRepository userRepository,
        DocumentRepository documentRepository, AiChatService aiChatService,
        RateLimitService rateLimitService) {  // Day 29 新增
    // ... 原有赋值 ...
    this.rateLimitService = rateLimitService;  // Day 29 新增
}
```

**改造 `askNotebook` 方法**：

```java
@PostMapping("/{id}/ask")
public Result<String> askNotebook(@PathVariable Long id, @RequestBody AskRequest request) {
    // 1. 参数校验
    if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
        return Result.fail("问题不能为空");
    }
    // 2. 获取当前用户
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // ===== Day 29 新增：限流检查 =====
    if (!rateLimitService.isAllowed(currentUser.getId())) {
        var status = rateLimitService.getStatus(currentUser.getId());
        return Result.fail("AI 问答次数已达上限（" + status.currentCount() + "/" 
                + status.maxRequests() + "次），请 " + status.remainingSeconds() / 60 
                + " 分钟后再试");
    }
    // ================================

    // 3. 查询笔记本并校验归属（数据隔离！）
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
            request.getQuestion(),
            id
    );
    return Result.success(answer);
}
```

### 3.3 流式接口也要加限流

流式问答同样消耗 AI 调用，也需要限流。但限流检查要在 Flux 创建之前完成，不能放在 Flux 内部。

**DocumentController 的 `askDocumentStream`**：

```java
@GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8")
public Flux<ServerSentEvent<String>> askDocumentStream(
        @PathVariable Long id,
        @RequestParam String question,
        @RequestParam(defaultValue = "true") boolean useDocumentContext) {
    
    // 1. 参数校验
    if (question == null || question.trim().isEmpty()) {
        return Flux.just(ServerSentEvent.<String>builder().data("问题不能为空").build());
    }
    
    // 2. 获取当前用户
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
    
    // ===== Day 29 新增：限流检查 =====
    if (!rateLimitService.isAllowed(currentUser.getId())) {
        return Flux.just(ServerSentEvent.<String>builder()
                .data("AI 问答次数已达上限，请稍后再试")
                .build());
    }
    // ================================
    
    // 3. 查询文档并校验归属
    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));
    if (!document.getUser().getId().equals(currentUser.getId())) {
        return Flux.just(ServerSentEvent.<String>builder().data("无权访问该文档").build());
    }
    
    // 4. 调用流式 Service 方法
    return aiChatService.askBasedOnDocumentStream(
            document.getContent(),
            question,
            useDocumentContext
    );
}
```

**NotebookController 的 `askNotebookStream`**：

```java
@GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8")
public Flux<ServerSentEvent<String>> askNotebookStream(
        @PathVariable Long id,
        @RequestParam String question) {
    
    // 1. question 空校验
    if (question == null || question.trim().isEmpty()) {
        return Flux.just(ServerSentEvent.<String>builder().data("问题不能为空").build());
    }
    
    // 2. 获取当前用户
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // ===== Day 29 新增：限流检查 =====
    if (!rateLimitService.isAllowed(currentUser.getId())) {
        return Flux.just(ServerSentEvent.<String>builder()
                .data("AI 问答次数已达上限，请稍后再试")
                .build());
    }
    // ================================
    
    // 3. 查询笔记本并校验归属
    Notebook notebook = notebookRepository.findByIdAndUserId(id, currentUser.getId())
            .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));
    if (!notebook.getUser().getId().equals(currentUser.getId())) {
        return Flux.just(ServerSentEvent.<String>builder().data("无权访问该文档").build());
    }
    // 4. 获取该笔记本下的所有文档
    List<Document> documents = documentRepository.findByNotebook_Id(id);
    List<String[]> docList = documents.stream()
            .map(doc -> new String[]{doc.getTitle(), doc.getContent()})
            .toList();
    // 5. 调用流式 Service
    return aiChatService.askBasedOnDocumentsStream(
            docList,
            question
    );
}
```

---

## 步骤 4/5: 限流与缓存的协同 — 精细化处理

### 4.1 当前的问题

目前的实现中，限流检查在缓存检查**之前**：

```
请求 → 限流检查（+1）→ 缓存检查 → 命中 → 返回
                                  → 未命中 → 调用 AI
```

这意味着：**即使命中了缓存，限流计数也会 +1**。用户问同一个问题 10 次，虽然 AI 只被调用了 1 次，但限流计数已经满了。

### 4.2 优化：缓存命中不消耗限流次数

我们需要把限流逻辑移到缓存未命中时才计数。这需要修改 `AiChatService`，让限流检查在缓存未命中的时候才执行。

**修改思路**：让 Controller 先检查缓存，缓存命中直接返回；缓存未命中时才检查限流并调用 AI。

但这样 Controller 的逻辑就复杂了。更简单的方案是：**在 `AiChatService` 内部处理**。

### 4.3 改造方案

修改 `AiChatService`，让 `getOrCache` 的 `supplier` 内部包含限流逻辑：

**在 `AiChatService` 中注入 `RateLimitService`**：

```java
private final RateLimitService rateLimitService;  // Day 29 新增

public AiChatService(ChatClient.Builder chatClientBuilder, RedisService redisService, RateLimitService rateLimitService) {
    this.chatClient = chatClientBuilder.build();
    this.redisService = redisService;
    this.rateLimitService = rateLimitService;  // Day 29 新增
}
```

**改造 `askBasedOnDocument` 方法**：

```java
@Retryable(
    retryFor = {RestClientException.class},
    maxAttempts = 3,
    backoff = @Backoff(delay = 1500, multiplier = 1.5)
)
public String askBasedOnDocument(String documentContent, String question, boolean useDocumentContext, Long documentId) {
    if ((documentContent == null || documentContent.trim().isEmpty()) && useDocumentContext) {
        return "文档内容为空，无法回答问题。";
    }

    String cacheKey = buildDocAskCacheKey(documentId, question, useDocumentContext);
    
    // 先只查缓存，不做限流
    Object cached = redisService.get(cacheKey);
    if (cached != null) {
        log.info("[缓存] 命中, 直接返回 | Key: {}", cacheKey);
        return (String) cached;
    }
    
    // 缓存未命中 → 检查限流（这里需要 userId，但 Service 层不应该直接依赖用户上下文）
    // 所以我们换一种方式：限流检查留在 Controller，但改为"缓存未命中时才计数"
    // 详见 4.4 的 Controller 改造
}
```

等等，这里有个问题：`AiChatService` 不知道当前用户是谁，而限流需要 `userId`。

### 4.4 更好的方案：Controller 层先查缓存，再限流

**核心思路**：Controller 层先手动查 Redis 缓存，命中就直接返回（不限流）；未命中时再检查限流并调用 AI。

**修改 `DocumentController.askDocument`**：

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

    // 3. 查询文档并校验归属
    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));
    if (!document.getUser().getId().equals(currentUser.getId())) {
        throw new RuntimeException("无权访问该文档");
    }

    // 4. 传递开关状态
    boolean useDocumentContext = request.getUseDocumentContext() != null
            ? request.getUseDocumentContext()
            : true;

    // ===== Day 29 优化：先查缓存，缓存命中不限流 =====
    // 5. 先查缓存
    String cacheKey = "ai:doc:" + document.getId() + ":ask:" 
            + hashQuestion(request.getQuestion().trim().toLowerCase() + ":" + useDocumentContext);
    Object cached = redisService.get(cacheKey);
    if (cached != null) {
        log.info("[缓存] 命中, 不消耗限流次数 | Key: {}", cacheKey);
        return Result.success((String) cached);
    }
    
    // 6. 缓存未命中 → 检查限流
    if (!rateLimitService.isAllowed(currentUser.getId())) {
        var status = rateLimitService.getStatus(currentUser.getId());
        return Result.fail("AI 问答次数已达上限（" + status.currentCount() + "/" 
                + status.maxRequests() + "次），请 " + status.remainingSeconds() / 60 
                + " 分钟后再试");
    }
    // ==================================================

    // 7. 调用 AI（AiChatService 内部的 getOrCache 会再次检查缓存，但这次肯定命中不了）
    String answer = aiChatService.askBasedOnDocument(
            document.getContent(),
            request.getQuestion(),
            useDocumentContext,
            document.getId()
    );
    return Result.success(answer);
}
```

这样做有个缺点：**Controller 层出现了缓存 Key 的构建逻辑**，和 `AiChatService` 里的 Key 构建逻辑重复了。

### 4.5 最终方案：简洁优先

考虑到项目规模和个人开发的实际情况，**我推荐一个折中方案**：

> **简单做法**：限流检查放在缓存检查之前，缓存命中也消耗限流次数。
> 
> 理由：
> 1. 实现简单，代码清晰
> 2. 缓存命中时响应很快，用户不会感到"被限流了但没用上 AI"
> 3. 10 次/小时的额度对于正常使用完全足够
> 4. 如果用户反复问同一个问题，消耗限流次数也合理——说明他在使用系统
> 5. 后续如果真需要优化，再改也不迟

**最终代码就是步骤 3 中写的版本**——限流在前，缓存在后。简单可靠。

> 💡 **判断标准**：如果用户反馈"缓存命中也算限流太亏了"，再优化不迟。过早优化是万恶之源。

---

## 步骤 5/5: 新增限流状态查询接口 + 测试验证

### 5.1 新增限流状态查询接口

在 `DocumentController` 中（也可以单独建一个 Controller），添加一个查询当前用户限流状态的接口：

```java
/**
 * 查询当前用户的 AI 问答限流状态
 * GET /api/documents/ai/rate-limit-status
 */
@GetMapping("/ai/rate-limit-status")
public Result<RateLimitService.RateLimitStatus> getRateLimitStatus() {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
    
    return Result.success(rateLimitService.getStatus(currentUser.getId()));
}
```

**返回示例**：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "currentCount": 3,
    "maxRequests": 10,
    "allowed": true,
    "remainingSeconds": 2345
  }
}
```

前端可以根据这个信息显示"您还可以提问 7 次"之类的提示。

### 5.2 临时调低限流阈值方便测试

为了方便测试，可以临时把限流阈值调低。修改 `RateLimitService` 的常量：

```java
/** 临时测试：每分钟最多 3 次（测试完改回 10 次/小时） */
private static final int DEFAULT_MAX_REQUESTS = 3;
private static final long DEFAULT_WINDOW_SECONDS = 60;  // 1 分钟
```

**测试完记得改回**：

```java
private static final int DEFAULT_MAX_REQUESTS = 10;
private static final long DEFAULT_WINDOW_SECONDS = 3600;  // 1 小时
```

### 5.3 测试验证

#### 测试 1：正常调用（未超限）

```
POST http://localhost:8080/api/documents/1/ask
Body: {"question": "文档讲了什么？"}
Header: Authorization: Bearer <your-token>

预期：正常返回 AI 回答
后台日志：[限流] 用户 1 首次请求, 计数: 1/3
```

#### 测试 2：连续调用直到超限

```
第1次调用 → 成功，计数 1/3
第2次调用 → 成功，计数 2/3
第3次调用 → 成功，计数 3/3
第4次调用 → 失败！
```

预期返回：

```json
{
  "code": 400,
  "message": "AI 问答次数已达上限（3/3次），请 0 分钟后再试",
  "data": null
}
```

#### 测试 3：查询限流状态

```
GET http://localhost:8080/api/documents/ai/rate-limit-status
Header: Authorization: Bearer <your-token>

预期返回：
{
  "code": 200,
  "data": {
    "currentCount": 3,
    "maxRequests": 3,
    "allowed": false,
    "remainingSeconds": 45
  }
}
```

#### 测试 4：等待过期后恢复

```
等待 1 分钟（或 1 小时，取决于你设的窗口时间）后再次调用
→ 计数器已过期，重新从 0 开始
→ 调用成功
```

#### 测试 5：用 redis-cli 验证

```powershell
docker exec -it my-redis redis-cli

# 查看限流 Key
127.0.0.1:6379> KEYS ai:ratelimit:*
1) "ai:ratelimit:1"

# 查看计数
127.0.0.1:6379> GET ai:ratelimit:1
"3"

# 查看剩余时间
127.0.0.1:6379> TTL ai:ratelimit:1
(integer) 45
```

#### 测试 6：不同用户独立限流

```
用户 A 调用 3 次 → 达到上限
用户 B 调用 → 成功（用户 B 的计数独立）
```

### 5.4 测试完改回正式限流参数

```java
private static final int DEFAULT_MAX_REQUESTS = 10;
private static final long DEFAULT_WINDOW_SECONDS = 3600;  // 1 小时
```

---

## 改动文件总览

| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `RateLimitService.java` | 新建 | 限流服务类，固定窗口计数器实现 |
| `DocumentController.java` | 修改 | 注入 RateLimitService，AI 问答接口加限流检查，新增限流状态查询接口 |
| `NotebookController.java` | 修改 | 注入 RateLimitService，AI 问答接口加限流检查 |
| `AiChatService.java` | 修改 | 注入 RateLimitService（如果采用精细方案） |

---

## 今日知识图谱

```
限流（Rate Limiting）
  ├── 为什么需要限流
  │     ├── 保护 API 额度（省钱）
  │     ├── 防止恶意调用
  │     └── 保证系统稳定性
  ├── 限流维度
  │     ├── 全局限流
  │     ├── 用户级限流 ← 我们选这个
  │     ├── IP 级限流
  │     └── 接口级限流
  ├── 限流算法
  │     ├── 固定窗口计数器 ← 我们选这个
  │     │     ├── 简单：Redis SET + INCR + EXPIRE
  │     │     └── 缺点：窗口边界可能有 2 倍突发
  │     ├── 滑动窗口计数器
  │     │     └── 更精确，但更复杂
  │     └── 令牌桶算法
  │           └── 工业级，允许突发，适合网关
  ├── Redis 实现
  │     ├── Key: ai:ratelimit:{userId}
  │     ├── Value: 调用次数
  │     └── TTL: 窗口时间（到期自动重置）
  └── 限流与缓存的协同
        ├── 简单方案：限流在前，缓存在后（缓存命中也计数）
        └── 精细方案：缓存命中不计数（代码复杂度高）
```

---

## 测试验证清单

### 功能验证
- [ ] 正常调用：AI 问答成功，限流计数 +1
- [ ] 连续调用至超限：返回"次数已达上限"提示
- [ ] 超限后调用：持续被拒绝，直到窗口过期
- [ ] 窗口过期后：计数器重置，可正常调用
- [ ] 限流状态查询接口返回正确的计数和剩余时间
- [ ] 不同用户独立计数，互不影响

### Redis 验证
- [ ] `KEYS ai:ratelimit:*` 能看到限流 Key
- [ ] `GET ai:ratelimit:{userId}` 返回正确计数
- [ ] `TTL ai:ratelimit:{userId}` 显示剩余时间

### 流式接口验证
- [ ] 流式接口也受限流控制
- [ ] 超限时流式接口返回提示消息

---

## 今日复盘 Checklist

- [ ] 理解限流的三种算法：固定窗口、滑动窗口、令牌桶
- [ ] 理解为什么选固定窗口（简单够用，项目规模小）
- [ ] 理解 Redis 实现固定窗口限流的原理（SET + INCR + EXPIRE）
- [ ] 理解限流与缓存的协同关系
- [ ] 理解 `isAllowed` 方法的执行流程
- [ ] 了解并发安全问题和 Lua 脚本方案（了解即可）
- [ ] 理解为什么限流是"用户级"而非"接口级"

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| 限流计数不准确，偶尔多放行 | 并发请求同时读计数，都认为未超限 | 个人项目可忽略；生产环境用 Redis Lua 脚本保证原子性 |
| `redisTemplate.getExpire()` 返回 -1 | Key 存在但没有设置过期时间 | 检查首次 SET 时是否带了 TTL |
| `redisTemplate.getExpire()` 返回 -2 | Key 不存在 | Key 可能已过期或被删除 |
| 限流后 AI 仍然被调用 | 限流检查的位置不对，放在了 AI 调用之后 | 确保限流检查在 `aiChatService.ask*()` 之前 |
| 流式接口限流不生效 | 限流检查放在了 Flux 内部 | 限流检查必须在 Flux 创建之前完成 |
| GenericJackson2JsonRedisSerializer 反序列化数字为 Integer/Long 不确定 | JSON 数字可能反序列化为不同类型 | 使用 `((Number) countObj).intValue()` 统一转换 |
| 重启项目后限流计数丢失 | Redis 数据没有持久化（默认不持久化） | 限流计数丢失是可接受的（重启后计数归零反而更好） |

---

## 后续衔接

Day 29 完成后，Redis 的两大实战场景（缓存 + 限流）都已完成。Day 30 将进入新的领域——**PDF 文件支持**：

- 引入 Apache PDFBox 依赖
- 在 `DocumentExtractService` 中增加 PDF 解析逻辑
- 上传 PDF 文件时自动提取文本内容
- 让 AI 问答支持 PDF 文档

---

## Redis 三天总结

```
Day 27: Redis 入门
  └── Docker 安装 Redis + Spring Boot 集成 + 基本读写

Day 28: 缓存 AI 回答
  └── Cache-Aside 模式 + 问题 Hash 做 Key + 文档变更清缓存

Day 29: 限流保护
  └── 固定窗口计数器 + 用户级限流 + 限流状态查询

Redis 在本项目中的角色：
  不是替代 MySQL，而是作为"加速层"和"保护层"
  ├── 加速：缓存 AI 回答，省 Token 费用
  ├── 保护：限流控制，防止 API 额度被滥用
  └── 未来：还可用于存对话历史（实现多轮上下文）
```
