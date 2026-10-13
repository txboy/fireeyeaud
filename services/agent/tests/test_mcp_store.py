from fireeyeaud_agent.store import mcp


def test_mcp_crud(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"

    item = mcp.create_server(
        {
            "name": "filesystem",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
            "env": {"LOG_LEVEL": "info"},
            "apiKeyRef": "sec_1",
            "apiKeyEnv": "FS_API_KEY",
            "enabled": True,
            "scope": "project",
            "permissions": {"net": False, "toolsAllow": ["read_file"]},
        },
        root=root,
    )
    assert item["id"] == "mcp_1"
    assert item["permissions"]["toolsAllow"] == ["read_file"]
    assert item["permissions"]["fsScope"] == "workspace"
    assert item["permissions"]["net"] is False
    assert item["env"] == {"LOG_LEVEL": "info"}
    assert item["apiKeyRef"] == "sec_1"
    assert item["apiKeyEnv"] == "FS_API_KEY"

    assert [s["id"] for s in mcp.list_servers(root)] == ["mcp_1"]
    mcp.update_server(
        "mcp_1", "project", {"enabled": False, "apiKeyEnv": "OTHER_KEY"}, root
    )
    updated = mcp.get_server("mcp_1", "project", root)
    assert updated["enabled"] is False
    assert updated["apiKeyEnv"] == "OTHER_KEY"
    mcp.delete_server("mcp_1", "project", root)
    assert mcp.list_servers(root) == []


def test_mcp_rejects_bad_transport(tmp_path, monkeypatch):
    import pytest

    from fireeyeaud_agent.errors import ApiError

    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    with pytest.raises(ApiError) as ei:
        mcp.create_server(
            {"name": "x", "transport": "grpc", "scope": "project"}, root=tmp_path / "ws"
        )
    assert ei.value.code == "E_MCP_TRANSPORT"
