from dataclasses import replace

import pytest

from rag_eval_lab.metrics import evaluate_case, keyword_hit_rate


def test_all_offline_golden_cases_pass(golden_cases):
    """参数很多时也保留一条总闸门，确保样例报告始终是全绿基线。"""
    results = [evaluate_case(case) for case in golden_cases]
    assert [result.case_id for result in results if not result.passed] == []


@pytest.mark.parametrize(
    ("answer", "keywords", "expected"),
    [
        ("支持 AES-256 加密", ("AES-256", "加密"), 1.0),
        ("只提到了 AES-256", ("AES-256", "加密"), 0.5),
        ("任意回答", (), 1.0),
    ],
)
def test_keyword_hit_rate(answer, keywords, expected):
    """参数化测试用同一套逻辑验证多组输入，失败时 pytest 会指出具体参数。"""
    assert keyword_hit_rate(answer, keywords) == expected


def test_missing_keyword_is_a_real_failure(golden_cases):
    broken = replace(golden_cases[0], actual_answer="续航信息见产品手册[1]。")
    result = evaluate_case(broken)
    assert not result.passed
    assert "missing_keyword" in result.failures


def test_missing_citation_marker_is_reported(golden_cases):
    case = golden_cases[0]
    broken = replace(case, actual_answer="电池续航为 12 小时，来源是 AeroNote-X1-产品手册.md。")
    assert "missing_citation_marker" in evaluate_case(broken).failures


def test_wrong_source_title_is_reported(golden_cases):
    case = golden_cases[0]
    broken = replace(case, actual_answer="电池续航为 12 小时[1]，来源：别的文档.md。")
    assert "wrong_source_title" in evaluate_case(broken).failures


def test_no_answer_must_refuse_instead_of_guessing(golden_cases):
    case = next(item for item in golden_cases if item.case_id == "no-answer-001")
    broken = replace(case, actual_answer="它有红色版本。")
    result = evaluate_case(broken)
    assert "missing_refusal" in result.failures
    assert "forbidden_claim" in result.failures


def test_latency_threshold_is_enforced(golden_cases):
    broken = replace(golden_cases[0], latency_ms=2_001)
    assert "latency_exceeded" in evaluate_case(broken).failures


def test_access_control_requires_empty_response(golden_cases):
    case = next(item for item in golden_cases if item.category == "access_control")
    broken = replace(case, actual_answer="泄露的回答", retrieval_context=("泄露的分块",))
    assert "data_isolation_failure" in evaluate_case(broken).failures


def test_missing_token_usage_is_recorded_but_not_failed(golden_cases):
    case = next(item for item in golden_cases if item.category == "fallback")
    result = evaluate_case(case)
    assert result.metrics["token_usage_available"] == 0.0
    assert result.passed
