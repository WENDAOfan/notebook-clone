# Day 28: 缓存 AI 回答 — 让重复问题零成本

**目标**：用 Redis 缓存 AI 的回答，相同文档 + 相同问题直接返回缓存，不调用大模型，省钱省时间。

---

## 当前状态

Day 27 完成后，Redis 已经跑起来了，Spring Boot 能正常读写 Redis。但 AI 问答还没用上缓存：

```
用户问："这篇文档主要讲了什么？" → 调用 DeepSeek → 花 2000 Token → 返回回答
用户刷新页面，又问："这篇文档主要讲了什么？" → 又调用 DeepSeek → 又花 2000 Token → 返回几乎一样的回答
                                          ↑
                                    浪费！文档没变、问题没变，回答也几乎不变
```

**Day 28 的解决方案**：在 `AiChatService` 中加入缓存层——先查 Redis，命中就直接返回，不命中才调用 AI。

---

## 步骤 1/5: 认知学习 — 缓存的核心问题（前 10 分钟，不写代码）

### 1.1 什么情况下缓存有效？

回顾之前讨论过的关键点：**你的项目是"无状态"问答**——每次调用 AI 都不携带对话历史。这意味着：

```
输入确定 = 文档内容 + 问题 + useDocumentContext 开关
输出确定 = AI 的回答（有微小随机性，但核心内容一致）
```

在这种无状态下，**相同输入 → 高概率相同输出**，缓存命中率很高。

但如果是多轮对话（有上下文），缓存就不适用了：

```
第1轮："Spring Boot 是什么？" → AI 回答 A
第2轮："能更详细解释吗？" → AI 回答 B（B 依赖 A 的上下文）

如果缓存第2轮的输入"能更详细解释吗？"，下次单独问这句话，AI 不知道上下文，回答完全不同
→ 缓存就错了
```

**结论**：你的项目当前是无状态的，非常适合缓存。

### 1.2 缓存 Key 怎么设计？

缓存 Key 必须能**唯一标识**一次问答的输入。我们的 Key 设计：

```
ai:doc:{documentId}:ask:{questionHash}
```

| 部分 | 含义 | 为什么需要 |
|:---|:---|:---|
| `ai` | 业务域 | 区分 AI 缓存和其他缓存 |
| `doc` | 子域 | 区分单文档问答和笔记本问答 |
| `{documentId}` | 文档 ID | 文档不同，回答不同 |
| `ask` | 操作类型 | 区分问答和摘要 |
| `{questionHash}` | 问题的哈希值 | 问题不同，回答不同 |

**为什么不直接用问题原文做 Key？**

```
❌ ai:doc:42:ask:Spring Boot 是什么？
   问题1：Redis Key 不能含空格和特殊字符（虽然技术上可以，但容易出问题）
   问题2：问题可能很长，几百字，Key 太长影响性能
   问题3：大小写、标点微小差异导致 Key 不同，"Spring Boot是什么？" 和 "Spring Boot 是什么？" 是两个 Key

✅ ai:doc:42:ask:a1b2c3d4
   问题做 SHA-256 哈希后取前 8 位，固定长度，问题内容一样则 Hash 一样
```

**为什么不用文档内容做 Key 的一部分？**

```
文档内容可能几万字，放进 Key 不现实
文档 ID 已经能唯一标识一篇文档了（文档内容变了 → 应该清除该文档的缓存）
```

### 1.3 笔记本级问答的 Key 设计

笔记本级问答拼接了多篇文档，Key 设计不同：

```
ai:notebook:{notebookId}:ask:{questionHash}
```

**注意**：笔记本下的文档可能被增删改，所以缓存 TTL 要短一些，或者文档变动时清除相关缓存。

### 1.4 三个缓存经典问题

| 问题 | 含义 | 本项目如何应对 |
|:---|:---|:---|
| **缓存穿透** | 查一个根本不存在的数据，缓存没有，DB 也没有，每次请求都打到 DB | AI 回答不存在"查不到"的情况，每次调用都有返回值，不存在穿透 |
| **缓存击穿** | 一个热点 Key 过期的瞬间，大量请求同时打到 DB | 项目用户量小，不会出现；加互斥锁可防 |
| **缓存雪崩** | 大量 Key 同时过期，瞬间大量请求打到 DB | 给 TTL 加随机偏移，不设同一过期时间 |

