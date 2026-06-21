# Day 30: 对话上下文 — 让 AI 记住你们聊过什么

**目标**：用 Redis 存储对话历史，实现多轮对话——用户可以基于 AI 之前的回答继续追问，而不是每次都从零开始。

---

## 当前状态

Day 29 完成后，AI 问答已有缓存和限流保护。但有一个严重的体验问题：**AI 是"失忆"的**。

```
用户第 1 次问："这篇文档讲了什么？"
  AI 回答："这篇文档讲了 Spring Boot 的三个核心特性：自动配置、起步依赖、内嵌服务器..."

用户第 2 次问："能更详细解释第二个特性吗？"
  AI：？？？"第二个特性"是什么？我不知道你在说什么啊！
                                    ↑
                          没有上下文，AI 不知道"第二个"指什么
```

**Day 30 的解决方案**：用 Redis 存储每个用户对每个文档/笔记本的对话历史，每次调用 AI 时把历史消息带上，实现连续对话。

---

## 步骤 1/5: 认知学习 — API 的"上下文"到底是什么（前 10 分钟，不写代码）

### 1.1 核心认知：API 是完全无状态的

这是很多人误解的地方。**DeepSeek 的 API 不会帮你存任何上下文**——每次请求都是独立的，API 不记得之前聊过什么。

**打个比方**：

```
DeepSeek API 是一个"失忆专家"：

你第 1 次打电话："这篇文档讲了什么？"
  失忆专家回答："讲了 Spring Boot..."
  然后他立刻忘记了这次对话

你第 2 次打电话："能更详细解释第二点吗？"
  失忆专家："什么第二点？我不知道你在说什么"
  ↑ 他不记得之前聊过了！
```

**要让失忆专家理解"第二点"，你必须每次打电话时把之前的对话全部复述一遍：**

```
你第 2 次打电话：
  "之前我问了'这篇文档讲了什么？'，你回答'讲了 Spring Boot 的三点：A、B、C'。
   现在我问：第二点能详细说吗？"

  失忆专家："哦！第二点 B 是关于自动配置..."
  ↑ 他根据你复述的上下文，理解了"第二点"指什么
```

**这就是 API"上下文"的本质——你自己拼、自己发、自己存。**

### 1.2 用代码理解：messages 数组

你调用 DeepSeek API 时，每次请求的 `messages` 数组长这样：

```json
// 第 1 轮调用
POST https://api.deepseek.com/chat/completions
{
  "messages": [
    {"role": "system", "content": "你是助手"},
    {"role": "user", "content": "这篇文档讲了什么？"}          // ← 只有 1 条用户消息
  ]
}

// DeepSeek 返回回答，然后忘掉一切

// 第 2 轮调用 —— 你必须自己把第 1 轮的问答都带上！
POST https://api.deepseek.com/chat/completions
{
  "messages": [
    {"role": "system", "content": "你是助手"},
    {"role": "user", "content": "这篇文档讲了什么？"},         // ← 第 1 轮的问题
    {"role": "assistant", "content": "讲了 Spring Boot..."},   // ← 第 1 轮的回答
    {"role": "user", "content": "第二点能详细说吗？"}          // ← 第 2 轮的问题
  ]
}
```

**看到了吗？第 2 轮调用时，你把第 1 轮的问答又完整发了一遍。DeepSeek 每次都是从零开始理解，只不过你把历史喂给了它。**

### 1.3 DeepSeek 官网能"记住"上下文，是谁在存？

你在 DeepSeek 官网上聊天，看起来它能"记住"上下文，那是因为：

```
DeepSeek 官网的前端代码（运行在你的浏览器里）
  │
  ├── 1. 把你的每条消息和 AI 的每条回答，存在浏览器的内存/本地存储里
  ├── 2. 每次你发新消息时，把整个对话历史拼成 messages 数组
  ├── 3. 调用 API，把这个大数组发过去
  └── 4. 拿到回答后，追加到历史列表中
  │
  是前端代码在管理上下文，不是 DeepSeek 服务器在记！
```

### 1.4 "1M 上下文"是什么意思？

DeepSeek 声称有 1M（约 100 万 Token）的上下文窗口。**1M 上下文 = 一次请求最多能处理 1M Token 的输入**（大约 75 万字中文）。

不是说它帮你存 1M 的历史，而是说：

```
你可以在一次请求的 messages 数组里塞进去最多 ~75万字的对话历史 + 文档内容
DeepSeek 能在一次推理中读完这 75万字 并给你回答

但每次请求都是独立的，发完就忘
```

**1M 是处理能力的上限，不是存储空间。**

### 1.5 我们的项目需要做什么

```
┌─────────────────────────────────────────────────────────────┐
│             谁负责存储对话历史？                               │
│                                                             │
│  DeepSeek 服务器？   ❌ 不存！每次请求都是无状态的             │
│  用户的浏览器？      ✅ 官网页面是前端存的                     │
│  我们的后端代码？    ✅ 我们的项目要自己存（用 Redis）          │
│                                                             │
│  我们要做的三件事：                                          │
│  1. 每次问答后，把问题和回答存到 Redis                       │
│  2. 每次提问前，从 Redis 读取历史，拼进 AI 请求的 messages   │
│  3. 提供"清空对话"功能，让用户可以重新开始                   │
└─────────────────────────────────────────────────────────────┘
```

### 1.6 Spring AI 的 Message API

Spring AI 用 `Message` 接口来表示对话中的每一条消息：

```java
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.SystemMessage;

// 三种角色对应三种 Message 类：
SystemMessage    → role: "system"    → 系统提示词
UserMessage      → role: "user"     → 用户说的话
AssistantMessage → role: "assistant" → AI 的回答
```

**在 `ChatClient` 中传入历史消息**：

```java
// 之前（无上下文）：
chatClient.prompt()
    .system(systemPrompt)
    .user(userPrompt)
    .call()

// 之后（有上下文）：
chatClient.prompt()
    .system(systemPrompt)
    .messages(historyMessages)  // ← 历史对话
    .user(currentQuestion)      // ← 当前问题
    .call()
```

**注意**：`.messages()` 里传的是历史消息（不包括 system 和当前 user 消息），Spring AI 会自动把 system、messages、user 组合成完整的 messages 数组发给 API。

---

## 步骤 2/5: 创建对话历史服务类

### 2.1 设计决策

| 决策点 | 选择 | 理由 |
|:---|:---|:---|
| 历史存哪？ | **Redis** | 已有基础设施，快，支持 TTL 自动过期 |
| 对话粒度？ | **按文档/笔记本隔离** | 文档 A 的对话不应该影响文档 B |
| 保留几轮？ | **10 轮（20 条消息）** | 平衡上下文质量和 Token 消耗 |
| 过期时间？ | **2 小时** | 用户一个工作 session 内够用 |
| 缓存怎么处理？ | **多轮对话不走缓存** | 有上下文时相同问题回答不同，缓存会出错 |
| 流式回答怎么存？ | **等流完再存** | 需要收集完整回答才能作为历史 |

### 2.2 Redis Key 设计

```
ai:chat:doc:{documentId}:{userId}       ← 文档级对话历史
ai:chat:notebook:{notebookId}:{userId}  ← 笔记本级对话历史
```

| 部分 | 含义 | 为什么需要 |
|:---|:---|:---|
| `ai` | 业务域 | 区分 AI 对话历史和其他缓存 |
| `chat` | 子域 | 区分对话历史和 AI 缓存（Day 28） |
| `doc` / `notebook` | 对话类型 | 文档问答和笔记本问答的历史要隔离 |
| `{documentId}` | 资源 ID | 不同文档的对话互不干扰 |
| `{userId}` | 用户 ID | 不同用户的对话互不干扰 |

### 2.3 对话历史的存储结构

Redis 里存一个 JSON 数组，每条记录是一轮对话中的消息：

```json
[
  { "role": "user", "content": "这篇文档讲了什么？" },
  { "role": "assistant", "content": "这篇文档讲了 Spring Boot 的三个核心特性..." },
  { "role": "user", "content": "能更详细解释第二个特性吗？" },
  { "role": "assistant", "content": "第二个特性是起步依赖..." }
]
```

**为什么不用 Spring AI 自带的 `ChatMemory`？**

