"""RAG-Eval-Lab：Notebook Clone 的轻量 RAG 自动化评测工具。"""

from .dataset import load_cases
from .metrics import evaluate_case

__all__ = ["evaluate_case", "load_cases"]
