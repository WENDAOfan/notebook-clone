# Day 24: 引用溯源 — 让 AI 标注引用来源

**目标**：在 AI 流式回答中标注引用的原文段落来源，实现 NotebookLM 式的引用体验——用户不仅看到答案，还能知道答案来自哪篇文档的哪段内容。

---

## 当前状态

Day 23-5 完成后，前端已支持 SSE 流式输出，AI 回答像打字机一样逐字显示。但存在一个问题：

> 用户问："Spring Boot 的核心特性有哪些？"
> AI 答："Spring Boot 的核心特性包括自动配置、嵌入式服务器..."
>
> ❓ **用户无法验证**：这个答案是 AI 自己编的，还是真的来自我上传的文档？

**引用溯源（Citation）** 就是解决这个问题：让 AI 在回答中明确标注"这段话来自【文档：xxx】的第 Y 段"。

---

## 步骤 1/5: 认知学习 — 什么是引用溯源（前 10 分钟，不写代码）

### 为什么需要引用溯源

| 问题 | 没有引用溯源 | 有引用溯源 |
|:---|:---|:---|
| **AI 幻觉** | 用户无法分辨真假 | 用户可点击引用跳转原文验证 |
| **可信度** | "AI 说的，不一定对" | "AI 引用了我的文档，可信" |
| **深度阅读** | 看完回答就结束 | 可定位到原文深入阅读 |
| **多文档场景** | 不知道答案来自哪篇 | 清楚看到各篇文档的贡献 |

### 引用溯源的两种技术路线

| 路线 | 原理 | 精度 | 复杂度 |
|:---|:---|:---|:---|
| **Prompt 引导**（今天用的） | 在 System Prompt 中要求 AI 自行标注来源 | 中等（到文档级别） | 低 |
| **RAG + 向量检索**（Day 28） | 先检索相关段落，再让 AI 基于检索结果回答 | 高（到段落级别） | 高 |

今天用**路线 1**：通过 Prompt 工程让 AI 在回答中标注来源。虽然精度不如向量检索，但无需引入新组件，当天即可实现。

### 引用格式设计

我们需要一个**前后端都能识别**的引用标记格式：

```
AI 回答正文...这里引用了某段内容[^1^]...继续回答...

---
参考来源：
[^1^] 【文档：Spring Boot 入门.txt】Spring Boot 是 Spring 框架的扩展...
```

- `[^N^]`：引用标记，插在正文引用处
- `---`：分隔线，后面是参考来源列表
- 参考来源列表：编号 + 文档标题 + 原文片段

---

## 步骤 2/5: 后端改造 — Prompt 工程 + 引用格式约定

### 2.1 修改 System Prompt，增加引用要求

在 `AiChatService.java` 中，修改多文档问答的 System Prompt（`buildMultiDocSystemPrompt` 方法）：

```java
private String buildMultiDocSystemPrompt() {
    return """
            你是一位知识库问答助手。请严格遵循以下规则：
            1. 只基于用户提供的【文档内容】回答问题
            2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
            3. 回答要简洁，控制在 300 字以内
            4. 不要添加文档中没有的信息
            5. 如果有多篇文档，综合各篇文档的信息进行回答
            6. 【引用溯源】当你引用了某篇文档的具体内容时，必须在引用处添加标记 [^N^]，
               其中 N 是引用编号（从 1 开始递增）。
            7. 【引用溯源】回答末尾必须用 "---" 分隔，然后列出所有参考来源，格式为：
               [^N^] 【文档：标题】原文片段（前 50 字）
            """;
}
```

### 2.2 单文档问答也加上引用要求

修改 `buildSingleDocSystemPrompt` 中基于文档回答的分支：

```java
// useDocumentContext == true 的分支
? """
  你是一位知识库问答助手。请严格遵循以下规则：
  1. 只基于用户提供的【文档内容】回答问题
  2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
  3. 回答要简洁，控制在 300 字以内
  4. 不要添加文档中没有的信息
  5. 【引用溯源】当你引用了文档的具体内容时，必须在引用处添加标记 [^1^]。
  6. 【引用溯源】回答末尾必须用 "---" 分隔，然后列出参考来源：
     [^1^] 原文片段（前 50 字）
  """
```

