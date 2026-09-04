# NotebookLM Clone - Electron & SQLite3 Desktop Application

这是一个基于 Electron、SQLite3 和 Vector Store 本地向量检索（RAG）实现的本地知识库与 AI 笔记本桌面应用。

## 快速开始

### 1. 安装依赖

在 `notebook-electron` 目录下执行以下命令安装所需依赖：

```bash
npm install
```

### 2. 配置 AI API 密钥

本应用集成了 **DeepSeek**（用于对话生成与摘要）以及 **智谱 AI**（用于文本向量化 Embedding）。由于安全原因，真实的 API 密钥不会提交到 Git 仓库。

开发环境请按照以下步骤配置密钥：

1. 在 `notebook-electron` 目录下，复制模板配置文件 `config.example.json` 并重命名为 `config.json`：
   ```bash
   cp config.example.json config.json
   ```
2. 打开 `config.json`，将其中的占位符替换为你真实的 API 密钥：
   * `deepseek.apiKey`: 填入你的 DeepSeek API Key。
   * `zhipu.apiKey`: 填入你的智谱 AI API Key（用于 `embedding-3` 模型）。

> **注意：** `config.json` 已被加入 `.gitignore`，并被打包规则明确排除。安装版首次启动会在 Electron `userData` 目录生成配置模板；“系统状态 → AI 配置”会显示需要编辑的完整路径。缺少密钥时应用仍可启动，但对应 AI 功能会禁用。

### 3. 启动应用

在开发环境下，运行以下命令启动 Electron 应用：

```bash
npm start
```

### 4. 运行自动化测试

默认测试不会启动 Electron 窗口，不会连接真实 AI API，也不会修改用户数据库或向量文件：

```bash
npm test
```

测试使用内存 SQLite 和系统临时目录，覆盖中文 BM25、RRF、结构化引用、笔记本隔离、
分块边界、原子向量替换、研究来源去重、SSRF 防护、研究事务和 Agent 工具权限。真实 DeepSeek Agent
冒烟测试必须显式启用：

```bash
$env:RUN_ONLINE_AGENT_TESTS=1; npm test
```

公开接口的联网冒烟测试默认不运行；如后续添加真实接口测试，应通过
`RUN_ONLINE_RESEARCH_TESTS=1` 显式启用，并使用临时数据库与向量目录。

### 5. 打包应用

如果需要打包应用，可以运行以下命令：

* 生成免安装绿色版或安装包：
  ```bash
  npm run dist
  ```
* 仅构建目录：
  ```bash
  npm run pack
  ```

---

## 技术架构

- **外壳**: Electron 43 / Node 24（renderer sandbox、CSP、preload 白名单）
- **前端**: 原生 HTML5 / CSS3 / JavaScript (流式输出渲染、状态管理)
- **数据库**: SQLite3 (使用 `sqlite3` 库管理笔记本、文档元数据、历史聊天记录)
- **向量检索**: 本地 JSON Vector Store（原子持久化）+ 向量/BM25/RRF 混合检索
- **AI 引擎**: OpenAI SDK 调用 DeepSeek & Zhipu AI 接口
- **整理 Agent**: OpenAI Agents SDK + DeepSeek Tool Calls；只读原文，新增整理稿前逐次审批
- **联网研究**: Wikipedia、Crossref、arXiv 与手动 URL/Jina Reader；先预览勾选，再用一个事务创建研究笔记本、来源文档和带引用导读

## 联网研究

点击左侧“🌐 联网研究”，可选择快速或深度模式。快速模式通过 DeepSeek 扩展中英文查询；
深度模式使用受限的研究 Agent 多轮检查覆盖面。搜索阶段不会创建笔记本，用户必须在预览页
明确选择 3–15 个来源并点击创建。研究结果是时间快照，不会自动刷新。

所有网络请求都在 Electron 主进程中执行。手动 URL 仅允许 HTTP(S)，并阻止 localhost、
私有 IP、链路本地地址、超大响应和无限重定向。基础版本不需要新增搜索 API Key，但仍会
使用已有 DeepSeek 配置生成查询和导读，并使用已有智谱配置建立 Embedding 索引。
