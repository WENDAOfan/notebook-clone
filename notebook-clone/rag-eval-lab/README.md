# RAG-Eval-Lab

RAG-Eval-Lab 是 Notebook Clone 的 Python 自动化评测模块。它把“回答看起来不错”变成可重复的
测试结果：默认用确定性规则做离线回归，显式在线时调用 Spring RAG API，并可用 DeepEval 4.x
执行 Answer Relevancy、Faithfulness、Contextual Precision、Contextual Recall。

## 1. 安全设计

- 默认 `pytest` 不联网、不启动 Spring、不调用模型，不消耗 DeepSeek、智谱或 Judge 额度。
- 在线测试都有 `online` marker，并要求 `RAG_EVAL_ONLINE_ENABLED=true`。
- DeepEval 还有第二个开关 `RAG_EVAL_DEEPEVAL_ENABLED=true`，必须显式提供专用 Judge 模型和 Key。
- 代码不会读取或打印上级项目的 `config.json`、`application.properties` 或真实用户文档。
- 运行报告、虚拟环境、缓存和本地 `.env` 已忽略；仓库只保留脱敏的
  [`sample-report.json`](sample-report.json)。

## 2. 架构与目录

```text
rag-eval-lab/
├── data/
│   ├── corpus/                 3 篇虚构公开测试资料
│   └── golden_cases.jsonl      14 条黄金用例与离线观测
├── src/rag_eval_lab/
│   ├── dataset.py              JSONL 加载和字段校验
│   ├── metrics.py              确定性指标
│   ├── http_client.py          带 JWT 的 Spring API 客户端
│   ├── deepeval_adapter.py     四项 DeepEval 指标与额度保护
│   ├── reporting.py            JSON/CSV/HTML 报告
│   └── cli.py                  离线/在线评测入口
├── tests/                      pytest 离线与 online 测试
├── reports/                    本地运行结果（Git 忽略）
├── .env.example                环境变量模板（不含真实 Key）
└── pyproject.toml              Python 包、依赖和 pytest 配置
```

Spring 侧把原 `AiChatService` 的私有向量检索抽成 `RetrievalService`。`/api/eval/retrieval`
只在 `eval/test` Profile 注册，仍要求 JWT，并在检索前校验文档/笔记本归属。接口只返回排名、
文本、文档 ID 和标题，不返回 embedding、Key 或用户信息。

## 3. Windows PowerShell 安装

需要 Python 3.11+。以下命令均在 PowerShell 中执行：

```powershell
Set-Location D:\JetBrains\notebookproject\notebook-clone\rag-eval-lab
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[test]"
```

只做离线评测不需要安装 DeepEval。需要在线 LLM Judge 时再安装可选依赖：

```powershell
python -m pip install -e ".[test,online]"
```

## 4. 默认离线测试与报告

```powershell
# 运行离线单元/参数化测试；online 测试默认被排除
python -m pytest

# 对 14 条固定观测执行一次评测，生成 JSON、CSV 和 HTML
python -m rag_eval_lab.cli --mode offline

Invoke-Item .\reports\latest.html
```

报告包含总数、通过/失败数、通过率、指标平均值、P50/P95、Token 汇总、失败类型，以及失败
用例的 `case_id`、问题、实际回答和原因。

## 5. 在线 Spring RAG 评测

先把 `data/corpus/` 的 3 篇资料上传到专用测试笔记本，等待异步向量化完成。不要使用私人文档。
然后在另一个 PowerShell 窗口以 `eval` Profile 启动 Spring（Spring 自身所需配置仍通过其正常的
环境变量提供）：

```powershell
Set-Location D:\JetBrains\notebookproject\notebook-clone
$env:SPRING_PROFILES_ACTIVE = "eval"
.\mvnw.cmd spring-boot:run
```

在评测窗口设置临时环境变量。JWT 只存在于当前 PowerShell 进程，不会写进仓库：

```powershell
Set-Location D:\JetBrains\notebookproject\notebook-clone\rag-eval-lab
$env:RAG_EVAL_ONLINE_ENABLED = "true"
$env:RAG_EVAL_BASE_URL = "http://localhost:8080"
$env:RAG_EVAL_JWT = "粘贴专用评测账号的 JWT"
$env:RAG_EVAL_TARGET_TYPE = "notebook"
$env:RAG_EVAL_TARGET_ID = "专用测试笔记本 ID"
$env:RAG_EVAL_TOP_K = "5"

# 只运行在线 pytest；服务/变量缺失时明确 skip
python -m pytest -m online

# 默认最多评 3 条，避免一次误用大量额度
python -m rag_eval_lab.cli --mode online --max-cases 3
```

