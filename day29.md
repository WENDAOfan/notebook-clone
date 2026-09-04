# Day 29: 检索增强问答 — 让 AI 只读最相关的内容

**目标**：改造 AI 问答流程，用户提问时先从向量存储中检索最相关的文档块，只把这些块送进 prompt。这就是 RAG 的"检索 + 生成"阶段，完成 RAG 的完整闭环。

---

## 当前状态

Day 28 完成后，文档已经被分块并向量化存入 VectorStore。但 AI 问答还是老流程：

```
老流程（Day 21-26）：
  用户提问 + 整篇文档内容 → 拼进 prompt → DeepSeek 回答
                                            ↑
                         文档长 → Token 浪费 + 噪声大 + 回答质量差

新流程（Day 29）：
  用户提问 → 向量检索 Top-5 相关块 → 只把 5 个块拼进 prompt → DeepSeek 回答
                                                              ↑
                                   精准上下文，省 Token，回答质量高
```

---

## 步骤 1/5: 认知学习 — RAG 的核心模式

### 1.1 RAG 三步走

```
R（Retrieve）：用户问题 → Embedding → 向量检索 → 找到最相关的 K 个文档块
A（Augment）：把 K 个块 + 用户问题 + 系统指令 → 拼成增强 prompt
G（Generate）：LLM 基于增强 prompt 生成回答
```

### 1.2 RAG vs 全文塞入 prompt

| | 全文塞入 | RAG 检索 |
|:---|:---|:---|
| Token 消耗 | 高（整篇文档） | 低（3-5 个块） |
| 回答质量 | 噪声多，容易"走神" | 精准上下文，回答聚焦 |
| 支持文档数 | 只能处理 1-2 篇 | 可跨几十篇文档检索 |
| 延迟 | 长文档处理慢 | 检索快 + 短 prompt 生成快 |
| 局限性 | 超出 Token 限制就截断 | 检索不到就答不上来 |

### 1.3 RAG 的"双刃剑"

```
优势：
  文档太长 → RAG 只取相关块，不超限
  文档太多 → RAG 跨文档检索，不受篇数限制
  省钱 → Token 用量大幅减少

风险：
  检索质量决定回答质量 → 如果 Embedding 模型差，检索不准 → AI 回答也不准
  分块策略影响上下文 → 块切得太碎会丢失上下文
  新增文档需重新索引 → 上传/更新文档时必须触发分块+向量化
```

---

## 步骤 2/5: 改造 AiChatService — 接入 RAG 检索

### 2.1 注入 VectorStore

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

### 2.2 新增 RAG 检索方法

```java
/**
 * 从向量存储中检索与问题最相关的文档块
 * 参数:
 *   question - 用户问题
 *   topK - 返回最相关的块数量（默认 5）
 * 返回:
 *   检索到的文档块列表（含分数和元数据）
 */
private List<String> retrieveRelevantChunks(String question, int topK) {
    List<Document> results = vectorStore.similaritySearch(
            SearchRequest.query(question).withTopK(topK));

    return results.stream()
            .map(Document::getText)
            .toList();
}
```

### 2.3 改造单文档问答方法

```java
public String askBasedOnDocument(String documentContent, String question,
        boolean useDocumentContext, Long documentId, Long userId) {

    if (!useDocumentContext) {
        // 不使用文档上下文，直接问 AI
        return askWithoutContext(question);
    }

    // ===== Day 29：RAG 检索替代全文塞入 =====
    List<String> relevantChunks = retrieveRelevantChunks(question, 5);

    String context;
    if (relevantChunks.isEmpty()) {
        // 向量存储中还没有该文档的块（可能分块任务还没跑完）
        // 降级为全文模式
        context = documentContent != null && documentContent.length() > 8000
                ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
                : documentContent;
    } else {
        context = String.join("\n\n---\n\n", relevantChunks);
    }
    // ========================================

    // 构建 Prompt（和之前一样，但 context 现在是检索到的块而非全文）
    String systemPrompt = buildSingleDocSystemPrompt(true);
    String userPrompt = buildSingleDocUserPrompt(context, question, true);

    ChatResponse chatResponse = chatClient.prompt()
            .system(systemPrompt)
            .user(userPrompt)
            .call()
            .chatResponse();

    return chatResponse.getResult().getOutput().getText();
}
```

### 2.4 改造笔记本级问答

笔记本级问答是 RAG 的最大亮点——可以跨文档检索：

```java
public String askBasedOnDocuments(List<String[]> documents, String question,
        Long notebookId, Long userId) {

    // ===== Day 29：用 RAG 替代"拼接所有文档" =====
    // 不再把笔记本里所有文档拼成一个大字符串
    // 而是从向量存储中检索最相关的块（可能来自不同文档）
    List<String> relevantChunks = retrieveRelevantChunks(question, 8);

    String context;
    if (relevantChunks.isEmpty()) {
        // 降级为旧逻辑：拼接所有文档
        StringBuilder contextBuilder = new StringBuilder();
        for (String[] doc : documents) {
            contextBuilder.append("【文档: ").append(doc[0]).append("】\n")
                    .append(doc[1]).append("\n\n");
        }
        context = contextBuilder.toString();
    } else {
        context = String.join("\n\n---\n\n", relevantChunks);
    }
    // ============================================

    String systemPrompt = buildMultiDocSystemPrompt();
    String userPrompt = buildMultiDocUserPrompt(context, question);

    ChatResponse chatResponse = chatClient.prompt()
            .system(systemPrompt)
            .user(userPrompt)
            .call()
            .chatResponse();

    return chatResponse.getResult().getOutput().getText();
}
```

