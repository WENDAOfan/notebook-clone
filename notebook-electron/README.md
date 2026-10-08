# Notebook Clone — Electron 桌面端

基于 Electron、SQLite 和本地向量文件的知识库与 AI 笔记本。支持文档导入、带引用的流式问答，以及人工审批后生成整理稿。此目录是独立桌面应用，不依赖先启动 Java 服务，也不与 Web 端自动同步数据。

## 快速开始

### 1. 安装并启动

从仓库根目录执行。需要 Node.js 与 npm；仓库 CI 使用 Node.js 20 运行离线测试，Electron 应用使用其内置运行时。

```powershell
cd notebook-electron
npm ci
npm start
```

### 2. 配置模型

首次启动后，在“系统状态 → AI 配置”查看需要编辑的完整路径；缺少配置时应用会生成模板，仍可启动，但对应 AI 功能不可用。

| 配置 | 用途 |
| --- | --- |
| `deepseek.apiKey` | 对话、摘要、问答检索重排及相关 Agent 功能 |
| `zhipu.apiKey` | 文本 Embedding，模板默认 `embedding-3` |
| `llamaParse.apiKey` | 可选的 PDF/DOCX 云端解析；不配置时使用本地解析 |
| `retrieval.rerank` | `false` 关闭问答重排；DeepSeek 就绪时，缺省或 `true` 启用 |

模板见 [config.example.json](config.example.json)。编辑实际生效的配置文件并重启应用，不要把真实密钥填进版本控制中的模板。

开发模式通常使用仓库根目录 `.local-data/notebook-electron/config.json`。旧的 `notebook-electron/config.json` 只在用户数据配置尚不存在且处于开发模式时作为兼容来源；用户数据目录已有配置时，继续修改旧文件不会生效。以界面显示路径为准。

配置模型意味着相应文本会发送至服务商；启用 LlamaParse 时 PDF/DOCX 文件也会上传该解析服务。SQLite 和向量文件本地保存不等于模型完全离线运行。

## 提供 MCP 检索接口（可选）

设置 `NOTEBOOK_MCP_ENABLED=1` 后，桌面通过本机 MCP 提供笔记本列表、统计和带来源的只读检索，供 EchoMind 等客户端复用当前资料。默认关闭；不会复制或重建索引。启动方法、参数、连接文件和测试边界见 [MCP 接入说明](docs/mcp-integration.md)。

## 文档到回答的流程

1. **解析与索引**：导入 TXT、Markdown、PDF 或 DOCX。PDF/DOCX 在已配置时优先尝试 LlamaParse，失败后尝试本地 LiteParse／Mammoth；解析失败或清洗后为空不作为正文入库。分块后通过智谱生成向量，记录索引状态、内容哈希和模型标识。
2. **按需检索**：问答 Agent 决定是否调用检索工具，并提炼查询词。只对当前文档或笔记本内的有效索引运行向量检索、BM25，再通过 RRF 融合。
3. **基础排序与上下文**：完整主体／型号软排序减少近名干扰；保留最强的合格纯语义候选，降低相邻重叠片段占位；在同一有效原文的唯一精确位置有界补齐被切断的句子，不让模型补写证据。
4. **受限模型重排**：开启时，由现有 DeepSeek 对最多16个候选判断对象、否定、时间和适用条件，只返回0–3分组编号，不改写原文。每题最多一次尝试，8秒超时或非法结果退回基础排序；用户取消则终止。
5. **证据作答与引用**：按预算把片段及来源交给问答模型，流式展示答案。检索诊断记录查询、候选、排序、耗时和降级信息；未知引用编号显示校验失败，不生成虚构来源卡片。

本地 PDF 优先保留文本层，仅对无可用文本的页尝试中文 OCR。扫描件、复杂版式和表格不保证准确，无法提取有效文本时明确失败；能力范围及样本说明见 [PDF 专项记录](docs/pdf-local-e2e.md)。

### 运行边界

- 检索排除未就绪、内容过期或模型不匹配的索引；部分资料可用时提示未覆盖文档。普通聊天不因索引未就绪被直接阻断。
- 空结果不截取正文前段兜底。每次最多选8块，笔记本内每文档最多3块；整题证据累计最多8000 token，包含来源包装并去重。
- 每题最多3个允许工具调用的问答模型轮次，必要时加1次禁用工具的收尾；最多6次检索，另有最多1次重排尝试，总流程180秒超时。
- 空回答不能保存为成功；支持取消。引用编号有效不等于内容必然支持结论，后者仍需对照原文核验。
- 重排会额外消耗 DeepSeek 额度。重排用量单独记录，未知用量不冒充零；回答用量仍有估算，不作为精确账单。
- 上述新检索策略不改变索引格式，有效索引无需因此重建。旧安装包需要重新构建，不能仅更新源码就认为旧程序已升级。

