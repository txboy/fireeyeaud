import httpx

from fireeyeaud_agent.main import app


async def test_kb_providers_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            "/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")}
        )
        res = await client.post(
            "/api/v1/kb/providers",
            json={
                "type": "dify",
                "name": "法规库",
                "baseUrl": "https://api.dify.ai/v1",
                "apiKeyRef": "sec_kb",
                "scope": "project",
            },
        )
        assert res.status_code == 200
        provider = res.json()
        assert provider["id"] == "kb_1"
        assert provider["apiKeyRef"] == "sec_kb"
        assert "apiKey" not in provider

        listed = (await client.get("/api/v1/kb/providers")).json()["items"]
        assert [p["id"] for p in listed] == ["kb_1"]

        await client.delete("/api/v1/kb/providers/kb_1?scope=project")
        await client.post("/api/v1/workspaces/close")


async def test_kb_knowledge_listing_uses_adapter(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)

    from fireeyeaud_agent import kb
    from fireeyeaud_agent.store import knowledge

    provider = knowledge.create_provider(
        {"type": "ragflow", "name": "内部", "baseUrl": "http://kb", "scope": "project"},
        api_key="k",
        root=root,
    )

    class _Adapter:
        @staticmethod
        def list_knowledge(base_url, key, **kwargs):
            return [{"id": "d1", "name": "库", "documentCount": 1}]

    monkeypatch.setattr(kb, "adapter_for", lambda _t: _Adapter)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        res = await client.get(
            f"/api/v1/kb/providers/{provider['id']}/knowledge?scope=project"
        )
        assert res.json()["items"] == [{"id": "d1", "name": "库", "documentCount": 1}]
        test_res = await client.post(
            f"/api/v1/kb/providers/{provider['id']}/test?scope=project"
        )
        assert test_res.json() == {"ok": True, "knowledgeCount": 1}
        await client.post("/api/v1/workspaces/close")


async def test_kb_providers_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/kb/providers")).json()["items"] == []


async def test_kb_test_params(monkeypatch):
    from fireeyeaud_agent import kb

    class _Adapter:
        @staticmethod
        def list_knowledge(base_url, key, **kwargs):
            return [{"id": "d1"}]

    monkeypatch.setattr(kb, "adapter_for", lambda _t: _Adapter)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.post(
            "/api/v1/kb/test",
            json={"type": "dify", "baseUrl": "http://kb", "apiKey": "k"},
        )
        assert res.json() == {"ok": True, "knowledgeCount": 1}


async def test_kb_query_uses_adapter(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)

    from fireeyeaud_agent import kb
    from fireeyeaud_agent.store import knowledge

    provider = knowledge.create_provider(
        {"type": "dify", "name": "法规", "baseUrl": "http://kb", "scope": "project"},
        api_key="k",
        root=root,
    )

    calls: dict[str, str] = {}

    class _Adapter:
        @staticmethod
        def retrieve(base_url, key, knowledge_id, query, **kwargs):
            calls["knowledgeId"] = knowledge_id
            calls["query"] = query
            return [
                {"content": "命中内容", "docId": "d1", "docName": "doc", "score": 0.9}
            ]

    monkeypatch.setattr(kb, "adapter_for", lambda _t: _Adapter)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        res = await client.post(
            f"/api/v1/kb/providers/{provider['id']}/query",
            json={"query": "收入确认", "scope": "project", "knowledgeIds": ["k1"]},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is True
        assert body["knowledgeCount"] == 1
        assert isinstance(body["elapsedMs"], int)
        assert body["hits"][0]["content"] == "命中内容"
        assert calls == {"knowledgeId": "k1", "query": "收入确认"}
        await client.post("/api/v1/workspaces/close")


async def test_kb_query_surfaces_http_error_reason(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)

    from fireeyeaud_agent import kb
    from fireeyeaud_agent.store import knowledge

    provider = knowledge.create_provider(
        {"type": "dify", "name": "法规", "baseUrl": "http://kb", "scope": "project"},
        api_key="k",
        root=root,
    )

    request = httpx.Request("POST", "http://kb/datasets/k1/retrieve")
    response = httpx.Response(400, text="reranking model is required", request=request)

    class _Adapter:
        @staticmethod
        def retrieve(*args, **kwargs):
            raise httpx.HTTPStatusError("bad request", request=request, response=response)

    monkeypatch.setattr(kb, "adapter_for", lambda _t: _Adapter)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(root)})
        res = await client.post(
            f"/api/v1/kb/providers/{provider['id']}/query",
            json={"query": "x", "scope": "project", "knowledgeIds": ["k1"]},
        )
        await client.post("/api/v1/workspaces/close")

    assert res.status_code == 502
    payload = res.json()
    assert payload["error"]["messageKey"] == "error.kbConn"
    assert "reranking model is required" in payload["error"]["params"]["reason"]
