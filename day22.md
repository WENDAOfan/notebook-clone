# Day 22：笔记本级（多文档）智能问答

> **核心目标**：实现"基于笔记本内所有文档内容回答问题"的接口。用户在一个笔记本里上传了 3 篇 Spring 相关教程，然后问"这个笔记本里学过的 Spring 核心概念有哪些？"——AI 需要综合多篇文档的内容来回答。你将学会**多文档上下文拼接**：如何把多篇文档合并后发给大模型，以及 Token 超限时怎么取舍。
>
> 计划目标：笔记本级问答：将笔记本内所有文档内容拼接后作为上下文，实现跨文档问答。理解长文本的分段处理与信息压缩策略。

---

## 背景知识

### 从"单文档问答"到"笔记本级问答"

| 场景 | Day 21（单文档） | Day 22（多文档） |
|------|----------------|----------------|
| 用户问题 | "这篇文档讲了什么？" | "这个笔记本里的 Spring 内容有哪些？" |
| AI 上下文 | 1 篇文档的内容 | N 篇文档的内容拼接 |
| 技术难点 | 内容截断到 8000 字 | **多文档如何组织、总长度超限怎么取舍** |
| 接口路径 | `POST /api/documents/{id}/ask` | `POST /api/notebooks/{id}/ask` |

### 多文档上下文拼接的策略

把笔记本里的所有文档按顺序拼接，每篇文档标注标题：

```
System: "你是一位知识库问答助手。请严格基于以下文档内容回答问题。"

User: """
【文档 1：Spring Boot 入门.txt】
Spring Boot 是 Spring 框架的扩展...

【文档 2：Spring MVC 教程.txt】
Spring MVC 是一种基于 Java 的 Web 框架...

【文档 3：Spring Data JPA 指南.txt】
JPA（Java Persistence API）是...

【用户问题】
这个笔记本里的 Spring 核心概念有哪些？
"""
```

### 长文本超限的处理策略

现代大模型（如 DeepSeek、Kimi）已经支持 **1M 甚至 200 万字**的上下文窗口，所以 Day 22 不再需要对内容进行激进的截断。

但出于**成本和响应时间**的考虑（输入 Token 越多，费用越高、等待越久），我们仍然设置一个合理的上限：

```
总限制：50000 字（约 2-3 万 Token，在 1M 上下文中仅占 2-3%）

文档 1（8000 字）→ 纳入 ✓
文档 2（12000 字）→ 纳入 ✓  
文档 3（15000 字）→ 纳入 ✓
文档 4（20000 字）→ 纳入前 15000 字，截断
文档 5、6...      → 完全舍弃

最后提示："...（部分内容因长度限制未纳入上下文）"
```

> 💡 50000 字是什么概念？大概是一部中篇小说的 1/3，对普通笔记本（10-20 篇短文档）来说完全够用。Day 28 引入向量检索后，会升级为"只拿和用户问题最相关的段落"，届时可彻底摆脱长度限制。

---

## 任务规划（共 4 步）

---

### 第 1 步：扩展 AiChatService，新增多文档问答方法

#### 1.1 在 AiChatService 中新增方法

**文件**：`src/main/java/com/example/notebook_clone/service/AiChatService.java`

