"""项目归档：初始化、归档提交、远程推送与还原。"""

from __future__ import annotations

from pathlib import Path

import pytest
from dulwich import porcelain

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.archive import (
    archive_changes,
    archive_status,
    commit_archive,
    init_repo,
    list_archives,
    push_archive,
    restore_archive,
    set_remote,
)

AUTHOR = {"name": "张审计", "email": "a@b.c"}


def _project(tmp_path: Path) -> Path:
    fe = tmp_path / ".fireeye"
    (fe / "artifacts").mkdir(parents=True)
    (fe / "staging" / "x").mkdir(parents=True)
    (fe / "project.json").write_text('{"name":"P","counters":{}}', "utf-8")
    (fe / "findings.jsonl").write_text(
        '{"event":"created","id":"F-0001","seq":1}\n', "utf-8"
    )
    (fe / "workspace.duckdb").write_bytes(b"duck")
    (fe / ".lock").write_text("{}", "utf-8")
    (fe / "staging" / "x" / "tmp.docx").write_bytes(b"tmp")
    (tmp_path / "证据").mkdir()
    (tmp_path / "证据" / "回单.pdf").write_bytes(b"pdf")
    return tmp_path


def test_init_and_commit(tmp_path):
    root = _project(tmp_path)
    init_repo(root)
    result = commit_archive(root, message="首次归档", author=AUTHOR)
    assert result["id"] == "A-0001"
    assert result["tag"] == "archive/A-0001"
    assert len(result["commit"]) == 40

    status = archive_status(root)
    assert status["initialized"] is True
    assert status["branch"] == "main"
    assert status["dirty"] is False
    assert status["lastArchive"] == "A-0001"
    assert status["changed"] == []

    repo = porcelain.open_repo(root)
    try:
        index = repo.open_index()
    finally:
        repo.close()
    paths = {p.decode() for p in index}
    assert ".fireeye/workspace.duckdb" not in paths
    assert ".fireeye/.lock" not in paths
    assert ".fireeye/staging/x/tmp.docx" not in paths
    assert ".fireeye/findings.jsonl" in paths
    assert "证据/回单.pdf" in paths
    assert ".fireeye/archives/A-0001.json" in paths


def test_commit_requires_changes(tmp_path):
    root = _project(tmp_path)
    init_repo(root)
    commit_archive(root, author=AUTHOR)
    with pytest.raises(ApiError) as exc:
        commit_archive(root, author=AUTHOR)
    assert exc.value.code == "E_NOTHING_TO_ARCHIVE"


def test_history_and_changes(tmp_path):
    root = _project(tmp_path)
    init_repo(root)
    commit_archive(root, author=AUTHOR)
    (root / "证据" / "第二份.pdf").write_bytes(b"pdf2")
    commit_archive(root, author=AUTHOR)

    items = list_archives(root)
    assert [i["id"] for i in items] == ["A-0002", "A-0001"]
    assert items[0]["manifest"]["counts"]["findings"] == 1
    assert items[0]["author"]["name"] == "张审计"
    assert items[0]["pushed"] is False

    changes = archive_changes(root, "A-0002")
    assert {"path": "证据/第二份.pdf", "status": "added"} in changes


def test_deleted_file_is_recorded(tmp_path):
    root = _project(tmp_path)
    init_repo(root)
    commit_archive(root, author=AUTHOR)
    (root / "证据" / "回单.pdf").unlink()
    commit_archive(root, author=AUTHOR)
    changes = archive_changes(root, "A-0002")
    assert {"path": "证据/回单.pdf", "status": "deleted"} in changes


def test_push_to_bare_remote(tmp_path):
    root = _project(tmp_path / "project")
    remote = tmp_path / "remote.git"
    porcelain.init(str(remote), bare=True)

    init_repo(root)
    result = commit_archive(root, author=AUTHOR)
    set_remote(root, url=str(remote), username="", cred_ref=None, auto_push=False)
    pushed = push_archive(root, archive_id=result["id"])
    assert pushed["ok"] is True
    assert (remote / "refs" / "tags" / "archive" / "A-0001").is_file()
    assert (remote / "refs" / "heads" / "main").is_file()
    assert list_archives(root)[0]["pushed"] is True