Spring AI 提供了 `ChatMemory` 接口和 `InMemoryChatMemory`（内存版），但它有几个问题：
1. `InMemoryChatMemory` 重启就丢，不适合生产
2. 它的 `conversationId` 是字符串，不如我们直接用 `doc:documentId:userId` 灵活
3. 我们需要和限流、缓存协同，自己管理更方便

**所以我们手动管理对话历史，用 RedisTemplate 直接读写。**

### 2.4 新建 ChatHistoryService

新建文件：`notebook-clone/src/main/java/com/example/notebook_clone/service/ChatHistoryService.java`

```java
package com.example.notebook_clone.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 对话历史服务
 *
 * 基于 Redis 存储每个用户对每个文档/笔记本的对话历史，
 * 实现多轮对话上下文。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChatHistoryService {

    private final RedisTemplate<String, Object> redisTemplate;

    /** 最大保留轮数（1 轮 = 1 条 user + 1 条 assistant） */
    private static final int MAX_ROUNDS = 10;
    /** 对话历史过期时间（小时） */
    private static final long HISTORY_TTL_HOURS = 2;

    // ==================== Key 构建 ====================

    /**
     * 构建文档级对话历史的 Redis Key
     */
    public String buildDocKey(Long documentId, Long userId) {
        return "ai:chat:doc:" + documentId + ":" + userId;
    }

    /**
     * 构建笔记本级对话历史的 Redis Key
     */
    public String buildNotebookKey(Long notebookId, Long userId) {
        return "ai:chat:notebook:" + notebookId + ":" + userId;
    }

    // ==================== 读取历史 ====================

    /**
     * 获取对话历史（返回 Spring AI 的 Message 列表）
     *
     * @param key Redis Key
     * @return 历史消息列表（可能为空）
     */
    @SuppressWarnings("unchecked")
    public List<Message> getHistory(String key) {
        Object raw = redisTemplate.opsForValue().get(key);
        if (raw == null) {
            return new ArrayList<>();
        }

        List<Map<String, String>> rawList;
        try {
            rawList = (List<Map<String, String>>) raw;
        } catch (ClassCastException e) {
            log.warn("[对话历史] 反序列化失败，清空历史 | Key: {}", key);
            redisTemplate.delete(key);
            return new ArrayList<>();
        }

        List<Message> messages = new ArrayList<>();
        for (Map<String, String> item : rawList) {
            String role = item.get("role");
            String content = item.get("content");
            if ("user".equals(role)) {
                messages.add(new UserMessage(content));
            } else if ("assistant".equals(role)) {
                messages.add(new AssistantMessage(content));
            }
            // system 消息不存历史，每次请求时由 AiChatService 重新构建
        }

        log.debug("[对话历史] 读取 {} 条消息 | Key: {}", messages.size(), key);
        return messages;
    }

    /**
     * 获取文档级对话历史
     */
    public List<Message> getDocHistory(Long documentId, Long userId) {
        return getHistory(buildDocKey(documentId, userId));
    }

    /**
     * 获取笔记本级对话历史
     */
    public List<Message> getNotebookHistory(Long notebookId, Long userId) {
        return getHistory(buildNotebookKey(notebookId, userId));
    }

    // ==================== 保存历史 ====================

    /**
     * 保存一轮对话（用户问题 + AI 回答）
     *
     * @param key     Redis Key
     * @param question 用户问题
     * @param answer   AI 回答
     */
    @SuppressWarnings("unchecked")
    public void saveTurn(String key, String question, String answer) {
        // 1. 读取现有历史
        List<Map<String, String>> rawList = new ArrayList<>();
        Object raw = redisTemplate.opsForValue().get(key);
        if (raw != null) {
            try {
                rawList = new ArrayList<>((List<Map<String, String>>) raw);
            } catch (ClassCastException e) {
                log.warn("[对话历史] 读取旧历史失败，重新开始 | Key: {}", key);
                rawList = new ArrayList<>();
            }
        }

        // 2. 追加本轮对话
        Map<String, String> userMsg = Map.of("role", "user", "content", question);
        Map<String, String> assistantMsg = Map.of("role", "assistant", "content", answer);
        rawList.add(userMsg);
        rawList.add(assistantMsg);

        // 3. 只保留最近 MAX_ROUNDS 轮（每轮 2 条消息）
        int maxMessages = MAX_ROUNDS * 2;
        if (rawList.size() > maxMessages) {
            rawList = rawList.subList(rawList.size() - maxMessages, rawList.size());
        }

        // 4. 写回 Redis，重置 TTL
        redisTemplate.opsForValue().set(key, rawList, HISTORY_TTL_HOURS, TimeUnit.HOURS);

        log.debug("[对话历史] 保存 1 轮对话，当前共 {} 条消息 | Key: {}", rawList.size(), key);
    }

    /**
     * 保存文档级对话
     */
    public void saveDocTurn(Long documentId, Long userId, String question, String answer) {
        saveTurn(buildDocKey(documentId, userId), question, answer);
    }

    /**
     * 保存笔记本级对话
     */
    public void saveNotebookTurn(Long notebookId, Long userId, String question, String answer) {
        saveTurn(buildNotebookKey(notebookId, userId), question, answer);
    }

    // ==================== 清空历史 ====================

    /**
     * 清空对话历史
     */
    public void clearHistory(String key) {
        redisTemplate.delete(key);
        log.info("[对话历史] 已清空 | Key: {}", key);
    }

    /**
     * 清空文档级对话历史
     */
    public void clearDocHistory(Long documentId, Long userId) {
        clearHistory(buildDocKey(documentId, userId));
    }

    /**
     * 清空笔记本级对话历史
     */
    public void clearNotebookHistory(Long notebookId, Long userId) {
        clearHistory(buildNotebookKey(notebookId, userId));
    }

    // ==================== 查询历史（供前端展示） ====================

    /**
     * 获取对话历史的原始数据（供前端展示）
     *
     * @param key Redis Key
     * @return 消息列表 [{role, content}, ...]
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, String>> getHistoryForDisplay(String key) {
        Object raw = redisTemplate.opsForValue().get(key);
        if (raw == null) {
            return new ArrayList<>();
        }
        try {
            return new ArrayList<>((List<Map<String, String>>) raw);
        } catch (ClassCastException e) {
            return new ArrayList<>();
        }
    }

    /**
     * 获取文档级对话历史（供前端展示）
     */
    public List<Map<String, String>> getDocHistoryForDisplay(Long documentId, Long userId) {
        return getHistoryForDisplay(buildDocKey(documentId, userId));
    }

    /**
     * 获取笔记本级对话历史（供前端展示）
     */
    public List<Map<String, String>> getNotebookHistoryForDisplay(Long notebookId, Long userId) {
        return getHistoryForDisplay(buildNotebookKey(notebookId, userId));
    }

    /**
     * 检查是否存在对话历史
     */
    public boolean hasHistory(String key) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(key));
    }
}
```

### 2.5 理解核心方法

**`getHistory(key)`** — 读取历史并转为 Spring AI 的 `Message` 列表：

```
Redis 中的 JSON:
[
  {"role": "user", "content": "讲了什么？"},
  {"role": "assistant", "content": "讲了..."}
]

↓ 转换为 Spring AI Message ↓

[
  UserMessage("讲了什么？"),
  AssistantMessage("讲了...")
]
```

**`saveTurn(key, question, answer)`** — 保存一轮对话：

```
第 1 轮保存：
  读取历史：[]（空）
  追加：[user: "讲了什么？", assistant: "讲了..."]
  写回 Redis

第 2 轮保存：
  读取历史：[user: "讲了什么？", assistant: "讲了..."]
  追加：[user: "详细说第二点", assistant: "第二点是..."]
  写回 Redis（现在有 4 条消息）

...

第 11 轮保存（超过 MAX_ROUNDS=10）：
  读取历史：20 条消息
  追加后：22 条消息
  截断：只保留最后 20 条
  写回 Redis
```

**为什么要截断？**

```
如果不截断，对话越来越长：
  第 20 轮 → 40 条消息 → 可能有几万字
  发给 DeepSeek → 每次消耗几万 Token → 费用暴增
  而且 DeepSeek 1M 上下文也有上限

保留最近 10 轮 → 最多 20 条消息 → 几千字
  既能保持上下文连贯性，又不会 Token 爆炸
```

