import pytest
import sys
from types import ModuleType

import rag_eval_lab.deepeval_adapter as adapter
from rag_eval_lab.deepeval_adapter import DeepEvalNotConfigured, JudgeConfig


def test_judge_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("RAG_EVAL_DEEPEVAL_ENABLED", raising=False)
    with pytest.raises(DeepEvalNotConfigured, match="不是 true"):
        JudgeConfig.from_env()


def test_judge_requires_dedicated_key_and_model(monkeypatch):
    monkeypatch.setenv("RAG_EVAL_DEEPEVAL_ENABLED", "true")
    monkeypatch.delenv("RAG_EVAL_JUDGE_MODEL", raising=False)
    monkeypatch.delenv("RAG_EVAL_JUDGE_API_KEY", raising=False)
    with pytest.raises(DeepEvalNotConfigured, match="缺少"):
        JudgeConfig.from_env()


def test_judge_config_never_falls_back_to_existing_openai_key(monkeypatch):
    monkeypatch.setenv("RAG_EVAL_DEEPEVAL_ENABLED", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-be-used")
    monkeypatch.delenv("RAG_EVAL_JUDGE_API_KEY", raising=False)
    monkeypatch.setenv("RAG_EVAL_JUDGE_MODEL", "judge-model")
    with pytest.raises(DeepEvalNotConfigured):
        JudgeConfig.from_env()


def test_complete_judge_config_is_explicit(monkeypatch):
    monkeypatch.setenv("RAG_EVAL_DEEPEVAL_ENABLED", "true")
    monkeypatch.setenv("RAG_EVAL_JUDGE_MODEL", "judge-model")
    monkeypatch.setenv("RAG_EVAL_JUDGE_API_KEY", "dedicated-key")
    monkeypatch.setenv("RAG_EVAL_JUDGE_BASE_URL", "https://example.invalid/v1")
    config = JudgeConfig.from_env()
    assert config.model == "judge-model"
    assert config.api_key == "dedicated-key"
    assert config.base_url == "https://example.invalid/v1"


def test_adapter_maps_all_four_metrics_without_real_model(monkeypatch, golden_cases):
    """用 Mock 模块验证 DeepEval 接线，不安装依赖，也不产生一次网络请求。"""
    captured_model_kwargs = {}

    class FakeGPTModel:
        def __init__(self, **kwargs):
            captured_model_kwargs.update(kwargs)

    class FakeMetric:
        def __init__(self, **_kwargs):
            self.score = 0.9
            self.reason = "mock reason"

        def measure(self, _case):
            return self.score

        def is_successful(self):
            return True

    class FakeTestCase:
        def __init__(self, **kwargs):
            self.values = kwargs

    deepeval = ModuleType("deepeval")
    metrics = ModuleType("deepeval.metrics")
    models = ModuleType("deepeval.models")
    test_case = ModuleType("deepeval.test_case")
    for name in (
        "AnswerRelevancyMetric",
        "FaithfulnessMetric",
        "ContextualPrecisionMetric",
        "ContextualRecallMetric",
    ):
        setattr(metrics, name, FakeMetric)
    models.GPTModel = FakeGPTModel
    test_case.LLMTestCase = FakeTestCase
    monkeypatch.setitem(sys.modules, "deepeval", deepeval)
    monkeypatch.setitem(sys.modules, "deepeval.metrics", metrics)
    monkeypatch.setitem(sys.modules, "deepeval.models", models)
    monkeypatch.setitem(sys.modules, "deepeval.test_case", test_case)
    monkeypatch.setattr(adapter, "is_deepeval_available", lambda: True)

    scores = adapter.run_deepeval(
        golden_cases[0],
        JudgeConfig("judge-model", "dedicated-key", "https://example.invalid/v1"),
    )

    assert set(scores) == {
        "answer_relevancy",
        "faithfulness",
        "contextual_precision",
        "contextual_recall",
    }
    assert captured_model_kwargs == {
        "model": "judge-model",
        "api_key": "dedicated-key",
        "temperature": 0,
        "base_url": "https://example.invalid/v1",
    }
