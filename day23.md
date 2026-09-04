# Day 23: AI 流式输出（SSE 打字机效果）

**目标**：将现有的同步阻塞式 AI 问答改为 SSE 流式输出，实现"打字机"效果。

---

## 当前状态

现有 AI 问答全部使用 `chatClient.prompt()...call().content()` 同步阻塞模式，用户需等待完整回答才能看到结果。涉及文件：

| 文件 | 关键方法 |
|:---|:---|
| [AiChatService.java](notebook-clone/src/main/java/com/example/notebook_clone/service/AiChatService.java) | `askBasedOnDocument()` 返回 `String` |
| [AiChatService.java](notebook-clone/src/main/java/com/example/notebook_clone/service/AiChatService.java) | `askBasedOnDocuments()` 返回 `String` |
| [DocumentController.java](notebook-clone/src/main/java/com/example/notebook_clone/controller/DocumentController.java) | `POST /api/documents/{id}/ask` |
| [NotebookController.java](notebook-clone/src/main/java/com/example/notebook_clone/controller/NotebookController.java) | `POST /api/notebooks/{id}/ask` |
| [TestAiController.java](notebook-clone/src/main/java/com/example/notebook_clone/controller/TestAiController.java) | `POST /test/ai` |

---

## 步骤 1/5: 认知学习 — SSE vs WebSocket（前 10 分钟，不写代码）

### SSE（Server-Sent Events）
- **单向**：服务器 → 客户端，客户端不能通过 SSE 发数据
- **基于 HTTP**：走标准 HTTP 协议，无需额外握手
- **自动重连**：浏览器原生 `EventSource` API 断线后自动重连
- **数据格式**：`text/event-stream`，纯文本流
- **适用场景**：AI 流式输出、股票行情推送、进度条更新

### WebSocket
- **双向**：服务器 ↔ 客户端，双方可随时发送数据
- **独立协议**：`ws://` / `wss://`，需要 HTTP Upgrade 握手
- **更重**：需要维护长连接，心智负担更高
- **适用场景**：聊天室、协作编辑、多人在线游戏

### 本项目为什么用 SSE
AI 问答是**单向推送**（客户端发完问题后只需要接收答案），不需要双向通信。SSE 实现更简单、更轻量。

### Flux\<String\> 响应式基础
- `Flux<T>` 是 Reactor 中的 **0..N 个元素的异步序列**（对比 `List<T>` 是"拉取"，Flux 是"推送"）
- Spring AI 的 `ChatClient` 提供了 `.stream().content()` 直接返回 `Flux<String>`，每个元素是一个 token/chunk
- Spring WebFlux / MVC 原生支持 `Flux` 作为返回值，框架自动转为 SSE

---

## 步骤 2/5: 改造 AiChatService，添加流式方法（核心改动）

在 `AiChatService` 中新增两个流式方法，保留原有同步方法不动：

### 要添加的方法

**方法 A：单文档流式问答**
```java
public Flux<String> askBasedOnDocumentStream(
    String documentContent, String question, boolean useDocumentContext)
```
- 与现有 `askBasedOnDocument()` 使用相同的 System Prompt 构建逻辑
- 区别：用 `.stream().content()` 替代 `.call().content()`
- 可直接复用 Prompt 构建部分，封装一个私有方法避免重复

**方法 B：多文档流式问答**
```java
public Flux<String> askBasedOnDocumentsStream(
    List<String[]> documents, String question)
```
- 与现有 `askBasedOnDocuments()` 相同的上下文拼接逻辑
- 同样改用 `.stream().content()`

### 重构建议
将 Prompt 构建逻辑抽取为私有方法：
- `buildSingleDocPrompt(documentContent, question, useDocumentContext)` → 返回 `String`
- `buildMultiDocPrompt(documents, question)` → 返回 `String`

这样同步方法和流式方法都能复用。

---

## 步骤 3/5: 创建流式 API 端点

在三个 Controller 中分别添加流式端点，全部返回 `application/json` 的 `MediaType.TEXT_EVENT_STREAM_VALUE`：

### 3.1 DocumentController — 文档级流式问答
```java
@GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<String> askDocumentStream(
    @PathVariable Long id,
    @RequestParam String question,
    @RequestParam(defaultValue = "true") boolean useDocumentContext)
```
- 用 `@GetMapping` + `@RequestParam` 代替 POST body，方便浏览器 `EventSource` 直接调用
- 注入当前用户做权限校验
- 返回 `Flux<String>`

### 3.2 NotebookController — 笔记本级流式问答
```java
@GetMapping(value = "/{id}/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<String> askNotebookStream(
    @PathVariable Long id,
    @RequestParam String question)
```
- 同样用 GET + query param 方式

### 3.3 TestAiController — 测试用流式端点
```java
@GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<String> testStream(
    @RequestParam String question,
    @RequestParam(required = false) String systemPrompt)
```

---

## 步骤 4/5: 测试流式输出

### 用 curl 测试（推荐，最直观）
```bash
# 测试公开的 test 端点（无需 token）
curl -N "http://localhost:8080/test/ai/stream?question=用三句话介绍Spring Boot"

# 测试文档级流式问答（需要 token）
curl -N -H "Authorization: Bearer <your-jwt-token>" \
  "http://localhost:8080/api/documents/1/ask/stream?question=这篇文章讲了什么"

# 测试笔记本级流式问答（需要 token）
curl -N -H "Authorization: Bearer <your-jwt-token>" \
  "http://localhost:8080/api/notebooks/1/ask/stream?question=综合所有文档总结一下"
```

### 用浏览器测试
直接用浏览器打开 `http://localhost:8080/test/ai/stream?question=你好`，观察文字逐字出现。

### 用 Postman/Apifox 测试
选择 "Send and Download" 模式或使用 SSE 专用测试功能，观察逐 token 输出。

### 预期效果
回答不再是一次性返回，而是像 ChatGPT 一样一个字一个字地"打"出来。

---

## 步骤 5/5: 代码提交与复盘

```bash
git add -A
git commit -m "feat: add SSE streaming for AI Q&A endpoints"
```

### 今日复盘 Checklist
- [ ] 能说出 SSE 和 WebSocket 的核心区别
- [ ] 理解 `.call().content()` vs `.stream().content()` 的区别
- [ ] 知道 `Flux<String>` 为什么能实现流式推送
- [ ] 了解 `produces = MediaType.TEXT_EVENT_STREAM_VALUE` 的作用
- [ ] curl 测试确认能看到逐字输出效果

### 后续衔接
Day 24（引用溯源）可以在流式回答的基础上，让 AI 在回答中标注引用的原文段落来源。流式输出 + 引用标注 = NotebookLM 完整体验。
