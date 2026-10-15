import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.tools.search_files import search_files


def _seed(tmp_path):
    (tmp_path / "数据").mkdir()
    (tmp_path / "数据" / "序时账.xlsx").write_text("x", encoding="utf-8")
    (tmp_path / "数据" / "备注.txt").write_text("hello world\nHELLO again\n", encoding="utf-8")
    (tmp_path / "说明.md").write_text("Hello 底稿\n", encoding="utf-8")
    (tmp_path / ".fireeye").mkdir()
    (tmp_path / ".fireeye" / "project.json").write_text("hello", encoding="utf-8")


def test_glob_matches_files(tmp_path):
    _seed(tmp_path)
    out = search_files(tmp_path, {"glob": "**/*.xlsx"})
    assert [m["path"] for m in out["matches"]] == ["数据/序时账.xlsx"]


def test_glob_excludes_fireeye(tmp_path):
    _seed(tmp_path)
    out = search_files(tmp_path, {"glob": "**/*.json"})
    assert out["matches"] == []


def test_content_search_is_case_insensitive(tmp_path):
    _seed(tmp_path)
    out = search_files(tmp_path, {"query": "hello"})
    found = {(m["path"], m["line"]) for m in out["matches"]}
    assert found == {("数据/备注.txt", 1), ("数据/备注.txt", 2), ("说明.md", 1)}
    hit = next(m for m in out["matches"] if m["path"] == "说明.md")
    assert hit["text"] == "Hello 底稿"
    assert hit["column"] == 1


def test_content_search_case_sensitive(tmp_path):
    _seed(tmp_path)
    out = search_files(tmp_path, {"query": "HELLO", "caseSensitive": True})
    assert {(m["path"], m["line"]) for m in out["matches"]} == {
        ("数据/备注.txt", 2)
    }


def test_search_limit_truncates(tmp_path):
    _seed(tmp_path)
    out = search_files(tmp_path, {"query": "hello", "limit": 1})
    assert len(out["matches"]) == 1
    assert out["truncated"] is True


def test_search_requires_glob_or_query(tmp_path):
    _seed(tmp_path)
    with pytest.raises(ApiError) as exc:
        search_files(tmp_path, {})
    assert exc.value.code == "E_SEARCH_EMPTY"


def test_content_search_skips_binary(tmp_path):
    (tmp_path / "blob.bin").write_bytes(b"hello\x00world")
    out = search_files(tmp_path, {"query": "hello"})
    assert out["matches"] == []