**本项目规模小，这三个问题基本不会遇到**，但概念要理解。

---

## 步骤 2/5: 改造 RedisService — 增加缓存专用方法

### 2.1 在 RedisService 中增加缓存方法

打开 `notebook-clone/src/main/java/com/example/notebook_clone/service/RedisService.java`，在现有代码的基础上，增加缓存专用方法：

```java
// ========== 缓存专用方法 ==========

/**
 * 读取缓存，如果不存在则通过 supplier 获取数据并写入缓存
 * 这叫"Cache-Aside"模式——最常用的缓存策略
 *
 * @param key      缓存键
 * @param timeout  过期时间
 * @param unit     时间单位
 * @param supplier 缓存未命中时的数据获取函数（调用 AI）
 * @return 缓存或新获取的数据
 */
public <T> T getOrCache(String key, long timeout, TimeUnit unit, java.util.function.Supplier<T> supplier) {
    // 1. 先查缓存
    Object cached = redisTemplate.opsForValue().get(key);
    if (cached != null) {
        log.debug("[Redis] 缓存命中: {}", key);
        @SuppressWarnings("unchecked")
        T result = (T) cached;
        return result;
    }

    // 2. 缓存未命中，调用 supplier 获取数据
    log.debug("[Redis] 缓存未命中: {}, 调用数据源", key);
    T value = supplier.get();

    // 3. 写入缓存
    if (value != null) {
        redisTemplate.opsForValue().set(key, value, timeout, unit);
        log.debug("[Redis] 写入缓存: {} (TTL: {} {})", key, timeout, unit);
    }

    return value;
}

/**
 * 按前缀删除缓存（用于文档内容变更时清除相关缓存）
 *
 * @param pattern Key 的前缀模式，如 "ai:doc:42:*"
 */
public void deleteByPattern(String pattern) {
    var keys = redisTemplate.keys(pattern);
    if (keys != null && !keys.isEmpty()) {
        redisTemplate.delete(keys);
        log.debug("[Redis] 批量删除: {}, 共 {} 个", pattern, keys.size());
    }
}
```

**理解 `getOrCache` 方法**——这是整个缓存的核心逻辑：

```
getOrCache("ai:doc:42:ask:a1b2c3d4", 1, HOURS, () -> {
    // 只有缓存未命中时，才会执行这里的代码
    return aiChatService.callDeepSeek(...);
})

执行流程：
1. 查 Redis → 有 → 直接返回（不执行 lambda）
2. 查 Redis → 没有 → 执行 lambda → 拿到结果 → 存入 Redis → 返回
```

`Supplier<T>` 是 Java 8 的函数式接口，代表"一个无参但有返回值的函数"。用它的好处是：**缓存命中时，不会执行 AI 调用**。如果直接传值，AI 调用在传参之前就已经执行了。

### 2.2 完整的 RedisService 代码

修改后的 `RedisService.java` 完整内容：