def test_push_without_remote(tmp_path):
    root = _project(tmp_path)
    init_repo(root)
    commit_archive(root, author=AUTHOR)
    with pytest.raises(ApiError) as exc:
        push_archive(root, archive_id="A-0001")
    assert exc.value.code == "E_NO_REMOTE"


def test_restore_archive(tmp_path):
    root = _project(tmp_path / "project")
    init_repo(root)
    result = commit_archive(root, author=AUTHOR)

    target = tmp_path / "restored"
    restored = restore_archive(root, archive_id=result["id"], target=target)
    assert restored["target"] == str(target)
    assert (target / ".fireeye" / "project.json").is_file()
    assert (target / "证据" / "回单.pdf").is_file()
    # 排除项不随归档还原
    assert not (target / ".fireeye" / "workspace.duckdb").exists()
    assert not (target / ".fireeye" / "staging").exists()


def test_restore_unknown_archive(tmp_path):
    root = _project(tmp_path / "project")
    init_repo(root)
    commit_archive(root, author=AUTHOR)
    with pytest.raises(ApiError) as exc:
        restore_archive(root, archive_id="A-9999", target=tmp_path / "x")
    assert exc.value.code == "E_NOT_FOUND"


def test_restore_rejects_non_empty_target(tmp_path):
    root = _project(tmp_path / "project")
    init_repo(root)
    result = commit_archive(root, author=AUTHOR)
    target = tmp_path / "busy"
    target.mkdir()
    (target / "x.txt").write_text("x", "utf-8")
    with pytest.raises(ApiError) as exc:
        restore_archive(root, archive_id=result["id"], target=target)
    assert exc.value.code == "E_TARGET_NOT_EMPTY"


def test_gitignore_keeps_user_entries(tmp_path):
    root = _project(tmp_path)
    (root / ".gitignore").write_text("node_modules\n", "utf-8")
    init_repo(root)
    text = (root / ".gitignore").read_text("utf-8")
    assert "node_modules" in text
    assert ".fireeye/workspace.duckdb" in text
def test_exclusions_hold_even_without_gitignore(tmp_path):
    """用户删掉 .gitignore 后，排除项仍不能进入历史。"""
    root = _project(tmp_path)
    init_repo(root)
    (root / ".gitignore").unlink()
    commit_archive(root, author=AUTHOR)

    repo = porcelain.open_repo(root)
    try:
        paths = {p.decode() for p in repo.open_index()}
    finally:
        repo.close()
    assert ".fireeye/workspace.duckdb" not in paths
    assert ".fireeye/.lock" not in paths
    assert not any(p.startswith(".fireeye/staging/") for p in paths)
    # .gitignore 被自动补回
    assert ".fireeye/workspace.duckdb" in (root / ".gitignore").read_text("utf-8")


def test_push_reports_skipped_tag_conflicts(tmp_path):
    """两边各自归档出同号标签后，推送全部不应整体失败。"""
    root = _project(tmp_path / "project")
    remote = tmp_path / "remote.git"
    porcelain.init(str(remote), bare=True)
    init_repo(root)
    first = commit_archive(root, author=AUTHOR)
    set_remote(root, url=str(remote))
    push_archive(root, archive_id=first["id"])

    (root / "证据" / "b.txt").write_text("b", "utf-8")
    second = commit_archive(root, author=AUTHOR)
    push_archive(root, archive_id=second["id"])
    # 远端已存在 A-0001/A-0002；本地再归档出 A-0003 后推送全部
    (root / "证据" / "c.txt").write_text("c", "utf-8")
    third = commit_archive(root, author=AUTHOR)

    result = push_archive(root, archive_id=None)
    assert result["ok"] is True
    assert third["id"] in result["pushed"]
    assert (remote / "refs" / "tags" / "archive" / third["id"]).is_file()
