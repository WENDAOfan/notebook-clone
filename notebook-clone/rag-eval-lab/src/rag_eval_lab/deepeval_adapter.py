"""DeepEval 在线 Judge 适配。

DeepEval 在未指定模型时可能使用默认提供商，因此本模块拒绝任何不完整配置，
并把导入放到函数内部，确保默认离线 pytest 不加载它。
"""

from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass

from .models import EvalCase


class DeepEvalNotConfigured(RuntimeError):
    """Judge 未显式启用或配置不完整。"""


class DeepEvalDependencyMissing(RuntimeError):
    """没有安装 deepeval 可选依赖。"""


@dataclass(frozen=True)
class JudgeConfig:
    model: str
    api_key: str
    base_url: str | None = None
    threshold: float = 0.7

    @classmethod
    def from_env(cls) -> "JudgeConfig":
        if os.getenv("RAG_EVAL_DEEPEVAL_ENABLED", "").casefold() != "true":
            raise DeepEvalNotConfigured("RAG_EVAL_DEEPEVAL_ENABLED 不是 true")
        model = os.getenv("RAG_EVAL_JUDGE_MODEL", "").strip()
        api_key = os.getenv("RAG_EVAL_JUDGE_API_KEY", "").strip()
        if not model or not api_key:
            raise DeepEvalNotConfigured("缺少 RAG_EVAL_JUDGE_MODEL 或 RAG_EVAL_JUDGE_API_KEY")
        return cls(
            model=model,
            api_key=api_key,
            base_url=os.getenv("RAG_EVAL_JUDGE_BASE_URL", "").strip() or None,
            threshold=float(os.getenv("RAG_EVAL_JUDGE_THRESHOLD", "0.7")),
        )


def is_deepeval_available() -> bool:
    return importlib.util.find_spec("deepeval") is not None


def run_deepeval(case: EvalCase, config: JudgeConfig) -> dict[str, dict[str, object]]:
    """对一条真实在线观测运行四项 DeepEval RAG 指标。"""
    if not is_deepeval_available():
        raise DeepEvalDependencyMissing("请先安装 pip install -e '.[online]'")
    if not case.actual_answer or not case.retrieval_context:
        raise ValueError("DeepEval 需要 actual_answer 和真实 retrieval_context")

    # 懒加载保证离线环境完全不需要 DeepEval 及其传递依赖。
    from deepeval.metrics import (  # type: ignore[import-not-found]
        AnswerRelevancyMetric,
        ContextualPrecisionMetric,
        ContextualRecallMetric,
        FaithfulnessMetric,
    )
    from deepeval.models import GPTModel  # type: ignore[import-not-found]
    from deepeval.test_case import LLMTestCase  # type: ignore[import-not-found]

    model_kwargs = {
        "model": config.model,
        "api_key": config.api_key,
        "temperature": 0,
    }
    if config.base_url:
        model_kwargs["base_url"] = config.base_url
    judge_model = GPTModel(**model_kwargs)

    expected_output = case.expected_answer or "；".join(case.expected_keywords)
    test_case = LLMTestCase(
        input=case.question,
        actual_output=case.actual_answer,
        expected_output=expected_output,
        retrieval_context=list(case.retrieval_context),
    )
    metrics = {
        "answer_relevancy": AnswerRelevancyMetric,
        "faithfulness": FaithfulnessMetric,
        "contextual_precision": ContextualPrecisionMetric,
        "contextual_recall": ContextualRecallMetric,
    }
    results: dict[str, dict[str, object]] = {}
    for name, metric_type in metrics.items():
        metric = metric_type(
            threshold=config.threshold,
            model=judge_model,
            include_reason=True,
            async_mode=False,
        )
        metric.measure(test_case)
        results[name] = {
            "score": float(metric.score),
            "passed": bool(metric.is_successful()),
            "reason": metric.reason,
        }
    return results