```java
package com.example.notebook_clone.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

/**
 * Redis 服务类
 * 
 * 封装 RedisTemplate 的常用操作，让业务代码更简洁。
 * 所有 Redis 操作都通过这个类统一管理。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RedisService {

    private final RedisTemplate<String, Object> redisTemplate;

    // ========== 基本读写 ==========

    /**
     * 存入缓存（永不过期）
     */
    public void set(String key, Object value) {
        redisTemplate.opsForValue().set(key, value);
        log.debug("[Redis] SET {} = {}", key, value);
    }

    /**
     * 存入缓存（带过期时间）
     */
    public void set(String key, Object value, long timeout, TimeUnit unit) {
        redisTemplate.opsForValue().set(key, value, timeout, unit);
        log.debug("[Redis] SET {} = {} (TTL: {} {})", key, value, timeout, unit);
    }

    /**
     * 读取缓存
     */
    public Object get(String key) {
        return redisTemplate.opsForValue().get(key);
    }

    /**
     * 读取缓存（带类型转换）
     */
    @SuppressWarnings("unchecked")
    public <T> T get(String key, Class<T> clazz) {
        Object value = redisTemplate.opsForValue().get(key);
        if (value == null) {
            return null;
        }
        return (T) value;
    }

    /**
     * 删除缓存
     */
    public Boolean delete(String key) {
        Boolean result = redisTemplate.delete(key);
        log.debug("[Redis] DEL {} → {}", key, result);
        return result;
    }

    // ========== 缓存判断 ==========

    /**
     * 判断缓存是否存在
     */
    public Boolean hasKey(String key) {
        return redisTemplate.hasKey(key);
    }

    /**
     * 设置过期时间
     */
    public Boolean expire(String key, long timeout, TimeUnit unit) {
        return redisTemplate.expire(key, timeout, unit);
    }

    /**
     * 获取剩余过期时间（秒）
     */
    public Long getExpire(String key) {
        return redisTemplate.getExpire(key);
    }

    // ========== 缓存专用方法 ==========

    /**
     * 读取缓存，如果不存在则通过 supplier 获取数据并写入缓存
     * Cache-Aside 模式——最常用的缓存策略
     *
     * @param key      缓存键
     * @param timeout  过期时间
     * @param unit     时间单位
     * @param supplier 缓存未命中时的数据获取函数
     * @return 缓存或新获取的数据
     */
    public <T> T getOrCache(String key, long timeout, TimeUnit unit, java.util.function.Supplier<T> supplier) {
        Object cached = redisTemplate.opsForValue().get(key);
        if (cached != null) {
            log.debug("[Redis] 缓存命中: {}", key);
            @SuppressWarnings("unchecked")
            T result = (T) cached;
            return result;
        }

        log.debug("[Redis] 缓存未命中: {}, 调用数据源", key);
        T value = supplier.get();

        if (value != null) {
            redisTemplate.opsForValue().set(key, value, timeout, unit);
            log.debug("[Redis] 写入缓存: {} (TTL: {} {})", key, timeout, unit);
        }

        return value;
    }

    /**
     * 按前缀删除缓存（用于文档内容变更时清除相关缓存）
     *
     * @param pattern Key 的前缀模式，如 "ai:doc:42:*"
     */
    public void deleteByPattern(String pattern) {
        var keys = redisTemplate.keys(pattern);
        if (keys != null && !keys.isEmpty()) {
            redisTemplate.delete(keys);
            log.debug("[Redis] 批量删除: {}, 共 {} 个", pattern, keys.size());
        }
    }
}
```

---

## 步骤 3/5: 改造 AiChatService — 加入缓存逻辑

### 3.1 注入 RedisService

在 `AiChatService.java` 中注入 `RedisService`：

```java
@Slf4j
@Service
public class AiChatService {

    private final ChatClient chatClient;
    private final RedisService redisService;  // ← Day 28 新增

    public AiChatService(ChatClient.Builder chatClientBuilder, RedisService redisService) {
        this.chatClient = chatClientBuilder.build();
        this.redisService = redisService;  // ← Day 28 新增
    }
```

### 3.2 添加缓存 Key 生成方法

在 `AiChatService.java` 的私有方法区域，添加 Key 生成和问题哈希方法：

