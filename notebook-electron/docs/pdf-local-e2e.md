# 本地 PDF 生产链路专项验收（2026-09-29）

只测试 Electron。本轮使用三份本地生成的虚构 PDF：混合文本层与扫描页、四页中文文本层资料、单页中文扫描件；它们都由测试脚本解析后，经生产 `indexDocumentAsync`、`retrievalService.retrieve` 和 `handleAskStream` 处理。评测强制关闭 LlamaParse；Embedding 与对话使用现有智谱和 DeepSeek 配置。内存 SQLite 与 D 盘临时向量库在结束后清理，个人知识库未参与。原始逐题报告为本地忽略的 `eval/pdf-local-all-pagewise-v1-report.json`，题目定义和样本哈希在报告中冻结。

复现前先生成虚构样本：`python eval/build-corpus.py`、`python eval/build-scan-zh.py`、`python eval/build-mixed-pdf.py`。在 `notebook-electron` 目录先运行 `node eval/production-cases.js --suite pdf-local --split all --prepare` 检查固定题目和样本哈希；仅显式执行 `node eval/production-cases.js --suite pdf-local --split all --online --label <新标签>` 才调用两家现有模型。已有报告名不覆盖。

首次运行三份资料均为 `ready`，共 20 个生产分块。五道有答案题标注六处证据：原问题直接检索的证据级 Recall@5 为 6/6、MRR 为 0.917；Agent 最终提供的证据 Recall@5 为 6/6、MRR 为 0.875。六次问答均正常结束，未知引用编号 0、越出临时笔记本的来源 0、P95 总耗时 2.54 秒；模型 token 仅为本地估算，不等于账单。数据集很小且完全虚构，这些数值只说明此固定 PDF 专项，不是 RGB 分数或通用 RAG 性能。

人工按题目、实际回答和所引片段核对：X4、X8、中文扫描件、跨 PDF 对比四道题的数字及引用支持均正确；无答案的 X9 核心部件保修期题明确拒绝推断，1/1 通过。英文扫描题正确提取并引用了 `warranty 12 months`，但回答又说无法确认它来自第二页。原因是当前生产证据只保留文档和分块身份，没有把 PDF 页码传给模型。按题目包含的页码条件严格评分，该题为**部分通过**，因此有答案题完全通过 4/5，不能写成 5/5。原始报告的 `manualReview: NOT_DONE` 保持不变；本节是独立人工复核记录，不回填或覆盖原始在线结果。

下一步应针对页码溯源设计新样本与新留出题，再决定是否把页信息贯穿解析、分块、索引和引用。不能对这六道已见过的题反复调参后继续称其为未见验收题。此前已入库的旧 PDF 不会因本地解析器改动自动重建，重索引须单独处理。
