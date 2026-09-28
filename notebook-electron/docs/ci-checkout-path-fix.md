# 离线 CI 重复检出导致工作目录错位

## 问题

`Offline CI` 的 Spring 和 Python job 先把当前仓库检出到工作区根目录，又把同一仓库检出到 `notebook-clone/`。第二次检出使预期的项目子目录与 `defaults.run.working-directory` 不再对应。Python job 在启动 `python -m pip install -e ".[test]"` 前就因工作目录不存在失败；这不是黄金用例或生成文档缺失。Spring job 使用相同的重复检出配置，也应一并修正。

## 修改

三个 job 都只执行一次 `actions/checkout@v4`。保持现有工作目录：Spring 为 `notebook-clone`，Python 为 `notebook-clone/rag-eval-lab`，Electron 为 `notebook-electron`。Python 的 `cache-dependency-path` 仍相对于仓库根目录定位已提交的 `pyproject.toml`。不改测试命令、评测数据或在线评测开关。

## 验证

检查工作流中每个 job 只有一次 checkout，工作目录和依赖文件都存在于仓库树中；运行本地可用的离线测试。最终以 GitHub Actions 在修复提交上的 Spring、Python、Electron job 全部通过为准，本地路径检查不能替代远端执行。
