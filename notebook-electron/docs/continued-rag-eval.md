# 桌面 RAG 后续专项评测协议

此协议只检查 Electron 桌面版，不调用 Java。所有新资料均为虚构中文资料，生产入口依次为 `indexDocumentAsync`、`retrievalService.retrieve`、`handleAskStream`，问答事件由测试适配器收集；并非另外实现一套简化 RAG。默认仅离线准备，显式 `--online` 才调用已配置的 Embedding 和对话模型。

## 固定题目与隔离

- `temporal-cases.json`：12 份短资料、4 道校准题与 4 道留出题。先跑校准题，再改时间状态规则，留出题只在修改后运行。
- `temporal-v2-cases.json`：8 份资料、4 道新留出题，专门区分“没有后续记录”和“明确取消”。
- `temporal-v3-cases.json`：6 份资料、5 道新留出题，专门区分预告中的附属活动与明确已举行的活动。
- `long-cases.js`：8 份确定性生成的虚构长文，按生产 512-token 分块与 50-token 重叠形成至少 50 块；10 道题分为 5 道校准题和 5 道留出题，包含近似站名、跨文档条件、时态与无答案。
- `narrative-cases.js`：10 份非重复的虚构中文叙述资料，实际形成 12 个生产分块；10 道题分为 5 道校准题和 5 道留出题。它检验自然叙述、相近站名、跨文档推断、计划与实际、拒答；篇幅仍短，不应称为长文压力测试。
- `near-entity-cases.js`：四个仅一字之差的虚构站点，各有验收、保修、工单、演练、预算，共 20 份短资料；12 题在在线运行前固定为 6 道校准题、6 道留出题。它专门检查相近实体、同日不同故障、部分有价格/部分无价格以及申请/已完成，不代表自然文档总体水平。
- `dense-near-cases.js`：16 个一字相近的虚构站点，共 80 份短资料、16 道固定新题，其中 4 道无可确认答案。协议、预先固定的门槛与首次未通过结果见 `docs/dense-near-eval.md`；它仍不代表真实 PDF/DOCX 或通用实体识别水平。

每次运行使用独立临时笔记本和 D 盘临时向量文件，每题清空共享会话历史。报告记录题目集与代码哈希、实际答案、原始问题直接检索和 Agent 证据、诊断、耗时及用量估算。长文以**含关键原文的实际片段**计证据名次，而不是看到来自同一文档的任意片段就算命中。报告保留在本地、被 Git 忽略；临时数据库和向量文件在运行结束后清理。

## 复现命令

在 `notebook-electron` 目录中运行，例如：

```powershell
node eval/production-cases.js --suite temporal-v3 --split holdout --prepare
node eval/production-cases.js --suite temporal-v3 --split holdout --online --label policy-v3
node eval/production-cases.js --suite long --split all --prepare
node eval/production-cases.js --suite long --split all --online --label baseline-v1
node eval/production-cases.js --suite narrative --split all --prepare
node eval/production-cases.js --suite narrative --split all --online --label baseline-v1
node eval/production-cases.js --suite narrative --split all --rgb-background <RGB官方仓库目录> --prepare
node eval/production-cases.js --suite narrative --split all --rgb-background <RGB官方仓库目录> --online --label rgb90-background-v1
node eval/production-cases.js --suite near --split all --prepare
node eval/production-cases.js --suite near --split all --online --label baseline-v1
node eval/replay-retrieval-filters.js --suite near --report eval/near-all-baseline-v1-report.json --label near-baseline-v2
node eval/parser-local-audit.js --label baseline-v1
node eval/pdf-mode-audit.js --label baseline-v1
node eval/pdf-mixed-audit.js --label baseline-v1
node eval/audit-year-claims.js --report eval/rgb-shared-policy-v3-full-report.json
```

在线运行必须给每次实验一个新 `--label`，报告已存在时拒绝覆盖。`audit-year-claims.js` 只提示“回答出现、引用片段没出现”的年份，含否定句、问题复述时可能误报；人工仍须按证据逐题核对事实、时间状态与引用支持，不能拿它代替质量分数。模型估算 token 不等于实际账单。

