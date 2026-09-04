# Day 20：文档摘要自动生成

> **核心目标**：把 Day 19 的"测试接口"变成真正的业务功能——用户上传文档后，自动调用 AI 生成摘要并存入数据库。掌握 Prompt 工程：通过 System Prompt 控制 AI 的输出格式和角色。

---

## 背景知识

### 什么是文档摘要？

想象你上传了一篇 2 万字的 Spring Boot 教程。打开文档时，你第一眼想看什么？
- ❌ 全部 2 万字？太长了，抓不住重点
- ✅ **一段 200 字的摘要**？快速了解"这篇文档在讲什么"

这就是**文档摘要**的价值：把长文本压缩成精炼的概述，帮用户快速判断内容相关性。

### 为什么要在上传时自动生成？

| 时机 | 优点 | 缺点 |
|------|------|------|
| **上传时自动生成** ✅ | 用户打开文档列表时，摘要是"立即可见"的 | 上传接口会变慢（3~5 秒） |
| 用户点击"生成摘要"按钮 | 上传快，按需生成 | 每次都要等，体验不流畅 |
| 后台异步生成（Day 25） | 上传快 + 体验好 | 实现复杂，需要队列机制 |

**今天先学第一种**（上传时同步生成），Day 25 再优化成异步。

### Prompt 工程的入门

同样的文档内容，不同的 Prompt 会让 AI 给出完全不同的摘要：

```
System: "你是一位技术文档专家，请用 3 句话概括以下内容的核心观点"
→ 输出：结构化、专业、聚焦核心

System: "请总结以下内容"（无角色设定）
→ 输出：可能啰嗦、可能遗漏重点、格式不统一
```

**核心认知**：System Prompt 是给 AI "定规矩"的——规矩越清晰，输出越稳定。

---

## 任务规划（共 5 步）

---

### 第 1 步：给 Document 实体添加 summary 字段

#### 1.1 修改 Document 实体

**文件**：`src/main/java/com/example/notebook_clone/entity/Document.java`

在现有字段下方新增 `summary` 字段：

```java
// ... 原有字段 ...

@Column(columnDefinition = "LONGTEXT")
private String content;

// ===== Day 20 新增：AI 生成的文档摘要 =====
@Column(columnDefinition = "LONGTEXT")
private String summary;
// =========================================

private LocalDateTime createTime;
```

**为什么用 `LONGTEXT`？**
- 摘要虽然比原文短，但也可能几百字，用 `LONGTEXT` 保险
- 和 `content` 字段保持一致的风格

#### 1.2 确认数据库自动更新

因为我们配置了 `ddl-auto=update`，JPA 会自动给 `document` 表新增 `summary` 列。

**验证方式**：启动项目后，打开数据库客户端（如 DataGrip）查看 `document` 表结构，确认多了一列 `summary`。

---

### 第 2 步：创建 AiSummaryService，封装摘要生成逻辑

#### 2.1 新建 Service 文件

**文件**：`src/main/java/com/example/notebook_clone/service/AiSummaryService.java`

```java
package com.example.notebook_clone.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class AiSummaryService {

    private final ChatClient chatClient;

    public AiSummaryService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    /**
     * 为文档内容生成 AI 摘要
     *
     * @param content 文档原始内容
     * @return AI 生成的摘要文本
     */
    public String generateSummary(String content) {
        // 如果内容为空或太短，没必要生成摘要
        if (content == null || content.trim().length() < 50) {
            return "内容过短，无需摘要";
        }

        // 如果内容超长，只取前 8000 字（控制 Token 消耗和响应时间）
        String truncatedContent = content.length() > 8000
                ? content.substring(0, 8000) + "\n...（内容已截断）"
                : content;

        // 调用 AI 生成摘要
        String summary = chatClient.prompt()
                .system("""
                        你是一位专业的文档摘要助手。请遵循以下规则：
                        1. 用 2~4 句话概括文档的核心内容
                        2. 回答控制在 200 字以内
                        3. 语言简洁，突出关键信息（主题、核心观点、用途）
                        4. 不要复述原文，用自己的话总结
                        """)
                .user("请为以下文档生成摘要：\n\n" + truncatedContent)
                .call()
                .content();

        return summary;
    }
}
```

