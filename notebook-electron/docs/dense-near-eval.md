# 桌面 RAG：80 篇密集近名资料的预注册测试

题集 `eval/dense-near-cases.js` 在首次在线运行前固定，SHA-256 为
`87a77119f548f81941488290d7bc201cd0b879f1d29c84b6225c2e8f8c593565`。
16 个一字相近的虚构站点各有验收、保修、故障、演练和预算资料，共 80 篇；
按生产切块规则预计为 80 个短分块。16 题中 12 题有答案、4 题无可确认答案；
8 题标为校准、8 题标为留出。全部 22 处预标注证据分为 18 处有答案题证据和
4 处用来支持拒答的原文。本站遮盖的单价没有在该站其他资料中披露，
“没有举行记录”的启动仪式没有在该站其他资料中写成已举行或已取消。

本测试在**同一临时笔记本**走生产 `indexDocumentAsync`、`retrievalService.retrieve`
和 `handleAskStream`；每题清空会话。只向已有智谱 Embedding 与 DeepSeek 配置发送
上述虚构资料，使用独立临时数据库和向量文件，不操作个人知识库。原问题直接
检索的片段级名次与 Agent 最终提供的证据分别报告；人工逐句核对答案、引用和
站点归属。默认 `--prepare` 不调用模型，只有显式 `--online` 才消耗额度。

在看结果之前固定本轮判定：有答案题 18 处证据的直接 Recall@5 至少 16/18，
MRR 至少 0.80；12 道有答案题至少 10 道的关键结论及引用均受原文支持；
4 道无答案题都要正确拒答且不能借别站数值或把缺记录说成未发生；
未知引用编号与跨站事实混用均为零。有效请求不得空答案成功结束，
本地问答 P95 不超过 60 秒。未达门槛就如实标记未通过，不事后改题抬分。

先跑**不修改生产检索**的基线。离线重放基线保存的融合候选时，
只比较两种已在旧题集提出的策略：当前型号硬过滤，以及“保留通过阈值的
RRF 前两名，再对其余候选应用现有型号偏好”。前两名是看过旧题后的提议，
本新题集才是其首次独立检验。它若使 18 处有答案证据的 Recall@5 或 MRR
下降，或每题平均来源增加超过 1 个，就不进入下一步；即使通过这道离线关，
也不能把重放当成新模型回答分数，真正上线前仍需在生产链路上重跑问答。

在 `notebook-electron` 目录运行：

```powershell
node test/production-cases.test.js
node eval/production-cases.js --suite dense-near --split all --prepare
node eval/production-cases.js --suite dense-near --split all --online --label baseline-v1
node eval/replay-retrieval-filters.js --suite dense-near --report eval/dense-near-all-baseline-v1-report.json --label dense-near-baseline-v1
node eval/replay-retrieval-filters.js --suite dense-near --report eval/dense-near-all-baseline-v1-report.json --label dense-entity-audit-v1
```

报告在本地 `eval/` 目录中被 Git 忽略；已有标签不会覆盖。问答耗时为本机单次
观测，token 用量按供应商返回或项目估算如实记录，不等于精确账单。

## 首次运行结果（2026-09-29，题集未修改）

80/80 篇索引就绪、16/16 请求正常结束，但有答案题直接证据 Recall@5
只有 14/18、MRR 为 0.7620；人工判读关键结论及对应引用 9/12 通过，
未达上述门槛。4/4 道无答案题都拒答，但其中一题误称本站没有实际存在的
预算摘录。每题 Agent 平均提供 42.1 个来源片段，存在明显上下文过宽。
已保存的候选做离线重放时，“保留 RRF 前两名”没有改变任何证据名次；
此旧提议在新题集上未获支持，不能据此修改生产默认检索。
逐题证据与失败原因见本地 `eval/dense-near-review.md`；原始报告保持不变。

在看过失败题后的追加诊断，**不属于上述预注册验收**：只用查询中明确出现、
且恰好是文档标题前缀的完整站名缩小候选（这些名称从本虚构资料标题提取，
并非通用实体识别）。保留现有型号硬过滤时，本站遮盖价格仍被排除；
同时取消该硬过滤时，本题集有答案证据离线 Recall@5 为 18/18、MRR 为
0.8519，平均选入来源 6.25 个。对照长文集，同法 MRR 反而从 0.7167
微降至 0.7078；自然叙述集有一题连完整站名都没写。这说明“文档归属”
和“型号过滤”两个因素会相互作用，但不能把这项标题匹配上界当作已验证的
生产方案或新的模型回答成绩。详细对照在本地
`eval/filter-replay-dense-entity-audit-v1-report.json`。

后续单题诊断及新状态留出题见 [status-evidence-ablation.md](status-evidence-ablation.md)
和 [status-v4-eval.md](status-v4-eval.md)。新增作答规则虽然通过三道新短题，
原失败的枫岚东站状态题在 80 篇生产回归里仍先断言“没有完成”，因此尚未修复。
