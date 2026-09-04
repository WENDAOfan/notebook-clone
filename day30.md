# Day 30: 对话上下文 — 让 AI 记住你们聊过什么

**目标**：用 MySQL 存储对话历史，实现多轮对话——用户可以基于 AI 之前的回答继续追问，而不是每次都从零开始。

---

## 当前状态

Day 29 完成后，AI 问答已经接入了 RAG——检索最相关的文档块送进 prompt。但有一个严重的体验问题：**AI 是"失忆"的**。

```
用户第 1 次问："这篇文档讲了什么？"
  AI 回答："这篇文档讲了卫星网络切片资源调度的三个策略：SA-MS、RA-SMA、LC-SRA..."

用户第 2 次问："能更详细解释第二个策略吗？"
  AI：？？？"第二个策略"是什么？我不知道你在说什么啊！
                                    ↑
                          没有上下文，AI 不知道"第二个"指什么
```

**Day 30 的解决方案**：把每轮对话存进 MySQL，每次调用 AI 时把历史消息带上，实现连续对话。

---

## 步骤 1/5: 认知学习 — API 的"上下文"到底是什么

### 1.1 核心认知：API 是无状态的

**DeepSeek 的 API 不会帮你存任何上下文**——每次请求都是独立的。

```
DeepSeek API 是一个"失忆专家"：

你第 1 次打电话："这篇文档讲了什么？"
  失忆专家回答："讲了卫星切片..."
  然后他立刻忘记了这次对话

你第 2 次打电话："能更详细解释第二点吗？"
  失忆专家："什么第二点？我不知道你在说什么"

要让失忆专家理解"第二点"，你必须每次打电话时把之前的对话全部复述一遍：
  "之前我问了'这篇文档讲了什么？'，你回答'讲了 SA-MS、RA-SMA、LC-SRA'。
   现在我问：第二个能详细说吗？"
```

### 1.2 用代码理解：messages 数组

```json
// 第 1 轮调用：只有 1 条用户消息
{ "messages": [
    {"role": "system", "content": "你是助手"},
    {"role": "user", "content": "这篇文档讲了什么？"}
]}

// 第 2 轮调用：你必须自己把第 1 轮的问答都带上
{ "messages": [
    {"role": "system", "content": "你是助手"},
    {"role": "user", "content": "这篇文档讲了什么？"},
    {"role": "assistant", "content": "讲了 SA-MS、RA-SMA、LC-SRA..."},
    {"role": "user", "content": "第二个能详细说吗？"}
]}
```

**第 2 轮调用时，你把第 1 轮的问答又完整发了一遍。** DeepSeek 每次都是从零开始理解，只不过你把历史喂给了它。

### 1.3 DeepSeek 官网能"记住"，是谁在存？

```
DeepSeek 官网的前端代码（运行在你的浏览器里）：
  1. 把你的每条消息和 AI 的每条回答，存在浏览器内存里
  2. 每次你发新消息时，把整个对话历史拼成 messages 数组
  3. 调用 API，把这个大数组发过去
  4. 拿到回答后，追加到历史列表中

是前端代码在管理上下文，不是 DeepSeek 服务器在记！
```

---

## 步骤 2/5: 创建对话历史实体和存储

### 2.1 设计决策

| 决策点 | 选择 | 理由 |
|:---|:---|:---|
| 历史存哪？ | **MySQL（JPA）** | 已有数据库，不引入新依赖 |
| 对话粒度？ | **按文档/笔记本隔离** | 文档 A 的对话不应该影响文档 B |
| 保留几轮？ | **10 轮（20 条消息）** | 平衡上下文质量和 Token 消耗 |
| 自动清理？ | **定期清理超过 7 天的历史** | 避免数据库无限增长 |

### 2.2 新建 ChatMessage 实体

```java
package com.example.notebook_clone.entity;

@Entity
@Table(name = "chat_message", indexes = {
    @Index(name = "idx_chat_session", columnList = "sessionId"),
    @Index(name = "idx_chat_created", columnList = "createTime")
})
public class ChatMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 会话 ID：格式为 "doc:{documentId}:{userId}" 或 "notebook:{notebookId}:{userId}" */
    @Column(nullable = false)
    private String sessionId;

    /** 消息角色：user / assistant */
    @Column(nullable = false, length = 20)
    private String role;

    /** 消息内容 */
    @Column(nullable = false, columnDefinition = "LONGTEXT")
    private String content;

    /** 关联的文档 ID（文档级对话时） */
    private Long documentId;

    /** 关联的笔记本 ID（笔记本级对话时） */
    private Long notebookId;

    /** 关联的用户 ID */
    @Column(nullable = false)
    private Long userId;

    @Column(nullable = false)
    private LocalDateTime createTime;

    // getter/setter 省略
}
```

