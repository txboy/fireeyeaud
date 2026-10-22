"""归档分叉检测与文件级冲突解决。"""

from __future__ import annotations

from pathlib import Path

import pytest
from dulwich import porcelain

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.archive import (
    clone_from_remote,
    commit_archive,
    init_repo,
    push_archive,
    set_remote,
)
from fireeyeaud_agent.store.archive_conflict import check_conflict, resolve_conflict

A = {"name": "A", "email": "a@b.c"}
B = {"name": "B", "email": "b@b.c"}


def _project(path: Path) -> Path:
    fe = path / ".fireeye"
    (fe / "artifacts").mkdir(parents=True)
    (fe / "project.json").write_text('{"name":"P","counters":{}}', "utf-8")
    (fe / "findings.jsonl").write_text("", "utf-8")
    (path / "证据").mkdir()
    return path


def _setup_remote(tmp_path: Path) -> tuple[Path, Path]:
    remote = tmp_path / "remote.git"
    porcelain.init(str(remote), bare=True)
    a = _project(tmp_path / "a")
    init_repo(a)
    base = commit_archive(a, author=A)
    set_remote(a, url=str(remote))
    push_archive(a, archive_id=base["id"])
    return a, remote


def test_clone_from_remote(tmp_path):
    a, remote = _setup_remote(tmp_path)
    (a / "证据" / "文件.txt").write_text("x", "utf-8")
    commit_archive(a, author=A)
    push_archive(a, archive_id=None)

    target = tmp_path / "cloned"
    result = clone_from_remote(url=str(remote), target=target)
    assert result["target"] == str(target)
    assert (target / ".fireeye" / "project.json").is_file()
    assert (target / "证据" / "文件.txt").is_file()
    assert (target / ".fireeye" / "config" / "archive.json").is_file()


def test_clone_rejects_non_empty_target(tmp_path):
    _a, remote = _setup_remote(tmp_path)
    target = tmp_path / "busy"
    target.mkdir()
    (target / "x").write_text("x", "utf-8")
    with pytest.raises(ApiError) as exc:
        clone_from_remote(url=str(remote), target=target)
    assert exc.value.code == "E_TARGET_NOT_EMPTY"


def test_conflict_check_and_resolve_remote(tmp_path):
    a, remote = _setup_remote(tmp_path)
    (a / "证据" / "共同.txt").write_text("base", "utf-8")
    commit_archive(a, author=A)
    push_archive(a, archive_id=None)

    b = tmp_path / "b"
    clone_from_remote(url=str(remote), target=b)

    # B 改并推送
    (b / "证据" / "共同.txt").write_text("remote", "utf-8")
    (b / "证据" / "远程.txt").write_text("r", "utf-8")
    commit_archive(b, author=B)
    push_archive(b, archive_id=None)

    # A 改本地（同一文件）
    (a / "证据" / "共同.txt").write_text("local", "utf-8")
    (a / "证据" / "本地.txt").write_text("l", "utf-8")
    commit_archive(a, author=A)

    check = check_conflict(a, password=None)
    assert check["diverged"] is True
    assert check["behind"] is False
    paths = {f["path"] for f in check["conflicts"]}
    assert "证据/共同.txt" in paths
    assert "证据/远程.txt" in check["remoteOnly"]
    assert "证据/本地.txt" in check["localOnly"]

    result = resolve_conflict(
        a,
        base="local",
        choices={"证据/共同.txt": "remote"},
        message="合并远程",
        author=A,
        password=None,
    )
    assert result["id"].startswith("A-")
    assert (a / "证据" / "共同.txt").read_text("utf-8") == "remote"
    # 双方的独占文件都在
    assert (a / "证据" / "远程.txt").is_file()
    assert (a / "证据" / "本地.txt").is_file()

    repo = porcelain.open_repo(a)
    try:
        commit = repo[result["commit"].encode()]
        assert len(commit.parents) == 2
        manifest = repo.get_object(commit.tree)
        assert manifest is not None
    finally:
        repo.close()

    # 解决后工作区干净，且已不再分叉
    after = check_conflict(a, password=None)
    assert after["diverged"] is False


def test_conflict_both_keeps_two_files(tmp_path):
    a, remote = _setup_remote(tmp_path)
    (a / "证据" / "共同.txt").write_text("base", "utf-8")
    commit_archive(a, author=A)
    push_archive(a, archive_id=None)

    b = tmp_path / "b"
    clone_from_remote(url=str(remote), target=b)
    (b / "证据" / "共同.txt").write_text("remote", "utf-8")
    commit_archive(b, author=B)
    push_archive(b, archive_id=None)

    (a / "证据" / "共同.txt").write_text("local", "utf-8")
    commit_archive(a, author=A)

    resolve_conflict(
        a,
        base="local",
        choices={"证据/共同.txt": "both"},
        message="两份都留",
        author=A,
    )
    assert (a / "证据" / "共同.txt").read_text("utf-8") == "local"
    assert (a / "证据" / "共同_远程.txt").read_text("utf-8") == "remote"