**代码重点解析**：

| 代码 | 作用 |
|------|------|
| `content.length() < 50` 判断 | 避免为太短的文本浪费 API 调用 |
| `substring(0, 8000)` | **上下文窗口保护**：DeepSeek 有 Token 上限，超长文本直接截断 |
| `.system("...")` | **Prompt 工程核心**：给 AI 定角色和输出规则，摘要质量的关键 |
| `.user("请为以下文档..." + content)` | 把文档内容作为用户问题传入 |

#### 2.2 为什么抽成单独的 Service？

- **复用**：后续手动创建文档时也能调用
- **可测试**：可以单独测试摘要生成功能，不依赖 Controller
- **可扩展**：Day 25 改成异步时，只需要改这一个类

---

### 第 3 步：改造文件上传接口，上传后自动生成摘要

#### 3.1 注入 AiSummaryService

**文件**：`src/main/java/com/example/notebook_clone/controller/DocumentController.java`

在构造函数中注入 `AiSummaryService`：

```java
private final DocumentRepository documentRepository;
private final NotebookRepository notebookRepository;
private final UserRepository userRepository;
private final DocumentExtractService extractService;
private final AiSummaryService aiSummaryService;  // Day 20 新增

public DocumentController(DocumentRepository documentRepository,
                          NotebookRepository notebookRepository,
                          UserRepository userRepository,
                          DocumentExtractService extractService,
                          AiSummaryService aiSummaryService) {  // 新增参数
    this.documentRepository = documentRepository;
    this.notebookRepository = notebookRepository;
    this.userRepository = userRepository;
    this.extractService = extractService;
    this.aiSummaryService = aiSummaryService;  // 新增赋值
}
```

#### 3.2 在 upload 方法中调用 AI 生成摘要

找到 `uploadDocumentFile` 方法，在保存文档**之前**添加摘要生成逻辑：

```java
@PostMapping("/upload")
public Result<Document> uploadDocumentFile(
        @RequestParam("notebookId") Long notebookId,
        @RequestParam("file") MultipartFile file
) {
    try {
        String fileName = file.getOriginalFilename();
        String extractedText = extractService.extractText(file);

        // ... 原有用户权限校验和 notebook 关联代码 ...

        document.setTitle(fileName);
        document.setContent(extractedText);
        document.setCreateTime(LocalDateTime.now());

        // ===== Day 20 新增：自动生成摘要 =====
        // 注意：这是同步调用，会阻塞 2~5 秒！
        String summary = aiSummaryService.generateSummary(extractedText);
        document.setSummary(summary);
        // =====================================

        return Result.success(documentRepository.save(document));

    } catch (IOException e) {
        throw new RuntimeException("文件读取失败了！" + e.getMessage());
    }
}
```

#### 3.3 启动项目测试

用 `api.http` 或 Postman 测试文件上传：

```http
POST http://localhost:8080/api/documents/upload?notebookId=1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="spring教程.txt"
Content-Type: text/plain

（文件内容）
------WebKitFormBoundary--
```

**预期结果**：
- 响应比普通上传慢 **2~5 秒**（因为调用了 AI）
- 返回的 JSON 中多了一个 `summary` 字段，里面是 AI 生成的摘要

---

### 第 4 步：为已有/手动创建的文档添加"生成摘要"接口

#### 4.1 思考：手动创建的文档也需要摘要

目前的 `POST /api/documents` 接口（手动输入内容创建文档）还没有生成摘要的能力。我们需要一个**独立接口**：对已有文档触发摘要生成。

#### 4.2 添加新接口

在 `DocumentController` 中添加：

