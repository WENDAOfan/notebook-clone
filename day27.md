# Day 27: 文档文本提取 + 混合输入 — 为 RAG 做准备

**目标**：让"新建文档"支持同时输入文本 + 上传文件，两者内容合并存储；对提取的文本做基础清洗（去水印、去噪声），为后续 RAG 提供干净输入。

---

## 当前状态

Day 26 完成后，项目已具备 AI 问答、文档管理、摘要生成等能力。但"新建文档"有两个问题：

```
问题 1：前端不支持同时输入文本和上传文件
  当前是互斥选项卡 → 要么手动输入文本，要么上传文件 → 不能同时

问题 2：提取的文本质量没有保障
  PDF/Word 上传后直接提取原文存入数据库 → 没有清洗 → 水印、控制字符、多余空行等噪声
                                                       ↓
                                              后续做 RAG 时分块质量差
```

**Day 27 的解决方案**：前端改复选框支持混合输入，后端加文本清洗管线。

---

## 步骤 1/5: 后端 — 文本清洗管线（DocumentExtractService）

### 1.1 为什么需要文本清洗

PDF 和 Word 文件提取出来的"原文"并不干净：

```
PDF 提取常见问题：
  1. 控制字符（NUL \x00、退格 \x08 等）→ PDF 内部编码残留
  2. 连续大量空行 → PDF 页面间距被转成换行
  3. 水印文本 → "S e c r e t @ L e v e l" 每个字符间带空格
  4. 每页重复的页眉页脚 → 同一行出现几十次

Word 提取常见问题：
  1. 段落尾部多余换行
  2. 行首行尾空白
```

如果不清洗直接存库，做 RAG 分块时会把水印和正文混在一起，检索质量大打折扣。

### 1.2 cleanText() 清洗管线

在 `DocumentExtractService` 中新增 `cleanText()` 方法，在 `extractText()` 返回前统一调用：

```java
private String cleanText(String raw) {
    // 第一步：去除控制字符（保留换行\n、回车\r、制表符\t）
    String cleaned = raw.replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "");
    // 第二步：连续3个以上换行合并为2个
    cleaned = cleaned.replaceAll("\\n{3,}", "\n\n");
    // 第三步：过滤PDF水印行（字符间大量空格）
    cleaned = removeWatermarkLines(cleaned);
    // 第四步：去除重复出现3次以上的行（每页重复的水印、页眉页脚）
    cleaned = removeRepeatedLines(cleaned);
    // 第五步：每行首尾空白去除
    cleaned = Arrays.stream(cleaned.split("\\n", -1))
            .map(String::strip)
            .collect(Collectors.joining("\n"));
    return cleaned.trim();
}
```

### 1.3 水印行过滤的原理

PDF 中的水印层每个字符单独定位（坐标级别），PDFBox 逐字提取时会在字符之间插入空格，产生类似：

```
S e c r e t @ L e v e l : @ P u b l i c @ B e i j i n g @
```

这种文本的特征是**空格占比极高**。正常中英文文本的空格占比通常不到 20%，而水印文本可达 50%。

```java
private String removeWatermarkLines(String text) {
    return Arrays.stream(text.split("\\n", -1))
            .filter(line -> !isWatermarkLine(line))
            .collect(Collectors.joining("\n"));
}

private boolean isWatermarkLine(String line) {
    String trimmed = line.strip();
    if (trimmed.length() < 12) return false;
    long spaceCount = trimmed.chars().filter(c -> c == ' ').count();
    double spaceRatio = (double) spaceCount / trimmed.length();
    return spaceRatio > 0.4;  // 空格占比超过40% → 水印
}
```

### 1.4 重复行去重的原理

学位论文的水印在每一页都重复出现，页眉页脚也是。如果同一行文本在全文中出现 3 次以上，大概率不是正文：

```java
private String removeRepeatedLines(String text) {
    Map<String, Long> lineCounts = Arrays.stream(text.split("\\n"))
            .filter(line -> !line.strip().isEmpty())
            .collect(Collectors.groupingBy(String::strip, Collectors.counting()));
    return Arrays.stream(text.split("\\n", -1))
            .filter(line -> {
                String stripped = line.strip();
                if (stripped.isEmpty()) return true;  // 保留空行
                return lineCounts.getOrDefault(stripped, 0L) < 3;
            })
            .collect(Collectors.joining("\n"));
}
```

### 1.5 PDF 提取开启位置排序

PDFBox 默认按 PDF 内容流顺序提取文本，不按视觉位置。加上 `setSortByPosition(true)` 后按坐标排序，减少水印/页眉混入正文：

```java
private String extractFromPdf(MultipartFile file) throws IOException {
    try (PDDocument document = Loader.loadPDF(file.getBytes())) {
        PDFTextStripper stripper = new PDFTextStripper();
        stripper.setSortByPosition(true);  // 按视觉位置排序
        stripper.setStartPage(1);
        stripper.setEndPage(document.getNumberOfPages());
        return stripper.getText(document);
    }
}
```

