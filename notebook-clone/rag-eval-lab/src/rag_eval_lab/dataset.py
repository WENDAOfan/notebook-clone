"""JSONL 黄金数据加载器。"""

from __future__ import annotations

import json
from pathlib import Path

from .models import EvalCase


def load_cases(path: str | Path) -> list[EvalCase]:
    """逐行读取 JSONL；错误信息包含行号，方便初学者定位数据问题。"""
    dataset_path = Path(path)
    cases: list[EvalCase] = []
    seen_ids: set[str] = set()

    with dataset_path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
                case = EvalCase.from_mapping(raw)
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                raise ValueError(f"{dataset_path}:{line_number}: {exc}") from exc
            if case.case_id in seen_ids:
                raise ValueError(f"{dataset_path}:{line_number}: case_id 重复: {case.case_id}")
            seen_ids.add(case.case_id)
            cases.append(case)

    if not cases:
        raise ValueError(f"数据集为空: {dataset_path}")
    return cases