双用户隔离测试还需要 `$env:RAG_EVAL_OTHER_USER_JWT`。第二个 JWT 必须属于无权访问目标资源的
测试账号。

## 6. DeepEval 在线指标

DeepEval 的 LLM Judge 会产生模型费用。只有你明确决定运行时再设置：

```powershell
$env:RAG_EVAL_DEEPEVAL_ENABLED = "true"
$env:RAG_EVAL_JUDGE_MODEL = "你的 Judge 模型名"
$env:RAG_EVAL_JUDGE_API_KEY = "你的专用 Judge Key"
# 使用 OpenAI 兼容服务时填写；使用官方 OpenAI 时删除该变量
$env:RAG_EVAL_JUDGE_BASE_URL = "https://你的兼容服务地址/v1"
$env:RAG_EVAL_JUDGE_THRESHOLD = "0.7"

python -m rag_eval_lab.cli --mode online --max-cases 1 --deepeval
```

适配器把 `model`、`api_key`、`base_url` 显式传给 DeepEval 的 `GPTModel`。它不会使用环境里
碰巧存在的 `OPENAI_API_KEY` 作为回退。DeepEval 官方说明与指标契约见
[Faithfulness](https://deepeval.com/docs/metrics-faithfulness)、
[Contextual Precision](https://deepeval.com/docs/metrics-contextual-precision) 和
[Contextual Recall](https://deepeval.com/docs/metrics-contextual-recall)。

## 7. JSONL 数据格式

每行是一个独立 JSON 对象，方便 Git diff 和逐行定位：

```json
{"case_id":"factual-001","question":"续航多久？","expected_answer":"12 小时","expected_keywords":["12 小时"],"expected_source":"产品手册.md","forbidden_claims":["24 小时"],"category":"factual"}
```

`expected_source` 也可以是数组，用于多文档问题。`actual_answer`、`retrieval_context`、耗时和
Token 是离线基线的可重复观测；在线运行时会被真实 API 结果替换。

## 8. 指标含义

| 指标 | 通俗解释 |
|---|---|
| HTTP / business code | 请求是否按该用例的协议成功或正确拒绝 |
| answer non-empty | 正常问答有没有返回文字 |
| keyword hit rate | 黄金关键词命中了多少 |
| citation marker | 回答有没有 `[N]` 引用标记 |
| source title accuracy | 引用区的文档标题是否正确 |
| no-answer refusal | 资料没有答案时是否明确说不知道 |
| latency | 总耗时是否低于用例阈值，并汇总 P50/P95 |
| token usage | API 返回时统计；没有就如实记为 unavailable |
| data isolation | 另一个用户是否被拒绝且拿不到回答/分块 |
| Answer Relevancy | 回答是否围绕问题 |
| Faithfulness | 回答中的事实是否有检索上下文支撑 |
| Contextual Precision | 相关分块是否排在更前面 |
| Contextual Recall | 理想答案所需信息是否被完整检索到 |

## 9. 接入其他 RAG 系统

保留 `EvalCase`、`metrics.py` 和 `reporting.py`，替换 `RagApiClient.ask()` 与 `retrieve()` 即可。
适配器需要统一产出：HTTP 状态、业务码、实际回答、按相关度排序的原始分块、来源标题、耗时，
以及可选 Token。若目标系统不能返回真实检索上下文，Answer Relevancy 仍可运行，但
Faithfulness、Contextual Precision、Contextual Recall 不应伪造上下文。

## 10. 当前限制

- 在线测试假设专用测试笔记本和三篇资料已准备好，MVP 不自动注册账号或写数据库。
- Spring 同步问答接口当前不返回 Token，因此在线报告的 Token 可能为空；SSE 已有 Token 事件，
  后续可增加流式客户端采集。
- DeepEval 分数受 Judge 模型与版本影响，不像确定性指标那样完全可重复。
- 第一阶段没有复杂前端、用例管理后台、多模型批量对比或自动合成数据。