def test_findings_can_auto_merge(tmp_path):
    a, remote = _setup_remote(tmp_path)
    base_text = '{"event":"created","id":"F-0001","seq":1}\n'
    (a / ".fireeye" / "findings.jsonl").write_text(base_text, "utf-8")
    commit_archive(a, author=A)
    push_archive(a, archive_id=None)

    b = tmp_path / "b"
    clone_from_remote(url=str(remote), target=b)
    # B 追加一条远端疑点
    with (b / ".fireeye" / "findings.jsonl").open("a", encoding="utf-8") as handle:
        handle.write('{"event":"created","id":"F-0002","seq":2}\n')
    commit_archive(b, author=B)
    push_archive(b, archive_id=None)

    # A 追加另一条本地疑点
    with (a / ".fireeye" / "findings.jsonl").open("a", encoding="utf-8") as handle:
        handle.write('{"event":"created","id":"F-0003","seq":2}\n')
    commit_archive(a, author=A)

    check = check_conflict(a)
    assert any(
        f["path"] == ".fireeye/findings.jsonl" and f["autoMerge"] is True
        for f in check["conflicts"]
    )

    resolve_conflict(
        a,
        base="local",
        choices={".fireeye/findings.jsonl": "auto"},
        message="自动合并疑点",
        author=A,
    )
    lines = [
        line
        for line in (a / ".fireeye" / "findings.jsonl").read_text("utf-8").splitlines()
        if line.strip()
    ]
    ids = {__import__("json").loads(line)["id"] for line in lines}
    assert ids == {"F-0001", "F-0002", "F-0003"}
    seqs = [__import__("json").loads(line)["seq"] for line in lines]
    assert seqs == list(range(1, len(lines) + 1))


def test_evidence_is_never_auto_mergeable(tmp_path):
    a, remote = _setup_remote(tmp_path)
    ev = '{"seq":1,"id":"ev_1","hash":"x"}\n'
    (a / ".fireeye" / "evidence.jsonl").write_text(ev, "utf-8")
    commit_archive(a, author=A)
    push_archive(a, archive_id=None)

    b = tmp_path / "b"
    clone_from_remote(url=str(remote), target=b)
    (b / ".fireeye" / "evidence.jsonl").write_text(
        ev + '{"seq":2,"id":"ev_2","hash":"y"}\n', "utf-8"
    )
    commit_archive(b, author=B)
    push_archive(b, archive_id=None)

    (a / ".fireeye" / "evidence.jsonl").write_text(
        ev + '{"seq":2,"id":"ev_3","hash":"z"}\n', "utf-8"
    )
    commit_archive(a, author=A)

    check = check_conflict(a)
    conflict = next(f for f in check["conflicts"] if f["path"] == ".fireeye/evidence.jsonl")
    assert conflict["autoMerge"] is False
    assert conflict["hint"]

    with pytest.raises(ApiError) as exc:
        resolve_conflict(
            a,
            base="local",
            choices={".fireeye/evidence.jsonl": "auto"},
            message="不应允许",
            author=A,
        )
    assert exc.value.code == "E_MERGE_CONFLICT"


def test_resolve_requires_divergence_and_clean_tree(tmp_path):
    a, remote = _setup_remote(tmp_path)
    with pytest.raises(ApiError) as exc:
        resolve_conflict(a, base="local", choices={}, message="x", author=A)
    assert exc.value.code == "E_NOT_DIVERGED"

    # 制造分叉后再弄脏工作区
    b = tmp_path / "b"
    clone_from_remote(url=str(remote), target=b)
    (b / "证据").mkdir(parents=True, exist_ok=True)
    (b / "证据" / "远程.txt").write_text("r", "utf-8")
    commit_archive(b, author=B)
    push_archive(b, archive_id=None)
    (a / "证据" / "本地.txt").write_text("l", "utf-8")
    commit_archive(a, author=A)
    (a / "dirty.txt").write_text("dirty", "utf-8")

    with pytest.raises(ApiError) as dirty:
        resolve_conflict(a, base="local", choices={}, message="x", author=A)
    assert dirty.value.code == "E_DIRTY_WORKTREE"

def test_credentials_are_quoted_and_not_persisted(tmp_path):
    from fireeyeaud_agent.store.archive import _with_credentials

    url = "https://example.com/audit/project.git"
    auth = _with_credentials(url, "user", "pa/ss:word")
    from urllib.parse import unquote, urlsplit

    parts = urlsplit(auth)
    assert parts.username == "user"
    assert unquote(parts.password or "") == "pa/ss:word"
    assert parts.hostname == "example.com"

    # clone 后 .git/config 里的 origin 必须是干净 URL（不含凭据）
    remote = tmp_path / "remote.git"
    porcelain.init(str(remote), bare=True)
    root = _project(tmp_path / "project")
    init_repo(root)
    commit_archive(root, author=A)
    set_remote(root, url=str(remote))
    push_archive(root, archive_id=None)

    target = tmp_path / "cloned"
    clone_from_remote(url=str(remote), target=target, username="u", password="secret-token")
    config_text = (target / ".git" / "config").read_text("utf-8")
    assert "secret-token" not in config_text
    url_line = next(
        line for line in config_text.splitlines() if line.strip().startswith("url =")
    )
    assert "secret-token" not in url_line
    assert "@" not in url_line
    assert "remote.git" in url_line.replace("\\", "/")


def test_push_all_after_merge_skips_colliding_tag(tmp_path):
    a, remote = _setup_remote(tmp_path)
    (a / "证据" / "共同.txt").write_text("base", "utf-8")
    commit_archive(a, author=A)
    push_archive(a, archive_id=None)

    b = tmp_path / "b"
    clone_from_remote(url=str(remote), target=b)
    (b / "证据" / "共同.txt").write_text("remote", "utf-8")
    commit_archive(b, author=B)
    push_archive(b, archive_id=None)

    (a / "证据" / "共同.txt").write_text("local", "utf-8")
    commit_archive(a, author=A)

    merged = resolve_conflict(
        a,
        base="local",
        choices={"证据/共同.txt": "remote"},
        message="合并",
        author=A,
    )
    result = push_archive(a, archive_id=None)
    assert result["ok"] is True
    assert merged["id"] in result["pushed"]
    # 同号标签冲突被跳过而不是让整体失败
    assert any(name != merged["id"] for name in result["skipped"])
    # 保护标签永不推送
    assert list((remote / "refs" / "tags" / "archive").glob("local-*")) == []
