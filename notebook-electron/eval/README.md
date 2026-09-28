# 桌面 RAG 真实验收

RGB 中文外部小样本（只测 Electron）：先从 [RGB 官方仓库](https://github.com/chen700564/RGB) 获取固定提交 `65ec39e40e7dc9abb50e9bf1b4f32be3f6f16615`，将其放在源码仓库之外。用 `node eval/rgb-mini.js --rgb-root <RGB目录> --prepare` 离线核对数据哈希、固定的 3 个原题和 6 个对照场景；此步骤不调用模型。实际运行用 `node eval/rgb-mini.js --rgb-root <RGB目录> --online`，默认优先读取工作区 `.local-data/notebook-electron/config.json`；也可用 `--config <桌面版config.json路径>` 显式指定。仅传配置文件路径，绝不要在命令中传密钥。运行会向现有智谱 Embedding、DeepSeek 服务发送 RGB 公开文本并消耗额度，输出本地忽略的 `eval/rgb-mini-report.json`。缺少配置会标记 `BLOCKED`；报告需人工复核，不能当成官方 RGB 分数。协议、许可与选题规则见 [rgb-mini-eval.md](../docs/rgb-mini-eval.md)。

仓库保留 `cases.json` 和 `manifest.json` 作为固定题目定义。`fixtures/` 中的样本文件由 `build-corpus.py` 生成，未纳入 Git。可先用 `python eval/build-corpus.py --verify-definitions` 核对题目，无需额外 Python 包。首次运行文档解析验收前，在 `notebook-electron` 目录安装 `python-docx`、`reportlab`、`Pillow`，再执行 `python eval/build-corpus.py`。UI 冒烟检查会自行创建损坏 PDF。在线运行产生的报告和本地结果记录也不纳入 Git。

事实边界专项：`node eval/grounding-run.js --online`，使用12个新正反例及独立临时库。旧专项报告运行于SDK解码损坏导致的全零向量条件下，不视为向量检索验收。详见 `GROUNDING-RESULTS.md`。

Embedding编码修复验证：`node eval/embedding-verify.js --online`，用6个不同主题的虚构文档和语义改写问题分别验证纯向量及混合检索，输出 `embedding-verification.json`。`node eval/run.js --online --acceptance --embedding-fixed` 重建隔离索引并重跑20题，输出 `embedding-fixed-acceptance.json`，不覆盖历史报告。结果与逐题复核见 `EMBEDDING-RESULTS.md`；此处20题是已使用题目的回归，不是全新留出验收。

`node eval/run.js --online` 使用项目现有模型配置（不输出密钥），创建临时 SQLite/向量库，解析八份虚构资料，再运行 40 个问题。正常或异常退出均清理临时库；`report.json` 保留原始答案和证据。此命令会使用模型额度。

冻结配置后分别运行 `node eval/run.js --online --calibration` 和 `node eval/run.js --online --acceptance`，各生成独立报告，不覆盖首轮数据。报告包含生产问答与检索代码哈希。

`build-corpus.py` 使用 python-docx、reportlab、Pillow 重新生成固定语料。语料包含近似型号、不同保修政策、长文干扰和表格；这是受控产品政策任务，不代表所有真实文档的表现。

每类问题前四题是 calibration，后四题是 acceptance。运行前固定划分，禁止根据 acceptance 调参数。`expectedEvidence` 保存原文，`evidenceLocation` 保存节位置。

报告中的 `evidenceRanks` 按各次检索选中结果首次出现顺序去重后计算。MRR 按应覆盖证据计数，多证据题不会只奖励找到其中一条。引用编号检查与事实支持检查分开。

人工逐题核对：有答案题必须答对所问数字/对象、无相互矛盾结论、每项关键事实由所引片段支持；无答案题必须明确资料未提供，不得猜测编号。依此填写 manualCorrect、manualEvidenceSupported；未经复核不设 PASS。

目标：acceptance 的 Recall@5 >= .85，MRR >= .80；16 道可回答题至少 14 道事实正确且证据支持；4 道无答案全部正确拒答；无未知引用或范围泄露；P95 <= 60000ms。解析耗时不并入问答耗时。

现有离线人工向量用例仅验证程序，不用于宣称在线效果。扫描件与损坏文件用于解析边界，不属于问答资料库。扫描件可成功 OCR 或明确报错，不能索引错误提示。