### 2.3 为什么这样设计格式？

| 设计选择 | 原因 |
|:---|:---|
| `[^N^]` 标记 | 类似 Markdown 脚注，前后端都易解析 |
| `---` 分隔线 | 明确区分"回答正文"和"参考来源" |
| 原文片段限 50 字 | 防止引用列表过长，同时足够用户识别 |

> ⚠️ **注意**：AI 不一定 100% 遵守格式约定。如果 AI 没有输出引用，前端应该优雅降级——只显示回答正文，不显示引用卡片。

---

## 步骤 3/5: 前端改造 — 解析引用标记并渲染

### 3.1 新增引用解析工具函数

在 `app.js` 中添加：

```javascript
/**
 * 解析带引用标记的 AI 回答
 * @param {string} rawText - AI 返回的原始文本（含引用标记）
 * @returns {Object} { answer: 正文, citations: [{id, title, snippet}] }
 */
function parseCitations(rawText) {
    // 按 "---" 分割正文和引用来源
    const parts = rawText.split('---');
    let answer = parts[0].trim();
    const citations = [];

    // 如果有引用来源部分
    if (parts.length > 1) {
        const citationText = parts[1].trim();
        // 正则匹配：[^N^] 【文档：标题】原文片段
        const regex = /\[\^(\d+)\^\]\s*【?文档?：?([^】]+)】?\s*(.+)/g;
        let match;
        while ((match = regex.exec(citationText)) !== null) {
            citations.push({
                id: match[1],
                title: match[2].trim(),
                snippet: match[3].trim()
            });
        }
    }

    // 如果正文中有 [^N^] 标记但 citations 为空，尝试从正文中提取
    if (citations.length === 0) {
        const inlineRegex = /\[\^(\d+)\^\]/g;
        let inlineMatch;
        while ((inlineMatch = inlineRegex.exec(answer)) !== null) {
            citations.push({
                id: inlineMatch[1],
                title: '未知来源',
                snippet: ''
            });
        }
    }

    return { answer, citations };
}
```

### 3.2 新增引用卡片渲染函数

```javascript
/**
 * 渲染引用来源卡片
 * @param {Array} citations - 引用列表 [{id, title, snippet}]
 * @param {HTMLElement} container - 容器元素
 */
function renderCitationCards(citations, container) {
    if (!citations || citations.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    let html = '<div class="citation-header">📚 参考来源</div>';
    html += '<div class="citation-list">';

    citations.forEach(cite => {
        html += `
            <div class="citation-card" data-cite-id="${cite.id}">
                <div class="citation-number">[${cite.id}]</div>
                <div class="citation-content">
                    <div class="citation-title">${escapeHtml(cite.title)}</div>
                    <div class="citation-snippet">${escapeHtml(cite.snippet)}</div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
    container.style.display = 'block';
}

/**
 * HTML 转义，防止 XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
```

### 3.3 修改 HTML — 在回答区下方添加引用卡片容器

**文档问答区域**（`index.html`）：

```html
<div id="qaAnswer" class="qa-answer" style="display: none;">
    <div class="qa-answer-label">
        🤖 回答：
        <span id="qaStreamIndicator" class="stream-indicator" style="display: none;">
            <span class="stream-dot"></span> AI 正在输入...
        </span>
    </div>
    <textarea id="qaAnswerText" class="qa-answer-text" readonly rows="8"></textarea>
    <!-- Day 24 新增：引用来源卡片区域 -->
    <div id="qaCitations" class="citations-container" style="display: none;"></div>
</div>
```

**笔记本问答区域**（`index.html`）：

```html
<div id="notebookQAAnswer" class="notebook-qa-answer" style="display: none;">
    <div class="notebook-qa-answerlabel">
        🤖 AI 综合回答
        <span id="notebookStreamIndicator" class="stream-indicator" style="display: none;">
            <span class="stream-dot"></span> AI 正在输入...
        </span>
    </div>
    <textarea id="notebookQAAnswerText" class="notebook-qa-answertext" readonly rows="8"></textarea>
    <!-- Day 24 新增：引用来源卡片区域 -->
    <div id="notebookCitations" class="citations-container" style="display: none;"></div>
</div>
```

### 3.4 修改 askDocument — 流式输出完成后解析引用

在 `askDocument()` 函数的 `finally` 块之前，添加引用解析：

```javascript
} finally {
    // 原有代码：隐藏指示器
    indicator.style.display = 'none';
    answerEl.classList.remove('streaming');

    // ===== Day 24 新增：解析引用并渲染 =====
    const rawAnswer = answerEl.value;
    const { answer, citations } = parseCitations(rawAnswer);

    // 如果有引用，更新正文（去掉引用列表部分）并渲染引用卡片
    if (citations.length > 0) {
        answerEl.value = answer;  // 只保留正文部分
        const citationContainer = document.getElementById('qaCitations');
        renderCitationCards(citations, citationContainer);
    }
    // =========================================
}
```

### 3.5 修改 askNotebook — 同样的逻辑

在 `askNotebook()` 函数的 `finally` 块中，添加相同的引用解析逻辑，使用 `document.getElementById('notebookCitations')` 作为容器。

---

## 步骤 4/5: 添加引用卡片样式

在 `style.css` 末尾添加：

```css
/* ========== Day 24: 引用溯源样式 ========== */

