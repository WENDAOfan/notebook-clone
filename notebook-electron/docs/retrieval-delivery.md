# 桌面检索改进最终交付（2026-10-03）

检索改进已经接入Electron真实桌面入口。原80篇近名资料的证据Recall@5从14/18提高到18/18，证据MRR从.7620提高到.8519；最终提前冻结的132块新资料，证据Recall@5为15/15、证据MRR为.9000。这是受控虚构资料实测，不是RGB官方成绩或所有知识库的准确率保证。

本轮不修改Java、不重建个人知识库、不修改真实密钥配置、不提交Git。早期失败保留在 [第一阶段快照](retrieval-delivery-phase1.md) 和 [实验记录](retrieval-ranking-v2.md)，没有覆盖失败报告。

## 软件实际改变

| 原问题 | 当前实现 |
| --- | --- |
| 近似名称、型号子串压过真正对象 | 保留向量、BM25、RRF；完整主体和型号软排序，保护纯语义候选，不硬删省略型号的关联证据 |
| 相邻残句压过完整条款 | 单向重叠降序；仅在同一有效文档唯一精确原文位置补齐句边界，单侧最多256字符、总新增128 token |
| 否定适用关系仍因关键词命中靠前 | 现有DeepSeek对最多16个候选判断主体、否定、时间和必要条件，按0–3分返回有序编号，保留原文 |
| 重排增加等待 | 每题最多一次尝试；紧凑分组JSON替代冗长逐项输出，上限256 token；8秒超时或非法结果回退基础排序 |
| 新能力遗漏启动接线和调用预算 | main加载配置后应用策略；整理Agent不启用问答专用重排；单独记录重排用量、耗时和降级原因 |

核心文件：`retrieval-ranking.js`、`retrieval-context.js`、`retrieval-reranker.js`、`retrieval-service.js`、`rag-service.js`、`retrieval-runtime-policy.js`、`main.js`。

库的 `DEFAULT_POLICY.rerank` 仍为false，离线测试不访问模型；桌面DeepSeek就绪且未显式关闭时启用。配置 `"retrieval": { "rerank": false }` 可关闭，未就绪或非法开关不启用。重启源码版即可使用，有效索引无需重建；旧安装包需重新构建。每题最多增加一次DeepSeek请求并消耗额度，未知供应商用量不记为零；回答用量仍为估算，合计不含Embedding，不是精确账单。

## 原策略与最终策略：同索引、同查询向量

使用真实生产索引和retrieve，模型为 `embedding-3`、`deepseek-chat`。MRR按每项必要证据的倒数排名平均，不等于“首个正确结果”的标准按题MRR。报告分别保留原始分块和补全后实际提供上下文的排名。

| 回归集 | 必要证据 | 原Recall@5 → 当前 | 原证据MRR → 当前 |
| --- | ---: | --- | --- |
| dense-near，80篇近名资料 | 18 | 14/18 → 18/18 | .7620 → .8519 |
| retrieval-holdout，83篇资料 | 12 | 7/12 → 12/12 | .5417 → .8750 |
| retrieval-confirm，40篇资料 | 13 | 12/13 → 13/13 | .7308 → .8462 |
| long，旧长文63块 | 15 | 15/15 → 15/15 | .7167 → .7556 |

报告：`eval/retrieval-{dense-near-all,retrieval-holdout-holdout,retrieval-confirm-holdout,long-all}-compact-regression-v1-report.json`。无答案支持证据覆盖分别4/4、3/3、1/1、2/2，未下降。四组并行执行，只用于检索回归，不用其耗时判断性能门槛。

旧长文达到实际分块的理论证据MRR上限.7556：多处事实不能同时排第一。原.80门槛保留为不可达的评测设计问题，不改记通过、不用归一化冒充原分；标准按题MRR为1，15项证据均在前五。其他独立题集仍按.80目标验收。

## 紧凑重排启用依据

下表比较当前基础检索control与紧凑重排candidate，不把基础修复收益冒充重排收益。候选最多16个、同一评分含义、每题一次预算不变，仅压缩输出协议。

| 题集 | 无重排 → 重排证据MRR | 前五证据覆盖 | 完整问答P95：无重排 → 重排 |
| --- | --- | --- | --- |
| boundary-holdout，校准/回归，80块 | .6564 → .8846（+.2282） | 13/13不变 | 3292 → 4268 ms（+29.65%） |
| long-ranking，回归，116块 | .8611 → .9167（+.0556） | 12/12不变 | 3172 → 3949 ms（+24.50%） |
| paragraph-confirm，首次独立确认，132块 | .8333 → .9000（+.0667） | 15/15不变 | 3175 → 4058 ms（+27.81%） |

三组收益超过.05、召回没有下降；助手核对主要事实分别10/10、10/10、12/12，拒答均2/2。P95增幅不超过30%，绝对耗时低于60秒。boundary余量很小，不能保证不同网络条件仍满足相对门槛。

检索报告：`retrieval-boundary-holdout-holdout-compact-v1-report.json`、`retrieval-long-ranking-holdout-compact-v1-report.json`、`retrieval-paragraph-confirm-holdout-compact-frozen-v1-report.json`。对应问答报告为 `boundary-holdout-holdout-compact[-control]-v1-report.json`、`long-ranking-holdout-compact[-control]-v1-report.json`、`paragraph-confirm-holdout-compact-{control,frozen}-v1-report.json`，均在eval目录。

当前问答核心SHA-256与上述报告一致：`16480f8087c9c06f92f419c77b6c20788bd2f2e7622e0d772efa9d80fff47742`。main启动接线不在该指纹内，单独由真实main隔离适配器测试验证。

## 最后新题逐题核对

