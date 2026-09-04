"""评测数据结构。

这里使用 Python 标准库 dataclass，避免离线测试为了数据校验安装大型依赖。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


ALLOWED_CATEGORIES = {
    "factual",
    "citation",
    "no_answer",
    "multi_document",
    "access_control",
    "fallback",
}


@dataclass(frozen=True)
class EvalCase:
    """一条黄金用例及其可重复的离线观测结果。"""

    case_id: str
    question: str
    category: str
    expected_answer: str = ""
    expected_keywords: tuple[str, ...] = ()
    expected_sources: tuple[str, ...] = ()
    forbidden_claims: tuple[str, ...] = ()
    actual_answer: str = ""
    retrieval_context: tuple[str, ...] = ()
    retrieved_sources: tuple[str, ...] = ()
    expected_http_status: int = 200
    actual_http_status: int = 200
    business_code: int | None = 200
    latency_ms: float = 0.0
    max_latency_ms: float = 2_000.0
    token_usage: dict[str, int] | None = None

    @classmethod
    def from_mapping(cls, raw: dict[str, Any]) -> "EvalCase":
        """把 JSON 字典转成强类型对象，并尽早报告坏数据。"""
        required = ("case_id", "question", "category")
        missing = [name for name in required if not raw.get(name)]
        if missing:
            raise ValueError(f"缺少必填字段: {', '.join(missing)}")
        if raw["category"] not in ALLOWED_CATEGORIES:
            raise ValueError(f"不支持的 category: {raw['category']}")
        if not raw.get("expected_answer") and not raw.get("expected_keywords"):
            raise ValueError(f"{raw['case_id']} 必须提供 expected_answer 或 expected_keywords")

        expected_source = raw.get("expected_source")
        if isinstance(expected_source, str):
            expected_sources = (expected_source,)
        else:
            expected_sources = tuple(expected_source or ())

        return cls(
            case_id=str(raw["case_id"]),
            question=str(raw["question"]),
            category=str(raw["category"]),
            expected_answer=str(raw.get("expected_answer", "")),
            expected_keywords=tuple(str(item) for item in raw.get("expected_keywords", ())),
            expected_sources=expected_sources,
            forbidden_claims=tuple(str(item) for item in raw.get("forbidden_claims", ())),
            actual_answer=str(raw.get("actual_answer", "")),
            retrieval_context=tuple(str(item) for item in raw.get("retrieval_context", ())),
            retrieved_sources=tuple(str(item) for item in raw.get("retrieved_sources", ())),
            expected_http_status=int(raw.get("expected_http_status", 200)),
            actual_http_status=int(raw.get("actual_http_status", 200)),
            business_code=raw.get("business_code", 200),
            latency_ms=float(raw.get("latency_ms", 0.0)),
            max_latency_ms=float(raw.get("max_latency_ms", 2_000.0)),
            token_usage=raw.get("token_usage"),
        )


@dataclass
class CaseResult:
    """一条用例的指标、失败原因和运行数据。"""

    case_id: str
    question: str
    category: str
    actual_answer: str
    passed: bool
    metrics: dict[str, float | None]
    failures: list[str] = field(default_factory=list)
    latency_ms: float = 0.0
    token_usage: dict[str, int] | None = None