### 1.6 PDF 解析的异常兜底

PDFBox 解析可能抛出各种异常（加密 PDF、损坏文件、扫描版 PDF 等），不能让它导致整个上传接口崩溃：

```java
else if (lowerCaseName.endsWith(".pdf")) {
    try {
        rawText = extractFromPdf(file);
        if (rawText == null || rawText.strip().isEmpty()) {
            rawText = "[PDF文本提取为空，该文件可能是扫描版/图片型PDF]";
        }
    } catch (Exception e) {
        rawText = "[PDF解析失败: " + e.getMessage() + "]";
    }
}
```

### 1.7 已知局限

- **封面/扉页噪声**：学位论文封面用装饰性字体，PDFBox 无法解码会产生 □ 替换字符。正文不受影响，AI 摘要能从正文正确生成。
- **繁体字映射**：如 "密級"（繁体）是 PDF 字体编码映射结果，提取层无法修复。
- **扫描版 PDF**：纯图片型 PDF 无法提取文本，返回提示文本。

---

## 步骤 2/5: 后端 — upload 端点支持混合输入（DocumentController）

### 2.1 新增 additionalContent 参数

用户可能同时输入文本（笔记/备注）和上传文件（原始材料），两者都需要保存。upload 端点新增可选参数：

```java
@PostMapping("/upload")
public Result<Document> uploadDocumentFile(
        @RequestParam("notebookId") Long notebookId,
        @RequestParam("file") MultipartFile file,
        @RequestParam(value = "additionalContent", required = false) String additionalContent
) {
    // ... 提取文件文本 ...
    String extractedText = extractService.extractText(file);
    // 合并用户手动输入 + 文件提取文本
    String finalContent = mergeContent(extractedText, additionalContent);
    // ... 后续不变 ...
}
```

### 2.2 内容合并策略

手动输入的内容放前面（通常是用户的笔记、备注），文件提取的文本放后面（原始材料），用 `---` 分隔：

```java
private String mergeContent(String fileText, String additionalContent) {
    if (additionalContent == null || additionalContent.isBlank()) {
        return fileText;
    }
    return additionalContent.trim() + "\n\n---\n\n" + fileText;
}
```

### 2.3 异常捕获范围扩大

Controller 的 catch 从 `IOException` 扩大到 `Exception`，防止 PDFBox 的非 IO 异常（如加密 PDF 的 `InvalidPasswordException`）直接导致 500 崩溃：

```java
} catch (Exception e) {  // 原来是 IOException
    throw new RuntimeException("文件读取失败了！" + e.getMessage());
}
```

---

## 步骤 3/5: 前端 — 选项卡改复选框（HTML + CSS）

### 3.1 为什么改复选框

原来的选项卡是互斥的（输入内容 / 上传文件 二选一）。改成复选框后两个区域可以同时显示：

```html
<div class="doc-create-modes">
    <label class="doc-create-mode-check">
        <input type="checkbox" id="checkText" checked onchange="updateDocCreateModes()">
        <span>输入内容</span>
    </label>
    <label class="doc-create-mode-check">
        <input type="checkbox" id="checkFile" onchange="updateDocCreateModes()">
        <span>上传文件</span>
    </label>
</div>
```

两个区域（textarea + 文件上传区）根据复选框状态独立显示/隐藏，至少勾选一个才能点"创建"。

### 3.2 CSS 样式

```css
.doc-create-modes {
    display: flex;
    gap: 20px;
    margin-bottom: 16px;
}
.doc-create-mode-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
}
.doc-create-mode-check input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--color-primary);
    cursor: pointer;
}
```

---

## 步骤 4/5: 前端 — 三种模式创建文档（app.js）

### 4.1 createDocument() 支持三种模式

```javascript
async function createDocument() {
    const title = ...;
    const hasText = document.getElementById('checkText').checked;
    const fileChecked = document.getElementById('checkFile').checked;
    const hasFile = fileChecked && selectedFile;

    if (hasFile) {
        // 有文件 → 走 FormData 上传，可选附带文本
        const additionalContent = hasText
            ? document.getElementById('documentContent').value
            : null;
        const doc = await uploadDocumentFileAPI(selectedFile, currentNotebook.id, additionalContent);
        // ...
    } else if (hasText) {
        // 纯文本 → 走原有 JSON 接口
        const doc = await createDocumentAPI(...);
        // ...
    } else {
        showToast('请至少输入内容或上传文件');
    }
}
```

### 4.2 uploadDocumentFileAPI 支持额外文本

```javascript
async function uploadDocumentFileAPI(file, notebookId, additionalContent) {
    const formData = new FormData();
    formData.append('file', file);
    if (additionalContent) {
        formData.append('additionalContent', additionalContent);
    }
    // ... fetch 请求 ...
}
```

---

## 步骤 5/5: 配置 — 文件上传大小限制

### 5.1 Spring Boot 默认限制

