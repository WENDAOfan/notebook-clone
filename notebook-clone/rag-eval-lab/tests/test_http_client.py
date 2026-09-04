import json
from unittest.mock import Mock, patch

from rag_eval_lab.http_client import RagApiClient


class FakeResponse:
    def __init__(self, payload, status=200):
        self.status = status
        self.payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


@patch("urllib.request.urlopen")
def test_ask_uses_jwt_and_expected_document_path(mock_urlopen):
    mock_urlopen.return_value = FakeResponse({"code": 200, "data": "测试回答"})
    client = RagApiClient("http://localhost:8080", "secret-test-token")

    observation = client.ask("document", 7, "问题")

    request = mock_urlopen.call_args.args[0]
    assert request.full_url == "http://localhost:8080/api/documents/7/ask"
    assert request.headers["Authorization"] == "Bearer secret-test-token"
    assert observation.data == "测试回答"


@patch("urllib.request.urlopen")
def test_retrieval_parses_chunk_list(mock_urlopen):
    mock_urlopen.return_value = FakeResponse(
        {"code": 200, "data": [{"rank": 1, "text": "分块", "documentTitle": "资料.md"}]}
    )
    client = RagApiClient("http://localhost:8080/", "token")

    observation = client.retrieve("notebook", 9, "问题", top_k=3)

    assert observation.business_code == 200
    assert observation.data[0]["documentTitle"] == "资料.md"
    request_body = json.loads(mock_urlopen.call_args.args[0].data.decode("utf-8"))
    assert request_body["topK"] == 3


def test_invalid_target_type_fails_before_network():
    client = RagApiClient("http://localhost:8080", "token")
    try:
        client.ask("unknown", 1, "问题")
    except ValueError as exc:
        assert "document 或 notebook" in str(exc)
    else:
        raise AssertionError("无效 target_type 应抛出 ValueError")