### 2.3 新建 ChatMessageRepository

```java
package com.example.notebook_clone.repository;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {

    /** 按会话 ID 查询历史，按时间升序 */
    List<ChatMessage> findBySessionIdOrderByCreateTimeAsc(String sessionId);

    /** 统计某个会话的消息数 */
    long countBySessionId(String sessionId);

    /** 删除某个会话的所有消息 */
    void deleteBySessionId(String sessionId);

    /** 删除某个文档的所有对话历史 */
    void deleteByDocumentIdAndUserId(Long documentId, Long userId);

    /** 删除某个笔记本的所有对话历史 */
    void deleteByNotebookIdAndUserId(Long notebookId, Long userId);

    /** 清理过期历史 */
    @Modifying
    @Query("DELETE FROM ChatMessage c WHERE c.createTime < :cutoff")
    void deleteExpired(@Param("cutoff") LocalDateTime cutoff);
}
```

### 2.4 新建 ChatHistoryService

```java
package com.example.notebook_clone.service;

@Service
@RequiredArgsConstructor
@Slf4j
public class ChatHistoryService {

    private final ChatMessageRepository chatMessageRepository;

    /** 最大保留轮数 */
    private static final int MAX_ROUNDS = 10;
    /** 历史保留天数 */
    private static final int HISTORY_DAYS = 7;

    // ========== Key 构建 ==========

    public String buildDocSessionId(Long documentId, Long userId) {
        return "doc:" + documentId + ":" + userId;
    }

    public String buildNotebookSessionId(Long notebookId, Long userId) {
        return "notebook:" + notebookId + ":" + userId;
    }

    // ========== 读取历史 ==========

    /**
     * 获取对话历史，转为 Spring AI 的 Message 列表
     */
    public List<Message> getHistoryAsMessages(String sessionId) {
        List<ChatMessage> messages = chatMessageRepository
                .findBySessionIdOrderByCreateTimeAsc(sessionId);

        return messages.stream()
                .map(msg -> {
                    if ("user".equals(msg.getRole())) {
                        return (Message) new UserMessage(msg.getContent());
                    } else {
                        return (Message) new AssistantMessage(msg.getContent());
                    }
                })
                .toList();
    }

    // ========== 保存历史 ==========

    /**
     * 保存一轮对话（用户问题 + AI 回答）
     */
    @Transactional
    public void saveTurn(String sessionId, Long documentId, Long notebookId,
                          Long userId, String question, String answer) {
        LocalDateTime now = LocalDateTime.now();

        // 保存用户消息
        ChatMessage userMsg = new ChatMessage();
        userMsg.setSessionId(sessionId);
        userMsg.setRole("user");
        userMsg.setContent(question);
        userMsg.setDocumentId(documentId);
        userMsg.setNotebookId(notebookId);
        userMsg.setUserId(userId);
        userMsg.setCreateTime(now);
        chatMessageRepository.save(userMsg);

        // 保存 AI 回答
        ChatMessage assistantMsg = new ChatMessage();
        assistantMsg.setSessionId(sessionId);
        assistantMsg.setRole("assistant");
        assistantMsg.setContent(answer);
        assistantMsg.setDocumentId(documentId);
        assistantMsg.setNotebookId(notebookId);
        assistantMsg.setUserId(userId);
        assistantMsg.setCreateTime(now);
        chatMessageRepository.save(assistantMsg);

        // 截断：只保留最近 MAX_ROUNDS 轮
        truncateHistory(sessionId);
    }

    /**
     * 截断历史消息，只保留最近 MAX_ROUNDS 轮
     */
    private void truncateHistory(String sessionId) {
        List<ChatMessage> allMessages = chatMessageRepository
                .findBySessionIdOrderByCreateTimeAsc(sessionId);
        int maxMessages = MAX_ROUNDS * 2;
        if (allMessages.size() > maxMessages) {
            List<ChatMessage> toDelete = allMessages.subList(0, allMessages.size() - maxMessages);
            chatMessageRepository.deleteAll(toDelete);
        }
    }

    // ========== 清空历史 ==========

    @Transactional
    public void clearDocHistory(Long documentId, Long userId) {
        chatMessageRepository.deleteByDocumentIdAndUserId(documentId, userId);
    }

    @Transactional
    public void clearNotebookHistory(Long notebookId, Long userId) {
        chatMessageRepository.deleteByNotebookIdAndUserId(notebookId, userId);
    }

    // ========== 定期清理 ==========

    @Scheduled(cron = "0 0 3 * * ?")  // 每天凌晨 3 点
    @Transactional
    public void cleanExpiredHistory() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(HISTORY_DAYS);
        chatMessageRepository.deleteExpired(cutoff);
        log.info("[对话历史] 清理 7 天前的过期记录");
    }
}
```

