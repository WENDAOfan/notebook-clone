# NotebookLM Clone - Electron & SQLite3 Desktop Application

这是 `notebook-clone` 的本地桌面版实现，基于 Electron、SQLite3 和 Vector Store 本地向量检索（RAG）构建知识库与 AI 笔记本应用。Java Web 版位于仓库根目录，桌面版代码集中在本目录中，可独立安装、测试和运行。

## 快速开始

### 1. 安装依赖

在仓库的 `desktop-electron` 目录下执行以下命令安装所需依赖：

```bash
npm install
```

### 2. 配置 AI API 密钥

本应用集成了 **DeepSeek**（用于对话生成与摘要）以及 **智谱 AI**（用于文本向量化 Embedding）。由于安全原因，真实的 API 密钥不会提交到 Git 仓库。

请按照以下步骤配置你的密钥：

1. 在 `desktop-electron` 目录下，复制模板配置文件 `config.example.json` 并重命名为 `config.json`：
   ```bash
   cp config.example.json config.json
   ```
2. 打开 `config.json`，将其中的占位符替换为你真实的 API 密钥：
   * `deepseek.apiKey`: 填入你的 DeepSeek API Key。
   * `zhipu.apiKey`: 填入你的智谱 AI API Key（用于 `embedding-3` 模型）。

> **注意：** `config.json` 已被加入 `.gitignore` 规则中，不会被意外提交或开源。

### 3. 启动应用

在开发环境下，运行以下命令启动 Electron 应用：

```bash
npm start
```

### 4. 运行自动化测试

测试不会启动 Electron 窗口，不会连接真实 AI API，也不会修改用户数据库或向量文件：

```bash
npm test
```

测试使用内存 SQLite 和系统临时目录，当前覆盖文本清洗、向量检索/持久化、数据库 CRUD、
外键级联删除、聊天隔离与历史截断。

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

- **外壳**: Electron (支持本地文件解析、原生弹窗及主进程-渲染进程隔离)
- **前端**: 原生 HTML5 / CSS3 / JavaScript (流式输出渲染、状态管理)
- **数据库**: SQLite3 (使用 `sqlite3` 库管理笔记本、文档元数据、历史聊天记录)
- **向量检索**: 本地轻量级内存 Vector Store（持久化到本地 JSON，支持余弦相似度检索）
- **AI 引擎**: OpenAI SDK 调用 DeepSeek & Zhipu AI 接口
