import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.tools.list_files import list_files


def _seed(tmp_path):
    (tmp_path / "数据").mkdir()
    (tmp_path / "数据" / "序时账.xlsx").write_text("x", encoding="utf-8")
    (tmp_path / "数据" / "子目录").mkdir()
    (tmp_path / "数据" / "子目录" / "deep.txt").write_text("d", encoding="utf-8")
    (tmp_path / "说明.md").write_text("hi", encoding="utf-8")
    (tmp_path / ".fireeye").mkdir()
    (tmp_path / ".fireeye" / "project.json").write_text("{}", encoding="utf-8")


def test_list_default_depth(tmp_path):
    _seed(tmp_path)
    out = list_files(tmp_path, {})
    paths = {e["path"] for e in out["entries"]}
    # 默认 depth=2：根的直接子项 + 下一层，但不含「数据/子目录」的更下一层。
    assert paths == {"数据", "数据/序时账.xlsx", "数据/子目录", "说明.md"}
    assert out["truncated"] is False
    types = {e["path"]: e["type"] for e in out["entries"]}
    assert types["数据"] == "dir"
    assert types["说明.md"] == "file"


def test_list_excludes_fireeye(tmp_path):
    _seed(tmp_path)
    out = list_files(tmp_path, {"depth": 5})
    assert not any(".fireeye" in e["path"] for e in out["entries"])


def test_list_depth_one(tmp_path):
    _seed(tmp_path)
    out = list_files(tmp_path, {"depth": 1})
    assert {e["path"] for e in out["entries"]} == {"数据", "说明.md"}


def test_list_subdir(tmp_path):
    _seed(tmp_path)
    out = list_files(tmp_path, {"path": "数据"})
    assert {e["path"] for e in out["entries"]} == {
        "数据/序时账.xlsx",
        "数据/子目录",
        "数据/子目录/deep.txt",
    }
    assert out["path"] == "数据"


def test_list_limit_truncates(tmp_path):
    _seed(tmp_path)
    out = list_files(tmp_path, {"depth": 5, "limit": 1})
    assert len(out["entries"]) == 1
    assert out["truncated"] is True


def test_list_missing_dir(tmp_path):
    with pytest.raises(ApiError) as exc:
        list_files(tmp_path, {"path": "不存在"})
    assert exc.value.code == "E_FILE_NOT_FOUND"
