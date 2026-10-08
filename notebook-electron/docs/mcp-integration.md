# Notebook Electron MCP 检索接口

桌面应用可将现有 RAG 作为标准 MCP Streamable HTTP 服务提供给本机客户端。它共享桌面已初始化的 SQLite、向量存储和 `retrievalService`，不复制数据库，也不启动第二套索引。默认关闭。

## 启动与连接

在 `notebook-electron` 目录安装依赖，退出旧桌面实例后启动：

```powershell
npm ci
$env:NOTEBOOK_MCP_ENABLED = '1'
# 可选：仅允许这些笔记本；未设置时允许当前桌面全部笔记本。
# $env:NOTEBOOK_MCP_NOTEBOOK_IDS = '1,2'
npm start
```

启动日志显示连接文件 `notebook-mcp.json` 的实际路径。开发版默认位于仓库根目录 `.local-data/notebook-electron/`；设置 `NOTEBOOK_DATA_DIR` 或使用工作区外安装版时，以实际用户数据目录为准。旧安装包需要重新构建才会包含 MCP 功能。

连接文件包含 `endpoint` 和随机 `token`。客户端读取此文件，通过 `Authorization: Bearer <token>` 连接 `endpoint`。服务绑定 `127.0.0.1` 的随机端口；桌面重启后两者会变化，客户端应重新读取。关闭桌面时清理属于当前实例的连接文件。连接文件不进入 Git，也不要传给 renderer 或分享出去。

仅接受 `/mcp` 的 POST 请求，拒绝浏览器 Origin 和无效 Host。每个请求创建独立 MCP 服务实例，客户端使用官方 SDK 完成初始化和工具调用；无需持续的 SSE 通道。适用于同一主机上的进程，容器中的 `127.0.0.1` 不能直接访问宿主机服务。

## 工具与返回值

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `notebook_list` | 无 | 允许访问的笔记本 `id`、`name` |
| `notebook_stats` | `notebook_id`：正整数 | 文档数、向量块数、就绪文档数、索引版本 |
| `notebook_retrieve` | `notebook_id`、非空 `query`；可选 `top_k` 1–20（默认5）、`token_budget` 256–8000（默认6000） | 原文片段、来源、诊断及索引版本 |

工具均为只读，不提供导入、删除、配置修改或答案生成。查询长度最多8000字符，HTTP 请求体最多64 KiB。`top_k` 是返回上限，实际数量还受现有检索策略和证据预算约束。

检索的 `structuredContent` 包含：

- `results`：`id`、`title`、`content`、`score`、`citation_id`、`document_id`、`chunk_id`、`scores`、`notebook_id`、`index_revision`。
- `sources`：保留检索服务的来源记录，如 `citationId`、`documentId`、`documentTitle`、`chunkId`、`snippet`、`scores` 及原文位置。
- `diagnostics`：保留索引覆盖、检索、重排和警告信息；`selectedChunks` 为实际返回块数。
- `notebook_id`、`index_revision`、`provider=notebook_mcp`。

未授权的笔记本、检索期间索引变化或越界来源返回 MCP 工具错误。正常无命中返回空数组，不伪造降级资料。`index_revision` 是用于本次一致性校验的摘要，不是持久化版本历史。

检索复用桌面的模型配置：Embedding 和启用的重排仍可能调用模型供应商并消耗额度。“只读”表示不提供业务写操作，不代表完全离线。客户端负责回答及引用核验，获得有效片段不等于答案已经被证据支持。

## EchoMind Python 接入

EchoMind 的 Python 后端在同一主机运行，设置：

```powershell
$env:ECHOMIND_RAG_PROVIDER = 'notebook_mcp'
$env:ECHOMIND_NOTEBOOK_CONNECTION_FILE = '<实际用户数据目录>/notebook-mcp.json'
```

前端选择参考笔记本，把 `notebook_id` 交给后端；后端通过请求上下文限定范围，不能让模型自行扩大检索范围。资料仍在 Notebook 导入，EchoMind 不重复改写、重排或缓存此检索结果。EchoMind 的 Redis/ChromaDB 记忆与此接口独立。

## 验证

```powershell
npm test
# 只运行 MCP 和启动流程测试
node --test test/notebook-mcp.test.js test/retrieval-bootstrap.test.js
```

`test/notebook-mcp.test.js` 通过真实 SDK/HTTP 验证协议、笔记本范围、来源、空结果、索引变化和请求鉴权；检索本身使用替身。
`test-support/mcp-fixture-server.cjs` 是由跨语言测试显式启动的真实 SQLite/检索服务夹具，使用临时文件和固定向量，不自动加入 `npm test`，也不打入安装包。EchoMind 中设置 `NOTEBOOK_ELECTRON_DIR` 后可运行对应 Python 集成测试。

这些测试不读取个人资料，不调用真实在线模型。在线模型效果与打包后的桌面运行另行验证。

2026-10-08 本机完整离线回归：167通过、0失败、3个在线测试按默认配置跳过。
