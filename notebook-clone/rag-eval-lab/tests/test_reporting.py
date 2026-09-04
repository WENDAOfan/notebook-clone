import csv
import json

from rag_eval_lab.metrics import evaluate_case
from rag_eval_lab.reporting import build_report, percentile, write_report_files


def test_percentile_uses_nearest_rank():
    assert percentile([10, 20, 30, 40], 0.50) == 20
    assert percentile([10, 20, 30, 40], 0.95) == 40


def test_report_contains_required_summary(golden_cases):
    report = build_report([evaluate_case(case) for case in golden_cases])
    summary = report["summary"]
    assert summary["total_cases"] == 14
    assert summary["passed_cases"] == 14
    assert summary["pass_rate"] == 1.0
    assert summary["latency_ms"]["p50"] > 0
    assert summary["latency_ms"]["p95"] >= summary["latency_ms"]["p50"]
    assert "keyword_hit_rate" in summary["metric_averages"]


def test_report_writes_json_csv_and_html(tmp_path, golden_cases):
    report = build_report([evaluate_case(case) for case in golden_cases])
    paths = write_report_files(report, tmp_path)
    assert {path.suffix for path in paths} == {".json", ".csv", ".html"}
    assert json.loads((tmp_path / "latest.json").read_text(encoding="utf-8"))["summary"]["total_cases"] == 14
    assert "RAG-Eval-Lab" in (tmp_path / "latest.html").read_text(encoding="utf-8")

    with (tmp_path / "latest.csv").open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 14
    assert rows[0]["case_id"] == "factual-001"
