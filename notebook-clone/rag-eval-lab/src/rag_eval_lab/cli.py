"""RAG-Eval-Lab 命令行入口。"""

from __future__ import annotations

import argparse
import os
from dataclasses import replace
from pathlib import Path

from .dataset import load_cases
from .deepeval_adapter import JudgeConfig, run_deepeval
from .http_client import RagApiClient
from .metrics import evaluate_case
from .models import EvalCase
from .reporting import build_report, write_report_files


PROJECT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DATASET = PROJECT_DIR / "data" / "golden_cases.jsonl"


def _truthy(name: str) -> bool:
    return os.getenv(name, "").casefold() == "true"


def _online_case(case: EvalCase, client: RagApiClient, target_type: str, target_id: int, top_k: int) -> EvalCase:
    """先取真实检索上下文，再调用正常问答 API。"""
    retrieval = client.retrieve(target_type, target_id, case.question, top_k)
    answer = client.ask(target_type, target_id, case.question)
    chunks = retrieval.data if isinstance(retrieval.data, list) else []
    return replace(
        case,
        actual_answer=str(answer.data or ""),
        retrieval_context=tuple(str(item.get("text", "")) for item in chunks),
        retrieved_sources=tuple(str(item.get("documentTitle", "")) for item in chunks),
        actual_http_status=answer.status,
        business_code=answer.business_code,
        latency_ms=answer.latency_ms + retrieval.latency_ms,
        token_usage=None,  # 当前同步接口没有返回 Token，报告中如实记为 unavailable。
    )


def _run_offline(cases: list[EvalCase]):
    return [evaluate_case(case) for case in cases]


def _run_online(cases: list[EvalCase], max_cases: int, with_deepeval: bool):
    if not _truthy("RAG_EVAL_ONLINE_ENABLED"):
        raise SystemExit("在线评测未启用：请先设置 RAG_EVAL_ONLINE_ENABLED=true")
    required = ["RAG_EVAL_BASE_URL", "RAG_EVAL_JWT", "RAG_EVAL_TARGET_TYPE", "RAG_EVAL_TARGET_ID"]
    missing = [name for name in required if not os.getenv(name, "").strip()]
    if missing:
        raise SystemExit("在线评测缺少环境变量：" + ", ".join(missing))

    target_type = os.environ["RAG_EVAL_TARGET_TYPE"].strip().casefold()
    target_id = int(os.environ["RAG_EVAL_TARGET_ID"])
    top_k = int(os.getenv("RAG_EVAL_TOP_K", "5"))
    client = RagApiClient(os.environ["RAG_EVAL_BASE_URL"], os.environ["RAG_EVAL_JWT"])
    eligible = [case for case in cases if case.category not in {"access_control", "fallback"}]

    judge_config = JudgeConfig.from_env() if with_deepeval else None
    results = []
    for case in eligible[:max_cases]:
        observed = _online_case(case, client, target_type, target_id, top_k)
        result = evaluate_case(observed)
        if judge_config:
            deep_scores = run_deepeval(observed, judge_config)
            for name, value in deep_scores.items():
                result.metrics[f"deepeval_{name}"] = float(value["score"])
                if not value["passed"]:
                    result.failures.append(f"deepeval_{name}")
            result.passed = not result.failures
        results.append(result)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="可重复的 RAG 自动化评测")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output-dir", type=Path, default=PROJECT_DIR / "reports")
    parser.add_argument("--mode", choices=("offline", "online"), default="offline")
    parser.add_argument("--max-cases", type=int, default=3, help="在线额度保护，默认最多 3 条")
    parser.add_argument("--deepeval", action="store_true", help="在线模式额外运行四项 LLM Judge")
    args = parser.parse_args()

    cases = load_cases(args.dataset)
    if args.mode == "offline":
        results = _run_offline(cases)
    else:
        results = _run_online(cases, max(1, args.max_cases), args.deepeval)

    report = build_report(results)
    paths = write_report_files(report, args.output_dir)
    summary = report["summary"]
    print(
        f"RAG-Eval-Lab: {summary['passed_cases']}/{summary['total_cases']} 通过 "
        f"({summary['pass_rate']:.1%})"
    )
    for path in paths:
        print(path)
    raise SystemExit(0 if summary["failed_cases"] == 0 else 1)


if __name__ == "__main__":
    main()
