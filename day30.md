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