---

## 步骤 3/5: 改造 AiChatService — 让 AI 带上历史"记忆"

### 3.1 改造思路

```
之前（无上下文）：
  Controller → AiChatService.askBasedOnDocument(content, question, useDocContext)
    → chatClient.prompt().system(systemPrompt).user(userPrompt).call()

之后（有上下文）：
  Controller → AiChatService.askBasedOnDocument(content, question, useDocContext, docId, userId)
    → 1. 从 ChatHistoryService 读取历史
    → 2. chatClient.prompt().system(systemPrompt).messages(history).user(userPrompt).call()
    → 3. 把本轮问答存入 ChatHistoryService
```

### 3.2 关于缓存的决策：多轮对话不走缓存

Day 28 实现了缓存，但**有上下文的对话不能走缓存**，原因：

```
无上下文时：
  "文档1" + "讲了什么" → 缓存 Key → 同样输入同样结果 ✅

有上下文时：
  同样是"讲了什么"，但：
    场景 A：之前聊了"自动配置" → AI 回答自动配置的细节
    场景 B：之前聊了"起步依赖" → AI 回答起步依赖的细节
  → 相同问题 + 不同上下文 = 不同回答 → 缓存失效 ❌
```

**策略**：
- 有对话历史时 → 不查缓存，直接调用 AI
- 没有对话历史（首轮） → 正常走缓存

### 3.3 改造同步方法：单文档问答

打开 `AiChatService.java`，注入 `ChatHistoryService`：

```java
private final ChatHistoryService chatHistoryService;  // Day 30 新增

public AiChatService(ChatClient.Builder chatClientBuilder, RedisService redisService,
        RateLimitService rateLimitService, ChatHistoryService chatHistoryService) {
    this.chatClient = chatClientBuilder.build();
    this.redisService = redisService;
    this.rateLimitService = rateLimitService;
    this.chatHistoryService = chatHistoryService;  // Day 30 新增
}
```

**改造 `askBasedOnDocument` 方法**：

```java
@Retryable(
    retryFor = {RestClientException.class},
    maxAttempts = 3,
    backoff = @Backoff(delay = 1500, multiplier = 1.5)
)
public String askBasedOnDocument(String documentContent, String question,
        boolean useDocumentContext, Long documentId, Long userId) {
    // 空文档判断
    if ((documentContent == null || documentContent.trim().isEmpty()) && useDocumentContext) {
        return "文档内容为空，无法回答问题。";
    }

    // 文档截断
    String context = documentContent != null && documentContent.length() > 8000
            ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
            : documentContent;

    // 构建 Prompt
    String systemPrompt = buildSingleDocSystemPrompt(useDocumentContext);
    String userPrompt = buildSingleDocUserPrompt(context, question, useDocumentContext);

    // ===== Day 30 新增：读取对话历史 =====
    List<Message> history = chatHistoryService.getDocHistory(documentId, userId);
    boolean hasHistory = !history.isEmpty();
    // =====================================

    // 判断是否走缓存：有历史时不走缓存
    if (!hasHistory) {
        String cacheKey = buildDocAskCacheKey(documentId, question, useDocumentContext);
        Object cached = redisService.get(cacheKey);
        if (cached != null) {
            log.info("[缓存] 命中, 直接返回 | Key: {}", cacheKey);
            return (String) cached;
        }
    } else {
        log.info("[对话] 检测到 {} 条历史消息，跳过缓存", history.size());
    }

    // 调用 AI（带历史）
    ChatResponse chatResponse = chatClient.prompt()
        .system(systemPrompt)
        .messages(history)      // ← Day 30：传入历史消息
        .user(userPrompt)
        .call()
        .chatResponse();

    String answer = chatResponse.getResult().getOutput().getText();

    // Token 日志
    var usage = chatResponse.getMetadata().getUsage();
    if (usage != null) {
        log.info("[Token] 单文档问答 | 文档长度: {} | 历史轮数: {} | 输入: {} | 输出: {} | 总计: {}",
            documentContent != null ? documentContent.length() : 0,
            history.size() / 2,
            usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
    }

    // ===== Day 30 新增：保存本轮对话到历史 =====
    chatHistoryService.saveDocTurn(documentId, userId, question, answer);
    // ==========================================

    // 无历史时写缓存（首轮的问答可以被后续无历史请求命中）
    if (!hasHistory) {
        String cacheKey = buildDocAskCacheKey(documentId, question, useDocumentContext);
        redisService.set(cacheKey, answer, CACHE_TTL_HOURS, TimeUnit.HOURS);
    }

    return answer;
}
```

**关键变化**：

```
方法签名变化：
  旧：askBasedOnDocument(String documentContent, String question, boolean useDocumentContext)
  新：askBasedOnDocument(String documentContent, String question, boolean useDocumentContext,
                         Long documentId, Long userId)
  ↑ 新增 documentId 和 userId，用于构建对话历史的 Redis Key

核心逻辑变化：
  1. 先读取历史 → 有历史则跳过缓存
  2. 调用 AI 时传入 .messages(history)
  3. AI 回答后保存本轮对话到历史
  4. 仅无历史时写缓存
```

### 3.4 改造同步方法：多文档问答

**改造 `askBasedOnDocuments` 方法**：

```java
@Retryable(
    retryFor = {RestClientException.class},
    maxAttempts = 3,
    backoff = @Backoff(delay = 1500, multiplier = 1.5)
)
public String askBasedOnDocuments(List<String[]> documents, String question,
        Long notebookId, Long userId) {
    // 空文档判断（和之前一样，省略...）
    if (documents == null || documents.isEmpty()) {
        return "该笔记本下没有文档，无法回答问题。";
    }

    // 拼接文档内容（和之前一样，省略...）
    // ... contextBuilder 逻辑 ...
    String context = contextBuilder.toString();
    // ...

    // 构建 Prompt
    String systemPrompt = buildMultiDocSystemPrompt();
    String userPrompt = buildMultiDocUserPrompt(context, question);

    // ===== Day 30 新增：读取对话历史 =====
    List<Message> history = chatHistoryService.getNotebookHistory(notebookId, userId);
    boolean hasHistory = !history.isEmpty();
    // =====================================

    // 缓存逻辑：有历史时不走缓存
    if (!hasHistory) {
        String cacheKey = buildNotebookAskCacheKey(notebookId, question);
        Object cached = redisService.get(cacheKey);
        if (cached != null) {
            log.info("[缓存] 命中, 直接返回 | Key: {}", cacheKey);
            return (String) cached;
        }
    }

    // 调用 AI（带历史）
    ChatResponse chatResponse = chatClient.prompt()
        .system(systemPrompt)
        .messages(history)      // ← Day 30：传入历史消息
        .user(userPrompt)
        .call()
        .chatResponse();

    String answer = chatResponse.getResult().getOutput().getText();

    // Token 日志
    var usage = chatResponse.getMetadata().getUsage();
    if (usage != null) {
        log.info("[Token] 多文档问答 | 文档数: {} | 历史轮数: {} | 输入: {} | 输出: {} | 总计: {}",
            documents.size(), history.size() / 2,
            usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
    }

    // ===== Day 30 新增：保存本轮对话到历史 =====
    chatHistoryService.saveNotebookTurn(notebookId, userId, question, answer);
    // ==========================================

    // 无历史时写缓存
    if (!hasHistory) {
        String cacheKey = buildNotebookAskCacheKey(notebookId, question);
        redisService.set(cacheKey, answer, CACHE_TTL_HOURS, TimeUnit.HOURS);
    }

    return answer;
}
```

### 3.5 改造流式方法：单文档流式问答

流式方法有一个特殊问题：**流是逐步推送的，不能在流中间保存历史**——必须等流完整结束，收集了完整的 AI 回答后才能保存。

**改造 `askBasedOnDocumentStream` 方法**：