```java
// ========== Day 28 新增：缓存 Key 生成 ==========

/** 缓存过期时间：1 小时 */
private static final long CACHE_TTL_HOURS = 1;

/**
 * 生成单文档问答的缓存 Key
 * 格式：ai:doc:{documentId}:ask:{questionHash}
 */
private String buildDocAskCacheKey(Long documentId, String question, boolean useDocumentContext) {
    String raw = question.trim().toLowerCase() + ":" + useDocumentContext;
    String hash = hashQuestion(raw);
    return "ai:doc:" + documentId + ":ask:" + hash;
}

/**
 * 生成笔记本级问答的缓存 Key
 * 格式：ai:notebook:{notebookId}:ask:{questionHash}
 */
private String buildNotebookAskCacheKey(Long notebookId, String question) {
    String raw = question.trim().toLowerCase();
    String hash = hashQuestion(raw);
    return "ai:notebook:" + notebookId + ":ask:" + hash;
}

/**
 * 对问题文本做哈希（SHA-256 取前 8 位）
 * 同一个问题 → 同一个 Hash；大小写、空格差异会被统一
 */
private String hashQuestion(String question) {
    try {
        var digest = java.security.MessageDigest.getInstance("SHA-256");
        byte[] hashBytes = digest.digest(question.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        // 转为 16 进制字符串，取前 8 位
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 4; i++) {  // 取前 4 字节 = 8 个十六进制字符
            sb.append(String.format("%02x", hashBytes[i]));
        }
        return sb.toString();
    } catch (java.security.NoSuchAlgorithmException e) {
        // SHA-256 是 Java 标准库必定支持的算法，不会走到这里
        return String.valueOf(question.hashCode());
    }
}
```

**为什么 `hashQuestion` 里要做 `trim().toLowerCase()`？**

```
用户输入1："Spring Boot 是什么？"
用户输入2："spring boot 是什么？"
用户输入3："Spring Boot 是什么？  "（尾部多了空格）

这三个问题语义完全一样，但原文不同。如果不统一，会产生 3 个不同的缓存 Key。
trim() 去掉首尾空格 + toLowerCase() 统一小写 → 3 个输入变成同一个字符串 → 同一个 Hash → 命中同一个缓存
```

### 3.3 改造单文档问答方法（同步版）

将 `askBasedOnDocument` 方法改造为带缓存的版本。**关键变化**：方法签名增加 `documentId` 参数，用于构建缓存 Key。

**改造前**（当前代码）：
```java
public String askBasedOnDocument(String documentContent, String question, boolean useDocumentContext) {
    // ... 直接调用 AI ...
}
```

**改造后**：
```java
/**
 * 基于单个文档内容回答用户问题（带缓存）
 *
 * @param documentContent   文档内容
 * @param question          用户问题
 * @param useDocumentContext 是否基于文档内容进行回答
 * @param documentId        文档 ID（用于构建缓存 Key）
 * @return AI 基于文档内容的回答
 */
@Retryable(
    retryFor = {RestClientException.class},
    maxAttempts = 3,
    backoff = @Backoff(delay = 1500, multiplier = 1.5)
)
public String askBasedOnDocument(String documentContent, String question, boolean useDocumentContext, Long documentId) {
    // 如果文档内容为空，且用户要求基于文档回答
    if ((documentContent == null || documentContent.trim().isEmpty()) && useDocumentContext) {
        return "文档内容为空，无法回答问题。";
    }

    // ===== Day 28 新增：缓存逻辑 =====
    String cacheKey = buildDocAskCacheKey(documentId, question, useDocumentContext);
    return redisService.getOrCache(cacheKey, CACHE_TTL_HOURS, TimeUnit.HOURS, () -> {
        // 以下代码只在缓存未命中时执行
        log.info("[缓存] 未命中, 调用 AI | Key: {}", cacheKey);
        return askBasedOnDocumentFromAi(documentContent, question, useDocumentContext);
    });
}

/**
 * 实际调用 AI 的方法（从原 askBasedOnDocument 中提取）
 * 缓存未命中时才调用
 */
private String askBasedOnDocumentFromAi(String documentContent, String question, boolean useDocumentContext) {
    // 如果内容超过 8000 字，截断
    String context = documentContent != null && documentContent.length() > 8000
            ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
            : documentContent;

    String systemPrompt = useDocumentContext
            ? """
              你是一位知识库问答助手。请严格遵循以下规则：
              1. 只基于用户提供的【文档内容】回答问题
              2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
              3. 回答要简洁，控制在 300 字以内
              4. 不要添加文档中没有的信息
              """
            : """
              你是一位通用知识问答助手。请遵循以下规则：
              1. 基于你的知识库回答用户问题
              2. 回答要简洁，控制在 300 字以内
              3. 如果不确定，如实说明
              """;

    String userPrompt = useDocumentContext && context != null
            ? """
              【文档内容】
              %s

              【用户问题】
              %s
              """.formatted(context, question)
            : question;

    ChatResponse chatResponse = chatClient.prompt()
        .system(systemPrompt)
        .user(userPrompt)
        .call()
        .chatResponse();

    String answer = chatResponse.getResult().getOutput().getText();
    var usage = chatResponse.getMetadata().getUsage();
    if (usage != null) {
        log.info("[Token] 单文档问答 | 文档长度: {} | 输入: {} | 输出: {} | 总计: {}",
            documentContent != null ? documentContent.length() : 0,
            usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
    }
    return answer;
}
```