.citations-container {
    margin-top: 12px;
    padding: 12px 16px;
    background: #f8f9fa;
    border-radius: 8px;
    border-left: 3px solid #4a90d9;
}

.citation-header {
    font-size: 0.9em;
    font-weight: 600;
    color: #333;
    margin-bottom: 8px;
}

.citation-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.citation-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 12px;
    background: white;
    border-radius: 6px;
    border: 1px solid #e1e4e8;
    transition: all 0.2s ease;
}

.citation-card:hover {
    border-color: #4a90d9;
    box-shadow: 0 2px 4px rgba(74, 144, 217, 0.1);
}

.citation-number {
    min-width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #4a90d9;
    color: white;
    border-radius: 50%;
    font-size: 0.8em;
    font-weight: 600;
    flex-shrink: 0;
}

.citation-content {
    flex: 1;
    min-width: 0;
}

.citation-title {
    font-size: 0.85em;
    font-weight: 500;
    color: #333;
    margin-bottom: 2px;
}

.citation-snippet {
    font-size: 0.8em;
    color: #666;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
```

---

## 步骤 5/5: 测试验证 + 代码提交

### 5.1 测试用例

**测试 1：正常引用**
- 上传一篇包含 "Spring Boot 自动配置原理" 的文档
- 提问："Spring Boot 的自动配置是什么？"
- 预期：回答中出现 `[^1^]` 标记，回答下方显示引用卡片，卡片中显示文档标题和原文片段

**测试 2：无引用场景**
- 提问："你好"
- 预期：AI 回答问候语，不输出引用标记，下方不显示引用卡片（优雅降级）

**测试 3：多篇文档引用**
- 笔记本中有 3 篇文档
- 提问综合问题
- 预期：回答中出现多个 `[^1^]` `[^2^]` 等标记，下方显示多个引用卡片

### 5.2 代码提交

```bash
git add -A
git commit -m "feat: AI citation tracking -标注引用来源"
```

### 今日复盘 Checklist

- [ ] 能解释什么是引用溯源（Citation）及其重要性
- [ ] 理解 Prompt 工程实现引用溯源的原理和局限性
- [ ] 知道 `[^N^]` 和 `---` 分隔线的设计意图
- [ ] 理解 `parseCitations()` 的分割和正则解析逻辑
- [ ] 知道为什么需要 `escapeHtml()`（防止 XSS 攻击）
- [ ] 测试确认能看到引用标记和引用卡片
- [ ] 测试确认无引用时前端优雅降级（不报错、不显示空卡片）

### 后续衔接

Day 25-27 将引入**向量数据库**和 **RAG（检索增强生成）**，届时引用溯源将从"文档级别"升级到"段落级别"——不仅知道答案来自哪篇文档，还能精确到具体段落，并实现点击引用跳转原文定位。Prompt 引导 → 向量检索，是引用溯源从"近似"到"精确"的进化路径。