```java
public Flux<ServerSentEvent<String>> askBasedOnDocumentStream(
        String documentContent, String question, boolean useDocumentContext,
        Long documentId, Long userId) {  // ← Day 30：新增 documentId, userId

    // 空文档判断
    if ((documentContent == null || documentContent.trim().isEmpty()) && useDocumentContext) {
        return Flux.just(ServerSentEvent.<String>builder()
                .data("文档内容为空，无法回答问题。")
                .build());
    }

    // 文档截断
    String context = documentContent != null && documentContent.length() > 8000
            ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
            : documentContent;

    // 构建 Prompt
    String systemPrompt = buildSingleDocSystemPrompt(useDocumentContext);
    String userPrompt = buildSingleDocUserPrompt(context, question, useDocumentContext);

    // ===== Day 30 新增：读取对话历史 =====
    List<Message> history = chatHistoryService.getDocHistory(documentId, userId);
    // =====================================

    // Token 用量引用
    AtomicReference<Usage> usageRef = new AtomicReference<>();
    // ===== Day 30 新增：收集完整回答 =====
    StringBuilder fullAnswer = new StringBuilder();
    // ====================================

    Flux<ServerSentEvent<String>> contentFlux = chatClient.prompt()
        .system(systemPrompt)
        .messages(history)      // ← Day 30：传入历史消息
        .user(userPrompt)
        .stream()
        .chatResponse()
        .doOnNext(chunk -> {
            var usage = chunk.getMetadata() != null ? chunk.getMetadata().getUsage() : null;
            if (usage != null) {
                usageRef.set(usage);
                log.info("[Token] 流式单文档问答 | 输入：{} | 输出：{} | 总计：{}",
                        usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
            }
        })
        .map(chunk -> {
            var result = chunk.getResult();
            if (result != null && result.getOutput() != null) {
                String text = result.getOutput().getText();
                // ===== Day 30：收集每个片段 =====
                if (text != null && !text.isEmpty()) {
                    fullAnswer.append(text);
                }
                // ===============================
                return text;
            }
            return "";
        })
        .filter(text -> text != null && !text.isEmpty())
        .map(text -> ServerSentEvent.<String>builder().data(text).build())
        .onErrorResume(e -> Flux.just(ServerSentEvent.<String>builder()
                .data("AI 服务暂时不可用，请稍后重试")
                .build()));

    // ===== Day 30 新增：流结束后保存历史 + 发送 token 事件 =====
    return contentFlux
        .concatWith(Mono.fromCallable(() -> {
            // 流结束，保存本轮对话
            String answer = fullAnswer.toString();
            if (!answer.isEmpty()) {
                chatHistoryService.saveDocTurn(documentId, userId, question, answer);
            }
            // 发送 token 用量事件
            Usage usage = usageRef.get();
            if (usage != null) {
                String json = String.format("{\"prompt\":%d,\"completion\":%d,\"total\":%d}",
                        usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
                return ServerSentEvent.<String>builder()
                        .event("token-usage")
                        .data(json)
                        .build();
            }
            return null;
        }).filter(java.util.Objects::nonNull));
    // ============================================================
}
```

**理解流式保存的关键**：

```
流式输出过程：
  用户提问 → AI 开始输出
    chunk 1: "这"
    chunk 2: "篇"
    chunk 3: "文"
    chunk 4: "档"
    ...
    chunk N: "..."
  → 流结束

  在流结束的那一刻（Mono.fromCallable）：
  1. fullAnswer 已经收集了所有 chunk 拼成的完整回答
  2. 调用 chatHistoryService.saveDocTurn() 保存本轮对话
  3. 发送 token-usage 事件

为什么不边流边存？
  因为如果中途断流（网络错误），保存了不完整的回答作为"历史"，
  下次 AI 看到不完整的上下文，回答质量会很差。
  所以必须等流完整结束再保存。
```

### 3.6 改造流式方法：多文档流式问答

**同理改造 `askBasedOnDocumentsStream` 方法**：

```java
public Flux<ServerSentEvent<String>> askBasedOnDocumentsStream(
        List<String[]> documents, String question,
        Long notebookId, Long userId) {  // ← Day 30：新增 notebookId, userId

    // 空文档判断（和之前一样...）
    if (documents == null || documents.isEmpty()) {
        return Flux.just(ServerSentEvent.<String>builder()
                .data("该笔记本下没有文档，无法回答问题。")
                .build());
    }

    // 拼接文档内容（和之前一样...）
    // ... contextBuilder 逻辑 ...

    // 构建 Prompt
    String systemPrompt = buildMultiDocSystemPrompt();
    String userPrompt = buildMultiDocUserPrompt(context, question);

    // ===== Day 30 新增：读取对话历史 =====
    List<Message> history = chatHistoryService.getNotebookHistory(notebookId, userId);
    // =====================================

    AtomicReference<Usage> usageRef = new AtomicReference<>();
    // ===== Day 30 新增：收集完整回答 =====
    StringBuilder fullAnswer = new StringBuilder();
    // ====================================

    Flux<ServerSentEvent<String>> contentFlux = chatClient.prompt()
        .system(systemPrompt)
        .messages(history)      // ← Day 30：传入历史消息
        .user(userPrompt)
        .stream()
        .chatResponse()
        .doOnNext(chunk -> {
            var usage = chunk.getMetadata() != null ? chunk.getMetadata().getUsage() : null;
            if (usage != null) {
                usageRef.set(usage);
            }
        })
        .map(chunk -> {
            var result = chunk.getResult();
            if (result != null && result.getOutput() != null) {
                String text = result.getOutput().getText();
                if (text != null && !text.isEmpty()) {
                    fullAnswer.append(text);
                }
                return text;
            }
            return "";
        })
        .filter(text -> text != null && !text.isEmpty())
        .map(text -> ServerSentEvent.<String>builder().data(text).build())
        .onErrorResume(e -> Flux.just(ServerSentEvent.<String>builder()
                .data("AI 服务暂时不可用，请稍后重试")
                .build()));

    // ===== Day 30 新增：流结束后保存历史 + 发送 token 事件 =====
    return contentFlux
        .concatWith(Mono.fromCallable(() -> {
            String answer = fullAnswer.toString();
            if (!answer.isEmpty()) {
                chatHistoryService.saveNotebookTurn(notebookId, userId, question, answer);
            }
            Usage usage = usageRef.get();
            if (usage != null) {
                String json = String.format("{\"prompt\":%d,\"completion\":%d,\"total\":%d}",
                        usage.getPromptTokens(), usage.getCompletionTokens(), usage.getTotalTokens());
                return ServerSentEvent.<String>builder()
                        .event("token-usage")
                        .data(json)
                        .build();
            }
            return null;
        }).filter(java.util.Objects::nonNull));
}
```

### 3.7 @Recover 方法签名也要更新

因为同步方法的参数变了，`@Recover` 兜底方法的签名也要对应更新：

```java
@Recover
public String askBasedOnDocumentRecover(RestClientException e, String documentContent,
        String question, boolean useDocumentContext, Long documentId, Long userId) {
    log.error("[重试] 单文档问答失败，已重试 3 次: {}", e.getMessage());
    return "AI 服务暂时不可用，请稍后重试";
}

@Recover
public String askBasedOnDocumentsRecover(RestClientException e, List<String[]> documents,
        String question, Long notebookId, Long userId) {
    log.error("[重试] 多文档问答失败，已重试 3 次: {}", e.getMessage());
    return "AI 服务暂时不可用，请稍后重试";
}
```

---

## 步骤 4/5: 改造 Controller — 传入用户 ID，新增历史管理接口

### 4.1 DocumentController 改造

**注入 ChatHistoryService**：

```java
private final ChatHistoryService chatHistoryService;  // Day 30 新增

public DocumentController(DocumentRepository documentRepository, NotebookRepository notebookRepository,
        UserRepository userRepository, DocumentExtractService extractService,
        AiSummaryService aiSummaryService, AiChatService aiChatService,
        AsyncSummaryService asyncSummaryService, RedisService redisService,
        RateLimitService rateLimitService, ChatHistoryService chatHistoryService) {
    // ... 原有赋值 ...
    this.chatHistoryService = chatHistoryService;  // Day 30 新增
}
```

**改造 `askDocument` 方法 — 传入 userId**：

