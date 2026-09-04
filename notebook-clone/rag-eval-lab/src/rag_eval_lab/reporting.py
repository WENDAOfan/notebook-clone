"""JSON、CSV 和简单 HTML 评测报告。"""

from __future__ import annotations

import csv
import html
import json
import math
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from .models import CaseResult


def percentile(values: list[float], percentile_value: float) -> float:
    """使用最近秩算法计算百分位；小数据集也容易手工复核。"""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile_value * len(ordered)))
    return ordered[rank - 1]


def build_report(results: list[CaseResult]) -> dict:
    """把逐条结果汇总成适合 CI 和 GitHub 展示的字典。"""
    total = len(results)
    passed = sum(1 for result in results if result.passed)
    metric_names = sorted({name for result in results for name in result.metrics})
    metric_averages: dict[str, float | None] = {}
    for name in metric_names:
        values = [result.metrics[name] for result in results if result.metrics.get(name) is not None]
        metric_averages[name] = round(sum(values) / len(values), 4) if values else None

    failure_types = Counter(reason for result in results for reason in result.failures)
    latencies = [result.latency_ms for result in results]
    token_totals = [
        result.token_usage.get("total", 0)
        for result in results
        if result.token_usage is not None
    ]

    return {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_cases": total,
            "passed_cases": passed,
            "failed_cases": total - passed,
            "pass_rate": round(passed / total, 4) if total else 0.0,
            "metric_averages": metric_averages,
            "latency_ms": {
                "p50": percentile(latencies, 0.50),
                "p95": percentile(latencies, 0.95),
                "average": round(sum(latencies) / total, 2) if total else 0.0,
            },
            "token_usage": {
                "reported_cases": len(token_totals),
                "total": sum(token_totals),
            },
            "failure_types": dict(sorted(failure_types.items())),
        },
        "details": [asdict(result) for result in results],
        "failed_cases": [
            {
                "case_id": result.case_id,
                "question": result.question,
                "actual_answer": result.actual_answer,
                "failure_reasons": result.failures,
            }
            for result in results
            if not result.passed
        ],
    }


def write_report_files(report: dict, output_dir: str | Path, stem: str = "latest") -> list[Path]:
    """一次评测同时写 JSON、CSV、HTML，返回生成路径供测试断言。"""
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    json_path = directory / f"{stem}.json"
    csv_path = directory / f"{stem}.csv"
    html_path = directory / f"{stem}.html"

    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    _write_csv(report, csv_path)
    _write_html(report, html_path)
    return [json_path, csv_path, html_path]


def _write_csv(report: dict, path: Path) -> None:
    metric_names = sorted(report["summary"]["metric_averages"])
    fieldnames = [
        "case_id", "category", "passed", "question", "actual_answer",
        "failure_reasons", "latency_ms", "token_total", *metric_names,
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for detail in report["details"]:
            row = {
                "case_id": detail["case_id"],
                "category": detail["category"],
                "passed": detail["passed"],
                "question": detail["question"],
                "actual_answer": detail["actual_answer"],
                "failure_reasons": "|".join(detail["failures"]),
                "latency_ms": detail["latency_ms"],
                "token_total": (detail["token_usage"] or {}).get("total", ""),
            }
            row.update(detail["metrics"])
            writer.writerow(row)


def _write_html(report: dict, path: Path) -> None:
    summary = report["summary"]
    rows = []
    for detail in report["details"]:
        status = "PASS" if detail["passed"] else "FAIL"
        rows.append(
            "<tr>"
            f"<td>{html.escape(detail['case_id'])}</td>"
            f"<td>{html.escape(detail['category'])}</td>"
            f"<td>{status}</td>"
            f"<td>{html.escape(detail['question'])}</td>"
            f"<td>{html.escape(', '.join(detail['failures']) or '-')}</td>"
            "</tr>"
        )
    body = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>RAG-Eval-Lab Report</title>
<style>body{{font-family:Arial,sans-serif;margin:2rem}}table{{border-collapse:collapse;width:100%}}
th,td{{border:1px solid #ddd;padding:.5rem;text-align:left}}th{{background:#f5f5f5}}</style></head>
<body><h1>RAG-Eval-Lab</h1>
<p>总数 {summary['total_cases']}；通过 {summary['passed_cases']}；失败 {summary['failed_cases']}；
通过率 {summary['pass_rate']:.1%}；P50/P95 {summary['latency_ms']['p50']}/{summary['latency_ms']['p95']} ms。</p>
<table><thead><tr><th>case_id</th><th>类别</th><th>结果</th><th>问题</th><th>失败原因</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></body></html>"""
    path.write_text(body, encoding="utf-8")
