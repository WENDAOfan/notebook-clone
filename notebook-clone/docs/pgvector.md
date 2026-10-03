# Java 后端 pgvector 接入

Java 默认使用 Spring AI 1.0.0 的 `PgVectorStore`，与 JPA 共用 PostgreSQL 数据源。
`public.vector_store` 保存 `id`（TEXT）、`content`（TEXT）、`metadata`（JSON）和
`embedding`（vector(2048)）。上传仍由 `DocumentChunkService` 异步分块和向量化；
`RetrievalService` 使用元数据中的数字 `documentId` 做单文档或笔记本文档集合过滤。
分块 ID 保留 `doc:<documentId>:chunk:<index>`，写入采用 upsert，删除直接落库。

## 扩展与配置

先在 PostgreSQL 所在机器安装 [pgvector](https://github.com/pgvector/pgvector)，再在业务数据库执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS hstore;
```

SQL 只能启用已经安装的扩展，不能下载 DLL。Windows 官方安装方式是在 Visual Studio
x64 Native Tools 环境中编译与 PostgreSQL 主版本匹配的扩展；Linux/Docker 安装见官方说明。

```properties
vector.store.dimensions=2048
vector.store.initialize-schema=true
```

`initialize-schema=true` 由 Spring AI 初始化向量表，需要对应数据库权限。表建好后可设为
`false`。向量维度必须与实际 Embedding 输出一致，已有表不会随此配置自动修改维度。

当前智谱 `embedding-3` 实测输出及旧文件均为 2048 维。pgvector 的普通 `vector` HNSW /
IVFFlat 索引上限为 2000 维，因此代码明确使用 `PgIndexType.NONE` 和 `COSINE_DISTANCE`，
执行精确余弦检索。没有实施 HNSW、IVFFlat、半精度索引或性能基准测试。
参考：[Spring AI 1.0.0 PgVectorStore 源码](https://github.com/spring-projects/spring-ai/blob/v1.0.0/vector-stores/spring-ai-pgvector-store/src/main/java/org/springframework/ai/vectorstore/pgvector/PgVectorStore.java)、
[pgvector 索引维度限制](https://github.com/pgvector/pgvector#hnsw)。

## 一次性迁移旧文件

正常启动不会自动读取旧 `vector-store.json`。需要迁移时，从 `notebook-clone` 目录执行：

```powershell
.\mvnw.cmd spring-boot:run '-Dspring-boot.run.arguments=--vector.store.import-file=D:/JetBrains/notebookproject/vector-store.json'
```

迁移直接复用文件中的向量，不调用 Embedding。先验证所有条目的 ID、数字 documentId、
维度和正文，再在一个数据库事务中写入。只有文档仍存在且 `chunk_count > chunkIndex`
的条目才导入；已存在的 ID 不覆盖。失败时整批回滚，旧文件保留。
迁移完成后正常启动，不再传 `vector.store.import-file`。重新索引使用原有分块服务。

## 本机安装记录（2026-10-01）

本机是 PostgreSQL 18.4 / Windows x64。安装目录 `D:/PostgreSQL/18` 需要管理员文件权限，
因此使用 PostgreSQL 18 的 `extension_control_path` 从项目本地目录加载扩展：

- 运行所需 DLL：`D:/JetBrains/notebookproject/.local-data/pgvector/lib/vector.dll`
- control / SQL：`D:/JetBrains/notebookproject/.local-data/pgvector/share/extension/`
- control 中的 `module_pathname` 指向上述 DLL 的绝对路径（省略 `.dll`）。
- 数据库设置：`ALTER DATABASE notebook_clone SET extension_control_path = 'D:/JetBrains/notebookproject/.local-data/pgvector/share;$system';`

这些是运行文件，不能当作临时构建目录删除。移动项目或恢复数据库到另一机器时，需要
重新安装对应 PostgreSQL 主版本的扩展并处理函数记录中的 DLL 路径。
参见 [PostgreSQL 18 扩展路径说明](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-EXTENSION-CONTROL-PATH)。

本机使用的是社区维护的 MSVC 预构建，**并非 pgvector 官方二进制发布**：
[pgvector 0.8.6 / PostgreSQL 18 Windows x64 发布](https://github.com/andreiramani/pgvector_pgsql_windows/releases/tag/0.8.6_18)。
下载 ZIP 的 SHA256 已与 GitHub release asset 的 digest 对照：

```text
bda17eb97d9e687e3da701adbf4b65a342943b3e0cdc81935ccf0b9833a1ed62
```

之前尝试的 Zig 自编译 DLL 在数值验证时导致一个数据库后端进程退出，事务回滚且业务记录
未变动；该构建已弃用，最终安装的是上述 MSVC 构建。

## 验证结果与复现

2026-10-01 在本机执行并通过：

- 原有 Java 测试及迁移解析测试：56 项。
- 真实 PostgreSQL 集成测试：3 项，覆盖 2048 维向量写入、重新创建 store 后读取、文档 /
  笔记本过滤、文本 ID upsert 和持久化删除；Embedding 使用确定性测试向量。
- 真实智谱 Embedding 验证：1 项，调用实际配置的模型检索已迁移文档，并向量化、写入、
  检索和删除一个临时分块；没有调用 Chat 模型。
- 完整 Spring Boot 后端成功启动，并在事务中迁移旧文件：177 条中新增 174 条，跳过 3 条
  （documentId=2 的 `chunk_count` 为空）。数据库各文档向量数为 139、17、18，维度全部为 2048。
- 再次启动并重复执行迁移：新增 0 条、已存在 174 条、跳过 3 条，数据库仍为 174 条，
  临时测试向量为 0 条。测试启动的后端已停止，正常使用时从 `notebook-clone` 运行 `mvnw.cmd spring-boot:run`。

默认测试不连接外部数据库、不调用模型，不需要被Git忽略的个人配置；真实数据库及Embedding测试需环境变量显式开启。默认离线回归从Java子目录执行 `mvnw.cmd --batch-mode test`。上述2026-10-01记录是历史真实验证，不能把默认CI通过理解成重新验证了线上模型或本机数据库。

显式运行真实数据库测试：

```powershell
$env:PGVECTOR_INTEGRATION = 'true'
.\mvnw.cmd test
Remove-Item Env:\PGVECTOR_INTEGRATION
```

显式运行真实模型测试（会产生少量 Embedding API 请求）：

```powershell
$env:PGVECTOR_LIVE_EMBEDDING = 'true'
.\mvnw.cmd '-Dtest=PgVectorLiveEmbeddingTests' test
Remove-Item Env:\PGVECTOR_LIVE_EMBEDDING
```

两个集成测试读取本地、git-ignore 的 `application.properties`，支持其中的环境变量占位符。
测试创建的向量使用随机 ID，结束后仅清理本次测试行。

检查实际数据库：

```sql
SELECT extversion FROM pg_extension WHERE extname = 'vector';
SELECT count(*), min(vector_dims(embedding)), max(vector_dims(embedding)) FROM vector_store;
SELECT metadata->>'documentId' AS document_id, count(*) FROM vector_store GROUP BY 1;
```

上述验证证明本机已完成 pgvector 持久化与检索接入，不代表大规模性能、召回率或部署验证。

## 可用于简历的表述

基于 PostgreSQL + pgvector 实现文档分块向量持久化，结合 Spring AI 与智谱 Embedding
完成余弦相似度检索，并通过文档元数据限制单文档和笔记本级检索范围。