```java
@PostMapping("/{id}/ask")
public Result<String> askDocument(@PathVariable Long id,
                                   @RequestBody AskRequest request) {
    if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
        return Result.fail("问题不能为空");
    }

    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 限流检查
    if (!rateLimitService.isAllowed(currentUser.getId())) {
        var status = rateLimitService.getStatus(currentUser.getId());
        return Result.fail("AI 问答次数已达上限（" + status.currentCount() + "/"
                + status.maxRequests() + "次），请 " + status.remainingSeconds() / 60
                + " 分钟后再试");
    }

    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));
    if (!document.getUser().getId().equals(currentUser.getId())) {
        throw new RuntimeException("无权访问该文档");
    }

    boolean useDocumentContext = request.getUseDocumentContext() != null
            ? request.getUseDocumentContext()
            : true;

    // ===== Day 30：传入 documentId 和 userId =====
    String answer = aiChatService.askBasedOnDocument(
            document.getContent(),
            request.getQuestion(),
            useDocumentContext,
            document.getId(),          // ← 新增
            currentUser.getId()        // ← 新增
    );
    // ============================================
    return Result.success(answer);
}
```

**改造 `askDocumentStream` 方法**：

```java
@GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8")
public Flux<ServerSentEvent<String>> askDocumentStream(
        @PathVariable Long id,
        @RequestParam String question,
        @RequestParam(defaultValue = "true") boolean useDocumentContext) {

    if (question == null || question.trim().isEmpty()) {
        return Flux.just(ServerSentEvent.<String>builder().data("问题不能为空").build());
    }

    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 限流检查
    if (!rateLimitService.isAllowed(currentUser.getId())) {
        return Flux.just(ServerSentEvent.<String>builder()
                .data("AI 问答次数已达上限，请稍后再试")
                .build());
    }

    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));
    if (!document.getUser().getId().equals(currentUser.getId())) {
        return Flux.just(ServerSentEvent.<String>builder().data("无权访问该文档").build());
    }

    // ===== Day 30：传入 documentId 和 userId =====
    return aiChatService.askBasedOnDocumentStream(
            document.getContent(),
            question,
            useDocumentContext,
            document.getId(),          // ← 新增
            currentUser.getId()        // ← 新增
    );
    // ============================================
}
```

### 4.2 新增对话历史管理接口

在 `DocumentController` 中新增：

```java
// ========== Day 30：对话历史管理接口 ==========

/**
 * 获取文档级对话历史
 * GET /api/documents/{id}/chat/history
 */
@GetMapping("/{id}/chat/history")
public Result<List<Map<String, String>>> getDocChatHistory(@PathVariable Long id) {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 校验文档归属
    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));
    if (!document.getUser().getId().equals(currentUser.getId())) {
        throw new RuntimeException("无权访问该文档");
    }

    return Result.success(chatHistoryService.getDocHistoryForDisplay(id, currentUser.getId()));
}

/**
 * 清空文档级对话历史
 * DELETE /api/documents/{id}/chat/history
 */
@DeleteMapping("/{id}/chat/history")
public Result<Void> clearDocChatHistory(@PathVariable Long id) {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 校验文档归属
    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));
    if (!document.getUser().getId().equals(currentUser.getId())) {
        throw new RuntimeException("无权操作该文档");
    }

    chatHistoryService.clearDocHistory(id, currentUser.getId());
    return Result.success(null);
}
```

### 4.3 NotebookController 改造

**注入 ChatHistoryService**：

```java
private final ChatHistoryService chatHistoryService;  // Day 30 新增

public NotebookController(NotebookRepository notebookRepository, UserRepository userRepository,
        DocumentRepository documentRepository, AiChatService aiChatService,
        RateLimitService rateLimitService, ChatHistoryService chatHistoryService) {
    // ... 原有赋值 ...
    this.chatHistoryService = chatHistoryService;  // Day 30 新增
}
```

**改造 `askNotebook` 方法**：

```java
@PostMapping("/{id}/ask")
public Result<String> askNotebook(@PathVariable Long id, @RequestBody AskRequest request) {
    if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
        return Result.fail("问题不能为空");
    }

    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 限流检查
    if (!rateLimitService.isAllowed(currentUser.getId())) {
        var status = rateLimitService.getStatus(currentUser.getId());
        return Result.fail("AI 问答次数已达上限（" + status.currentCount() + "/"
                + status.maxRequests() + "次），请 " + status.remainingSeconds() / 60
                + " 分钟后再试");
    }

    Notebook notebook = notebookRepository.findByIdAndUserId(id, currentUser.getId())
            .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));

    List<Document> documents = documentRepository.findByNotebook_Id(id);
    List<String[]> docList = documents.stream()
            .map(doc -> new String[]{doc.getTitle(), doc.getContent()})
            .toList();

    // ===== Day 30：传入 notebookId 和 userId =====
    String answer = aiChatService.askBasedOnDocuments(
            docList,
            request.getQuestion(),
            id,                       // ← 新增
            currentUser.getId()       // ← 新增
    );
    // ============================================
    return Result.success(answer);
}
```

**改造 `askNotebookStream` 方法**：

```java
@GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8")
public Flux<ServerSentEvent<String>> askNotebookStream(
        @PathVariable Long id,
        @RequestParam String question) {

    if (question == null || question.trim().isEmpty()) {
        return Flux.just(ServerSentEvent.<String>builder().data("问题不能为空").build());
    }

    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 限流检查
    if (!rateLimitService.isAllowed(currentUser.getId())) {
        return Flux.just(ServerSentEvent.<String>builder()
                .data("AI 问答次数已达上限，请稍后再试")
                .build());
    }

    Notebook notebook = notebookRepository.findByIdAndUserId(id, currentUser.getId())
            .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));

    List<Document> documents = documentRepository.findByNotebook_Id(id);
    List<String[]> docList = documents.stream()
            .map(doc -> new String[]{doc.getTitle(), doc.getContent()})
            .toList();

    // ===== Day 30：传入 notebookId 和 userId =====
    return aiChatService.askBasedOnDocumentsStream(
            docList,
            question,
            id,                       // ← 新增
            currentUser.getId()       // ← 新增
    );
    // ============================================
}
```

**新增笔记本对话历史管理接口**：

```java
// ========== Day 30：对话历史管理接口 ==========

/**
 * 获取笔记本级对话历史
 * GET /api/notebooks/{id}/chat/history
 */
@GetMapping("/{id}/chat/history")
public Result<List<Map<String, String>>> getNotebookChatHistory(@PathVariable Long id) {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 校验笔记本归属
    notebookRepository.findByIdAndUserId(id, currentUser.getId())
            .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));

    return Result.success(chatHistoryService.getNotebookHistoryForDisplay(id, currentUser.getId()));
}

/**
 * 清空笔记本级对话历史
 * DELETE /api/notebooks/{id}/chat/history
 */
@DeleteMapping("/{id}/chat/history")
public Result<Void> clearNotebookChatHistory(@PathVariable Long id) {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 校验笔记本归属
    notebookRepository.findByIdAndUserId(id, currentUser.getId())
            .orElseThrow(() -> new RuntimeException("笔记本不存在或无权访问"));

    chatHistoryService.clearNotebookHistory(id, currentUser.getId());
    return Result.success(null);
}
```

### 4.4 删除文档/笔记本时清空对话历史

在 `DocumentController.deleteDocument` 中增加清空对话历史：

```java
@DeleteMapping("/{id}")
public Result<Void> deleteDocument(@PathVariable Long id) {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository
            .findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    Boolean exists = documentRepository.existsByIdAndUserId(id, currentUser.getId());
    if (!exists) {
        throw new RuntimeException("文档不存在或无权删除");
    }

    // ===== Day 30：删除文档时清空对话历史 =====
    chatHistoryService.clearDocHistory(id, currentUser.getId());
    // ============================================

    // Day 28：清除该文档的所有 AI 缓存
    redisService.deleteByPattern("ai:doc:" + id + ":*");

    documentRepository.deleteById(id);
    return Result.success(null);
}
```

在 `NotebookController.deleteNotebook` 中增加清空对话历史：

```java
@DeleteMapping("/{id}")
public Result<Void> deleteNotebook(@PathVariable Long id) {
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository
            .findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    Boolean exists = notebookRepository.existsByIdAndUserId(id, currentUser.getId());
    if (!exists) {
        throw new RuntimeException("笔记本不存在或无权删除");
    }

    // ===== Day 30：删除笔记本时清空对话历史 =====
    chatHistoryService.clearNotebookHistory(id, currentUser.getId());
    // ==============================================

    notebookRepository.deleteById(id);
    return Result.success(null);
}
```

---

## 步骤 5/5: 前端改造 + 测试验证