`paragraph-confirm` 运行前固定：12份资料、132块、12有答案题与2无答案题，SHA-256 `379568fe9f66be7b18832976f843943eb86e4ecbff8590db5ba6d87a6527d994`。未按首次结果改题；后续只能称回归。下表是助手对照实际答案和引用的核对，不是独立人工盲审，原始状态仍为 `AWAITING_MANUAL_REVIEW`。

| 题号 | 主要事实 | 核对结果 |
| --- | --- | --- |
| pc-hours-a | 澄桥周六9:30–17:00 | 正确、引用支持 |
| pc-hours-b | 橙桥周六10:00–18:30 | 正确；多余名称确认提醒仍存在 |
| pc-hours-compare | 两对象分别对应两组时间 | 正确、引用支持 |
| pc-new | 8月适用28天，7月15日起旧21天失效 | 正确、引用支持 |
| pc-loan-compare | 21天改28天 | 正确、引用支持 |
| pc-unit | UV-6为400小时，不是900小时 | 正确、引用支持 |
| pc-unit-compare | UV-6/UV-60分别400/900小时 | 正确、引用支持 |
| pc-cooling | 更换前断电并等待冷却 | 正确、引用支持 |
| pc-entry | 护照或身份证，前台查询已批准预约 | 正确、引用支持 |
| pc-log | 默认7天改30天，管理员可调整 | 正确、引用支持 |
| pc-refund | 团体5工作日、个人2工作日 | 正确、引用支持 |
| pc-battery | 停用交维修，不得挤压或继续充电 | 正确、引用支持 |
| pc-price | 成交价删除，保险金额不可替代 | 正确拒答 |
| pc-photo | 培训已举行，但合照无记录 | 正确拒答，未断言没拍照 |

旧 `semantic-confirm-holdout-compact-regression-v1-report.json` 中，原误拒答的 `sc-near-pad` 这次明确回答凝川75天，区分宁川45天且引用正确；10/10主要事实、2/2拒答通过助手核对。这不保证永不复发。仍存在多余提醒、宽泛缺失声明或额外谨慎建议，不宣称每句话都完美。

## 未部署方案与保留问题

- 本地句子IDF排序v1使近名召回18/18降至13/18；保护主体后的v2仍降至16/18，旧长文降至14/15。未接入生产，仅保留eval复盘程序和报告。
- 逐轮重排曾使P95增加47.4%；每题一次但冗长输出协议仍使长文增加41.5%。失败报告保留，最终启用的是重新实测过的紧凑协议。
- 历史日期计算错误、过度推断和部分关联拒答本轮没有全部重新验收。本次交付是检索改善，不是RAG回答问题清零。
- 合成题规模有限，由同一助手构造和复核，不是独立第三方测评。检索到证据不等于模型必然正确使用它。

## 边界与验证

只检索ready且内容哈希、模型一致的索引；部分就绪提示未覆盖资料，普通聊天不被阻断。补全不跨文档，空检索不退回全文。每次最多8块、笔记本每文档最多3块、整题累计8000 token含来源包装与去重。最多3次可工具调用模型轮次加1次无工具收尾、6次检索、另有最多1次重排；180秒总超时、用户取消、工具错误配对、空回答失败规则保留。

最终全套离线161项：158通过、0失败、3个在线测试默认跳过，约26.6秒。覆盖排序、句补全、工具预算、取消超时、无效引用、范围隔离和main配置→检索策略→数据库→窗口的接线。启动测试为真实main配合隔离适配器，不声称手动点击了可见窗口。真实报告无请求错误、空回答或未知引用编号，来源均为对应虚构文档原文，每题重排不超过一次。在线临时库已清理，报告保留。

收尾重新核对上述四组共50次candidate问答：题集哈希全部一致，所有来源均为对应原文精确子串，所有黄金证据均存在于被引用来源，未知引用零，累计证据最大6473 token；代码指纹与七份control/candidate报告一致。当前启动/开关/重排边界12项复核全部通过，未再消耗在线模型额度。`git diff --check`通过，仅有Git换行提示；临时评测目录数量为零。

| 完成核对项 | 权威证据 | 判断 |
| --- | --- | --- |
| 不只实现模块，接入桌面实际入口 | main启动适配器、runtime-policy测试、当前代码 | 已接入；可显式关闭 |
| 原难例召回与排序实际改善 | 四份同索引同查询向量compact-regression报告 | 改善成立，无召回退步 |
| 未看过的新资料确认 | 固定paragraph-confirm哈希及首次生产报告 | 检索与主要事实核对通过；不是第三方盲审 |
| 重排收益与性能门槛 | 三组control/candidate生产报告 | 本轮通过；保留网络波动和小样本边界 |
| 原索引、范围、预算、取消边界 | 生产代码、离线回归、50次报告审计 | 保留，未发现违反 |
| 可复现交付、失败记录、数据清理 | eval脚本、固定题集、历史/最终报告、临时目录检查 | 完成；未提交Git |

## 复现

在 `notebook-electron` 目录运行。必须显式加 `--rerank` 才复现当前桌面策略，不带为无重排control；省略 `--online` 只准备。使用尚不存在的新label，脚本拒绝覆盖旧报告。只发送虚构资料，使用内存SQLite、D盘临时向量库，不动个人库。

```powershell
node --test --test-concurrency=1
node eval/retrieval-compare.js --suite paragraph-confirm --split holdout --online --rerank --label repeat-v2
node eval/production-cases.js --suite paragraph-confirm --split holdout --online --rerank --label repeat-v2
node eval/retrieval-compare.js --suite boundary-holdout --split holdout --online --rerank --label repeat-v2
node eval/retrieval-ceiling.js long
```

代码、固定题集和测试属于源码交付；在线报告依现有规则保留本地、不提交。未执行Git提交或推送。