---

## 步骤 3/5: 改造 AiChatService — 带上历史"记忆"

### 3.1 改造思路

```
之前（Day 29，无上下文）：
  用户提问 → RAG 检索 → 拼 prompt → AI 回答

之后（Day 30，有上下文）：
  用户提问 → 读取对话历史 → RAG 检索 → 历史 + 检索结果 + 问题拼 prompt → AI 回答 → 保存本轮
```

### 3.2 改造单文档问答

```java
public String askBasedOnDocument(String documentContent, String question,
        boolean useDocumentContext, Long documentId, Long userId) {

    // 1. 读取对话历史
    String sessionId = chatHistoryService.buildDocSessionId(documentId, userId);
    List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);

    // 2. RAG 检索（Day 29 的逻辑）
    String context = useDocumentContext
            ? buildContextFromRAG(question)
            : "";

    // 3. 构建 Prompt
    String systemPrompt = buildSingleDocSystemPrompt(useDocumentContext);
    String userPrompt = buildSingleDocUserPrompt(context, question, useDocumentContext);

    // 4. 调用 AI（带历史）
    ChatResponse chatResponse = chatClient.prompt()
            .system(systemPrompt)
            .messages(history)      // ← Day 30：传入历史消息
            .user(userPrompt)
            .call()
            .chatResponse();

    String answer = chatResponse.getResult().getOutput().getText();

    // 5. 保存本轮对话
    chatHistoryService.saveTurn(sessionId, documentId, null, userId, question, answer);

    return answer;
}
```

### 3.3 流式回答的特殊处理

流式回答不能边流边存——必须等流完整结束后，收集完整回答再保存：

```java
public Flux<ServerSentEvent<String>> askBasedOnDocumentStream(
        String documentContent, String question, boolean useDocumentContext,
        Long documentId, Long userId) {

    // 读取历史
    String sessionId = chatHistoryService.buildDocSessionId(documentId, userId);
    List<Message> history = chatHistoryService.getHistoryAsMessages(sessionId);

    // RAG 检索
    String context = useDocumentContext ? buildContextFromRAG(question) : "";

    // 构建 Prompt
    String systemPrompt = buildSingleDocSystemPrompt(useDocumentContext);
    String userPrompt = buildSingleDocUserPrompt(context, question, useDocumentContext);

    // 收集完整回答
    StringBuilder fullAnswer = new StringBuilder();

    Flux<ServerSentEvent<String>> contentFlux = chatClient.prompt()
            .system(systemPrompt)
            .messages(history)      // ← Day 30：传入历史
            .user(userPrompt)
            .stream()
            .chatResponse()
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
            .filter(text -> !text.isEmpty())
            .map(text -> ServerSentEvent.<String>builder().data(text).build());

    // 流结束后保存历史
    return contentFlux.concatWith(Mono.fromCallable(() -> {
        String answer = fullAnswer.toString();
        if (!answer.isEmpty()) {
            chatHistoryService.saveTurn(sessionId, documentId, null, userId, question, answer);
        }
        return null;
    }).filter(java.util.Objects::nonNull));
}
```

**为什么不边流边存？**

```
如果中途断流（网络错误），保存了不完整的回答作为"历史"，
下次 AI 看到不完整的上下文，回答质量会很差。
所以必须等流完整结束再保存。
```

---

## 步骤 4/5: 前端改造 — 对话列表模式