**注意**：`@Retryable` 注解仍然在 `askBasedOnDocument` 上。因为 `getOrCache` 内部的 lambda 调用了 `askBasedOnDocumentFromAi`，而重试逻辑包裹在外层方法上，如果 AI 调用失败，会触发重试。但有一个问题——**缓存未命中 + AI 调用失败时，`getOrCache` 不会缓存失败结果**，因为 `supplier.get()` 抛异常时，后面的 `set` 不会执行。下次请求会再次尝试调用 AI，这是正确的行为。

### 3.4 改造笔记本级问答方法（同步版）

同样改造 `askBasedOnDocuments`，增加 `notebookId` 参数：

```java
/**
 * 基于笔记本内多篇文档内容回答用户问题（带缓存）
 *
 * @param documents   文档列表，每个元素是 [标题, 内容] 的数组
 * @param question    用户问题
 * @param notebookId  笔记本 ID（用于构建缓存 Key）
 * @return AI 基于所有文档内容的综合回答
 */
@Retryable(
    retryFor = {RestClientException.class},
    maxAttempts = 3,
    backoff = @Backoff(delay = 1500, multiplier = 1.5)
)
public String askBasedOnDocuments(List<String[]> documents, String question, Long notebookId) {
    // 如果没有文档
    if (documents == null || documents.isEmpty()) {
        return "该笔记本下没有文档，无法回答问题。";
    }

    // ===== Day 28 新增：缓存逻辑 =====
    String cacheKey = buildNotebookAskCacheKey(notebookId, question);
    return redisService.getOrCache(cacheKey, CACHE_TTL_HOURS, TimeUnit.HOURS, () -> {
        log.info("[缓存] 未命中, 调用 AI | Key: {}", cacheKey);
        return askBasedOnDocumentsFromAi(documents, question);
    });
}

/**
 * 实际调用 AI 的方法（从原 askBasedOnDocuments 中提取）
 */
private String askBasedOnDocumentsFromAi(List<String[]> documents, String question) {
    // 原来的文档拼接逻辑，原封不动搬过来
    StringBuilder contextBuilder = new StringBuilder();
    int totalLength = 0;
    final int MAX_LENGTH = 50000;
    boolean truncated = false;

    for (String[] doc : documents) {
        String title = doc[0];
        String content = doc[1];

        if (content == null || content.trim().isEmpty()) {
            continue;
        }

        String docSection = "\n【文档：" + title + "】\n" + content.trim() + "\n";

        if (totalLength + docSection.length() > MAX_LENGTH) {
            int remaining = MAX_LENGTH - totalLength;
            if (remaining > 100) {
                String partial = docSection.substring(0, remaining);
                contextBuilder.append(partial).append("\n...（内容已截断）");
                totalLength = MAX_LENGTH;
            }
            truncated = true;
            break;
        } else {
            contextBuilder.append(docSection);
            totalLength += docSection.length();
        }
    }

    String context = contextBuilder.toString();
    if (context.isEmpty()) {
        return "该笔记本下的文档内容均为空，无法回答问题。";
    }

    if (truncated) {
        context += "\n...（更多文档内容因长度限制未纳入上下文）";
    }

    ChatResponse chatResponse = chatClient.prompt()
    .system("""
            你是一位知识库问答助手。请严格遵循以下规则：
            1. 只基于用户提供的【文档内容】回答问题
            2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
            3. 回答要简洁，控制在 300 字以内
            4. 不要添加文档中没有的信息
            5. 如果有多篇文档，综合各篇文档的信息进行回答
            """)
    .user("""
            【文档内容】    
            %s
            【用户问题】
            %s
            """.formatted(context, question))
    .call()
    .chatResponse();

    String answer = chatResponse.getResult().getOutput().getText();
    var usage = chatResponse.getMetadata().getUsage();
    if (usage != null) {
        log.info("[Token] 多文档问答 | 文档数: {} | 上下文长度: {} | 输入: {} | 输出: {} | 总计: {}",
            documents.size(), context.length(),
            usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
    }

    return answer;
}
```