Spring Boot 默认 multipart 上传限制 **1MB**（单文件）/ **10MB**（整个请求）。用户上传 PDF 经常超过这个限制，报错 "Maximum upload size exceeded" 或前端 "Failed to fetch"。

### 5.2 修改 application.properties

```properties
# ===== Day 27：文件上传大小限制 =====
spring.servlet.multipart.max-file-size=50MB
spring.servlet.multipart.max-request-size=50MB
```

---

## 改动文件总览

| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `DocumentExtractService.java` | 修改 | 新增 `cleanText()`、`removeWatermarkLines()`、`removeRepeatedLines()`、PDF/DOCX 异常兜底、`setSortByPosition(true)` |
| `DocumentController.java` | 修改 | upload 端点加 `additionalContent` 参数 + `mergeContent()`，catch 扩大到 Exception |
| `index.html` | 修改 | 选项卡改复选框，两区域可同时显示 |
| `style.css` | 修改 | 复选框样式替换选项卡样式 |
| `app.js` | 修改 | `createDocument()` 三种模式，`uploadDocumentFileAPI` 支持额外文本 |
| `application.properties` | 修改 | 加 `max-file-size=50MB` 和 `max-request-size=50MB` |

---

## 后续可选优化：PDF 解析升级路线

当前 PDFBox 属于纯文本提取路线，对于学术论文封面、双栏、公式等复杂排版有天然局限。以下是调研后的三种升级路线。

### 三种 PDF 解析路线

**路线一：纯文本提取（当前方案 PDFBox）**
按坐标扫描字符拼文本。速度快、零依赖，但遇到水印/双栏/封面装饰字体容易乱。当前的 cleanText 后处理已经尽量弥补，但天花板有限。

**路线二：版面感知提取**
先用视觉模型或规则分析页面结构（标题、正文、表格、公式分区），再按逻辑顺序提取。代表工具：

| 工具 | 特点 | 适合场景 | 局限 |
|:---|:---|:---|:---|
| **MinerU**（OpenDataLab） | VLM + 专用模型多阶段流水线，中文学术论文效果最好，双栏还原率高，公式输出 LaTeX | 中文科研论文 | 重，需要 GPU，纯 CPU 慢 |
| **Docling**（IBM） | 模块化流水线，轻量端到端 VLM，MIT 协议 | 企业级/隐私合规 | 中文能力和复杂公式精度一般 |
| **Marker** | PyMuPDF + 启发式规则直出 Markdown，极快极轻 | 英文文档快速原型 | 中文支持弱，版面还原有限 |

**路线三：视觉理解（多模态 LLM "看图"）**
把 PDF 每页渲染成图片，用 GPT-4V / Claude Vision 等多模态模型"读"图。精度最高但贵且慢。ChatGPT 和 Claude 上传 PDF 本质上走这条路。Google NotebookLM 大概率是路线二 + 路线三组合。

### 务实的升级路径

在 Spring Boot 里直接集成 MinerU/Docling 太重（都是 Python + GPU）。建议：

1. **轻量方案**：在现有 cleanText 里再加一层封面噪声过滤（含大量 □ 的行、超短无意义行），正文部分已经够用
2. **微服务方案**：用 Python 写独立的文档解析服务（MinerU 或 Marker），Spring Boot 通过 HTTP 调用，替代 PDFBox
3. **云端方案**：接入 LlamaParse 等云端解析 API，按量付费，零本地部署

### 现代 RAG 完整范式（备忘）

```
类型识别 → 多模态解析 → 结构还原（章节嵌套、图表编号绑定页码）
    → 语义切片（按语义单元而非固定字数）
    → 双索引（向量 + 关键词）
    → Agent 检索 → 溯源评测
```

当前 Day 27 完成了"多模态解析"中最基础的一步（PDF/DOCX/TXT → 纯文本 + 基础清洗），后续 RAG 还需要：文本分块、向量化、向量存储、检索+生成。

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|:---|:---|:---|
| PDF 上传报 "Maximum upload size exceeded" | Spring Boot 默认 multipart 限制 1MB | `application.properties` 加 `max-file-size=50MB` |
| PDF 上传报 "Failed to fetch" | PDFBox 抛非 IO 异常，controller catch 只接 IOException | catch 扩大到 Exception + 服务层加 try-catch 兜底 |
| PDF 提取文本含 "S e c r e t..." 水印 | PDFBox 逐字提取水印层，字符间插入空格 | cleanText 加 `removeWatermarkLines()` 过滤空格占比 > 40% 的行 |
| 每页重复的页眉页脚出现在正文中 | PDFBox 不区分正文和页眉 | cleanText 加 `removeRepeatedLines()` 去除出现 3 次以上的行 |
| 封面出现 □ 替换字符 | 装饰字体编码无法映射 Unicode | PDFBox 天花板，正文不受影响，后续可用版面感知工具升级 |
| 扫描版 PDF 提取为空 | PDFBox 只能提取文字型 PDF | 加空文本检测，返回提示文本 |