### 5.1 前端改造思路

当前前端是"一问一答"模式：输入框 + 回答 textarea。我们需要改成"对话列表"模式：上方显示历史对话，下方是输入框。

```
之前：
┌──────────────────────────┐
│ 💬 智能问答              │
│ ┌──────────────────────┐ │
│ │ 输入你的问题...       │ │
│ └──────────────────────┘ │
│ 🤖 回答：                │
│ ┌──────────────────────┐ │
│ │ （textarea 显示回答） │ │
│ └──────────────────────┘ │
└──────────────────────────┘

之后：
┌──────────────────────────┐
│ 💬 智能问答    🗑️ 清空对话│
│ ┌──────────────────────┐ │
│ │ 🧑 这篇文档讲了什么？ │ │
│ │ 🤖 讲了 Spring Boot  │ │
│ │    的三个核心特性...   │ │
│ │ 🧑 详细说第二点       │ │
│ │ 🤖 第二点是起步依赖...│ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ 继续追问...    [发送] │ │
│ └──────────────────────┘ │
└──────────────────────────┘
```

### 5.2 改造 index.html — 文档问答区域

找到 `viewDocumentModal` 中的文档问答区域（`document-qa-section`），替换为：

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
        <button class="btn btn-secondary btn-small" onclick="clearDocChatHistory()" id="btnClearDocChat"
                style="display:none; margin-left:auto; font-size:12px;">
            🗑️ 清空对话
        </button>
    </div>

    <!-- Day 30：对话历史列表 -->
    <div id="docChatHistory" class="chat-history"></div>

    <!-- 输入区域 -->
    <div class="qa-input-area">
        <input type="text" id="qaInput" placeholder="输入你的问题，例如：这篇文档讲了什么？"
            onkeypress="if(event.key==='Enter') askDocument()">
        <button class="btn btn-primary" onclick="askDocument()">提问</button>
    </div>

    <!-- Token 用量 -->
    <div id="qaTokenUsage" class="token-usage-container" style="display: none;"></div>
</div>
```

### 5.3 改造 index.html — 笔记本问答区域

找到 `notebookQAContent` 中的笔记本问答区域，替换为：

```html
<div class="notebook-qa-content" id="notebookQAContent">
    <p class="notebook-qa-desc">基于当前笔记本内的所有文档内容，综合回答你的问题</p>

    <!-- Day 30：对话历史列表 -->
    <div id="notebookChatHistory" class="chat-history"></div>

    <div class="notebook-qa-inputbox">
        <input type="text" id="notebookQAInput"
               placeholder="例如：这些文档的共同主题是什么？对比各篇的核心观点..."
               onkeypress="if(event.key==='Enter') askNotebook()">
        <button class="btn btn-primary notebook-qa-sendbtn" onclick="askNotebook()">
            <span>🚀</span> 提问
        </button>
    </div>

    <!-- Day 30：清空对话按钮 -->
    <div id="notebookChatActions" class="chat-actions" style="display:none;">
        <button class="btn btn-secondary btn-small" onclick="clearNotebookChatHistory()">🗑️ 清空对话</button>
    </div>

    <!-- Token 用量 -->
    <div id="notebookTokenUsage" class="token-usage-container" style="display: none;"></div>
</div>
```

### 5.4 添加 CSS 样式

在 `style.css` 中添加对话历史的样式：

```css
/* ===== Day 30：对话历史样式 ===== */
.chat-history {
    max-height: 300px;
    overflow-y: auto;
    margin-bottom: 12px;
    padding: 8px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    background: #fafafa;
}

.chat-message {
    margin-bottom: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    line-height: 1.6;
    word-break: break-word;
    white-space: pre-wrap;
}

.chat-message.user {
    background: #e3f2fd;
    border-left: 3px solid #1976d2;
    margin-left: 20px;
}

.chat-message.assistant {
    background: #f5f5f5;
    border-left: 3px solid #9e9e9e;
    margin-right: 20px;
}

.chat-message .role-label {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 4px;
    display: block;
}

.chat-message.user .role-label {
    color: #1976d2;
}

.chat-message.assistant .role-label {
    color: #616161;
}

.chat-message .message-content {
    font-size: 14px;
}

.chat-actions {
    margin-top: 8px;
    text-align: right;
}

/* 流式输出时的动画 */
.chat-message.streaming .message-content::after {
    content: '▊';
    animation: blink 0.8s infinite;
}

@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
}
```

### 5.5 改造 app.js — 文档问答

**新增 API 封装**：

```javascript
// Day 30：对话历史 API
async function getDocChatHistoryAPI(documentId) {
    return fetchAPI(`/api/documents/${documentId}/chat/history`);
}

async function clearDocChatHistoryAPI(documentId) {
    return fetchAPI(`/api/documents/${documentId}/chat/history`, {
        method: 'DELETE',
    });
}

async function getNotebookChatHistoryAPI(notebookId) {
    return fetchAPI(`/api/notebooks/${notebookId}/chat/history`);
}

async function clearNotebookChatHistoryAPI(notebookId) {
    return fetchAPI(`/api/notebooks/${notebookId}/chat/history`, {
        method: 'DELETE',
    });
}
```

**改造 `viewDocument` 函数 — 加载对话历史**：

```javascript
function viewDocument(id) {
    const doc = currentDocuments.find(d => d.id === id);
    if (!doc) return;

    document.getElementById('viewDocumentTitle').textContent = doc.title;

    // ... 摘要区域逻辑不变 ...

    document.getElementById('viewDocumentContent').textContent = doc.content || '（无内容）';
    document.getElementById('viewDocumentTitle').dataset.documentId = id;

    // 重置问答开关
    document.getElementById('qaContextSwitch').checked = true;

    // 清空输入框
    document.getElementById('qaInput').value = '';

    // ===== Day 30：加载对话历史 =====
    loadDocChatHistory(id);
    // ================================

    showModal('viewDocumentModal');
}
```

**新增对话历史渲染函数**：

```javascript
// Day 30：加载文档对话历史
async function loadDocChatHistory(documentId) {
    const historyContainer = document.getElementById('docChatHistory');
    const clearBtn = document.getElementById('btnClearDocChat');

    try {
        const history = await getDocChatHistoryAPI(documentId);
        renderChatHistory(historyContainer, history);

        // 有历史时显示清空按钮
        if (history && history.length > 0) {
            clearBtn.style.display = 'inline-flex';
        } else {
            clearBtn.style.display = 'none';
        }
    } catch (e) {
        historyContainer.innerHTML = '';
        clearBtn.style.display = 'none';
    }
}

// Day 30：渲染对话历史
function renderChatHistory(container, history) {
    if (!history || history.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = history.map(msg => {
        const isUser = msg.role === 'user';
        const roleLabel = isUser ? '🧑 你' : '🤖 AI';
        const cssClass = isUser ? 'user' : 'assistant';
        return `
            <div class="chat-message ${cssClass}">
                <span class="role-label">${roleLabel}</span>
                <span class="message-content">${escapeHtml(msg.content)}</span>
            </div>
        `;
    }).join('');

    // 自动滚动到底部
    container.scrollTop = container.scrollHeight;
}

// Day 30：追加一条消息到对话历史（流式输出时用）
function appendChatMessage(containerId, role, content) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const isUser = role === 'user';
    const roleLabel = isUser ? '🧑 你' : '🤖 AI';
    const cssClass = isUser ? 'user' : 'assistant';

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${cssClass}`;
    if (!isUser) {
        msgDiv.classList.add('streaming');  // 流式输出时添加动画
    }
    msgDiv.innerHTML = `
        <span class="role-label">${roleLabel}</span>
        <span class="message-content">${escapeHtml(content)}</span>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
}

