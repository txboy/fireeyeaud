import json

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.tools.base import dump_artifact
from fireeyeaud_agent.tools.read_artifact import read_artifact


def _seed(tmp_path):
    ref = dump_artifact(
        tmp_path,
        "query_test",
        {"columns": ["a"], "rows": [[str(i)] for i in range(30)], "sql": "select 1"},
    )
    return ref


def test_read_artifact_pages_rows(tmp_path):
    ref = _seed(tmp_path)
    out = read_artifact(tmp_path, {"artifactRef": ref, "offset": 10, "limit": 5})
    assert out["columns"] == ["a"]
    assert out["rows"] == [["10"], ["11"], ["12"], ["13"], ["14"]]
    assert out["totalRows"] == 30
    assert out["hasMore"] is True


def test_read_artifact_rejects_escape(tmp_path):
    with pytest.raises(ApiError) as exc:
        read_artifact(tmp_path, {"artifactRef": "../project.json"})
    assert exc.value.code == "E_ARTIFACT_INVALID"


def test_read_artifact_missing(tmp_path):
    with pytest.raises(ApiError) as exc:
        read_artifact(tmp_path, {"artifactRef": "artifacts/nope.json"})
    assert exc.value.code == "E_ARTIFACT_NOT_FOUND"


def test_read_artifact_returns_non_row_payload(tmp_path):
    ref = dump_artifact(tmp_path, "snapshot", {"columns": ["a"], "text": "hello"})
    out = read_artifact(tmp_path, {"artifactRef": ref})
    assert out["payload"]["text"] == "hello"
    assert "rows" not in out