```java
/**
 * 为已有文档生成/重新生成 AI 摘要
 */
@PostMapping("/{id}/summary")
public Result<Document> generateSummary(@PathVariable Long id) {
    // 1. 获取当前用户
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 2. 查询文档并校验归属（数据隔离！）
    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));
    
    if (!document.getUser().getId().equals(currentUser.getId())) {
        throw new RuntimeException("无权操作该文档");
    }

    // 3. 调用 AI 生成摘要
    String summary = aiSummaryService.generateSummary(document.getContent());
    document.setSummary(summary);

    // 4. 保存并返回
    return Result.success(documentRepository.save(document));
}
```

#### 4.3 为什么需要这个独立接口？

| 场景 | 说明 |
|------|------|
| 手动创建文档 | `POST /api/documents` 只存了 content，没有 summary，后续可以调用这个接口补生成 |
| 重新生成 | 内容编辑后，可以重新调用生成新的摘要 |
| 失败补偿 | 如果上传时 AI 调用失败（网络问题），可以后续补生成 |

---

### 第 5 步：在 api.http 中添加 Day 20 测试用例

#### 5.1 追加测试用例

**文件**：`notebook-clone/api.http`

在文件末尾追加：

```http
### ========== Day 20 文档摘要自动生成测试 ==========

### 1. 上传文件（会自动生成摘要）
POST http://localhost:8080/api/documents/upload?notebookId=1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="java基础.txt"
Content-Type: text/plain

Java 是一种面向对象的编程语言，由 Sun Microsystems 于 1995 年发布。
它具有跨平台、安全性高、生态丰富等特点，广泛应用于企业级后端开发、
Android 应用开发、大数据处理等领域。Java 的核心特性包括自动内存管理（GC）、
强类型系统、丰富的标准库等。Spring Boot 是基于 Java 的一款流行框架，
它简化了企业级应用的开发流程，提供了自动配置、嵌入式服务器等便利功能。
------WebKitFormBoundary--

### 2. 查询笔记本下的文档列表（验证 summary 字段已保存）
GET http://localhost:8080/api/documents/notebook/1

### 3. 为已有文档手动生成摘要（替换 {documentId} 为实际 ID）
POST http://localhost:8080/api/documents/{documentId}/summary

### 4. 测试空内容文档（应该不会调用 AI）
POST http://localhost:8080/api/documents/{documentId}/summary
# 前提：先创建一个 content 为空或很短的文档
```

#### 5.2 测试 Prompt 工程效果

尝试修改 `AiSummaryService` 里的 System Prompt，观察输出差异：

**版本 A：大学教授风格**
```
你是一位计算机科学的大学教授。请用学术化的语言，
用 2~3 句话概括这篇文档的核心学术价值。
```

**版本 B：短视频博主风格**
```
你是一位技术类短视频博主。请用口语化、轻松幽默的语言，
用 1 句话讲清楚这篇文档在说什么，适合做成视频标题。
```

**版本 C：结构化输出（为 Day 24 铺垫）**
```
你是一位文档摘要助手。请按以下 JSON 格式输出摘要：
{"topic": "主题", "keyPoints": ["要点1", "要点2"], "suitableFor": "适合人群"}
```

> 💡 **思考题**：你觉得哪种 Prompt 最适合 NotebookLM Clone 的场景？为什么？

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `Document.java` | **修改** | 新增 `summary` 字段（LONGTEXT） |
| `AiSummaryService.java` | **新增** | 封装 AI 摘要生成逻辑，含 Prompt 工程 |
| `DocumentController.java` | **修改** | 注入 AiSummaryService，upload 接口集成摘要生成，新增 `/{id}/summary` 接口 |
| `api.http` | **修改** | 追加 Day 20 测试用例 |

---

## Day 20 完成标志

- [ ] `Document` 实体已添加 `summary` 字段，数据库表结构已更新
- [ ] `AiSummaryService` 已创建，含合理的 System Prompt 和内容截断保护
- [ ] 上传文件后，返回的文档数据包含 AI 生成的 `summary`
- [ ] `POST /api/documents/{id}/summary` 接口可用，且做了数据权限校验
- [ ] 测试了"内容过短不生成摘要"的边界情况
- [ ] 体会了不同 System Prompt 对输出风格的影响
- [ ] Git 提交：`git commit -m "feat: Day20 文档摘要自动生成，集成 AI 摘要功能"`