// Day 30：更新流式回答的最后一条消息
function updateStreamingMessage(msgDiv, content) {
    if (!msgDiv) return;
    const contentEl = msgDiv.querySelector('.message-content');
    if (contentEl) {
        contentEl.textContent = content;
    }
    // 滚动到底部
    const container = msgDiv.parentElement;
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

// Day 30：流式回答结束，移除动画
function finishStreamingMessage(msgDiv) {
    if (msgDiv) {
        msgDiv.classList.remove('streaming');
    }
}
```

**改造 `askDocument` 函数**：

```javascript
async function askDocument() {
    const input = document.getElementById('qaInput');
    const question = input.value.trim();
    const currentDocId = document.getElementById('viewDocumentTitle').dataset.documentId;
    const useDocumentContext = document.getElementById('qaContextSwitch').checked;

    if (!question) {
        showToast('请输入问题', 'warning');
        return;
    }

    // ===== Day 30：在对话历史中显示用户问题 =====
    const historyContainer = document.getElementById('docChatHistory');
    appendChatMessage('docChatHistory', 'user', question);
    // ============================================

    // 清空输入框
    input.value = '';

    // 添加 AI 回答占位
    const aiMsgDiv = appendChatMessage('docChatHistory', 'assistant', '');
    const tokenUsageEl = document.getElementById('qaTokenUsage');
    tokenUsageEl.style.display = 'none';
    tokenUsageEl.innerHTML = '';

    showToast('AI 正在思考...', 'info');

    let currentAnswer = '';
    let currentUsage = null;

    try {
        await askDocumentStreamAPI(
            currentDocId,
            question,
            useDocumentContext,
            (chunk) => {
                currentAnswer += chunk;
                updateStreamingMessage(aiMsgDiv, currentAnswer);
            },
            (usage) => {
                currentUsage = usage;
            }
        );

        finishStreamingMessage(aiMsgDiv);
        showToast('回答完成', 'success');

        // 有历史后显示清空按钮
        document.getElementById('btnClearDocChat').style.display = 'inline-flex';
    } catch (error) {
        showToast('回答失败：' + error.message, 'error');
        updateStreamingMessage(aiMsgDiv, '获取回答失败，请稍后重试。');
        finishStreamingMessage(aiMsgDiv);
    } finally {
        if (currentUsage) {
            renderTokenUsageCard('qaTokenUsage', currentUsage);
            accumulateSessionTokens(currentUsage.total);
        }
    }
}

// Day 30：清空文档对话历史
async function clearDocChatHistory() {
    const currentDocId = document.getElementById('viewDocumentTitle').dataset.documentId;
    if (!currentDocId) return;

    if (!confirm('确定要清空当前文档的对话历史吗？')) return;

    try {
        await clearDocChatHistoryAPI(currentDocId);
        document.getElementById('docChatHistory').innerHTML = '';
        document.getElementById('btnClearDocChat').style.display = 'none';
        showToast('对话历史已清空', 'success');
    } catch (error) {
        showToast('清空失败：' + error.message, 'error');
    }
}
```

### 5.6 改造 app.js — 笔记本问答

**改造 `askNotebook` 函数**：

```javascript
async function askNotebook() {
    const input = document.getElementById('notebookQAInput');
    const question = input.value.trim();

    if (!question) {
        showToast('请输入问题', 'warning');
        return;
    }

    // ===== Day 30：在对话历史中显示用户问题 =====
    appendChatMessage('notebookChatHistory', 'user', question);
    // ============================================

    input.value = '';

    // 添加 AI 回答占位
    const aiMsgDiv = appendChatMessage('notebookChatHistory', 'assistant', '');
    const tokenUsageEl = document.getElementById('notebookTokenUsage');
    tokenUsageEl.style.display = 'none';
    tokenUsageEl.innerHTML = '';

    showToast('AI 正在综合多篇文档思考...', 'info');

    let currentAnswer = '';
    let currentUsage = null;

    try {
        await askNotebookStreamAPI(
            currentNotebookId,
            question,
            (chunk) => {
                currentAnswer += chunk;
                updateStreamingMessage(aiMsgDiv, currentAnswer);
            },
            (usage) => {
                currentUsage = usage;
            }
        );

        finishStreamingMessage(aiMsgDiv);
        showToast('回答完成', 'success');

        // 有历史后显示清空按钮
        document.getElementById('notebookChatActions').style.display = 'block';
    } catch (error) {
        showToast('回答失败：' + error.message, 'error');
        updateStreamingMessage(aiMsgDiv, '获取回答失败，请稍后重试。');
        finishStreamingMessage(aiMsgDiv);
    } finally {
        if (currentUsage) {
            renderTokenUsageCard('notebookTokenUsage', currentUsage);
            accumulateSessionTokens(currentUsage.total);
        }
    }
}

// Day 30：清空笔记本对话历史
async function clearNotebookChatHistory() {
    if (!currentNotebookId) return;

    if (!confirm('确定要清空当前笔记本的对话历史吗？')) return;

    try {
        await clearNotebookChatHistoryAPI(currentNotebookId);
        document.getElementById('notebookChatHistory').innerHTML = '';
        document.getElementById('notebookChatActions').style.display = 'none';
        showToast('对话历史已清空', 'success');
    } catch (error) {
        showToast('清空失败：' + error.message, 'error');
    }
}
```

**改造 `selectNotebook` 函数 — 加载笔记本对话历史**：

```javascript
async function selectNotebook(id) {
    currentNotebookId = id;
    renderNotebookList();

    try {
        currentDocuments = await getDocumentsByNotebook(id);
        renderDocumentList();

        const panel = document.getElementById('notebookQAPanel');
        const content = document.getElementById('notebookQAContent');
        const chevron = document.getElementById('notebookQAChevron');
        if (panel) {
            panel.style.display = 'block';
            if (content) content.style.display = 'none';
            if (chevron) chevron.textContent = '▼';
        }
        resetNotebookQA();

        // ===== Day 30：加载笔记本对话历史 =====
        loadNotebookChatHistory(id);
        // ========================================
    } catch (error) {
        showToast('加载文档失败: ' + error.message, 'error');
    }
}

// Day 30：加载笔记本对话历史
async function loadNotebookChatHistory(notebookId) {
    const historyContainer = document.getElementById('notebookChatHistory');
    const chatActions = document.getElementById('notebookChatActions');

    try {
        const history = await getNotebookChatHistoryAPI(notebookId);
        renderChatHistory(historyContainer, history);

        if (history && history.length > 0) {
            chatActions.style.display = 'block';
        } else {
            chatActions.style.display = 'none';
        }
    } catch (e) {
        historyContainer.innerHTML = '';
        chatActions.style.display = 'none';
    }
}
```

**改造 `resetNotebookQA` 函数**：

```javascript
function resetNotebookQA() {
    const input = document.getElementById('notebookQAInput');
    if (input) input.value = '';
    // Day 30：不再手动清空历史区域，由 loadNotebookChatHistory 管理
}
```

### 5.7 删除文档时清空对话历史

```javascript
async function deleteDocument(id) {
    if (!confirm('确定要删除这个文档吗？')) return;

    try {
        await deleteDocumentAPI(id);
        showToast('文档删除成功', 'success');
        currentDocuments = await getDocumentsByNotebook(currentNotebookId);
        renderDocumentList();
        // Day 30：后端会自动清空对话历史，无需前端额外处理
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}
```

### 5.8 测试验证

#### 测试 1：首轮对话（无历史，走缓存）

```
1. 查看一个文档
2. 输入"这篇文档讲了什么？"
3. 点击提问

预期：
  - 对话历史区域显示用户消息 + AI 回答
  - 后端日志：[缓存] 未命中，调用 AI
  - 后端日志：[对话历史] 保存 1 轮对话
  - 清空对话按钮出现
```

#### 测试 2：连续追问（有历史，不走缓存）

```
1. 在同一个文档中继续输入"能更详细解释第二点吗？"
2. 点击提问

预期：
  - 对话历史区域显示 2 轮对话
  - 后端日志：[对话] 检测到 2 条历史消息，跳过缓存
  - AI 能理解"第二点"指什么，给出针对"第二点"的详细解释
```

#### 测试 3：切换文档，对话隔离

```
1. 查看文档 A，问"讲了什么？"
2. 关闭弹窗
3. 查看文档 B，问"讲了什么？"

预期：
  - 文档 B 的对话历史是空的（和文档 A 隔离）
  - 文档 B 的 AI 回答是关于文档 B 的
```

#### 测试 4：清空对话

```
1. 在一个文档中进行 2-3 轮对话
2. 点击"清空对话"按钮
3. 确认清空

预期：
  - 对话历史区域清空
  - 清空按钮消失
  - 下次提问时，AI 不会记得之前的对话（从零开始）
```

#### 测试 5：用 redis-cli 验证

```powershell
docker exec -it my-redis redis-cli

# 查看对话历史 Key
127.0.0.1:6379> KEYS ai:chat:*
1) "ai:chat:doc:1:1"

# 查看对话历史内容
127.0.0.1:6379> GET ai:chat:doc:1:1
"[{\"role\":\"user\",\"content\":\"讲了什么？\"},{\"role\":\"assistant\",\"content\":\"讲了...\"}]"

# 查看剩余过期时间
127.0.0.1:6379> TTL ai:chat:doc:1:1
(integer) 7185

# 清空对话后验证
127.0.0.1:6379> DEL ai:chat:doc:1:1
```

#### 测试 6：验证缓存策略

```
1. 文档 A 第一次问"讲了什么？" → 调用 AI（缓存未命中）
2. 清空对话历史
3. 再次问"讲了什么？" → 走缓存（缓存命中，不调用 AI）

4. 文档 A 问"讲了什么？" → 走缓存
5. 继续问"详细说" → 不走缓存（有历史）
6. 继续问"还有吗" → 不走缓存（有历史）
7. 清空对话历史
8. 问"讲了什么？" → 走缓存
```

#### 测试 7：笔记本级对话

```
1. 选择一个笔记本
2. 展开 AI 笔记本问答面板
3. 进行多轮对话
4. 验证对话历史显示和上下文效果
5. 清空对话历史
```

---

## 改动文件总览

| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `ChatHistoryService.java` | **新建** | 对话历史的 Redis 存取服务 |
| `AiChatService.java` | 修改 | 注入 ChatHistoryService，同步/流式方法增加历史读取和保存，有历史时跳过缓存 |
| `DocumentController.java` | 修改 | 注入 ChatHistoryService，传入 documentId/userId，新增对话历史查询/清空接口 |
| `NotebookController.java` | 修改 | 注入 ChatHistoryService，传入 notebookId/userId，新增对话历史查询/清空接口 |
| `index.html` | 修改 | 文档问答和笔记本问答区域改为对话列表模式，新增清空对话按钮 |
| `app.js` | 修改 | 新增对话历史 API、渲染函数、改造 askDocument/askNotebook 为对话模式 |
| `style.css` | 修改 | 新增对话历史的样式 |

---

## 今日知识图谱

```
对话上下文（Conversation Context）
  ├── 核心认知
  │     ├── API 是无状态的 → 每次请求独立，不存历史
  │     ├── 上下文 = 每次调用时手动传入历史 messages 数组
  │     ├── "1M 上下文" = 单次请求的最大处理能力，不是存储空间
  │     └── 谁存历史？你的代码（Redis），不是 AI 服务器
  ├── 存储设计
  │     ├── 存储介质：Redis（快、支持 TTL 自动过期）
  │     ├── Key 设计：ai:chat:{type}:{resourceId}:{userId}
  │     ├── 数据结构：[{role, content}, ...]
  │     ├── 保留策略：最近 10 轮（20 条消息）
  │     └── 过期时间：2 小时
  ├── 与缓存的关系
  │     ├── 无历史（首轮）→ 走缓存
  │     ├── 有历史（追问）→ 不走缓存
  │     └── 原因：相同问题 + 不同上下文 = 不同回答
  ├── 流式回答的特殊处理
  │     ├── 边流边收集 → StringBuilder 拼接所有 chunk
  │     ├── 流结束再保存 → Mono.fromCallable()
  │     └── 不完整回答不存 → 避免上下文污染
  └── Spring AI 的 Message API
        ├── UserMessage → 用户消息
        ├── AssistantMessage → AI 回答
        ├── SystemMessage → 系统提示（每次重建，不存历史）
        └── chatClient.prompt().messages(history).user(question).call()
```

---

## 测试验证清单

### 功能验证
- [ ] 首轮提问正常，AI 回答正确
- [ ] 连续追问时 AI 能理解上下文（如"第二点"指什么）
- [ ] 不同文档的对话历史互相隔离
- [ ] 不同用户的对话历史互相隔离
- [ ] 清空对话后，AI 从零开始（不再记得之前的对话）
- [ ] 对话历史在 2 小时后自动过期
- [ ] 删除文档时，对话历史被清空
- [ ] 删除笔记本时，对话历史被清空

### 缓存策略验证
- [ ] 无历史时走缓存（相同问题第二次直接返回）
- [ ] 有历史时不走缓存（后端日志显示"跳过缓存"）
- [ ] 清空对话后再问相同问题，走缓存

### 前端验证
- [ ] 对话历史列表正确显示用户消息和 AI 回答
- [ ] 流式输出时逐步追加文字，有打字机效果
- [ ] 清空对话按钮在有历史时显示，无历史时隐藏
- [ ] 切换文档时对话历史正确切换
- [ ] 对话历史超过容器高度时自动滚动到底部

### Redis 验证
- [ ] `KEYS ai:chat:*` 能看到对话历史 Key
- [ ] 对话历史内容是正确的 JSON 数组
- [ ] TTL 显示约 2 小时
- [ ] 清空后 Key 被删除

---

## 今日复盘 Checklist

- [ ] 理解 API 是无状态的——上下文不是 AI 服务器存的，是你的代码每次传过去的
- [ ] 理解 "1M 上下文"是单次请求的处理上限，不是免费存储空间
- [ ] 理解 Spring AI 的 Message API：`UserMessage`、`AssistantMessage`、`SystemMessage`
- [ ] 理解 `.messages(history)` 的作用——把历史对话传给 AI
- [ ] 理解为什么多轮对话不走缓存
- [ ] 理解流式回答时"等流完再存"的原因
- [ ] 理解对话历史按"文档+用户"隔离的设计
- [ ] 理解截断历史（只保留 10 轮）是为了控制 Token 消耗

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| `ClassCastException` 反序列化失败 | `GenericJackson2JsonRedisSerializer` 反序列化 `List<Map>` 时类型不匹配 | 在 `getHistory` 中 try-catch，失败则清空历史重新开始 |
| 流式回答保存历史失败 | `fullAnswer` 没有收集到任何内容（可能 AI 返回了空回答） | 保存前检查 `answer.isEmpty()`，空回答不存 |
| 传了 `.messages(history)` 但 AI 仍然"失忆" | history 列表为空（Redis 中没有数据或读取失败） | 检查 Redis 连接和 Key 是否正确；查看日志中的历史条数 |
| AI 回答"根据文档内容，无法找到相关答案" | 历史消息中包含了 system 消息，Spring AI 可能重复拼接 | 确保历史中只存 user 和 assistant 消息，不存 system |
| 首轮提问后清空对话，再问同样问题不走缓存 | 首轮的回答写入了缓存，但清空对话历史不影响缓存 | 这是正确行为；如果想重新获取 AI 回答，需要换一个问题 |
| 对话历史显示乱码 | Redis 中的 JSON 序列化/反序列化编码问题 | 确保使用 `GenericJackson2JsonRedisSerializer`，检查 Redis 配置 |
| `@Recover` 方法签名不匹配导致重试兜底不生效 | `@Recover` 的参数类型和数量与 `@Retryable` 方法不一致 | 确保 `@Recover` 方法的参数与原方法完全一致（除第一个异常参数外） |

---

## 后续衔接

Day 30 完成后，AI 问答已经从"失忆的一问一答"进化为"有记忆的连续对话"。Day 31 将进入项目收尾阶段：

- 编写完整的 README.md
- 整理 API 文档
- 项目整体测试与 Bug 修复
- Git 打 v1.0.0 Tag

---

## Day 27-30 Redis 四天总结

```
Day 27: Redis 入门
  └── Docker 安装 Redis + Spring Boot 集成 + 基本读写

Day 28: 缓存 AI 回答
  └── Cache-Aside 模式 + 问题 Hash 做 Key + 文档变更清缓存

Day 29: 限流保护
  └── 固定窗口计数器 + 用户级限流 + 限流状态查询

Day 30: 对话上下文
  └── Redis 存对话历史 + .messages(history) 传上下文 + 多轮对话不走缓存

Redis 在本项目中的角色：
  不是替代 MySQL，而是作为"加速层"、"保护层"和"记忆层"
  ├── 加速：缓存 AI 回答，省 Token 费用
  ├── 保护：限流控制，防止 API 额度被滥用
  └── 记忆：存对话历史，实现多轮上下文
```
