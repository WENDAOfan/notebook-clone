# Day 21：基于单个文档的智能问答

> **核心目标**：实现"基于单个文档内容回答问题"的接口。用户上传了一篇 Spring Boot 教程，然后问"Spring Boot 的自动配置原理是什么？"——AI 只基于这篇文档的内容来回答，而不是泛泛而谈。你将学会**上下文拼接**：如何把"文档内容 + 用户问题"一起发给大模型。

---

## 背景知识

### 为什么不是直接问 AI？

| 方式 | 回答质量 | 问题 |
|------|---------|------|
| ❌ 直接问 AI（无上下文） | 泛泛而谈，可能和文档内容无关 | "Spring Boot 自动配置" → 讲通用原理，但文档里可能有特定版本的内容 |
| ✅ 基于文档问答（有上下文） | 精准、有依据、和文档强相关 | "根据这篇文档，Spring Boot 自动配置的原理是..." |

**核心认知**：大模型本身有"世界知识"，但我们要让它**只基于用户提供的文档**回答——这就是 RAG（Retrieval-Augmented Generation，检索增强生成）的最简形式。

### 什么是上下文拼接？

把文档内容作为"背景信息"，和用户问题一起发给大模型：

```
System: "你是一位知识库问答助手。请严格基于以下文档内容回答问题。"

User: """
【文档内容】
（这里放文档的完整/截断内容）

【用户问题】
Spring Boot 的自动配置原理是什么？
"""
```

大模型看到"请严格基于以下文档内容"的指令后，会优先从文档里找答案，而不是调用自己的通用知识。

---

## 任务规划（共 5 步）

---

### 第 1 步：创建 AskRequest DTO

#### 1.1 新建请求 DTO

**文件**：`src/main/java/com/example/notebook_clone/dto/AskRequest.java`

```java
package com.example.notebook_clone.dto;

import lombok.Data;

@Data
public class AskRequest {
    /**
     * 用户的问题（必填）
     */
    private String question;
}
```

**为什么需要 DTO？**
- 前端只需要传 `question`，不需要传文档内容（文档 ID 在 URL 里）
- 后续扩展方便（如增加 `temperature`、`maxTokens` 等参数）

---

### 第 2 步：创建 AiChatService，封装问答逻辑

#### 2.1 新建 Service 文件

**文件**：`src/main/java/com/example/notebook_clone/service/AiChatService.java`

```java
package com.example.notebook_clone.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class AiChatService {

    private final ChatClient chatClient;

    public AiChatService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    /**
     * 基于文档内容回答用户问题
     *
     * @param documentContent 文档原始内容
     * @param question        用户问题
     * @return AI 基于文档内容的回答
     */
    public String askBasedOnDocument(String documentContent, String question) {
        // 如果文档内容为空
        if (documentContent == null || documentContent.trim().isEmpty()) {
            return "文档内容为空，无法回答问题。";
        }

        // 如果内容超长，截断到 8000 字（和摘要服务保持一致）
        String context = documentContent.length() > 8000
                ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
                : documentContent;

        // 调用 AI：System Prompt 设定角色 + User Prompt 拼接文档+问题
        String answer = chatClient.prompt()
                .system("""
                        你是一位知识库问答助手。请严格遵循以下规则：
                        1. 只基于用户提供的【文档内容】回答问题
                        2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                        3. 回答要简洁，控制在 300 字以内
                        4. 不要添加文档中没有的信息
                        """)
                .user("""
                        【文档内容】
                        %s

                        【用户问题】
                        %s
                        """.formatted(context, question))
                .call()
                .content();

        return answer;
    }
}
```

#### 2.2 代码重点解析

| 代码 | 作用 |
|------|------|
| `"只基于用户提供的【文档内容】回答问题"` | **核心指令**：限制 AI 只能用文档内容回答 |
| `"如果文档中没有相关信息..."` | **诚实指令**：防止 AI  hallucination（编造答案）|
| `"不要添加文档中没有的信息"` | **安全护栏**：避免 AI 用通用知识补充 |
| `"%s".formatted(context, question)` | **上下文拼接**：把文档内容和问题拼成一个字符串 |

---

### 第 3 步：在 DocumentController 中添加问答接口

#### 3.1 注入 AiChatService

**文件**：`src/main/java/com/example/notebook_clone/controller/DocumentController.java`

在构造函数中注入：

```java
private final DocumentRepository documentRepository;
private final NotebookRepository notebookRepository;
private final UserRepository userRepository;
private final DocumentExtractService extractService;
private final AiSummaryService aiSummaryService;
private final AiChatService aiChatService;  // Day 21 新增

public DocumentController(DocumentRepository documentRepository,
                          NotebookRepository notebookRepository,
                          UserRepository userRepository,
                          DocumentExtractService extractService,
                          AiSummaryService aiSummaryService,
                          AiChatService aiChatService) {  // 新增参数
    this.documentRepository = documentRepository;
    this.notebookRepository = notebookRepository;
    this.userRepository = userRepository;
    this.extractService = extractService;
    this.aiSummaryService = aiSummaryService;
    this.aiChatService = aiChatService;  // 新增赋值
}
```