---

## 核心知识点总结

### 1. Prompt 工程三板斧

```
┌─────────────────────────────────────────┐
│  1. 定角色（System Prompt）              │
│     "你是一位专业的 XXX"                 │
├─────────────────────────────────────────┤
│  2. 定规则（输出格式/长度/风格）          │
│     "用 2~4 句话，控制在 200 字以内"      │
├─────────────────────────────────────────┤
│  3. 给示例（复杂场景）                    │
│     "比如：这篇文档讲的是..."             │
└─────────────────────────────────────────┘
```

### 2. 上下文窗口保护

大模型有 **Token 上限**（类似"一次最多读多少字"），超长内容需要截断：

```java
String truncated = content.length() > 8000
    ? content.substring(0, 8000) + "..."
    : content;
```

> 为什么 8000 字？中文大约 1 字 ≈ 1~1.5 Token，8000 字安全地控制在常见模型的上限内。

### 3. 同步生成摘要的利弊

| 优点 | 缺点 |
|------|------|
| 实现简单，用户无感知 | 上传接口变慢 2~5 秒 |
| 数据一致性高（存库即完整） | 高并发时线程池压力大 |
| 错误处理直接（上传失败 = 摘要失败） | AI 服务挂了，上传也跟着挂 |

**未来优化方向**：Day 25 引入 `@Async` + 任务队列，上传后立即返回，后台慢慢生成摘要。

### 4. 第三阶段进度

| Day | 内容 | 状态 |
|:---:|------|:----:|
| **18** | 注册 API + 引入依赖 | ✅ 完成 |
| **19** | 打通模型调用（同步） | ✅ 完成 |
| **20** | 文档摘要自动生成 | 🔄 今天 |
| **21** | 基于单个文档的智能问答 | ⏳ 待开始 |
| **22** | 笔记本级（多文档）问答 | ⏳ 待开始 |
| **23** | SSE 流式输出 | ⏳ 待开始 |
| **24** | 引用溯源 | ⏳ 待开始 |
| **25** | 异步生成摘要 | ⏳ 待开始 |
| **26** | 超时重试、用量统计 | ⏳ 待开始 |

---

## 下节预告（Day 21）

> **智能问答（核心功能）**：实现"基于单个文档内容回答问题"的接口。用户上传了一篇 Spring Boot 教程，然后问"Spring Boot 的自动配置原理是什么？"——AI 只基于这篇文档的内容来回答，而不是泛泛而谈。你将学会**上下文拼接**：如何把"文档内容 + 用户问题"一起发给大模型。

---

## 💡 常见问题

**Q: 调用摘要接口时报 `429 Too Many Requests`？**

A: DeepSeek 有速率限制（如 60 次/分钟）。如果在循环里批量生成摘要，会触发限流。解决方案：
1. 批量操作时加 `Thread.sleep(1000)` 间隔
2. Day 26 会引入重试机制

**Q: 摘要质量不好，怎么优化？**

A: 调整 System Prompt 是最直接的方式：
- 要求更具体："请用 3 个要点总结" 比 "请总结" 效果好
- 加角色设定："你是一位技术专家" 比无角色设定效果好
- 要求结构化："按 `主题|要点|适用人群` 格式输出"

**Q: 生成摘要失败了，文档还能保存吗？**

A: 当前实现中，如果 AI 调用异常，整个 `upload` 接口会失败（因为异常会向上抛出）。如果想"即使摘要失败也保存文档"，可以用 `try-catch` 包裹摘要生成逻辑：

```java
try {
    String summary = aiSummaryService.generateSummary(extractedText);
    document.setSummary(summary);
} catch (Exception e) {
    // 摘要生成失败，但不影响文档保存
    document.setSummary("摘要生成失败，请稍后重试");
}
```