### 4.1 UI 变化

```
之前（一问一答）：
┌──────────────────────────┐
│ 💬 智能问答              │
│ [输入框]  [提问]         │
│ 🤖 回答：（textarea）    │
└──────────────────────────┘

之后（对话列表）：
┌──────────────────────────┐
│ 💬 智能问答    🗑️ 清空对话│
│ ┌──────────────────────┐ │
│ │ 🧑 这篇文档讲了什么？ │ │
│ │ 🤖 讲了三个策略...    │ │
│ │ 🧑 详细说第二点       │ │
│ │ 🤖 第二点是RA-SMA...  │ │
│ └──────────────────────┘ │
│ [输入框]          [提问] │
└──────────────────────────┘
```

### 4.2 前端改造要点

- `viewDocumentModal` 中的问答区域改为对话列表 `<div id="docChatHistory">`
- 每次提问后，在列表中追加用户消息和 AI 回答
- 流式输出时逐步追加文字（打字机效果）
- 有历史时显示"清空对话"按钮
- 调用 `GET /api/documents/{id}/chat/history` 加载历史
- 调用 `DELETE /api/documents/{id}/chat/history` 清空历史

（前端代码和之前的 Redis 版本结构一致，只是后端存储从 Redis 换成了 MySQL，API 接口不变。）

---

## 步骤 5/5: 测试验证

### 测试 1：连续追问

```
1. 查看一个文档
2. 输入"这篇文档讲了什么？" → AI 回答
3. 继续输入"详细说第二点" → AI 应该理解"第二点"指什么
```

### 测试 2：对话隔离

```
1. 文档 A 问"讲了什么？" → AI 回答文档 A
2. 关闭弹窗，打开文档 B
3. 文档 B 的对话历史应该是空的
```

### 测试 3：清空对话

```
1. 在文档中进行 2-3 轮对话
2. 点击"清空对话"
3. 再提问 → AI 从零开始，不记得之前的对话
```

---

## 改动文件总览

| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `ChatMessage.java` | **新建** | 对话消息 JPA 实体 |
| `ChatMessageRepository.java` | **新建** | 对话消息数据访问层 |
| `ChatHistoryService.java` | **新建** | 对话历史的读取/保存/截断/清理 |
| `AiChatService.java` | 修改 | 注入 ChatHistoryService，同步/流式方法加入历史读取和保存 |
| `DocumentController.java` | 修改 | 新增对话历史查询/清空接口，删除文档时清空历史 |
| `NotebookController.java` | 修改 | 同上，笔记本级 |
| `index.html` | 修改 | 问答区域改为对话列表模式 |
| `app.js` | 修改 | 新增对话历史加载/渲染/清空逻辑 |
| `style.css` | 修改 | 对话气泡样式 |

---

## Day 27-30 四天总结

```
Day 27: 文档文本提取 + 混合输入
  └── PDF/DOCX 提取 → 文本清洗（去水印/去噪声）→ 为 RAG 准备干净文本

Day 28: 文本分块 + 向量化
  └── 分块（Token 512 + 重叠 50）→ Embedding 模型生成向量 → 存入 VectorStore

Day 29: 检索增强问答（RAG）
  └── 用户提问 → 向量检索 Top-K → 拼进 prompt → LLM 生成带引用的回答

Day 30: 对话上下文
  └── MySQL 存对话历史 → .messages(history) 传上下文 → 多轮连续对话

RAG 管线全流程：
  上传 → 提取清洗(Day27) → 分块向量化(Day28) → 检索增强(Day29) → 多轮对话(Day30)
```

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| 传了 `.messages(history)` 但 AI 仍然"失忆" | 历史查询结果为空 | 检查 sessionId 拼接是否正确，数据库里是否有记录 |
| 对话越来越长，Token 消耗暴增 | 没有截断历史 | `truncateHistory()` 只保留最近 10 轮 |
| 流式回答保存了不完整的回答 | 中途断流 | 只在流完整结束后保存 |
| 删除文档后对话历史残留 | 没有级联删除 | 删除文档时调用 `clearDocHistory` |
| 数据库越来越大 | 历史消息没有过期清理 | `@Scheduled` 每天清理 7 天前的记录 |

---

# Day 30 代码审查：待解决问题清单

