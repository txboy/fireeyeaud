import json

import httpx
import pytest

from fireeyeaud_agent.kb import dify, ragflow


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://kb")


def test_dify_list_and_retrieve():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/datasets":
            assert request.headers["authorization"] == "Bearer k"
            return httpx.Response(
                200,
                json={"data": [{"id": "ds1", "name": "审计准则", "document_count": 3}]},
            )
        assert request.url.path == "/datasets/ds1/retrieve"
        body = json.loads(request.content)
        assert body["query"] == "收入确认"
        assert body["retrieval_model"]["top_k"] == 5
        assert body["retrieval_model"]["reranking_enable"] is False
        assert body["retrieval_model"]["score_threshold_enabled"] is True
        assert body["retrieval_model"]["score_threshold"] == 0.3
        return httpx.Response(
            200,
            json={
                "records": [
                    {
                        "score": 0.9,
                        "segment": {
                            "content": "片段",
                            "document_id": "d1",
                            "document": {"name": "准则.md"},
                        },
                    }
                ]
            },
        )

    kb = dify.list_knowledge("http://kb", "k", client=_client(handler))
    assert kb == [{"id": "ds1", "name": "审计准则", "documentCount": 3}]

    chunks = dify.retrieve("http://kb", "k", "ds1", "收入确认", client=_client(handler))
    assert chunks == [
        {"content": "片段", "docId": "d1", "docName": "准则.md", "score": 0.9}
    ]


def test_dify_truncates_query_to_250():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["q"] = json.loads(request.content)["query"]
        return httpx.Response(200, json={"records": []})

    dify.retrieve("http://kb", "k", "ds1", "x" * 300, client=_client(handler))
    assert len(seen["q"]) == 250


def test_ragflow_list_and_retrieve():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/datasets":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": [{"id": "ds1", "name": "法规", "document_count": 2}],
                },
            )
        body = json.loads(request.content)
        assert body["question"] == "收入确认"
        assert body["dataset_ids"] == ["ds1"]
        assert body["top_k"] == 4
        assert body["similarity_threshold"] == 0.2
        # 不能发送 keyword：keyword=true 会让 RAGFlow 加载租户默认对话模型做 LLM 关键词抽取。
        assert "keyword" not in body
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "chunks": [
                        {
                            "content": "片段",
                            "document_id": "d1",
                            "document_keyword": "法.md",
                            "similarity": 0.8,
                        }
                    ]
                },
            },
        )

    kb = ragflow.list_knowledge("http://kb", "k", client=_client(handler))
    assert kb == [{"id": "ds1", "name": "法规", "documentCount": 2}]

    chunks = ragflow.retrieve(
        "http://kb",
        "k",
        "ds1",
        "收入确认",
        top_k=4,
        score_threshold=0.2,
        client=_client(handler),
    )
    assert chunks == [
        {"content": "片段", "docId": "d1", "docName": "法.md", "score": 0.8}
    ]


def test_ragflow_retrieve_omits_unset_params():
    """未显式配置 top_k/similarity_threshold 时不应下发，交给 RAGFlow 服务端默认。"""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"code": 0, "data": {"chunks": []}})

    ragflow.retrieve("http://kb", "k", "ds1", "q", client=_client(handler))
    assert "top_k" not in seen
    assert "similarity_threshold" not in seen
    assert "keyword" not in seen


def test_ragflow_surfaces_nonzero_code():
    """RAGFlow 以 HTTP 200 + 非 0 code 报错时，必须抛出而非静默返回空。"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"code": 102, "message": "`dataset_ids` is required."}
        )

    with pytest.raises(RuntimeError, match="RAGFlow error 102"):
        ragflow.list_knowledge("http://kb", "k", client=_client(handler))

    with pytest.raises(RuntimeError, match="RAGFlow error 102"):
        ragflow.retrieve("http://kb", "k", "ds1", "q", client=_client(handler))
