# RGB 中文共享资料库评测协议

本轮只测 Electron，不调用 Java，也不宣称获得 RGB 官方分数。上游来源、非商业许可、文件版本及上一轮 20 题的审查见 [rgb-mini-eval.md](rgb-mini-eval.md)。固定使用同一个 `zh_refine.json`（SHA-256 `6691483d440c931ed7d00120d419361fafe61bf35fc29e89adc37e999a56504d`），不依据本轮模型输出换题。

## 固定材料与题目

有答案题 20 道：保留上一轮口径有效的 19 道，用证据明确写有运营终止日期的 ID 232 替换口径不一致的 ID 58。ID 205 只保留在有答案组，因为其负例含“艾纳斯”这个别称，不适合作无答案题。无答案题另固定 10 道，与有答案题 ID 不重叠，正例均不导入；先做字面答案泄漏检测，再人工复核别称、时间推断和跨文档泄漏。两个清单在 `eval/rgb-shared-lib.js` 中冻结。

所有资料进入**一个**临时笔记本：每道有答案题导入 1 篇正例和 3 篇全局去重的负例，另给每道无答案题导入 1 篇相关负例，共 90 篇互不重复的文档。标题统一为“资料 N”，不泄漏正负标签。导入只调用生产 `indexDocumentAsync`；问答只调用生产 `handleAskStream`。资料内容、数据库和向量库不进入 Git，测试结束清理临时库；上游数据缓存留在工作区的忽略目录供复现。

## 隔离和计分

同一笔记本的生产对话默认共用历史，因此每道题前调用现有 `clearChatHistory` 并检查历史为 0；这是测试会话隔离，不改变检索或问答逻辑。每题先以原始问题调用生产 `retrievalService.retrieve`，记录正例在**实际进入上下文的片段**中的名次、Recall@1、Recall@5 和 MRR；随后让 Agent 正常决定检索词，单独记录它最终引用的片段。这样能分清“原问题检索失败”和“Agent 决策/作答失败”。

自动检查答案字符串、拒答提示、引用编号、错误和耗时；人工逐题检查事实与来源支持。正例 ID 只用来评分，不传给模型。无答案题先核查全库是否包含同义答案或足够推断的线索；发现泄漏须标记题目无效，不能算模型拒答失败，也不能事后换题补分。

本轮虽比上轮更难，但仍主要是短文本单事实问题；长文、多段综合、冲突资料另做下一阶段，不能由这轮结果代替。

## 可复现命令

在 `notebook-electron` 目录中运行：

```powershell
node eval/rgb-shared.js --prepare --rgb-root ..\.local-data\rgb-official
node eval/rgb-shared.js --online --rgb-root ..\.local-data\rgb-official
node eval/rgb-shared.js --online --rgb-root ..\.local-data\rgb-official --label policy-v3-id86 --case-id 86
node eval/rgb-shared.js --rescore --rgb-root ..\.local-data\rgb-official
```

默认仅离线准备；只有显式 `--online` 才向已配置的智谱 Embedding 和 DeepSeek 发送 RGB 公开资料并消耗额度。报告写入被 Git 忽略的 `eval/rgb-shared-report.json`，包括逐题答案、来源、诊断和本地问答 token 估算；该估算不包括索引摘要和 Embedding，也不是实际账单。
复测用 `--label` 写入独立的 `rgb-shared-<label>-report.json`，如只想在完整 90 份语料下重测一题，可另传 `--case-id`；已存在的报告不会被覆盖。复测的 `codeHash` 包含作答规则，单题报告不可冒充 30 题总体结果。
`--rescore` 只读取原始报告与固定题目，使用当前判分规则生成单独的 `eval/rgb-shared-rescored-report.json`；它不重跑模型，且在新文件中记录原始报告与判分代码的哈希。逐题人工核对另记于本地忽略的 `eval/rgb-shared-review.md`，原始在线报告保持不变。