### 3.5 关于流式方法——暂不加缓存

流式方法（`askBasedOnDocumentStream`、`askBasedOnDocumentsStream`）**暂不加缓存**，原因：

1. 流式返回的是 `Flux<ServerSentEvent<String>>`，不能直接存入 Redis（需要等所有 chunk 收集完毕才能缓存）
2. 流式的核心价值是"实时打字机效果"，用户更看重即时性而非缓存
3. 前端已经实现了流式展示，如果命中缓存一次性返回全部文本，体验反而突兀

**后续可以优化**：收集流式响应的完整文本后异步写入缓存，下次非流式请求可命中。但这增加了复杂度，先不做。

---

## 步骤 4/5: 改造 Controller — 传递 documentId / notebookId

由于 `AiChatService` 的方法签名变了（新增 `documentId` / `notebookId` 参数），Controller 层也需要同步修改。

### 4.1 改造 DocumentController

打开 `DocumentController.java`，修改 `askDocument` 方法：

**改造前**：
```java
String answer = aiChatService.askBasedOnDocument(
        document.getContent(),
        request.getQuestion(),
        useDocumentContext
);
```

**改造后**：
```java
// 5. 调用 AI 基于文档内容回答问题（Day 28：传入 documentId 用于缓存）
String answer = aiChatService.askBasedOnDocument(
        document.getContent(),
        request.getQuestion(),
        useDocumentContext,
        document.getId()  // ← 新增：传入文档 ID
);
```

### 4.2 改造 NotebookController

打开 `NotebookController.java`，修改 `askNotebook` 方法：

**改造前**：
```java
String answer = aiChatService.askBasedOnDocuments(
        docList,
        request.getQuestion()
);
```

**改造后**：
```java
// 6. 调用 AI 基于多篇文档回答（Day 28：传入 notebookId 用于缓存）
String answer = aiChatService.askBasedOnDocuments(
        docList,
        request.getQuestion(),
        id  // ← 新增：传入笔记本 ID
);
```

### 4.3 修改 @Recover 方法

`@Recover` 方法的签名也需要和 `@Retryable` 方法保持一致。修改两个 Recover 方法：

```java
@Recover
public String askBasedOnDocumentRecover(RestClientException e, String documentContent, String question, boolean useDocumentContext, Long documentId) {
    log.error("[重试] 单文档问答失败，已重试 3 次: {}", e.getMessage());
    return "AI 服务暂时不可用，请稍后重试";
}

@Recover
public String askBasedOnDocumentsRecover(RestClientException e, List<String[]> documents, String question, Long notebookId) {
    log.error("[重试] 多文档问答失败，已重试 3 次: {}", e.getMessage());
    return "AI 服务暂时不可用，请稍后重试";
}
```

---

## 步骤 5/5: 文档变更时清除缓存 + 测试验证

### 5.1 文档内容变更时清除缓存

当文档被编辑或删除时，与该文档相关的缓存应该失效。在 `DocumentController.java` 的删除方法中，加入缓存清除逻辑：

**在 `DocumentController` 中注入 `RedisService`**：

```java
private final RedisService redisService;  // Day 28 新增

public DocumentController(DocumentRepository documentRepository, NotebookRepository notebookRepository,
        UserRepository userRepository, DocumentExtractService extractService,
        AiSummaryService aiSummaryService, AiChatService aiChatService,
        AsyncSummaryService asyncSummaryService, RedisService redisService) {
    // ... 原有赋值 ...
    this.redisService = redisService;  // Day 28 新增
}
```

