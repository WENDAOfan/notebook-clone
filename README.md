# Notebook Clone

> 一个受 NotebookLM 启发的智能笔记本：上传文档，与你的资料对话。基于 Spring Boot + Spring AI + DeepSeek 构建，支持 RAG 检索增强、流式问答与引用溯源。
>
> A NotebookLM-inspired smart notebook: upload documents and chat with your own knowledge base. Built with Spring Boot + Spring AI + DeepSeek, featuring RAG, streaming Q&A, and citation tracing.

[中文](#中文) · [English](#english)

---

## 中文

### ✨ 功能特性

- 🔐 JWT 用户认证与数据隔离（每个用户只看自己的笔记本）
- 📚 笔记本 / 文档 CRUD，支持文本新建与文件上传（`.txt` / `.md` / `.docx` / `.pdf`）
- 🧹 文档文本清洗：去控制字符、水印行（空格占比 >40%）、重复行（≥3 次）
- ✨ 异步 AI 摘要生成（`@Async` + `@Retryable` 重试 + `@Recover` 兜底）
- 💬 单文档 / 笔记本级 AI 问答（RAG 检索增强）
- 🌊 SSE 流式"打字机"输出
- 🔖 引用溯源：回答标注来源段落 `[N]`
- 🧠 向量检索：Token 分块（512 + 重叠 50）+ 智谱 Embedding + SimpleVectorStore 文件持久化
- 🔁 多轮对话：上下文压缩（300K token 预算，保留最近 200 轮完整消息）
- 📊 Token 用量统计与展示
- 🖥 原生前端：三栏可拖拽布局 + Hash 路由 + Markdown 渲染

### 🛠 技术栈

| 层 | 选型 |
| :--- | :--- |
| 后端 | Spring Boot 3.4.2 · Java 21 · Spring AI 1.0.0 |
| 持久化 | PostgreSQL · Spring Data JPA · Hibernate |
| 安全 | Spring Security · JWT (jjwt 0.12.3) · BCrypt |
| AI | DeepSeek（Chat）· 智谱 AI（Embedding）· Spring AI |
| 文档解析 | Apache PDFBox 3.0.1 · Apache POI 5.2.5 |
| 健壮性 | Spring Retry · `@Async` 线程池 |
| 前端 | 原生 HTML/CSS/JS · marked.js 12 |

### 🚀 快速开始

**前置条件**：JDK 21+、Maven 3.9+、PostgreSQL 14+、DeepSeek API Key、智谱 AI API Key。

```bash
# 1. 克隆
git clone <your-repo-url>
cd notebook-clone

# 2. 建库
psql -U postgres -c "CREATE DATABASE notebook_clone;"

# 3. 复制配置模板并填入你的密钥与密码
cp src/main/resources/application.properties.example src/main/resources/application.properties

# 4. 运行
./mvnw spring-boot:run
# Windows: mvnw.cmd spring-boot:run

# 5. 访问
# 浏览器打开 http://localhost:8080
```

数据库表由 Hibernate `ddl-auto=update` 自动创建，无需手写 SQL。

### ⚙️ 配置说明

关键配置项见 `application.properties.example`：

| 配置项 | 说明 | 环境变量（可选） |
| :--- | :--- | :--- |
| `spring.datasource.password` | PostgreSQL 密码 | `DB_PASSWORD` |
| `jwt.secret` | JWT 签名密钥（≥256 bit，务必修改） | `JWT_SECRET` |
| `spring.ai.openai.api-key` | DeepSeek API Key | `DEEPSEEK_API_KEY` |
| `spring.ai.zhipuai.api-key` | 智谱 AI API Key | `ZHIPU_API_KEY` |

> ⚠️ **安全提醒**：真实 `application.properties` 已被 `.gitignore` 忽略，切勿提交真实密钥。密钥也可通过环境变量注入，避免写入文件。

### 📂 项目结构

```
src/main/java/com/example/notebook_clone/
├── NotebookCloneApplication.java        启动类（@EnableAsync/@EnableRetry/@EnableScheduling）
├── common/        Result<T>, GlobalExceptionHandler
├── config/        AsyncConfig, SecurityConfig, VectorStoreConfig
├── controller/    Auth, Notebook, Document, TestAi, ChunkTest, Test, User, Hello
├── dto/           AskRequest, ChatRequest
├── entity/        User, Notebook, Document, ChatMessage
├── filter/        JwtAuthenticationFilter
├── repository/    4 个 JpaRepository
├── service/       AiChat, AiSummary, AsyncSummary, AuthService, ChatHistory,
│                  ContextCompression, DocumentChunk, DocumentExtract
└── util/          JwtUtil
src/main/resources/
├── application.properties.example       配置模板
└── static/                              原生前端
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

### 📖 API 文档

<details>
<summary>点击展开完整 API（33 个端点）</summary>

**统一响应**：`{ "code": int, "message": String, "data": T }`，成功 `code=200`。
**认证**：除 `/api/auth/**` 和 `/test/**` 外，所有接口需在请求头携带 `Authorization: Bearer <token>`。

**认证 Auth**

| 方法 | 路径 | 功能 |
| :--- | :--- | :--- |
| POST | `/api/auth/register` | 注册（BCrypt 加密） |
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/auth/me` | 获取当前登录用户 |

**笔记本 Notebook**

| 方法 | 路径 | 功能 |
| :--- | :--- | :--- |
| GET | `/api/notebooks` | 列出当前用户的笔记本 |
| POST | `/api/notebooks` | 创建笔记本 |
| PUT | `/api/notebooks/{id}` | 改名 / 改描述 |
| DELETE | `/api/notebooks/{id}` | 删除（级联清历史与文档） |
| POST | `/api/notebooks/{id}/ask` | 笔记本级问答（同步） |
| GET | `/api/notebooks/{id}/ask/stream` | 笔记本级流式问答（SSE） |
| GET | `/api/notebooks/{id}/chat/history` | 查询对话历史 |
| DELETE | `/api/notebooks/{id}/chat/history` | 清空对话历史 |

**文档 Document**

| 方法 | 路径 | 功能 |
| :--- | :--- | :--- |
| POST | `/api/documents?notebookId=` | 新建文本文档 |
| GET | `/api/documents/notebook/{notebookId}` | 列出笔记本下的文档 |
| POST | `/api/documents/upload` | multipart 上传（`notebookId`、`file`、`additionalContent`） |
| GET | `/api/documents/{id}` | 文档详情（含 summary） |
| DELETE | `/api/documents/{id}` | 删除（清向量分块与历史） |
| POST | `/api/documents/{id}/summary` | 生成 / 重生成 AI 摘要 |
| POST | `/api/documents/{id}/ask` | 单文档问答（同步） |
| GET | `/api/documents/{id}/ask/stream` | 单文档流式问答（SSE） |
| GET | `/api/documents/{id}/chat/history` | 查询对话历史 |
| DELETE | `/api/documents/{id}/chat/history` | 清空对话历史 |

**测试 Test**（`/test/**` 无需认证，正式上线可移除）

| 方法 | 路径 | 功能 |
| :--- | :--- | :--- |
| GET | `/test/ai` | 固定问题测 AI |
| POST | `/test/ai` | 自定义 question + system prompt |
| GET | `/test/ai/stream` | 流式测试 |
| GET | `/test/chunk/{documentId}` | 手动触发分块向量化 |
| GET | `/test/chunk/search?query=&topK=3` | 向量相似度搜索 |

</details>

### 🗺 开发路线

基于 32 天学习计划（按"工时"而非"自然日"计算，每个 Day ≈ 1 小时专注）。

- ✅ **第一阶段 数据基石**（Day 1-10）：数据模型、CRUD、文件上传、Lombok、统一返回 `Result<T>`、全局异常
- ✅ **第二阶段 安全与多用户**（Day 11-17）：User 实体、Spring Security、JWT、数据隔离
- ✅ **第三阶段 AI 灵魂**（Day 18-26）：DeepSeek 接入、文档摘要、智能问答、SSE 流式、引用溯源、`@Async` 异步、重试机制
- ✅ **第四阶段 RAG 与上下文**（Day 27-30）：PDF/DOCX 解析、文本清洗、分块向量化、RAG 检索、多轮对话与上下文压缩
- 📝 **Day 31**：README 与 API 文档（当前）
- ⏳ **Day 32**：整体测试与 Bug 修复，打 v1.0.0 Tag

### 📄 协议

MIT，详见 [LICENSE](./LICENSE)。

---

## English

### ✨ Features

- JWT auth & per-user data isolation
- Notebook/document CRUD with file upload (`.txt` / `.md` / `.docx` / `.pdf`)
- Text cleaning (control chars, watermark lines >40% spaces, duplicate lines ≥3)
- Async AI summary (`@Async` + `@Retryable` + `@Recover` fallback)
- Single-doc & notebook-level Q&A with RAG
- SSE streaming "typewriter" output
- Citation tracing (`[N]` source markers)
- Vector retrieval: token chunking (512 + overlap 50) + Zhipu embedding + SimpleVectorStore file persistence
- Multi-turn dialog with context compression (300K token budget, keep latest 200 messages)
- Token usage stats
- Vanilla front-end: draggable 3-column layout, hash routing, markdown rendering

### 🛠 Tech Stack

Spring Boot 3.4.2 · Java 21 · Spring AI 1.0.0 · PostgreSQL · Spring Data JPA · Spring Security / JWT (jjwt 0.12.3) · DeepSeek (chat) · Zhipu AI (embedding) · Apache PDFBox 3.0.1 · Apache POI 5.2.5 · Spring Retry · vanilla HTML/CSS/JS + marked.js 12.

### 🚀 Quick Start

Prerequisites: JDK 21+, Maven 3.9+, PostgreSQL 14+, DeepSeek & Zhipu API keys.

```bash
git clone <your-repo-url>
cd notebook-clone
psql -U postgres -c "CREATE DATABASE notebook_clone;"
cp src/main/resources/application.properties.example src/main/resources/application.properties
# edit the file to fill in your keys (or use env vars)
./mvnw spring-boot:run      # Windows: mvnw.cmd
# open http://localhost:8080
```

Tables are auto-created by Hibernate `ddl-auto=update`.

### ⚙️ Configuration

See `application.properties.example`. Keys can be injected via environment variables to avoid writing them to disk: `DEEPSEEK_API_KEY`, `ZHIPU_API_KEY`, `DB_PASSWORD`, `JWT_SECRET`. The real `application.properties` is git-ignored — never commit secrets.

### 📂 Project Structure

Java 21 + Spring Boot under `src/main/java/com/example/notebook_clone` (packages: `common`, `config`, `controller`, `dto`, `entity`, `filter`, `repository`, `service`, `util`). Front-end in `src/main/resources/static` (`index.html`, `css/style.css`, `js/app.js`).

### 📖 API Reference

33 endpoints across Auth / Notebook / Document / Test groups. Unified response `{code, message, data}` (success `code=200`). All endpoints require `Authorization: Bearer <token>` except `/api/auth/**` and `/test/**`. See the Chinese section above for the full table, or explore `src/main/java/.../controller`.

### 🗺 Roadmap

A 32-day learning plan (each "Day" ≈ 1 focused hour, not a calendar day).

- ✅ Phase 1 — Data foundation (Day 1-10): models, CRUD, upload, Lombok, `Result<T>`, global exception handler
- ✅ Phase 2 — Auth & multi-tenancy (Day 11-17): User, Spring Security, JWT, data isolation
- ✅ Phase 3 — AI soul (Day 18-26): DeepSeek, summary, Q&A, SSE, citations, `@Async`, retry
- ✅ Phase 4 — RAG & context (Day 27-30): PDF/DOCX parsing, chunking + embedding, RAG retrieval, multi-turn dialog
- 📝 Day 31 — README & API docs (this)
- ⏳ Day 32 — Testing & v1.0.0 tag

### 📄 License

MIT — see [LICENSE](./LICENSE).
