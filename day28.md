# Day 28: 文本分块 + 向量化 — RAG 的第一步

**目标**：把 Day 27 提取的干净文本切成小块（chunks），用 Embedding 模型生成向量，存入向量存储。这是 RAG 管线中"索引"阶段的完整实现。

---

## 当前状态

Day 27 完成后，上传的文档已经过提取和清洗，以完整文本形式存在 MySQL 的 `content` 字段中。但当前 AI 问答的做法是：

```
用户提问 → 把整篇文档塞进 prompt → 发给 DeepSeek → 返回回答
                                    ↑
                         问题 1：文档太长会超出 Token 限制
                         问题 2：即使不超限，大量无关内容会稀释回答质量
                         问题 3：每篇文档都全文发送，Token 浪费严重
```

**Day 28 的解决方案**：把文档切成小块 + 向量化存储，后续（Day 29）提问时只检索最相关的几个块送进 prompt。

---

## 步骤 1/5: 认知学习 — 什么是文本分块（前 10 分钟，不写代码）

### 1.1 为什么要分块

```
一篇 10000 字的论文：
  全文塞进 prompt → 5000 Token → DeepSeek 回答时"注意力分散"
                                   ↑
                      模型在 5000 Token 里找答案，噪声太多

切成 50 个块（每块 200 字）：
  用户问"什么是切片技术" → 检索到最相关的 3 个块 → 600 Token
                                                  ↑
                                    精准上下文，回答质量高，Token 省 90%
```

### 1.2 分块策略

| 策略 | 做法 | 优缺点 |
|:---|:---|:---|
| **固定长度** | 每 500 字符切一刀 | 简单粗暴，可能在句子中间断开 |
| **按段落** | 按 `\n\n` 切 | 保留语义完整性，但段落长度不一 |
| **Token 分块** | 按 Token 数量切（如 512 Token），带重叠 | 最常用的平衡方案 |
| **语义分块** | 用 Embedding 检测语义边界 | 效果最好，但计算成本高 |

**Day 28 使用 Token 分块 + 重叠**，这是 Spring AI 内置支持的方式，也是 RAG 实践中最常用的起点。

### 1.3 重叠（Overlap）为什么重要

```
不重叠：
  块 1: "切片技术是一种网络虚拟化方法，它将物理网络..."
  块 2: "资源划分为多个逻辑切片，每个切片独立管理..."
                    ↑
         "它"指什么？块 2 丢失了上下文

重叠 50 Token：
  块 1: "切片技术是一种网络虚拟化方法，它将物理网络划分为多个逻辑"
  块 2: "划分为多个逻辑切片，每个切片独立管理..."
              ↑
     重叠部分保留了上下文衔接
```

---

## 步骤 2/5: 认知学习 — 什么是向量化

### 2.1 Embedding 的核心思想

Embedding 把文本变成一个高维向量（如 1536 维的浮点数数组）。语义相近的文本，向量在空间中的距离也近：

```
"卫星通信资源调度"  → [0.82, 0.15, 0.73, ..., 0.41]  (1536维)
"GEO卫星波束分配"  → [0.79, 0.18, 0.71, ..., 0.38]  ← 语义相近，距离小
"今天天气不错"      → [0.02, 0.91, 0.05, ..., 0.87]  ← 语义无关，距离大
```

### 2.2 相似度检索的原理

```
索引阶段（Day 28）：
  文档 → 分块 → 每个块调 Embedding 模型 → 生成向量 → 存入向量存储

检索阶段（Day 29）：
  用户问题 → 调同一个 Embedding 模型 → 生成问题向量
           → 在向量存储中找最相似的 Top-K 个块
           → 把这 K 个块拼进 prompt 给 LLM
```

### 2.3 Embedding 模型选择

当前项目用的是 DeepSeek 做 chat，但 **DeepSeek 不提供 Embedding API**。可选方案：

| 模型 | 提供方 | 维度 | 特点 |
|:---|:---|:---|:---|
| `text-embedding-3-small` | OpenAI | 1536 | 英文好，中文一般，需付费 |
| `embedding-2` | 智谱 AI | 1024 | 中文效果好，有免费额度 |
| `bge-large-zh-v1.5` | BAAI（本地） | 1024 | 中文最优，需本地跑，免费 |
| `nomic-embed-text` | Ollama（本地） | 768 | 轻量，中英文均可，免费 |