**在 `deleteDocument` 方法末尾加一行**：

```java
@DeleteMapping("/{id}")
public Result<Void> deleteDocument(@PathVariable Long id) {
    // ... 原有权限校验代码不变 ...
    
    documentRepository.deleteById(id);
    
    // ===== Day 28 新增：清除该文档相关的 AI 问答缓存 =====
    redisService.deleteByPattern("ai:doc:" + id + ":*");
    // ====================================================
    
    return Result.success(null);
}
```

**为什么删除时要清缓存？**

```
文档 ID=42 的缓存：
  ai:doc:42:ask:a1b2c3d4 → "Spring Boot 是一个框架..."
  ai:doc:42:ask:e5f6g7h8 → "文档主要讲了..."

文档被删除后，这些缓存无意义了（文档都不存在了）
如果不清除，Redis 里会残留无用数据（虽然 TTL 到期会自动清除，但立即清除更干净）
```

**注意**：文档上传/编辑时暂不清缓存，因为当前项目没有文档内容编辑接口。如果后续添加了编辑接口，也需要在编辑后清除 `ai:doc:{id}:*`。

### 5.2 测试验证

#### 测试 1：首次问答（缓存未命中）

```
POST http://localhost:8080/api/documents/1/ask
Body: {"question": "这篇文档讲了什么？"}

观察后台日志：
[缓存] 未命中, 调用 AI | Key: ai:doc:1:ask:xxxxxxxx
[Token] 单文档问答 | 文档长度: 5234 | 输入: 2100 | 输出: 156 | 总计: 2256
[Redis] 写入缓存: ai:doc:1:ask:xxxxxxxx (TTL: 1 HOURS)
```

#### 测试 2：再次问同样的问题（缓存命中）

```
POST http://localhost:8080/api/documents/1/ask
Body: {"question": "这篇文档讲了什么？"}

观察后台日志：
[Redis] 缓存命中: ai:doc:1:ask:xxxxxxxx

注意：没有 [Token] 日志！说明 AI 没有被调用！
```

#### 测试 3：用 redis-cli 验证

```powershell
docker exec -it my-redis redis-cli

# 查看所有 AI 缓存 Key
127.0.0.1:6379> KEYS ai:*
# 应该看到类似：ai:doc:1:ask:xxxxxxxx

# 查看某个缓存的内容
127.0.0.1:6379> GET "ai:doc:1:ask:xxxxxxxx"
# 应该看到 AI 的回答文本

# 查看过期时间
127.0.0.1:6379> TTL "ai:doc:1:ask:xxxxxxxx"
# 应该显示剩余秒数（接近 3600）
```

#### 测试 4：不同问题不命中

```
POST http://localhost:8080/api/documents/1/ask
Body: {"question": "文档里提到了哪些技术？"}

观察后台日志：
[缓存] 未命中, 调用 AI | Key: ai:doc:1:ask:yyyyyyyy
（Key 不同，所以未命中，正确！）
```

#### 测试 5：大小写差异命中

```
POST http://localhost:8080/api/documents/1/ask
Body: {"question": "这篇文档讲了什么？"}

POST http://localhost:8080/api/documents/1/ask  
Body: {"question": "这篇文档讲了什么？"}  （多几个空格、大小写不同）

观察：应该命中缓存（因为 trim + toLowerCase 统一了）
```

#### 测试 6：删除文档后缓存清除

```
DELETE http://localhost:8080/api/documents/1

然后在 redis-cli 中：
127.0.0.1:6379> KEYS ai:doc:1:*
（应为空，缓存已清除）
```

---

## 改动文件总览

| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `RedisService.java` | 修改 | 新增 `getOrCache()` 和 `deleteByPattern()` 方法 |
| `AiChatService.java` | 修改 | 注入 `RedisService`，新增缓存 Key 生成方法，同步方法加缓存逻辑 |
| `DocumentController.java` | 修改 | 传入 `documentId`，注入 `RedisService`，删除时清缓存 |
| `NotebookController.java` | 修改 | 传入 `notebookId` |