---

## 步骤 3/5: 引用溯源 — 让 AI 标注答案来源

### 3.1 为什么需要溯源

RAG 的回答基于检索到的文档块，用户需要知道"AI 说的这些话来自哪个文档的哪一段"。

### 3.2 给检索结果加上来源标注

```java
private List<String> retrieveRelevantChunksWithSource(String question, int topK) {
    List<Document> results = vectorStore.similaritySearch(
            SearchRequest.query(question).withTopK(topK));

    List<String> chunksWithSource = new ArrayList<>();
    for (int i = 0; i < results.size(); i++) {
        Document doc = results.get(i);
        String title = (String) doc.getMetadata().getOrDefault("documentTitle", "未知文档");
        String source = String.format("【来源 %d: %s】\n%s", i + 1, title, doc.getText());
        chunksWithSource.add(source);
    }
    return chunksWithSource;
}
```

### 3.3 Prompt 中要求 AI 引用来源

在 System Prompt 中增加：

```
你的回答必须基于提供的文档内容。当引用某个来源时，用 [来源 N] 标注，例如：
"根据文档描述，切片技术是一种网络虚拟化方法 [来源 1]。"
如果文档内容无法回答问题，请明确说明。
```

---

## 步骤 4/5: 文档更新时重建索引

### 4.1 新增/上传文档 → 自动索引

Day 28 已经在上传后触发 `chunkAndStoreAsync`。

### 4.2 删除文档 → 清除对应向量

SimpleVectorStore 不支持按条件删除。生产级方案（pgvector/Redis）支持 `deleteByFilter`。

当前策略：删除文档时标记为"已删除"，检索时过滤掉：

```java
// 在 DocumentController.deleteDocument 中
documentRepository.deleteById(id);
// 标记文档已删除，下次检索时过滤
// 生产环境应该直接调用 vectorStore.delete(documentIds)
```

### 4.3 更新文档内容 → 重新索引

```java
// 文档内容变更时，先删旧块再建新块
public void reindexDocument(Long documentId) {
    // 1. 删除旧块（生产环境支持按 metadata 删除）
    // 2. 重新分块 + 向量化
    chunkAndStoreAsync(documentId);
}
```

---

## 步骤 5/5: RAG 问答效果验证

### 5.1 测试流程

```
1. 上传 2-3 篇不同主题的论文 PDF
2. 等待分块完成（观察日志）
3. 在单文档问答中：
   问"什么是切片技术？" → AI 应该基于该文档的相关块回答
   问"这篇论文的方法论是什么？" → AI 应该引用论文中的具体方法
4. 在笔记本级问答中：
   问"这几篇论文有什么共同点？" → AI 应该跨文档检索并综合回答
5. 验证引用标注：AI 回答中应该出现 [来源 1]、[来源 2] 等标记
```

### 5.2 调优参数

| 参数 | 建议值 | 调整依据 |
|:---|:---|:---|
| Top-K | 3-5（单文档）/ 5-8（多文档） | K 太小→信息不足；K 太大→噪声多 |
| chunkSize | 512 Token | 太小→语义不完整；太大→不够精准 |
| overlap | 50 Token | 保持块间上下文衔接 |
| 相似度阈值 | 0.7 | 低于 0.7 的块可能不太相关 |

---

## 改动文件总览

| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `AiChatService.java` | 修改 | 注入 VectorStore，问答方法改用 RAG 检索 |
| `DocumentChunkService.java` | 修改 | 检索结果加来源标注 |
| `DocumentController.java` | 修改 | 删除文档时标记索引失效 |

---

## RAG 完整管线回顾

```
Day 27: 文档上传 → 文本提取 + 清洗
Day 28: 文本分块 → Embedding 向量化 → 存入 VectorStore
Day 29: 用户提问 → 向量检索 Top-K → 拼进 prompt → LLM 生成带引用的回答

索引阶段（离线）：上传 → 提取 → 分块 → 向量化 → 存储
检索阶段（在线）：提问 → 检索 → 增强 prompt → 生成 → 返回
```

---

## 后续衔接

Day 29 完成了 RAG 的完整闭环。但当前的问答仍然是"一问一答"——AI 不记得之前聊了什么。

Day 30 将实现多轮对话上下文：用 MySQL 存储对话历史，让 AI 能理解"刚才说的第二点"这类追问。

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| RAG 检索不到相关内容 | 问题表述和文档用词差异大 | 尝试换一种问法；或增大 Top-K |
| AI 回答中出现错误引用 | Prompt 没有明确要求引用格式 | System Prompt 中强调"必须用 [来源 N] 标注" |
| 新上传的文档检索不到 | 分块任务是异步的，还没跑完 | 等几秒再试，或查看后端日志确认分块完成 |
| 删除文档后仍能检索到 | SimpleVectorStore 不支持按条件删除 | 换持久化向量存储，或重启应用重建索引 |
| 笔记本问答质量不如单文档 | 跨文档检索混入不相关块 | 给 chunk 元数据加 notebookId，检索时加 filter |
