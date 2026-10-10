import json

import httpx

from fireeyeaud_agent.web import custom, tavily


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_tavily_normalizes():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.tavily.com"
        body = json.loads(request.content)
        assert body["api_key"] == "k"
        assert body["query"] == "收入确认"
        assert body["max_results"] == 3
        return httpx.Response(
            200,
            json={
                "results": [
                    {"title": "T", "url": "http://a", "content": "C", "score": 0.7}
                ]
            },
        )

    out = tavily.search("k", "收入确认", max_results=3, client=_client(handler))
    assert out == [{"title": "T", "url": "http://a", "content": "C", "score": 0.7}]


def test_custom_normalizes():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer k"
        body = json.loads(request.content)
        assert body["query"] == "q"
        assert body["max_results"] == 3
        return httpx.Response(
            200, json={"results": [{"title": "T", "url": "u", "content": "c"}]}
        )

    out = custom.search(
        "http://engine", "k", "q", max_results=3, client=_client(handler)
    )
    assert out[0]["title"] == "T"
    assert out[0]["url"] == "u"