> 下面是对 `notebook-clone` 项目（Day 30 对话历史 + RAG）全面审查后发现的潜在问题，按 **严重 / 中等 / 建议** 三级分类。建议按优先级逐个修复。

## 一、严重问题（优先修复）

### 1. RAG 检索未按 documentId/notebookId 过滤，存在跨文档/跨笔记本污染
- **涉及文件**：`service/AiChatService.java:45-60`
- **问题**：`retrieveRelevantChunks()` 直接对全量向量库做 `similaritySearch`，没有按当前文档或笔记本过滤。
- **影响**：用户问文档 A 的问题，可能返回文档 B 或笔记本 C 的内容，答案来源错误。
- **修复方向**：在 chunk 元数据中补充 `notebookId`，检索时用 `SearchRequest.filterExpression(...)` 过滤；生产环境迁移到 pgvector / Redis Vector Store。

### 2. SimpleVectorStore 是内存存储，重启后向量丢失且不会从数据库重载
- **涉及文件**：`config/VectorStoreConfig.java:48-51`
- **问题**：`SimpleVectorStore` 存在 JVM 内存中，重启清空；启动时也没有从 `document` 表重新分块加载。
- **影响**：每次部署/重启后 RAG 失效，自动降级为“全文截断”，长文档直接塞 Prompt。
- **修复方向**：开发环境保留，但加启动重载逻辑（扫描所有文档异步重新 `chunkAndStoreAsync`）；生产环境换持久化向量库。

### 3. 手动创建的文本文档永远不会被分块/向量化
- **涉及文件**：`controller/DocumentController.java:64-85`
- **问题**：`createDocument()` 只保存数据库记录，没有调用 `chunkAndStoreAsync()` 和 `generateSummaryAsync()`。
- **影响**：手动输入的长文档无法使用 RAG，问答时只能全文截断；也没有 AI 摘要。
- **修复方向**：在 `createDocument` 保存后同样异步触发摘要生成和分块向量化。

### 4. 删除笔记本/用户时，向量块和对话历史没有被级联清理
- **涉及文件**：`controller/NotebookController.java:103-122`、`controller/UserController.java:53-62`、`entity/Notebook.java:37`、`entity/User.java:39`
- **问题**：JPA 级联删除文档/用户时，不会调用 `deleteDocumentChunks()`，也不会清理对话历史。
- **影响**：向量库残留“僵尸”块，导致检索污染、内存膨胀；`chat_message` 成为孤儿记录。
- **修复方向**：删除前先查出旗下所有文档 ID，逐个清理向量块和对话历史，再删实体。

### 5. 流式接口在 EventLoop 线程中同步调用数据库保存历史
- **涉及文件**：`service/AiChatService.java:388-399, 518-529`
- **问题**：`concatWith(Mono.fromCallable(...))` 里直接调用 `chatHistoryService.saveTurn()`，阻塞 JDBC 操作运行在 Netty EventLoop 上。
- **影响**：高并发或数据库慢时阻塞 EventLoop，导致所有 WebFlux 响应卡顿甚至假死。
- **修复方向**：使用 `.subscribeOn(Schedulers.boundedElastic())`，或改由异步线程池保存。

### 6. `application.properties` 中硬编码敏感信息
- **涉及文件**：`resources/application.properties:5,20,31`
- **问题**：MySQL 密码、DeepSeek API Key、智谱 AI API Key 全部明文硬编码。
- **影响**：代码一旦入 Git 立刻泄露密钥；所有环境共用同一套密钥。
- **修复方向**：使用环境变量，例如 `${DEEPSEEK_API_KEY:}`，本地用 `.env` 或 IDE 环境变量注入。

### 7. `/test/**` 接口未授权且暴露向量和分块触发能力
- **涉及文件**：`config/SecurityConfig.java:47`、`controller/ChunkTestController.java`
- **问题**：`/test/**` 全部放行，`ChunkTestController` 可无权限触发任意文档分块、搜索全局向量库。
- **影响**：未登录用户也能触发分块和向量搜索，造成信息泄露和算力滥用。
- **修复方向**：开发完成后删除测试 Controller；或要求登录并校验文档归属。