```java
package com.example.notebook_clone.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class AiChatService {

    private final ChatClient chatClient;

    public AiChatService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    // ====== Day 21 原有方法（略，保留不动）======
    public String askBasedOnDocument(String documentContent, String question, boolean useDocumentContext) {
        // ... 原有实现保持不变 ...
    }

    // ====== Day 22 新增：基于多篇文档回答 ======

    /**
     * 基于笔记本内多篇文档内容回答用户问题
     *
     * @param documents     文档列表，每个元素是 [标题, 内容] 的数组
     * @param question      用户问题
     * @return AI 基于所有文档内容的综合回答
     */
    public String askBasedOnDocuments(List<String[]> documents, String question) {
        // 如果没有文档
        if (documents == null || documents.isEmpty()) {
            return "该笔记本下没有文档，无法回答问题。";
        }

        // 拼接所有文档内容，每篇标注标题
        StringBuilder contextBuilder = new StringBuilder();
        int totalLength = 0;
        // 现代模型上下文可达 1M+ Token，这里放宽到 50000 字符（约 2-3 万 Token）
        final int MAX_LENGTH = 50000;
        boolean truncated = false;

        for (String[] doc : documents) {
            String title = doc[0];
            String content = doc[1];

            if (content == null || content.trim().isEmpty()) {
                continue;
            }

            // 构建这篇文档的片段
            String docSection = "\n【文档：" + title + "】\n" + content.trim() + "\n";

            // 检查加入后是否超限
            if (totalLength + docSection.length() > MAX_LENGTH) {
                // 还能塞多少字
                int remaining = MAX_LENGTH - totalLength;
                if (remaining > 100) {
                    // 至少还能塞 100 字，截断这篇文档的一部分
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

        // 调用 AI
        String answer = chatClient.prompt()
                .system("""
                        你是一位知识库问答助手。请严格遵循以下规则：
                        1. 只基于用户提供的【文档内容】回答问题
                        2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                        3. 回答要简洁，控制在 300 字以内
                        4. 不要添加文档中没有的信息
                        5. 如果有多篇文档，综合各篇文档的信息进行回答
                        """)
                .user("""
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

#### 1.2 代码重点解析

| 代码 | 作用 |
|------|------|
| `List<String[]>` | 每篇文档传 `[标题, 内容]`，方便拼接时标注来源 |
| `totalLength + docSection.length() > MAX_LENGTH` | **核心截断逻辑**：按文档顺序累加，超限即停 |
| `"【文档：" + title + "】"` | 每篇文档标注标题，让 AI 知道答案来自哪篇 |
| `"综合各篇文档的信息进行回答"` | 关键指令：提醒 AI 要跨文档综合分析 |
| `truncated` 标志 | 如果舍弃了部分文档，在末尾提示用户 |

---

### 第 2 步：在 NotebookController 中添加笔记本级问答接口

#### 2.1 注入所需依赖

**文件**：`src/main/java/com/example/notebook_clone/controller/NotebookController.java`

修改构造函数，注入 `DocumentRepository` 和 `AiChatService`：

```java
package com.example.notebook_clone.controller;

import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.dto.AskRequest;
import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.entity.Notebook;
import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.repository.NotebookRepository;
import com.example.notebook_clone.repository.UserRepository;
import com.example.notebook_clone.service.AiChatService;
import jakarta.validation.Valid;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/notebooks")
public class NotebookController {

    private final NotebookRepository notebookRepository;
    private final UserRepository userRepository;
    private final DocumentRepository documentRepository;  // Day 22 新增
    private final AiChatService aiChatService;             // Day 22 新增

    public NotebookController(NotebookRepository notebookRepository,
                              UserRepository userRepository,
                              DocumentRepository documentRepository,  // 新增
                              AiChatService aiChatService) {          // 新增
        this.notebookRepository = notebookRepository;
        this.userRepository = userRepository;
        this.documentRepository = documentRepository;
        this.aiChatService = aiChatService;
    }

    // ... 原有接口（getAllNotebooks、createNotebook 等）保持不变 ...
```

#### 2.2 添加笔记本级问答接口

在 `NotebookController` 中追加：

```java
    /**
     * 基于笔记本内所有文档进行智能问答（跨文档问答）
     */
    @PostMapping("/{id}/ask")
    public Result<String> askNotebook(@PathVariable Long id,
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

        // 3. 查询笔记本并校验归属
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
                request.getQuestion()
        );

        return Result.success(answer);
    }
```

#### 2.3 接口设计说明

| 设计选择 | 说明 |
|---------|------|
| `POST /api/notebooks/{id}/ask` | RESTful 风格，表示"对某个笔记本执行 ask 操作" |
| 复用 `AskRequest` | 和 Day 21 同一个 DTO，前端不需要新增请求体格式 |
| `findByNotebook_Id(id)` | 利用 DocumentRepository 已有的方法查询笔记本下所有文档 |
| 权限校验 | 使用 `findByIdAndUserId` 一步完成"存在性 + 归属权"校验 |

---

### 第 3 步：前端添加笔记本级问答入口

#### 3.1 在 index.html 的文档列表区域增加问答入口

在右侧文档列表的标题栏（`currentNotebookName` 旁边）增加一个"向笔记本提问"按钮：

```html
<!-- 在文档列表 header 区域（找 <h2 id="currentNotebookName"...> 附近） -->
<div class="content-header">
    <h2 id="currentNotebookName" class="content-title">📄 文档列表</h2>
    <!-- Day 22 新增：笔记本问答按钮 -->
    <button class="btn btn-secondary" id="btnNotebookAsk" onclick="toggleNotebookQA()" style="display: none;">
        💬 向笔记本提问
    </button>