**推荐方案**：本地跑 Ollama + `nomic-embed-text`（零费用、无网络依赖），或用智谱 AI 的 `embedding-2`（有免费额度、效果好）。

---

## 步骤 3/5: 后端 — 文本分块服务

### 3.1 添加 Spring AI 相关依赖

`pom.xml` 新增：

```xml
<!-- Day 28：Spring AI 向量存储（内存版，开发阶段用） -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-tika-document-reader</artifactId>
</dependency>
```

### 3.2 新建 DocumentChunkService

```java
package com.example.notebook_clone.service;

@Service
public class DocumentChunkService {

    /**
     * 将文档文本切分为 Token 块
     * 参数:
     *   content - 文档全文
     *   chunkSize - 每块最大 Token 数（默认 512）
     *   overlap - 相邻块重叠 Token 数（默认 50）
     * 返回:
     *   分块文本列表
     */
    public List<String> splitIntoChunks(String content, int chunkSize, int overlap) {
        // Spring AI 的 TokenTextSplitter
        TokenTextSplitter splitter = new TokenTextSplitter(chunkSize, overlap, 5, 10000, true);
        Document document = new Document(content);
        List<Document> chunks = splitter.apply(List.of(document));
        return chunks.stream()
                .map(Document::getText)
                .collect(Collectors.toList());
    }

    /**
     * 对文档进行分块并持久化
     * 在文档上传/更新后调用
     */
    public void chunkAndStore(Document document) {
        String content = document.getContent();
        if (content == null || content.isBlank()) return;

        List<String> chunks = splitIntoChunks(content, 512, 50);
        // Day 29 会接入向量存储
        // 当前先记录分块数量，验证分块逻辑
    }
}
```

### 3.3 分块时机

文档上传成功后，在 `DocumentController.uploadDocumentFile` 末尾触发分块：

```java
// Day 27 已有：异步生成摘要
asyncSummaryService.generateSummaryAsync(saved.getId());

// Day 28 新增：异步分块（和摘要并行执行，不阻塞上传）
chunkService.chunkAndStoreAsync(saved.getId());
```

---

## 步骤 4/5: 后端 — Embedding + 向量存储

### 4.1 配置 Embedding 模型

以智谱 AI 为例（有免费额度）：

```properties
# ===== Day 28：Embedding 模型配置 =====
# 智谱 AI Embedding API（和 DeepSeek 一样兼容 OpenAI 格式）
spring.ai.zhipuai.embedding.api-key=your-zhipu-api-key
spring.ai.zhipuai.embedding.options.model=embedding-2
```

或者用本地 Ollama（零费用）：

```properties
# ===== Day 28：本地 Embedding（Ollama）=====
spring.ai.ollama.embedding.base-url=http://localhost:11434
spring.ai.ollama.embedding.options.model=nomic-embed-text
```

### 4.2 向量存储选型

| 方案 | 持久化 | 适合阶段 | 依赖 |
|:---|:---|:---|:---|
| **SimpleVectorStore** | 内存（重启丢） | 开发/学习 | 无 |
| **JDBC Vector Store** | MySQL 8.0+ | 小规模生产 | 已有 MySQL |
| **pgvector** | PostgreSQL | 生产 | 需装 PG |
| **Redis Vector Store** | Redis Stack | 生产 | 需 Redis Stack |

**Day 28 用 SimpleVectorStore 快速验证**，后续可换持久化方案：

```java
@Configuration
public class VectorStoreConfig {

    @Bean
    public VectorStore vectorStore(EmbeddingModel embeddingModel) {
        // 内存向量存储，重启后需重新索引
        return new SimpleVectorStore(embeddingModel);
    }
}
```

