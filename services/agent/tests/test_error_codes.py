"""错误码语义化：这些错误此前一律用 error.internal，用户看到「发生内部错误」无法判断原因。"""

from pathlib import Path

import httpx
import pytest

from fireeyeaud_agent import config
from fireeyeaud_agent.agent import form_agent, report_agent
from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.main import app
from fireeyeaud_agent.store import archive_conflict, evidence, findings


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def _error_code(exc: BaseException) -> str:
    assert isinstance(exc, ApiError)
    return exc.envelope["error"]["messageKey"]


async def test_report_and_form_chat_reject_empty_message(tmp_path) -> None:
    root = tmp_path / "ws"
    root.mkdir()

    events = [event async for event in report_agent.stream_report_chat(root, "RPT-1", "  ")]
    assert events == [
        {
            "event": "error",
            "data": {"code": "E_EMPTY_MESSAGE", "messageKey": "error.emptyMessage"},
        }
    ]

    events = [event async for event in form_agent.stream_form_chat(root, "QZ-0001", "")]
    assert events == [
        {
            "event": "error",
            "data": {"code": "E_EMPTY_MESSAGE", "messageKey": "error.emptyMessage"},
        }
    ]


def test_config_store_rejects_invalid_scope() -> None:
    with pytest.raises(ApiError) as excinfo:
        config.store.create_item("models", {"name": "x", "scope": "weird"})
    assert _error_code(excinfo.value) == "error.invalidScope"


def test_archive_conflict_uses_specific_codes(tmp_path) -> None:
    with pytest.raises(ApiError) as excinfo:
        archive_conflict.resolve_conflict(
            tmp_path, base="nope", choices={}, message="merge"
        )
    assert _error_code(excinfo.value) == "error.invalidBase"


def test_evidence_kind_is_not_reported_as_internal(tmp_path) -> None:
    with pytest.raises(ApiError) as excinfo:
        evidence.append_manual_evidence(
            tmp_path, finding_id="F-0001", kind="weird", title="x"
        )
    # 疑点不存在时先报 notFound；只验证不会落到 error.internal。
    assert _error_code(excinfo.value) in {"error.notFound", "error.invalidEvidenceKind"}


def test_findings_review_invalid_action(tmp_path) -> None:
    """review_finding 在疑点不存在时返回 None，只有动作非法才抛错。"""
    created = findings.create_finding(
        tmp_path,
        title="疑点",
        description="",
        severity="high",
        dataRefs=[],
        sessionId="",
    )
    assert created is not None
    with pytest.raises(ApiError) as excinfo:
        findings.review_finding(
            tmp_path, created["id"], action="nonsense", reviewer="审计员"
        )
    assert _error_code(excinfo.value) == "error.invalidAction"


async def test_kb_query_requires_text(tmp_path) -> None:
    async with _client() as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path)})
        try:
            created = await client.post(
                "/api/v1/kb/providers",
                json={
                    "type": "dify",
                    "name": "库",
                    "baseUrl": "http://x",
                    "scope": "project",
                },
            )
            assert created.status_code == 200
            provider_id = created.json()["id"]
            resp = await client.post(
                f"/api/v1/kb/providers/{provider_id}/query",
                json={"query": "   ", "scope": "project"},
            )
            assert resp.status_code == 400
            assert resp.json()["error"]["messageKey"] == "error.emptyQuery"
        finally:
            await client.post("/api/v1/workspaces/close")


def test_no_backend_module_still_uses_error_internal() -> None:
    """回归：用户可见的失败不应再统一落到「发生内部错误」。"""
    src = Path(__file__).resolve().parents[1] / "src"
    offenders = []
    for path in src.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if '"error.internal"' in text:
            offenders.append(path.name)
    assert offenders == []