</div>

<!-- Day 22 新增：笔记本级问答面板（默认隐藏） -->
<div id="notebookQAPanel" class="notebook-qa-panel" style="display: none;">
    <div class="qa-header">
        <span>💬 笔记本问答</span>
        <span class="qa-hint">基于当前笔记本内 <span id="notebookDocCount">0</span> 篇文档回答</span>
    </div>
    <div class="qa-input-area">
        <input type="text" id="notebookQAInput" 
               placeholder="输入你的问题，例如：这个笔记本里的核心概念有哪些？" 
               onkeypress="if(event.key==='Enter') askNotebook()">
        <button class="btn btn-primary" onclick="askNotebook()">提问</button>
    </div>
    <div id="notebookQAAnswer" class="qa-answer" style="display: none;">
        <div class="qa-answer-label">🤖 回答：</div>
        <textarea id="notebookQAAnswerText" class="qa-answer-text" readonly rows="8"></textarea>
    </div>
</div>
```

#### 3.2 修改 app.js

**改动一**：新增 API 函数和问答逻辑

```javascript
// API：基于笔记本问答
async function askNotebookAPI(notebookId, question) {
    return fetchAPI(`/api/notebooks/${notebookId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question }),
    });
}

// 切换笔记本问答面板显示/隐藏
function toggleNotebookQA() {
    const panel = document.getElementById('notebookQAPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// 笔记本级问答功能
async function askNotebook() {
    const input = document.getElementById('notebookQAInput');
    const question = input.value.trim();
    
    if (!question) {
        showToast('请输入问题', 'error');
        return;
    }
    
    if (!currentNotebookId) {
        showToast('请先选择一个笔记本', 'error');
        return;
    }
    
    try {
        showToast('正在综合多篇文档思考...', 'info');
        const answer = await askNotebookAPI(currentNotebookId, question);
        
        // 显示答案
        document.getElementById('notebookQAAnswer').style.display = 'block';
        document.getElementById('notebookQAAnswerText').value = answer;
        input.value = '';
        showToast('回答已生成', 'success');
    } catch (error) {
        showToast('回答失败: ' + error.message, 'error');
    }
}
```

**改动二**：在加载文档列表时，显示/隐藏问答按钮并更新文档数量

找到 `loadDocuments(notebookId)` 函数（或你项目里加载文档列表的函数），在成功加载后增加：

```javascript
async function loadDocuments(notebookId) {
    // ... 原有加载逻辑 ...
    
    // Day 22 新增：显示笔记本问答按钮，更新文档数量
    const btnNotebookAsk = document.getElementById('btnNotebookAsk');
    const docCountSpan = document.getElementById('notebookDocCount');
    const panel = document.getElementById('notebookQAPanel');
    
    if (btnNotebookAsk) {
        btnNotebookAsk.style.display = 'inline-block';
    }
    if (docCountSpan) {
        docCountSpan.textContent = currentDocuments.length;  // 假设 currentDocuments 是已加载的文档数组
    }
    // 切换笔记本时，关闭问答面板
    if (panel) {
        panel.style.display = 'none';
        document.getElementById('notebookQAInput').value = '';
        document.getElementById('notebookQAAnswer').style.display = 'none';
        document.getElementById('notebookQAAnswerText').value = '';
    }
    
    // ... 原有后续逻辑 ...
}
```

**改动三**：在没有选中笔记本时隐藏按钮

在初始化或清空文档列表的逻辑中：

```javascript
// 当没有选中笔记本时，隐藏问答按钮和面板
const btnNotebookAsk = document.getElementById('btnNotebookAsk');
const panel = document.getElementById('notebookQAPanel');
if (btnNotebookAsk) btnNotebookAsk.style.display = 'none';
if (panel) panel.style.display = 'none';
```

#### 3.3 添加 CSS 样式

在 `style.css` 中增加笔记本问答面板样式：

```css
/* ========== 笔记本级问答面板 ========== */

.content-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.notebook-qa-panel {
    margin-bottom: 20px;
    padding: 16px;
    background-color: #f0f7ff;
    border-radius: 12px;
    border: 1px solid #d0e3f7;
}

.notebook-qa-panel .qa-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    font-weight: 500;
    color: #333;
}

.notebook-qa-panel .qa-hint {
    font-size: 13px;
    color: #666;
    font-weight: normal;
}

.notebook-qa-panel .qa-input-area {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
}

.notebook-qa-panel .qa-input-area input[type="text"] {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid #c0d8f0;
    border-radius: 8px;
    font-size: 14px;
    outline: none;
    background-color: #fff;
}

.notebook-qa-panel .qa-input-area input[type="text"]:focus {
    border-color: #4a90d9;
}

.notebook-qa-panel .qa-answer {
    background-color: #fff;
    border-radius: 10px;
    padding: 16px;
    border: 1px solid #e0ecf7;
}
```

---

### 第 4 步：在 api.http 中添加 Day 22 测试用例

**文件**：`notebook-clone/api.http`

在文件末尾追加：

```http
### ========== Day 22 笔记本级（多文档）智能问答测试 ==========

### 0. 先登录获取 Token（替换为你的真实用户名密码）
POST http://localhost:8080/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "123456"
}

### 1. 基于笔记本提问（替换 {notebookId} 为实际笔记本 ID）
### 问题应该综合多篇文档的内容才能完整回答
POST http://localhost:8080/api/notebooks/1/ask
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "question": "这个笔记本里的核心概念有哪些？"
}

### 2. 问一个跨文档的问题（测试多文档综合）
POST http://localhost:8080/api/notebooks/1/ask
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "question": "对比文档中提到的不同技术，各有什么特点？"
}

### 3. 测试空笔记本（应该提示没有文档）
### 先创建一个空笔记本，然后用它的 ID 测试
POST http://localhost:8080/api/notebooks/999/ask
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "question": "这个笔记本讲了什么？"
}

### 4. 测试空问题（应该返回错误）
POST http://localhost:8080/api/notebooks/1/ask
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "question": ""
}

### 5. 测试跨用户访问（应该失败）
### 用另一个用户的 Token 访问别人的笔记本
POST http://localhost:8080/api/notebooks/1/ask
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "question": "这个笔记本讲了什么？"
}
```

---

## 改动文件总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `AiChatService.java` | **修改** | 新增 `askBasedOnDocuments` 方法：多文档拼接 + 按文档顺序截断 |
| `NotebookController.java` | **修改** | 注入 DocumentRepository 和 AiChatService，新增 `/{id}/ask` 接口 |
| `index.html` | **修改** | 文档列表区域增加"向笔记本提问"按钮和问答面板 |
| `app.js` | **修改** | 新增 `askNotebookAPI`、`askNotebook`、`toggleNotebookQA` 函数 |
| `style.css` | **修改** | 笔记本问答面板样式 |
| `api.http` | **修改** | 追加 Day 22 测试用例 |

---

## Day 22 完成标志

- [ ] `AiChatService.askBasedOnDocuments` 已创建，支持多篇文档拼接和按文档顺序截断
- [ ] `POST /api/notebooks/{id}/ask` 接口可用，且做了数据权限校验
- [ ] 前端文档列表区域出现"💬 向笔记本提问"按钮，点击展开问答面板
- [ ] 问答面板显示当前笔记本内文档数量
- [ ] 测试了"多文档综合问答"和"空笔记本"两种情况
- [ ] 测试了空问题和跨用户访问的边界情况
- [ ] Git 提交：`git commit -m "feat: Day22 笔记本级多文档智能问答，实现跨文档上下文拼接"`

---

## 核心知识点总结

### 1. 多文档上下文拼接（Multi-Document Context Concatenation）

```
┌────────────────────────────────────────────────────────┐
│  System Prompt: "只基于文档内容回答，综合各篇文档信息"      │
├────────────────────────────────────────────────────────┤
│  User Prompt:                                          │
│  【文档 1：标题 A】                                      │
│  xxxxxx...                                             │
│  【文档 2：标题 B】                                      │
│  yyyyyy...                                             │
│  【文档 3：标题 C】                                      │
│  zzzzzz...（截断）                                      │
│                                                        │
│  【用户问题】                                            │
│  这些文档的共同主题是什么？                               │
└────────────────────────────────────────────────────────┘
                          │
                          ▼
                   AI 综合多篇文档生成回答
```

### 2. 长文本截断策略

Day 22 采用的是**按文档顺序截断**，这是最简单的策略：

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| **全量传入 + 宽松上限**（Day 22） | 充分利用现代模型大上下文，答案完整 | 超长文本仍有成本 | 单笔记本几十篇文档以内 |
| 按文档顺序截断 | 简单、可预期 | 后面的文档永远进不来 | 文档极多且按重要性排序 |
| 只取相关段落（Day 28） | 精准、省 Token、无上限 | 需要向量检索 | 文档数量多、内容长 |

> 💡 **为什么 Day 22 用简单策略？**
> - 先理解"多文档拼接"的核心原理
> - 复杂检索策略（RAG）在 Day 28 引入，循序渐进

### 3. 单文档问答 vs 笔记本级问答 对比

| 维度 | Day 21（单文档） | Day 22（笔记本级） |
|------|----------------|-------------------|
| 接口 | `/api/documents/{id}/ask` | `/api/notebooks/{id}/ask` |
| Service 方法 | `askBasedOnDocument` | `askBasedOnDocuments` |
| 上下文 | 1 篇文档 | N 篇文档 |
| 适用问题 | "这篇文档讲了什么？" | "这些文档的共同主题是什么？" |
| 截断策略 | 单文档截断到 8000 字 | 多文档累计截断到 8000 字 |

### 4. 第三阶段进度

| Day | 内容 | 状态 |
|:---:|------|:----:|
| **18** | 注册 API + 引入依赖 | ✅ 完成 |
| **19** | 打通模型调用（同步） | ✅ 完成 |
| **20** | 文档摘要自动生成 | ✅ 完成 |
| **21** | 基于单个文档的智能问答 | ✅ 完成 |
| **21.5** | 前端问答优化（开关 + 大回答框） | ✅ 完成 |
| **22** | 笔记本级（多文档）问答 | 🔄 今天 |
| **23** | SSE 流式输出 | ⏳ 待开始 |
| **24** | 引用溯源 | ⏳ 待开始 |
| **25** | 异步生成摘要 | ⏳ 待开始 |
| **26** | 超时重试、用量统计 | ⏳ 待开始 |

---

## 下节预告（Day 23）

> **SSE 流式输出**：目前 AI 问答要等 2~5 秒才一次性返回完整答案，用户体验差。Day 23 将引入 **SSE（Server-Sent Events）**，让 AI 的回答像打字机一样**逐字逐句实时显示**，不用干等。你将掌握 `Flux<String>` 响应式编程和 `EventSource` 前端API。

---

## 💡 常见问题

**Q: 笔记本里有 10 篇文档，每篇 5000 字，总共 5 万字，怎么办？**

A: 5 万字刚好接近 Day 22 的 50000 字上限，大部分内容都能传入。如果确实超限被截断了，后续方案：
1. Day 24 引用溯源：让 AI 先读每篇文档的摘要，再决定深入哪篇
2. Day 28 向量检索：只拿和用户问题最相关的段落，而不是整篇文档

**Q: 现在模型都支持 1M 上下文了，为什么还要设 50000 字上限？**

A: 三个原因：
1. **成本**：输入 Token 按量计费，5 万字约 2-3 万 Token，费用可控；传 100 万字费用就很高了
2. **响应时间**：Token 越多，模型处理时间越长，50000 字以内通常在几秒内返回
3. **防御性设计**：防止用户恶意/误操作上传超大文本导致费用爆炸

等 Day 28 引入向量检索后，就不再受这个上限约束了。

**Q: 为什么不是把文档内容存到向量数据库，然后做语义检索？**

A: 向量数据库（如 Milvus、Pinecone）确实是最优解，但它增加了架构复杂度（需要额外部署服务、生成向量、维护索引）。Day 22 先解决"多文档拼接"的最简场景，Day 28 再引入向量检索做性能优化。

**Q: 多文档问答比单文档问答慢吗？**

A: 不一定。AI 的响应时间主要取决于 **输出字数**，而不是输入字数（只要没超过模型的上下文上限）。但多文档的输入 Token 更多，费用会更高。Day 26 会加入 Token 用量统计。

**Q: 文档标题在 Prompt 里有什么用？**

A: 让 AI 知道答案来自哪篇文档，也为 Day 24 的"引用溯源"打基础。如果用户问"哪篇文档讲了 Spring Boot？"，AI 可以根据标题直接回答。
