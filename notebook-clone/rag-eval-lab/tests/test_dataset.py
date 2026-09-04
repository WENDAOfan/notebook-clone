import json

import pytest

from rag_eval_lab.dataset import load_cases
from rag_eval_lab.models import ALLOWED_CATEGORIES


def test_dataset_contains_fourteen_high_quality_cases(golden_cases):
    assert len(golden_cases) == 14


def test_case_ids_are_unique(golden_cases):
    ids = [case.case_id for case in golden_cases]
    assert len(ids) == len(set(ids))


def test_required_categories_are_covered(golden_cases):
    categories = {case.category for case in golden_cases}
    assert categories == ALLOWED_CATEGORIES


def test_every_case_has_expected_answer_or_keywords(golden_cases):
    assert all(case.expected_answer or case.expected_keywords for case in golden_cases)


def test_bad_json_reports_line_number(tmp_path):
    dataset = tmp_path / "bad.jsonl"
    dataset.write_text(json.dumps({"case_id": "x"}, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(ValueError, match=r"bad\.jsonl:1"):
        load_cases(dataset)
