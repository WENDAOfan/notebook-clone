# 桌面用户数据迁移到当前工作区

## 目标与边界

本机目标为仓库根目录 `.local-data/notebook-electron/`，包含 `config.json`、`notebook.db`、`vector-store.json`、已有备份与 Electron/Chromium 会话缓存。源码仍在 `notebook-electron/`。用户数据目录被 Git 忽略，且位于 Electron 打包目录之外；不能将密钥或个人资料放进发行包。

被忽略的数据不会随 Git 提交或普通源码备份保存，也可能被 `git clean -fdx` 一类包含 ignored 文件的清理命令删除；该目录需要独立备份。

开发模式从源码位置解析仓库根目录。当前工作区 `notebook-electron/dist/` 内的 unpacked/portable 构建也从可验证的仓库结构解析同一目录。其他位置安装的构建保留 Electron 默认位置，除非显式提供绝对路径 `NOTEBOOK_DATA_DIR`；这避免把本机 D 盘路径硬编码到给其他人使用的程序。目录不可创建或不可写时启动应明确失败，不能悄悄新建 C 盘空库。

主进程在 `ready` 之前同步创建并设置 `userData`、`sessionData`，之后数据库、向量库、配置服务均从同一目录取路径。离线测试使用自己的临时配置与数据库；在线评测如未显式传 `--config`，优先读取当前工作区 D 盘活动配置，但评测数据库仍独立隔离。系统临时目录、安装器或崩溃日志仍可能由 Windows/Electron 放到其他位置；“迁移”不承诺 C 盘零写入。

## 一次性迁移与回退

1. 确认桌面程序未运行，并确认目标目录尚不存在；先复制旧 `%APPDATA%/notebook-electron/` 的全部文件，保留原目录不删除。
2. 开发版 `notebook-electron/config.json` 中的模型配置优先于旧用户目录内尚未配置的示例文件，因此再把开发版配置复制到目标 `config.json`。整个过程不输出密钥内容。
3. 核对复制文件数量、大小与 SHA-256（目标配置与开发版配置比较），再检查 SQLite 完整性、向量 JSON 可解析和已迁移资源数量。
4. 运行路径解析、配置选择和应用离线回归；检查开发版与工作区内打包版的路径选择。旧 C 盘目录和开发版原配置暂留，不作为新的活跃数据源。若验证失败，可恢复旧启动代码并继续使用原目录。

现有 `notebook.db` 和 `vector-store.json` 是个人数据；不会在未确认新版本正常使用 D 盘前删除 C 盘原件。对仓库以外安装的旧版程序，必须更新/重启到支持新路径的版本，不能仅复制数据就假设它也会读取 D 盘。

## 本机执行记录（2026-09-29）

旧目录 69 个文件已复制到目标，除目标配置改用开发版配置外逐文件 SHA-256 一致；目标配置与开发版配置的 SHA-256 一致。目标 SQLite `PRAGMA integrity_check` 为 `ok`，含 2 个笔记本和 14 份文档；向量 JSON 可解析。真实 Electron 无窗口探针确认 `userData` 与 `sessionData` 均为目标目录。离线测试 87 项通过、3 项跳过。新工作区内打包版位于 `notebook-electron/dist/storage-migration-build/win-unpacked/`；其 `app.asar` 包含路径解析代码，不包含根目录的 `config.json`、`.local-data` 或当前开发版的真实密钥。旧 `dist/win-unpacked/` 未覆盖，不能用它验证新路径。
