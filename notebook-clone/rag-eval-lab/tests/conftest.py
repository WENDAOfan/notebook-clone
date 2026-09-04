from pathlib import Path

import pytest

from rag_eval_lab.dataset import load_cases


PROJECT_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def dataset_path() -> Path:
    """fixture 把公共准备步骤集中起来，测试无需重复拼路径。"""
    return PROJECT_DIR / "data" / "golden_cases.jsonl"


@pytest.fixture(scope="session")
def golden_cases(dataset_path):
    """整个测试会话只读取一次固定 JSONL，不访问数据库或用户文档。"""
    return load_cases(dataset_path)