### 8. `UserController` 存在超级管理员接口且创建用户时密码明文存储
- **涉及文件**：`controller/UserController.java:24-62`
- **问题**：所有 `/api/users` 接口只要登录就能访问；`createUser()` 密码未经过 `PasswordEncoder` 加密。
- **影响**：普通用户可删其他用户及全部数据；新用户密码明文存储。
- **修复方向**：加角色权限控制（ADMIN），或仅由 `AuthController` 管理用户；创建/修改用户必须 `PasswordEncoder.encode()`。

### 9. JWT Secret 使用弱随机字符串且所有环境相同
- **涉及文件**：`resources/application.properties:13`、`util/JwtUtil.java:17`
- **问题**：`jwt.secret` 是硬编码示例字符串。
- **影响**：密钥可预测，Token 易被伪造，身份认证失效。
- **修复方向**：从环境变量读取，生产环境使用至少 256 位随机密钥，不同环境不同密钥。

---

## 二、中等问题（建议近期修复）

### 10. 文档删除时向量块清理依赖 `chunkCount`，存在残留风险
- **涉及文件**：`service/DocumentChunkService.java:110-134`
- **问题**：按 `chunkCount` 生成 ID 再删除，若实际块数不一致会漏删或删错。
- **修复方向**：删除前用 `filterExpression(documentId == x)` 查出所有相关块 ID 再删。

### 11. 向量块 ID 是确定性生成，重新索引后旧块可能残留
- **涉及文件**：`service/DocumentChunkService.java:153-155`
- **问题**：`buildChunkId(documentId, chunkIndex)` 只依赖下标。内容变短时旧高下标块会残留。
- **修复方向**：重新索引时先彻底删除旧块再写入；或用 UUID + 文档版本号作为块 ID。

### 12. 对话历史没有 Token/长度预算控制，可能撑爆模型上下文
- **涉及文件**：`service/ChatHistoryService.java:48-61`、`service/AiChatService.java:86,162,320,415`
- **问题**：`MAX_ROUNDS=10` 只限制轮数，不限制总 Token；单条消息也可能很长。
- **修复方向**：按总 Token 数或字符数截断历史，优先保留最近消息。

### 13. 同一轮对话中 user/assistant 使用相同 `createTime`，排序可能不稳定
- **涉及文件**：`service/ChatHistoryService.java:75-104`
- **问题**：用户消息和 AI 回答的 `createTime` 都是 `LocalDateTime.now()`，高并发或批量写入时顺序可能错乱。
- **修复方向**：给 assistant 消息加微小时间偏移，或按 `id` 自增作为第二排序字段。

### 14. `saveTurn` 中先保存后截断，高并发时可能出现竞态
- **涉及文件**：`service/ChatHistoryService.java:75-117`
- **问题**：截断逻辑是“读取全部 → 删除前 N 条”，并发下可能都保留后 `maxMessages` 条，结果超出限制。
- **修复方向**：使用数据库级删除，例如 `DELETE ... WHERE id <= (SELECT id ... LIMIT 1 OFFSET ?)`。

### 15. 上传文件缺少服务端类型校验、大小提示和文件名安全处理
- **涉及文件**：`controller/DocumentController.java:104-141`、`service/DocumentExtractService.java:22-57`
- **问题**：仅按扩展名判断类型，未校验 MIME、文件头、处理路径穿越文件名。
- **修复方向**：服务端校验扩展名、文件大小、Content-Type；使用 `FilenameUtils.getName()` 处理文件名；解析设置超时和内存上限。

### 16. 同步问答接口重试覆盖不全，流式接口无重试
- **涉及文件**：`service/AiChatService.java:71-137, 148-244, 307-400, 402-530`
- **问题**：仅对 `RestClientException` 重试；流式方法没有 `@Retryable`，超时/限流等可能直接失败。
- **修复方向**：统一捕获 AI 调用异常，增加超时配置和指数退避重试；流式接口 `onErrorResume` 返回友好 SSE 错误事件。

### 17. 前端 `parseCitations` 按 `---` 分割，可能误伤正常 Markdown 内容
- **涉及文件**：`resources/static/js/app.js:1335-1389`
- **问题**：AI 回答中的 `---` 分隔线会被当成引用分隔符。
- **修复方向**：使用更严格的引用分隔标记，例如 `---SOURCES---`，或要求 AI 输出 JSON 格式引用。