#### 3.2 添加问答接口

在 `DocumentController` 中添加：

```java
/**
 * 基于单个文档内容进行智能问答
 */
@PostMapping("/{id}/ask")
public Result<String> askDocument(@PathVariable Long id,
                                   @RequestBody AskRequest request) {
    // 1. .trim()参数校验过滤纯空格或空字符串
    if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
        return Result.fail("问题不能为空");
    }

    // 2. 获取当前用户
    String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
    User currentUser = userRepository.findByUsername(username)
            .orElseThrow(() -> new RuntimeException("用户不存在: " + username));

    // 3. 查询文档并校验归属（数据隔离！）
    Document document = documentRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("文档不存在"));

    if (!document.getUser().getId().equals(currentUser.getId())) {
        throw new RuntimeException("无权访问该文档");
    }

    // 4. 调用 AI 基于文档内容回答问题
    String answer = aiChatService.askBasedOnDocument(
            document.getContent(),
            request.getQuestion()
    );

    return Result.success(answer);
}
```

#### 3.3 为什么接口路径是 `/{id}/ask`？

| 设计选择 | 说明 |
|---------|------|
| `POST /api/documents/{id}/ask` | RESTful 风格，表示"对某个文档执行 ask 操作" |
| 文档 ID 在路径里 | 明确标识"基于哪篇文档"问答 |
| 问题在请求体里 | 问题可能很长，放 body 更合适 |

---

### 第 4 步：前端添加问答界面

#### 4.1 修改 index.html

在查看文档弹窗（`viewDocumentModal`）中增加问答区域：

```html
<!-- 在 viewDocumentModal 的 modal-body 中，放在 document-content 下方 -->
<div class="document-qa-section">
    <div class="qa-header">
        <span>💬 智能问答</span>
        <span class="qa-hint">基于当前文档内容回答</span>
    </div>
    <div class="qa-input-area">
        <input type="text" id="qaInput" placeholder="输入你的问题，例如：这篇文档讲了什么？" 
               onkeypress="if(event.key==='Enter') askDocument()">
        <button class="btn btn-primary" onclick="askDocument()">提问</button>
    </div>
    <div id="qaAnswer" class="qa-answer" style="display: none;">
        <div class="qa-answer-label">🤖 回答：</div>
        <div id="qaAnswerText" class="qa-answer-text"></div>
    </div>
</div>
```

#### 4.2 修改 app.js

新增 API 函数和问答逻辑：

```javascript
// API：基于文档问答
async function askDocumentAPI(documentId, question) {
    return fetchAPI(`/api/documents/${documentId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question }),
    });
}

// 问答功能
async function askDocument() {
    const input = document.getElementById('qaInput');
    const question = input.value.trim();
    
    if (!question) {
        showToast('请输入问题', 'error');
        return;
    }
    
    // 获取当前查看的文档 ID
    const currentDocId = document.getElementById('viewDocumentTitle').dataset.documentId;
    if (!currentDocId) return;
    
    try {
        showToast('正在思考...', 'info');
        const answer = await askDocumentAPI(currentDocId, question);
        
        // 显示答案
        document.getElementById('qaAnswer').style.display = 'block';
        document.getElementById('qaAnswerText').textContent = answer;
        input.value = '';
        showToast('回答已生成', 'success');
    } catch (error) {
        showToast('回答失败: ' + error.message, 'error');
    }
}
```

#### 4.3 修改 viewDocument 函数

在打开弹窗时记录当前文档 ID：

```javascript
function viewDocument(id) {
    const doc = currentDocuments.find(d => d.id === id);
    if (!doc) return;
    
    // ... 原有摘要和内容展示代码 ...
    
    // 记录当前文档 ID（用于问答）
    document.getElementById('viewDocumentTitle').dataset.documentId = id;
    
    // 清空上一次的问答结果
    document.getElementById('qaInput').value = '';
    document.getElementById('qaAnswer').style.display = 'none';
    document.getElementById('qaAnswerText').textContent = '';
    
    showModal('viewDocumentModal');
}
```

---

### 第 5 步：在 api.http 中添加 Day 21 测试用例

#### 5.1 追加测试用例

**文件**：`notebook-clone/api.http`

在文件末尾追加：

```http
### ========== Day 21 基于文档的智能问答测试 ==========

### 0. 先登录获取 Token（替换为你的真实用户名密码）
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}

### 1. 基于文档提问（替换 {documentId} 为实际 ID）
### 问题应该能从文档内容中找到答案
POST http://localhost:8080/api/documents/1/ask
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "question": "这篇文档主要讲了什么？"
}

### 2. 问一个文档中没有的问题（测试"无法找到答案"）
POST http://localhost:8080/api/documents/1/ask
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "question": "量子力学的基本原理是什么？"
}

### 3. 测试空问题（应该返回错误）
POST http://localhost:8080/api/documents/1/ask
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "question": ""
}

