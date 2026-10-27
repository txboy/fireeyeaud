import os

import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.workspace_files import (
    resolve_in_workspace,
    walk_files,
)


def test_resolve_relative_file(tmp_path):
    target = tmp_path / "数据" / "序时账.xlsx"
    target.parent.mkdir(parents=True)
    target.write_text("x", encoding="utf-8")

    resolved = resolve_in_workspace(tmp_path, "数据/序时账.xlsx")
    assert resolved == target.resolve()


def test_resolve_empty_is_root(tmp_path):
    assert resolve_in_workspace(tmp_path, None) == tmp_path.resolve()
    assert resolve_in_workspace(tmp_path, "") == tmp_path.resolve()


def test_resolve_rejects_parent_escape(tmp_path):
    with pytest.raises(ApiError) as exc:
        resolve_in_workspace(tmp_path, "../secret.txt")
    assert exc.value.code == "E_FILE_OUTSIDE"


def test_resolve_rejects_absolute(tmp_path):
    with pytest.raises(ApiError) as exc:
        resolve_in_workspace(tmp_path, str(tmp_path.parent / "outside.txt"))
    assert exc.value.code == "E_FILE_OUTSIDE"


def test_resolve_rejects_fireeye(tmp_path):
    with pytest.raises(ApiError) as exc:
        resolve_in_workspace(tmp_path, ".fireeye/project.json")
    assert exc.value.code == "E_FILE_FORBIDDEN"


def test_resolve_rejects_nested_fireeye(tmp_path):
    with pytest.raises(ApiError) as exc:
        resolve_in_workspace(tmp_path, "sub/.fireeye/x.json")
    assert exc.value.code == "E_FILE_FORBIDDEN"


def test_resolve_rejects_symlink_escape(tmp_path):
    outside = tmp_path.parent / "outside-target.txt"
    outside.write_text("secret", encoding="utf-8")
    link = tmp_path / "link.txt"
    try:
        os.symlink(outside, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlink not supported")
    with pytest.raises(ApiError) as exc:
        resolve_in_workspace(tmp_path, "link.txt")
    assert exc.value.code == "E_FILE_OUTSIDE"


def test_walk_files_skips_fireeye(tmp_path):
    (tmp_path / "a.txt").write_text("a", encoding="utf-8")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "b.txt").write_text("b", encoding="utf-8")
    (tmp_path / ".fireeye").mkdir()
    (tmp_path / ".fireeye" / "project.json").write_text("{}", encoding="utf-8")

    found = {p.relative_to(tmp_path).as_posix() for p in walk_files(tmp_path)}
    assert found == {"a.txt", "sub/b.txt"}