### 18. 前端流式输出期间没有禁用发送按钮，可重复触发请求
- **涉及文件**：`resources/static/js/app.js:982-1048, 1072-1132`
- **问题**：流式响应过程中没有“回答中”状态，用户可反复点击发送。
- **修复方向**：增加 `isAnswering` 全局状态，流式期间禁用输入框和发送按钮，并支持 AbortController 取消上一个请求。

### 19. 前端未正确取消/管理 SSE 请求，切换页面时可能造成内存泄漏
- **涉及文件**：`resources/static/js/app.js:305-403`
- **问题**：`fetchStream` 没有 `AbortController`，切换页面或重发问题时前一个流仍在后台读取。
- **修复方向**：传入 `AbortSignal`，在切换笔记本、关闭文档、重发问题时 `abort()`。

### 20. `ddl-auto=update` 和 `show-sql=true` 不适合生产环境
- **涉及文件**：`resources/application.properties:8,10`
- **问题**：启动时自动改表结构；控制台打印完整 SQL。
- **修复方向**：生产环境使用 `validate` 或 `none`，由 Flyway/Liquibase 管理迁移；关闭 `show-sql`。

### 21. `GlobalExceptionHandler` 覆盖不全，部分异常直接暴露堆栈
- **涉及文件**：`common/GlobalExceptionHandler.java`
- **问题**：只处理了少数异常；`RuntimeException` 默认返回 200 但 code=400 也可能让前端困惑。
- **修复方向**：补充常见异常处理器；使用自定义业务异常；生产环境不返回堆栈。

---

## 三、建议项（可优化）

### 22. Controller 与 Service 参数传递风格不一致
- **涉及文件**：`controller/DocumentController.java:221-288`、`controller/NotebookController.java:124-188`
- **建议**：同步接口用 `@RequestBody`，流式接口用 `@RequestParam`，建议统一封装 DTO。

### 23. 多处权限校验写法不统一
- **涉及文件**：`controller/DocumentController.java:195-217`、`controller/NotebookController.java:169-175`
- **建议**：统一使用 `findByIdAndUserId` / `existsByIdAndUserId`，避免触发懒加载和 N+1。

### 24. 实体类使用 `@Data` 可能带来潜在风险
- **涉及文件**：所有 `entity/*.java`
- **建议**：JPA 实体建议用 `@Getter/@Setter`，显式排除关联字段的 `toString/equals/hashCode`。

### 25. JWT 过滤器使用 `System.out.println` 而非日志框架
- **涉及文件**：`util/JwtUtil.java:86-94`
- **建议**：改为 `log.warn/error`，便于统一收集和告警。

### 26. 日志输出中打印用户问题和完整 AI 回答，存在隐私风险
- **建议**：建立规范——生产环境不打印完整对话内容，最多记录长度和会话 ID。

### 27. 缺少限流/熔断，AI 接口可能被滥用
- **建议**：引入 Bucket4j / Sentinel / Resilience4j，对上传、问答、摘要等接口按用户限流。

### 28. `AsyncConfig` 线程池缺少拒绝策略细节和优雅关闭等待时间
- **涉及文件**：`config/AsyncConfig.java:32-43`
- **建议**：补充 `setAwaitTerminationSeconds`、`setWaitForTasksToCompleteOnShutdown` 等优雅关闭配置。

### 29. 前端 Token 费用按固定单价计算，不准确
- **涉及文件**：`resources/static/js/app.js:969-979, 1135-1147`
- **建议**：按模型和输入/输出分别计价，或仅显示 Token 数不显示费用。

### 30. 前端 `loadDocChatHistory` 在文档内容较长时全量渲染，未分页
- **涉及文件**：`resources/static/js/app.js:899-935`
- **建议**：后端接口支持分页，前端滚动加载或限制默认展示最近 N 轮。

---

## 四、最需要优先处理的 Top 5

1. **RAG 检索未按文档/笔记本过滤** — 跨文档污染，答案来源错误。
2. **SimpleVectorStore 内存丢失且不重载** — 重启后 RAG 失效。
3. **手动创建的文本文档未触发分块/摘要** — 功能缺失。
4. **删除笔记本/用户时向量与历史未清理** — 数据污染和孤儿记录。
5. **流式接口在 EventLoop 中阻塞保存历史** — 高并发下可用性风险。

> 建议先解决 Top 5，再逐步处理中等问题，最后按需优化建议项。
