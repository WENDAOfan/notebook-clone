"""不需要 LLM 的确定性 RAG 指标。"""

from __future__ import annotations

import re

from .models import CaseResult, EvalCase


CITATION_PATTERN = re.compile(r"\[\d+]")
REFUSAL_PHRASES = (
    "无法找到",
    "无法回答",
    "没有相关信息",
    "未提供",
    "不能确定",
)


def _contains(text: str, phrase: str) -> bool:
    """英文忽略大小写；中文 casefold 后保持不变。"""
    return phrase.casefold() in text.casefold()


def keyword_hit_rate(answer: str, expected_keywords: tuple[str, ...]) -> float:
    """关键词命中率 = 命中数量 / 期望数量。"""
    if not expected_keywords:
        return 1.0
    hits = sum(1 for keyword in expected_keywords if _contains(answer, keyword))
    return hits / len(expected_keywords)


def evaluate_case(case: EvalCase) -> CaseResult:
    """执行一条离线评测。

    每个断言都写入 metrics；真正影响红绿灯的原因写入 failures，便于报告分类。
    """
    failures: list[str] = []
    answer = case.actual_answer.strip()
    is_access_case = case.category == "access_control"

    http_contract = case.actual_http_status == case.expected_http_status
    if not http_contract:
        failures.append("http_status_mismatch")

    business_ok = (
        case.business_code in {400, 401, 403, 404}
        if is_access_case
        else case.business_code == 200
    )
    if not business_ok:
        failures.append("business_code_failure")

    non_empty = bool(answer)
    if not is_access_case and not non_empty:
        failures.append("empty_answer")

    hit_rate = keyword_hit_rate(answer, case.expected_keywords)
    if not is_access_case and hit_rate < 1.0:
        failures.append("missing_keyword")

    citation_required = case.category in {"factual", "citation", "multi_document"}
    citation_present = bool(CITATION_PATTERN.search(answer))
    if citation_required and not citation_present:
        failures.append("missing_citation_marker")

    source_accuracy = 1.0
    if case.expected_sources:
        source_hits = sum(1 for source in case.expected_sources if _contains(answer, source))
        source_accuracy = source_hits / len(case.expected_sources)
        if source_accuracy < 1.0:
            failures.append("wrong_source_title")

    refusal = any(_contains(answer, phrase) for phrase in REFUSAL_PHRASES)
    if case.category == "no_answer" and not refusal:
        failures.append("missing_refusal")

    forbidden_clear = all(not _contains(answer, claim) for claim in case.forbidden_claims)
    if not forbidden_clear:
        failures.append("forbidden_claim")

    latency_ok = case.latency_ms <= case.max_latency_ms
    if not latency_ok:
        failures.append("latency_exceeded")

    # 越权用例不仅要返回拒绝状态，还必须不带回答和检索上下文。
    data_isolation: float | None = None
    if is_access_case:
        isolated = (
            (case.actual_http_status in {401, 403, 404} or business_ok)
            and not answer
            and not case.retrieval_context
        )
        data_isolation = float(isolated)
        if not isolated:
            failures.append("data_isolation_failure")

    metrics: dict[str, float | None] = {
        "http_success": float(http_contract and business_ok),
        "answer_non_empty": None if is_access_case else float(non_empty),
        "keyword_hit_rate": None if is_access_case else hit_rate,
        "citation_marker": None if not citation_required else float(citation_present),
        "source_title_accuracy": None if not case.expected_sources else source_accuracy,
        "no_answer_refusal": None if case.category != "no_answer" else float(refusal),
        "forbidden_claims_clear": float(forbidden_clear),
        "latency_within_limit": float(latency_ok),
        "token_usage_available": float(case.token_usage is not None),
        "data_isolation": data_isolation,
    }
    return CaseResult(
        case_id=case.case_id,
        question=case.question,
        category=case.category,
        actual_answer=case.actual_answer,
        passed=not failures,
        metrics=metrics,
        failures=failures,
        latency_ms=case.latency_ms,
        token_usage=case.token_usage,
    )
