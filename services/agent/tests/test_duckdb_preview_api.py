"""工作区 DuckDB 的 SQL 预览（文件型数据源）：只读、分页、总数、沙箱与内置连接保护。"""

import httpx
import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.main import app
from fireeyeaud_agent.store import db as db_store
from fireeyeaud_agent.store import db_engine


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def _import_csv(client: httpx.AsyncClient, path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    async with client.stream(
        "POST", "/api/v1/datasources/import", json={"path": str(path)}
    ) as resp:
        assert resp.status_code == 200
        async for _line in resp.aiter_lines():
            pass


async def _query(client: httpx.AsyncClient, sql: str, **extra) -> httpx.Response:
    return await client.post(
        "/api/v1/datasources/workspace-duckdb/query",
        json={"sql": sql, "limit": 2, "offset": 0, "includeTotal": True, **extra},
    )


async def test_duckdb_preview_pages_and_counts(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        try:
            await _import_csv(client, tmp_path / "a.csv", "x,y\n1,2\n3,4\n5,6\n")

            resp = await _query(client, 'SELECT * FROM "src_ds1_a"')
            assert resp.status_code == 200
            body = resp.json()
            assert body["columns"] == ["__row_id", "x", "y"]
            assert body["rows"][0] == ["1", "1", "2"]
            assert body["rowCount"] == 2
            assert body["hasMore"] is True
            assert body["total"] == 3
            assert "LIMIT 3 OFFSET 0" in body["sql"]

            page2 = (await _query(client, 'SELECT * FROM "src_ds1_a"', offset=2)).json()
            assert page2["rows"] == [["3", "5", "6"]]
            assert page2["hasMore"] is False
        finally:
            await client.post("/api/v1/workspaces/close")


async def test_duckdb_preview_blocks_writes(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        try:
            await _import_csv(client, tmp_path / "a.csv", "x\n1\n")
            for sql in (
                'DROP TABLE "src_ds1_a"',
                "DELETE FROM \"src_ds1_a\"",
                'CREATE TABLE evil (x INT)',
            ):
                resp = await _query(client, sql)
                assert resp.status_code == 400, sql
                assert resp.json()["error"]["messageKey"] == "error.sqlRejected"

            # 表还在：写操作确实没被执行。
            ok = await _query(client, 'SELECT COUNT(*) AS n FROM "src_ds1_a"')
            assert ok.json()["rows"] == [[1]]
        finally:
            await client.post("/api/v1/workspaces/close")


async def test_duckdb_preview_rejects_internal_tables(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        try:
            resp = await client.get(
                "/api/v1/datasources/workspace-duckdb/tables/__internal"
            )
            assert resp.status_code == 404
        finally:
            await client.post("/api/v1/workspaces/close")


async def test_duckdb_table_schema_for_preview(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        try:
            await _import_csv(client, tmp_path / "a.csv", "x,y\n1,2\n")
            resp = await client.get(
                "/api/v1/datasources/workspace-duckdb/tables/src_ds1_a"
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["table"] == "src_ds1_a"
            assert [c["name"] for c in body["columns"]] == ["__row_id", "x", "y"]
            assert all(c["primaryKey"] is False for c in body["columns"])

            missing = await client.get(
                "/api/v1/datasources/workspace-duckdb/tables/src_nope"
            )
            assert missing.status_code == 404
        finally:
            await client.post("/api/v1/workspaces/close")


async def test_builtin_connection_is_read_only_and_hidden(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        try:
            listed = (await client.get("/api/v1/db/connections")).json()["items"]
            assert all(item["id"] != db_store.WORKSPACE_DUCKDB_ID for item in listed)

            deleted = await client.delete(
                f"/api/v1/db/connections/{db_store.WORKSPACE_DUCKDB_ID}"
            )
            assert deleted.status_code == 400
            assert deleted.json()["error"]["code"] == "E_PROTECTED"

            created = await client.post(
                "/api/v1/db/connections",
                json={"name": "x", "driver": "duckdb", "scope": "global"},
            )
            assert created.status_code == 400
        finally:
            await client.post("/api/v1/workspaces/close")


def test_duckdb_connection_points_into_workspace(tmp_path) -> None:
    conn = db_store.workspace_duckdb_connection(tmp_path)
    assert conn["driver"] == "duckdb"
    assert conn["id"] == db_store.WORKSPACE_DUCKDB_ID
    assert conn["path"].endswith("workspace.duckdb")
    assert db_store.is_builtin(conn["id"])


def test_duckdb_dialect_is_postgres_like() -> None:
    assert db_engine.dialect_for({"driver": "duckdb"}) == "postgres"


def test_duckdb_preview_missing_workspace_file_raises(tmp_path) -> None:
    conn = db_store.workspace_duckdb_connection(tmp_path)
    with pytest.raises(ApiError) as excinfo:
        db_engine.duckdb_inspect_table(conn, "src_ds1_a")
    assert excinfo.value.code == "E_DB_CONN"