这些长文由规则化巡检记录组成，虽真实经过多分块和生产检索链路，仍不等同于真实 PDF/DOCX 的解析质量、自然语言长报告、复杂表格或任意用户知识库。结果不应称作 RGB 官方分数或通用 RAG 水平。
`parser-local-audit.js` 独立进程内禁用 LlamaParse，只用生产 `extractText` 的本地路径检查八份虚构 TXT/Markdown/DOCX/PDF 文件的关键原文，以及空文件、损坏 PDF、英文扫描 PDF 边界；它不读 AI 密钥，也不调用模型。报告保留在本地且不覆盖同名文件。此检查不能代表云端 LlamaParse 路径或中文扫描 PDF 的效果。PDF 解析若返回非空但漏掉关键条款，仍判失败，不能用后续问答弥补。
`pdf-mode-audit.js` 用已安装的 LiteParse 对两份虚构中文 PDF 和一份英文扫描 PDF 比较默认 OCR 与 `ocrEnabled: false`；记录 `isComplex` 判定、各页长度和关键原文保留情况。它是诊断，不是生产解析入口或新实现的 RAG；两种模式谁能提取这些固定样本，不能推广成所有 PDF 的最佳方案。
`pdf-mixed-audit.js` 检查两页虚构混合 PDF 的生产本地解析：第一页为可复制中文条款，第二页为图片扫描件。原始本地路径只保留扫描页事实；改为逐页先取文本层、仅对空文本层 OCR 后，两处事实均保留。固定样本和按页策略不足以证明任意 PDF（例如非空但乱码的文本层、复杂表格）都能正确解析；此前已经索引的 PDF 也不会因解析代码变化自动重建。
2026-09-29 本地复测：原生产解析在八份固定资料中保留 6/8 条关键事实，修复后为 8/8；混合 PDF 同一文件哈希下从 1/2 提升至 2/2。新增的中文图片扫描件能提取预期事实，但 OCR 会插入字间空格，因此边界检查只在核对事实时忽略空格。当前本机缺少 `chi_sim_vert.traineddata`，水平排版样本仍可识别；竖排中文与非空乱码文本层未验证。此处只评估解析，不是检索 Recall/MRR 或模型问答分数。报告分别保存在本地忽略的 `parser-local-*-report.json`、`pdf-mixed-*-report.json` 中。
随后用三份 PDF 跑通生产解析、索引、检索与问答的六题专项，结果及严格人工复核见 [pdf-local-e2e.md](pdf-local-e2e.md)。这一轮发现页码未进入模型证据，不能把数字正确误记为页码溯源也通过。
`context-ablation.js` 针对密集近名集一题，用原报告保存的候选回放三种工具证据范围，仍走生产 `handleAskStream` 和同一对话模型，但**不走生产检索/索引**。它要求原始来源顺序与生产代码哈希一致，显式 `--online` 才调用模型；协议和首次两次重复结果见 `docs/context-ablation.md`。这仅能区分该题的证据完整性与回答波动，不能冒充新的端到端 RAG 分数。
`--rgb-background` 仅用于 `narrative`。它读取官方 RGB 固定哈希中文资料，加入先前选定的 90 篇短文作为同一笔记本中的干扰项，再索引 10 份自然叙述资料，合计 100 篇、102 个分块；十题、预期证据和题集哈希与 10 篇基线完全相同。仍用两个既有在线模型，不调用 LlamaParse。报告分开保存，不能把两次单样本运行的微小波动当作调参收益，也不能将来源相同的 RGB 文本称为全新独立留出集。
`replay-retrieval-filters.js` 从已保存的生产候选诊断离线重放当前筛选，并首先要求每道题的片段 ID 顺序与原始来源完全一致；不一致就拒绝计算。对照项包括取消精确型号硬过滤，以及先保留通过阈值的 RRF 前两名、再执行现有型号偏好；两者都复用同一批候选和上下文预算，不重新索引、调用 Embedding 或问答模型。报告分别给出全部标注证据、有答案题证据、无答案题“缺失信息”证据的指标，避免后者抬高有答案题 MRR。“前两名”是在看到近名站点的失败后选择的，仅属探索性方案，必须用未见过的新题验证。因此输出只用于定位“原候选被哪一步丢掉”和估算上下文膨胀，不是新线上运行、独立留出分数或可直接上线的参数配置。
在 `dense-near-v1` 失败后，重放脚本还加入“查询中完整站名与文档标题前缀完全一致”的**诊断上界**，分别保留和取消现有型号硬过滤，以区分实体归属与型号筛选的影响。站名从虚构资料标题取得，不适用于代词、省略名、标题不含实体的资料；这是事后分析，不计作题集验收，更不是通用生产策略。
旧索引不会因切块代码更新而自动改变；要受益于 UTF-8 边界修正，已有文档需重新索引。本协议的每次在线长文评测都会从原文重建独立临时索引，不使用旧向量文件。
