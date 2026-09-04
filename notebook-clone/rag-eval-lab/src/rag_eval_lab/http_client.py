"""Spring RAG API 客户端，只使用 Python 标准库。"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class HttpObservation:
    status: int
    business_code: int | None
    data: Any
    latency_ms: float


class RagApiClient:
    """显式接收 JWT，不读取项目配置文件，也不会记录 Token。"""

    def __init__(self, base_url: str, jwt: str, timeout_seconds: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.jwt = jwt
        self.timeout_seconds = timeout_seconds

    def ask(self, target_type: str, target_id: int, question: str) -> HttpObservation:
        if target_type == "document":
            path = f"/api/documents/{target_id}/ask"
        elif target_type == "notebook":
            path = f"/api/notebooks/{target_id}/ask"
        else:
            raise ValueError("target_type 只支持 document 或 notebook")
        return self._post(path, {"question": question, "useDocumentContext": True})

    def retrieve(
        self, target_type: str, target_id: int, question: str, top_k: int = 5
    ) -> HttpObservation:
        return self._post(
            "/api/eval/retrieval",
            {
                "targetType": target_type,
                "targetId": target_id,
                "question": question,
                "topK": top_k,
            },
        )

    def _post(self, path: str, payload: dict[str, Any]) -> HttpObservation:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.jwt}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                status = response.status
                raw_body = response.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            raw_body = exc.read()
        latency_ms = round((time.perf_counter() - started) * 1_000, 2)
        try:
            parsed = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except json.JSONDecodeError:
            parsed = {"data": raw_body.decode("utf-8", errors="replace")}
        return HttpObservation(
            status=status,
            business_code=parsed.get("code") if isinstance(parsed, dict) else None,
            data=parsed.get("data") if isinstance(parsed, dict) else parsed,
            latency_ms=latency_ms,
        )
