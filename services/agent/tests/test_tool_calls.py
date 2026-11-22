from fireeyeaud_agent.agent.tool_calls import call_id, tool_error_payload
from fireeyeaud_agent.errors import ApiError


def test_call_id_prefers_provider_id():
    assert call_id({"id": "call_abc"}, step=2, index=0) == "call_abc"


def test_call_id_falls_back_to_step_and_index():
    assert call_id({}, step=2, index=0) == "call_2_0"
    assert call_id({"id": ""}, step=2, index=1) == "call_2_1"
    assert call_id({"id": None}, step=3, index=2) == "call_3_2"


def test_tool_error_payload_keeps_api_error_code():
    payload = tool_error_payload(
        ApiError("E_FILE_NOT_FOUND", 404, "error.fileNotFound", {"path": "x"}),
        tool="read_file",
    )
    assert payload["ok"] is False
    assert payload["error"]["code"] == "E_FILE_NOT_FOUND"
    assert payload["error"]["params"] == {"path": "x"}
    assert payload["retryable"] is False


def test_tool_error_payload_wraps_unknown_error():
    payload = tool_error_payload(RuntimeError("boom"), tool="sql_query")
    assert payload["ok"] is False
    assert payload["error"]["code"] == "E_TOOL_FAILED"
    assert payload["error"]["params"]["tool"] == "sql_query"
    assert payload["error"]["params"]["reason"] == "boom"
