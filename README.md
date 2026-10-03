# Notebook Clone

一个受 NotebookLM 启发的多端知识库项目：导入资料，以文档证据进行问答，并查看引用来源。仓库包含 Spring Boot Web 版与 Electron 桌面版；两端有各自的数据存储和启动入口，并非自动同步的同一数据库。

## 从哪里开始

| 模块 | 用途 | 入口 |
| --- | --- | --- |
| Electron 桌面端 | 本地笔记本、文档导入、混合检索、流式问答、人工审批整理 | [桌面端 README](notebook-electron/README.md) |
| Spring Boot Web 端 | JWT 多用户认证、资源隔离、文档与聊天管理、RAG 问答 | [Web 端 README](notebook-clone/README.md) |
| 桌面 RAG 评测 | 生产链路对照、固定题集、证据召回与回答核对 | [评测说明](notebook-electron/eval/README.md) |
| Python RAG-Eval-Lab | 独立评测工具与离线测试 | [Python README](notebook-clone/rag-eval-lab/README.md) |

## Web 端向量存储

Java 版通过 Spring AI `PgVectorStore` 把文档分块正文、元数据和2048维向量保存到 PostgreSQL 的 `vector_store` 表，与业务表共用数据源；按文档元数据限制检索范围。当前使用精确余弦检索，未启用 HNSW/IVFFlat，也不以此次接入宣称性能提升。

启动前需安装与数据库版本匹配的 pgvector 并启用 `vector`、`hstore` 扩展。旧 `SimpleVectorStore` JSON 可通过显式迁移参数导入，复用已有向量、不重新调用 Embedding、不覆盖现有记录；正常启动不会自动导入旧文件。见 [pgvector 安装、迁移及验证说明](notebook-clone/docs/pgvector.md)。

本机2026-10-01曾通过3项真实数据库测试和1项真实Embedding测试；这不是每次CI都会重跑的在线验证。相关测试须显式开启，默认离线测试不需要个人配置或外部数据库。Electron仍使用本地JSON向量存储，不因Java接入pgvector而改变。

## 桌面端当前能力

- 支持 TXT、Markdown、PDF、DOCX 导入，保存笔记本、文档与聊天历史。
- 向量检索与 BM25 经 RRF 融合，再进行完整主体／型号软排序、重叠片段降序和有界句子补全。
- DeepSeek 配置就绪时默认启用受限语义重排：最多16个候选，每题最多一次尝试；失败或8秒超时回退基础排序。
- 问答 Agent 按需调用检索工具，支持多轮检索、流式输出、停止生成、引用编号校验及检索诊断。
- 只使用就绪且内容哈希、Embedding 模型一致的索引。未就绪资料有提示；无证据不截取全文冒充检索结果。
- 整理 Agent 只读原资料，写入新整理稿前逐次请求人工审批。联网研究支持来源预览与选择后导入。

桌面端使用 Electron、SQLite、本地 JSON 向量文件、DeepSeek 和智谱 Embedding。数据在本地管理，但对话、Embedding 及可选云端解析会将相应文本或文件发送至配置的服务；不是完全离线模型。

### 检索改进实测（2026-10-03）

下表是固定虚构资料上的生产检索结果。MRR 为**证据级**倒数排名，多证据题逐项计数，不等于标准按题首个正确结果 MRR。

| 测试范围 | 必要证据 Recall@5 | 证据 MRR |
| --- | --- | --- |
| 80篇近名资料，旧策略 → 当前策略 | 14/18 → 18/18 | 0.762 → 0.852 |
| 新冻结资料：12篇、132块、14题 | 15/15 | 0.900 |

新增确认集有12道有答案题和2道无答案题；助手对照引用核对主要事实12/12、拒答2/2。不是独立人工盲审，也不是 RGB 官方分数，不能据此保证所有资料100%召回或回答无幻觉。旧长文指标上限问题、历史失败和回答侧局限见 [完整交付报告](notebook-electron/docs/retrieval-delivery.md)。

重排使用现有 DeepSeek，会增加调用费用和等待时间；设置 `retrieval.rerank=false` 可关闭。最终三组对照中，完整问答 P95 增幅约24.5%–29.7%，只代表本轮小样本与网络条件。

## 快速开始

本轮改进发布在 `reconcile-latest` 分支，尚未合入 `main`。按本文体验该版本时克隆此分支：

```powershell
git clone --branch reconcile-latest https://github.com/WENDAOfan/notebook-clone.git
cd notebook-clone
```

### Electron 桌面端

需要 Node.js 与 npm；CI 使用 Node.js 20 执行离线测试。

```powershell
cd notebook-electron
npm ci
npm start
```

首次启动后，在“系统状态 → AI 配置”查看配置路径，填写 DeepSeek 与智谱密钥，再重启应用。配置、数据位置、可选解析服务及打包命令见 [桌面端说明](notebook-electron/README.md)。

### Spring Boot Web 端

在**克隆后的仓库根目录**进入其 Java 子目录（目录名同样叫 `notebook-clone`），按 [Web 端说明](notebook-clone/README.md) 配置数据库与模型：

```powershell
cd notebook-clone
# 完成该目录 README 中的数据库与配置步骤后运行
.\mvnw.cmd spring-boot:run
```

两段启动命令是二选一的入口，不要在 Electron 目录内直接接着执行 Java 命令。本次桌面检索指标不代表 Web 端评测结果。

## 测试与持续集成

桌面离线测试：

```powershell
cd notebook-electron
npm test
```

2026-10-03 修正PDF测试的本地文件依赖后，在不含生成样本和个人配置的干净源码副本中完整回归：160通过、0失败、3个在线测试默认跳过。默认离线测试不调用真实模型，不访问个人知识库。

[GitHub Actions](.github/workflows/ci.yml) 在 push 与 pull request 时分别执行 Java、Electron 和 Python 离线测试。CI 通过说明这些自动化检查通过，不能替代真实模型的回答质量验收。在线检索／问答评测需显式命令，会消耗模型额度，见 [评测入口](notebook-electron/eval/README.md)。

## 数据与仓库边界

源码开发模式及可识别工作区内的桌面构建，把配置、SQLite、向量文件与会话缓存放在仓库根目录 `.local-data/notebook-electron/`。工作区外安装版可设置绝对路径 `NOTEBOOK_DATA_DIR`，否则使用 Electron 默认用户目录。Windows 临时文件不受此约定完全控制。

真实密钥、个人数据库、向量文件、生成的 PDF/DOCX 样本、在线明细报告与构建产物不提交 Git。固定题目、生成脚本和测试代码保留；个人数据需单独备份。

## English overview

Notebook Clone contains two separate applications: a Spring Boot web app and an Electron desktop app. Start with the [desktop guide](notebook-electron/README.md) or the [web guide](notebook-clone/README.md). The Java app uses PostgreSQL/pgvector for 2048-dimensional exact cosine retrieval; the desktop app retains its local JSON vector store. See [pgvector setup and migration](notebook-clone/docs/pgvector.md).

The desktop pipeline combines vector search, BM25 and RRF with entity-aware soft ranking, bounded sentence-context restoration and optional model reranking. Configured desktop sessions enable reranking by default, with at most one attempt per question and an eight-second fallback timeout. Local storage does not mean local-only model processing.

Evaluation results above are from controlled synthetic corpora, not official RGB scores or a general accuracy guarantee. See the [evaluation guide](notebook-electron/eval/README.md) and [delivery report](notebook-electron/docs/retrieval-delivery.md) for definitions, reproduction commands and limitations.

## License

MIT，见 [LICENSE](LICENSE)。