### 4. 测试跨用户访问（应该失败）
### 用另一个用户的 Token 访问别人的文档
POST http://localhost:8080/api/documents/1/ask
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "question": "这篇文档讲了什么？"
}
```

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `AskRequest.java` | **新增** | 问答请求 DTO（question 字段） |
| `AiChatService.java` | **新增** | 封装基于文档的问答逻辑，含上下文拼接和 System Prompt |
| `DocumentController.java` | **修改** | 注入 AiChatService，新增 `/{id}/ask` 接口 |
| `index.html` | **修改** | 查看弹窗增加问答区域（输入框 + 答案展示） |
| `app.js` | **修改** | 新增 askDocumentAPI、askDocument 函数，修改 viewDocument |
| `style.css` | **修改** | 问答区域样式 |
| `api.http` | **修改** | 追加 Day 21 测试用例 |

---

## Day 21 完成标志

- [ ] `AskRequest` DTO 已创建
- [ ] `AiChatService` 已创建，含"只基于文档内容回答"的 System Prompt
- [ ] `POST /api/documents/{id}/ask` 接口可用，且做了数据权限校验
- [ ] 前端查看弹窗增加了问答区域，可以输入问题并显示答案
- [ ] 测试了"文档中有答案"和"文档中无答案"两种情况
- [ ] 测试了空问题和跨用户访问的边界情况
- [ ] Git 提交：`git commit -m "feat: Day21 基于单个文档的智能问答，实现上下文拼接"`

---

## 核心知识点总结

### 1. 上下文拼接（Context Concatenation）

```
┌─────────────────────────────────────────┐
│  System Prompt: "只基于文档内容回答"      │
├─────────────────────────────────────────┤
│  User Prompt:                           │
│  【文档内容】                            │
│  xxxxxx...                              │
│                                         │
│  【用户问题】                            │
│  什么是 Spring Boot？                   │
└─────────────────────────────────────────┘
                    │
                    ▼
              大模型生成回答
              （优先从文档内容中找答案）
```

### 2. RAG 的最简形式

Day 21 实现的是 **RAG（检索增强生成）** 的最基础版本：

| 完整 RAG 流程 | Day 21 实现 |
|-------------|------------|
| 1. 文档切分成小块 | ❌ 未实现（整篇文档直接传入） |
| 2. 向量化存入向量数据库 | ❌ 未实现 |
| 3. 用户问题向量化 | ❌ 未实现 |
| 4. 相似度检索找相关块 | ❌ 未实现 |
| 5. 把相关块拼进 Prompt | ✅ **直接传入整篇文档** |
| 6. 大模型生成回答 | ✅ 已实现 |

> 💡 **为什么 Day 21 不用向量数据库？**
> - 单篇文档通常几千字，直接传入 Token 够用
> - 向量数据库（如 Milvus、Pinecone）增加复杂度，Day 28+ 再引入
> - 先理解"上下文拼接"的核心原理，再优化检索效率

### 3. 防止 AI Hallucination（幻觉）

**Hallucination**：AI 编造文档中没有的信息。

**防御手段**：
1. **System Prompt 明确限制**："只基于文档内容回答"
2. **诚实指令**："如果文档中没有相关信息，明确回答无法找到"
3. **安全护栏**："不要添加文档中没有的信息"

### 4. 第三阶段进度

| Day | 内容 | 状态 |
|:---:|------|:----:|
| **18** | 注册 API + 引入依赖 | ✅ 完成 |
| **19** | 打通模型调用（同步） | ✅ 完成 |
| **20** | 文档摘要自动生成 | ✅ 完成 |
| **21** | 基于单个文档的智能问答 | 🔄 今天 |
| **22** | 笔记本级（多文档）问答 | ⏳ 待开始 |
| **23** | SSE 流式输出 | ⏳ 待开始 |
| **24** | 引用溯源 | ⏳ 待开始 |
| **25** | 异步生成摘要 | ⏳ 待开始 |
| **26** | 超时重试、用量统计 | ⏳ 待开始 |

---

## 下节预告（Day 22）

> **笔记本级（多文档）问答**：用户问"我在这个笔记本里学过的 Spring 相关内容有哪些？"——AI 需要基于**多篇文档**的内容来综合回答。你将学会**多文档上下文拼接**：如何把多篇文档的内容合并后发给大模型，以及 Token 超限时的取舍策略。

---

## 💡 常见问题

**Q: 文档内容很长，超过 8000 字怎么办？**

A: Day 21 采用截断策略（只取前 8000 字）。如果文档更长，答案可能不完整。解决方案：
1. Day 28 引入向量数据库，只检索相关段落
2. Day 23 引入流式输出，分块处理

**Q: AI 还是会回答文档中没有的内容？**

A: 大模型不是 100% 听话的。如果发生这种情况：
1. 加强 System Prompt 的约束语气
2. 在 User Prompt 中重复强调"只基于文档内容"
3. Day 24 引入引用溯源，让 AI 标注答案来自文档的哪一段

**Q: 问答接口也很慢（2~5 秒），怎么优化？**

A: 和摘要一样，这是同步调用的通病。Day 23 会引入 SSE 流式输出，让答案像打字机一样逐字显示，不用干等。