核心实现见 [检索入口](retrieval-service.js)、[基础排序](retrieval-ranking.js)、[句边界补全](retrieval-context.js)、[模型重排](retrieval-reranker.js) 和 [问答流程](rag-service.js)。

## 效果验证

2026-10-03，生产索引和检索入口的同索引、同查询向量对照：

| 固定题集 | 证据 Recall@5 | 证据 MRR |
| --- | --- | --- |
| 80篇近名资料，旧策略 → 当前策略 | 14/18 → 18/18 | 0.762 → 0.852 |
| 新冻结12篇、132块资料 | 15/15 | 0.900 |

MRR 按每项必要证据计算，不是标准按题首个正确结果 MRR。新资料14题中，助手对照实际答案与引用核对12/12有答案题主要事实、2/2拒答；原始报告仍等待独立人工审查。

最终三组完整问答对照的 P95 为3.949、4.268、4.058秒，比无重排约增加24.5%–29.7%。这是小样本实测，不保证网络波动下仍有同样耗时；结果不是 RGB 官方分数，也不代表全领域100%召回。历史失败、旧长文指标上限及回答侧剩余问题见 [完整交付报告](docs/retrieval-delivery.md)。

## 自动化测试与在线评测

默认测试不启动 Electron 窗口、不调用真实 AI API，使用隔离数据库和临时文件：

```powershell
npm test
```

2026-10-03 修正PDF测试的本地文件依赖后，干净源码副本完整离线回归：160通过、0失败、3个在线测试默认跳过。副本不含生成样本或个人配置；覆盖中文分块、BM25/RRF、排序与上下文补全、索引有效性、范围隔离、工具参数和预算、取消超时、引用校验、人工审批及启动配置接线。

在线检索与问答评测必须显式开启，以下命令会发送固定虚构资料并消耗现有模型额度；使用内存SQLite及工作区临时向量库，不重建个人知识库：

```powershell
# 先准备并核对固定题集；不调用模型
node eval/production-cases.js --suite paragraph-confirm --split holdout --prepare

# 使用一个尚不存在的标签，报告拒绝覆盖
node eval/retrieval-compare.js --suite paragraph-confirm --split holdout --online --rerank --label my-run-1
node eval/production-cases.js --suite paragraph-confirm --split holdout --online --rerank --label my-run-1
```

两个在线脚本加 `--rerank` 才复现当前桌面开启重排的策略；不加为无重排对照。题集首次运行结果已保存，后续运行只能称回归。生成样本、原始在线报告不随Git上传，固定题目与生成程序保留，详见 [评测 README](eval/README.md) 和 [源码提交范围](docs/source-publish-scope.md)。

仓库 [CI](../.github/workflows/ci.yml) 自动运行离线测试，不自动执行付费模型评测。部分独立联网测试另需 `RUN_ONLINE_AGENT_TESTS=1` 等显式开关，日常回归无需设置。

## 数据位置与打包

开发版及位于可识别工作区内的构建使用仓库根目录 `.local-data/notebook-electron/`，保存配置、`notebook.db`、`vector-store.json` 和 Electron 会话缓存。工作区外安装版默认使用 Electron 用户目录，也可通过绝对路径 `NOTEBOOK_DATA_DIR` 指定位置。

真实配置和个人数据已忽略，不会随Git备份；请单独备份该目录。系统临时文件或安装器仍可能写入 Windows 用户目录，不承诺C盘零写入。路径规则见 [存储设计](docs/local-storage-migration.md)。

```powershell
npm run pack
npm run dist
```

前者构建应用目录，后者构建Windows安装包／便携包。打包排除真实 `config.json`、测试、评测和文档目录；工作区用户数据位于应用源码目录之外。

## 其他能力与技术栈

- Electron 43；原生 HTML/CSS/JavaScript，renderer sandbox、CSP 与 preload 白名单。
- SQLite3 管理笔记本、文档和聊天；本地 JSON Vector Store 原子持久化。
- OpenAI SDK 调用 DeepSeek 与智谱；整理 Agent 使用 OpenAI Agents SDK，只读原资料，创建整理稿前逐次审批。问答专用重排不自动应用于整理 Agent。
- 联网研究支持 Wikipedia、Crossref、arXiv 和手动 URL/Jina Reader。快速模式扩展查询，深度模式由受限研究 Agent 检查覆盖面；用户预览选择3–15个来源后，才以事务创建笔记本、来源与带引用导读。
- 联网请求在主进程执行，手动 URL 有私有地址、重定向与响应大小限制。研究结果是时间快照，不自动刷新；基础研究功能仍会使用现有模型额度。

规范与设计见 [SPEC_CODING.md](SPEC_CODING.md)；返回 [仓库首页](../README.md)。
