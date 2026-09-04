"""显式在线测试。

普通 pytest 会通过 marker 排除本文件；即使用户指定 -m online，配置不全也只会 skip。
"""

import os
import urllib.error
from dataclasses import replace

import pytest

from rag_eval_lab.deepeval_adapter import (
    DeepEvalDependencyMissing,
    DeepEvalNotConfigured,
    JudgeConfig,
    is_deepeval_available,
    run_deepeval,
)
from rag_eval_lab.http_client import RagApiClient
from rag_eval_lab.metrics import evaluate_case


pytestmark = pytest.mark.online


def _required_online_config():
    if os.getenv("RAG_EVAL_ONLINE_ENABLED", "").casefold() != "true":
        pytest.skip("设置 RAG_EVAL_ONLINE_ENABLED=true 后才运行在线测试")
    names = ("RAG_EVAL_BASE_URL", "RAG_EVAL_JWT", "RAG_EVAL_TARGET_TYPE", "RAG_EVAL_TARGET_ID")
    missing = [name for name in names if not os.getenv(name, "").strip()]
    if missing:
        pytest.skip("缺少在线环境变量: " + ", ".join(missing))
    return (
        os.environ["RAG_EVAL_BASE_URL"],
        os.environ["RAG_EVAL_JWT"],
        os.environ["RAG_EVAL_TARGET_TYPE"],
        int(os.environ["RAG_EVAL_TARGET_ID"]),
    )


def _observe_first_case(golden_cases):
    base_url, jwt, target_type, target_id = _required_online_config()
    case = golden_cases[0]
    client = RagApiClient(base_url, jwt)
    try:
        retrieval = client.retrieve(target_type, target_id, case.question)
        answer = client.ask(target_type, target_id, case.question)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        pytest.skip(f"Spring 服务未启动或不可达: {exc}")
    if retrieval.status >= 500 or answer.status >= 500:
        pytest.skip(f"Spring 服务未就绪: retrieval={retrieval.status}, answer={answer.status}")
    chunks = retrieval.data if isinstance(retrieval.data, list) else []
    return replace(
        case,
        actual_answer=str(answer.data or ""),
        retrieval_context=tuple(str(item.get("text", "")) for item in chunks),
        retrieved_sources=tuple(str(item.get("documentTitle", "")) for item in chunks),
        actual_http_status=answer.status,
        business_code=answer.business_code,
        latency_ms=answer.latency_ms + retrieval.latency_ms,
        token_usage=None,
    )


def test_online_spring_answer_and_retrieval(golden_cases):
    observed = _observe_first_case(golden_cases)
    result = evaluate_case(observed)
    assert result.passed, result.failures
    assert observed.retrieval_context, "eval Profile 接口应返回真实检索上下文"


def test_online_cross_user_retrieval_is_isolated():
    base_url, _jwt, target_type, target_id = _required_online_config()
    other_jwt = os.getenv("RAG_EVAL_OTHER_USER_JWT", "").strip()
    if not other_jwt:
        pytest.skip("缺少 RAG_EVAL_OTHER_USER_JWT，无法验证双用户隔离")
    try:
        response = RagApiClient(base_url, other_jwt).retrieve(
            target_type, target_id, "尝试读取另一用户的资料"
        )
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        pytest.skip(f"Spring 服务未启动或不可达: {exc}")
    denied = response.status in {401, 403, 404} or response.business_code in {400, 401, 403, 404}
    assert denied
    assert response.data in (None, [], "")


def test_online_deepeval_four_rag_metrics(golden_cases):
    try:
        config = JudgeConfig.from_env()
    except (DeepEvalNotConfigured, DeepEvalDependencyMissing) as exc:
        pytest.skip(str(exc))
    if not is_deepeval_available():
        pytest.skip("请先安装 pip install -e '.[online]'")
    observed = _observe_first_case(golden_cases)
    try:
        scores = run_deepeval(observed, config)
    except DeepEvalDependencyMissing as exc:
        pytest.skip(str(exc))
    assert set(scores) == {
        "answer_relevancy",
        "faithfulness",
        "contextual_precision",
        "contextual_recall",
    }
    assert all(0.0 <= item["score"] <= 1.0 for item in scores.values())