---

## 今日知识图谱

```
缓存策略
  ├── Cache-Aside 模式 —— 读时写缓存，最常用
  │     ├── 先查缓存 → 命中 → 返回
  │     └── 未命中 → 查数据源 → 写入缓存 → 返回
  ├── 缓存 Key 设计
  │     ├── 唯一标识输入：ai:doc:{id}:ask:{hash}
  │     ├── 问题做 SHA-256 Hash → 固定长度
  │     └── trim + toLowerCase → 统一格式，提高命中率
  ├── 缓存过期（TTL）
  │     ├── 1 小时 → AI 回答缓存
  │     └── 到期自动清除 → 防止数据太陈旧
  └── 缓存失效
        ├── 文档删除 → deleteByPattern("ai:doc:{id}:*")
        └── TTL 到期 → 自动失效

缓存三大问题（概念了解）
  ├── 缓存穿透 —— 查不存在的数据，绕过缓存
  ├── 缓存击穿 —— 热点 Key 过期瞬间
  └── 缓存雪崩 —— 大量 Key 同时过期
```

---

## 测试验证清单

### 功能验证
- [ ] 首次问答：日志显示"缓存未命中"，AI 被调用，Token 日志出现
- [ ] 重复问答：日志显示"缓存命中"，AI 未被调用，无 Token 日志
- [ ] 不同问题：产生不同缓存 Key，缓存未命中
- [ ] 大小写/空格差异：命中同一个缓存
- [ ] redis-cli 能看到缓存 Key 和内容
- [ ] 删除文档后，相关缓存被清除

### 边界验证
- [ ] 缓存 TTL 正确（约 3600 秒）
- [ ] AI 调用失败时，不会缓存错误结果
- [ ] 空文档返回提示信息，不走缓存
- [ ] 笔记本级问答也正常缓存

---

## 今日复盘 Checklist

- [ ] 理解 Cache-Aside 模式的流程（先查缓存 → 未命中 → 查数据源 → 写缓存）
- [ ] 理解 `Supplier<T>` 的作用——延迟执行，缓存命中时不调用 AI
- [ ] 理解缓存 Key 设计原则：唯一标识输入，冒号分隔层级
- [ ] 理解为什么问题要做 Hash（固定长度、避免特殊字符、统一格式）
- [ ] 理解为什么 `trim + toLowerCase` 能提高缓存命中率
- [ ] 理解文档删除时为什么需要清除相关缓存
- [ ] 了解缓存穿透、击穿、雪崩的概念

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| `getOrCache` 返回类型不对 | `RedisTemplate<String, Object>` 存入的是 JSON，取出时可能是 LinkedHashMap | 如果 AI 回答是 String 类型，序列化/反序列化后仍是 String，不会出问题；如果是复杂对象，需要额外处理 |
| 缓存命中但返回了 `LinkedHashMap` | GenericJackson2JsonRedisSerializer 反序列化 JSON 时，不知道目标类型，默认转为 LinkedHashMap | 对于 String 类型的值，不会出现此问题；如果出现，改用 `StringRedisTemplate` 单独处理纯字符串缓存 |
| `@Recover` 方法签名不匹配 | `@Retryable` 方法新增了参数，但 `@Recover` 没有同步更新 | Recover 方法的参数必须和 Retryable 方法一致（除了第一个异常参数） |
| `deleteByPattern` 在 Key 很多时很慢 | `KEYS *` 命令是全库扫描，Key 很多时会阻塞 Redis | 生产环境用 `SCAN` 替代；本项目 Key 很少，不影响 |
| 缓存 Key 中出现乱码 | Key 序列化器没配对 | 确保用了 `StringRedisSerializer` 序列化 Key（Day 27 的 RedisConfig 已配好） |

---

## 后续衔接

Day 28 完成后，AI 问答已有缓存，重复提问不花钱。Day 29 将进入另一个 Redis 实战场景——**限流**：

- 用 Redis 计数器记录用户每小时调用 AI 的次数
- 超过限制（如 10 次/小时）直接拒绝
- 防止用户无限调用 AI，保护 API 额度