### 4.3 分块 + 向量化 + 存储的完整流程

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class DocumentChunkService {

    private final VectorStore vectorStore;
    private final DocumentRepository documentRepository;

    /**
     * 对文档进行分块、向量化、存入向量存储
     */
    @Async
    public void chunkAndStoreAsync(Long documentId) {
        Document document = documentRepository.findById(documentId).orElse(null);
        if (document == null) return;

        String content = document.getContent();
        if (content == null || content.isBlank()) return;

        // 1. 分块
        TokenTextSplitter splitter = new TokenTextSplitter(512, 50, 5, 10000, true);
        List<Document> springDocs = splitter.apply(
                List.of(new org.springframework.ai.document.Document(content)));

        // 2. 给每个块添加元数据（用于 Day 29 的溯源）
        List<org.springframework.ai.document.Document> enrichedDocs = springDocs.stream()
                .map(chunk -> {
                    Map<String, Object> metadata = new HashMap<>(chunk.getMetadata());
                    metadata.put("documentId", documentId);
                    metadata.put("documentTitle", document.getTitle());
                    return new org.springframework.ai.document.Document(chunk.getText(), metadata);
                })
                .toList();

        // 3. 存入向量存储（内部自动调 Embedding 模型生成向量）
        vectorStore.add(enrichedDocs);

        log.info("[分块] 文档 {} 分块完成，共 {} 块", document.getTitle(), enrichedDocs.size());
    }
}
```

---

## 步骤 5/5: 验证分块效果

### 5.1 添加测试接口

```java
@RestController
@RequestMapping("/test/chunk")
@RequiredArgsConstructor
public class ChunkTestController {

    private final DocumentChunkService chunkService;
    private final VectorStore vectorStore;

    /**
     * 手动触发文档分块
     * POST /test/chunk/index?documentId=1
     */
    @PostMapping("/index")
    public Result<String> index(@RequestParam Long documentId) {
        chunkService.chunkAndStoreAsync(documentId);
        return Result.success("分块任务已提交");
    }

    /**
     * 测试相似度检索
     * GET /test/chunk/search?query=什么是切片技术&topK=3
     */
    @GetMapping("/search")
    public Result<List<String>> search(@RequestParam String query,
                                        @RequestParam(defaultValue = "3") int topK) {
        List<org.springframework.ai.document.Document> results =
                vectorStore.similaritySearch(SearchRequest.query(query).withTopK(topK));

        List<String> texts = results.stream()
                .map(doc -> String.format("[%.4f] %s",
                        doc.getScore() != null ? doc.getScore() : 0.0,
                        doc.getText().substring(0, Math.min(100, doc.getText().length())) + "..."))
                .toList();

        return Result.success(texts);
    }
}
```

### 5.2 测试流程

```
1. 上传一篇论文 PDF（Day 27 的提取 + 清洗已生效）
2. 调用 POST /test/chunk/index?documentId=1 触发分块
3. 观察后端日志：[分块] 文档 xxx 分块完成，共 45 块
4. 调用 GET /test/chunk/search?query=卫星网络切片资源调度&topK=3
5. 验证返回的 3 个块确实与"卫星网络切片"相关
```

---

## 改动文件总览

| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `pom.xml` | 加依赖 | `spring-ai-tika-document-reader` |
| `application.properties` | 加配置 | Embedding 模型连接信息 |
| `VectorStoreConfig.java` | **新建** | 向量存储 Bean 配置 |
| `DocumentChunkService.java` | **新建** | 分块 + 向量化 + 存储 |
| `ChunkTestController.java` | **新建** | 测试接口（开发阶段用） |

---

## 后续衔接

Day 28 完成的是 RAG 的"索引"阶段。当前的问题：

```
向量存储里已经有了所有文档的分块向量
但 AI 问答还是把整篇文档塞进 prompt（没有用上向量检索）
```

Day 29 将完成 RAG 的"检索 + 生成"阶段：用户提问时，先从向量存储检索最相关的块，拼进 prompt 给 DeepSeek。

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| Embedding API 调用失败 | API Key 错误或额度用完 | 检查 API Key，确认免费额度 |
| SimpleVectorStore 重启后数据丢失 | 内存存储不持久 | 开发阶段可接受，生产换 JDBC/pgvector |
| 分块太小导致语义不完整 | chunkSize 设置过小 | 增大到 512 Token，overlap 设为 50 |
| 分块太慢阻塞上传接口 | 没有用 @Async | 分块操作加 @Async 异步执行 |
| 中文分块质量差 | Tokenizer 不支持中文 | Spring AI 默认 tokenizer 基本够用，高级需求可换中文专用模型 |
