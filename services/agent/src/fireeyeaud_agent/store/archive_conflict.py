"""分叉检测与文件级冲突解决（不自动合并证据链）。"""

from __future__ import annotations

import io
import json
import shutil
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dulwich import porcelain
from dulwich.objects import Commit

from ..errors import ApiError
from ..util import now_iso
from . import archive, secrets
from .fsutil import write_json_atomic
from .lock import WORKSPACE_MUTATION_LOCK

REMOTE_REF = b"refs/remotes/origin/main"
REMOTE_BRANCH = b"refs/heads/main"
MERGEABLE = ".fireeye/findings.jsonl"
NO_AUTO_HINT = "证据链不能自动合并，请整份选择本地或远程"


# ---- 图遍历 ----


def _commit(repo: Any, sha: bytes | None) -> Commit | None:
    if not sha:
        return None
    return archive._peel_commit(repo, sha)


def _parents(repo: Any, sha: bytes) -> list[bytes]:
    commit = _commit(repo, sha)
    return list(commit.parents) if commit is not None else []


def is_ancestor(repo: Any, ancestor: bytes, descendant: bytes) -> bool:
    if ancestor == descendant:
        return True
    seen: set[bytes] = set()
    stack = [descendant]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        for parent in _parents(repo, current):
            if parent == ancestor:
                return True
            stack.append(parent)
    return False


def merge_base(repo: Any, a: bytes, b: bytes) -> bytes | None:
    ancestors_a: set[bytes] = set()
    stack = [a]
    while stack:
        current = stack.pop()
        if current in ancestors_a:
            continue
        ancestors_a.add(current)
        stack.extend(_parents(repo, current))

    candidates: list[bytes] = []
    seen: set[bytes] = set()
    stack = [b]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        if current in ancestors_a:
            candidates.append(current)
            continue
        stack.extend(_parents(repo, current))
    if not candidates:
        return None

    def commit_time(sha: bytes) -> int:
        commit = _commit(repo, sha)
        return commit.commit_time if commit is not None else 0

    return max(candidates, key=commit_time)


def _diff(base: dict[str, tuple[int, bytes]], head: dict[str, tuple[int, bytes]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for path in set(base) | set(head):
        if path not in base:
            out[path] = "added"
        elif path not in head:
            out[path] = "deleted"
        elif base[path][1] != head[path][1]:
            out[path] = "modified"
    return out


# ---- 冲突检查 ----


def _remote_sha(root: Path, password: str | None) -> tuple[bytes | None, dict[str, Any]]:
    config = archive.load_archive_config(root)
    url = config.get("remoteUrl") or ""
    if not url or not archive.repo_path(root).exists():
        return None, config
    if not password and config.get("credRef"):
        password = secrets.get(str(config["credRef"]))
    auth_url = archive._with_credentials(
        url, str(config.get("username") or ""), password
    )
    repo = archive._open(root)
    try:
        result = porcelain.fetch(
            repo, auth_url, outstream=io.BytesIO(), errstream=io.BytesIO()
        )
        refs = getattr(result, "refs", {}) or {}
        return refs.get(REMOTE_BRANCH), config
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001 - 网络错误统一报 fetch 失败
        raise ApiError(
            "E_FETCH_FAILED", 502, "error.fetchFailed", {"reason": type(exc).__name__}
        ) from exc
    finally:
        repo.close()


def check_conflict(root: Path, *, password: str | None = None) -> dict[str, Any]:
    root = Path(root)
    empty: dict[str, Any] = {
        "diverged": False,
        "behind": False,
        "local": None,
        "remote": None,
        "base": None,
        "conflicts": [],
        "remoteOnly": [],
        "localOnly": [],
    }
    remote, _config = _remote_sha(root, password)
    repo = archive._open(root)
    try:
        local = archive._head_sha(repo)
        if not local or not remote:
            return {
                **empty,
                "local": local.decode() if local else None,
                "remote": remote.decode() if remote else None,
            }
        if is_ancestor(repo, remote, local):
            return {
                **empty,
                "local": local.decode(),
                "remote": remote.decode(),
            }
        if is_ancestor(repo, local, remote):
            return {
                **empty,
                "behind": True,
                "local": local.decode(),
                "remote": remote.decode(),
            }
        base = merge_base(repo, local, remote)
        base_files = archive._tree_files(
            repo, _commit(repo, base).tree if base else None
        )
        local_files = archive._tree_files(repo, _commit(repo, local).tree)
        remote_files = archive._tree_files(repo, _commit(repo, remote).tree)
    finally:
        repo.close()

    local_changes = _diff(base_files, local_files)
    remote_changes = _diff(base_files, remote_files)
    both = set(local_changes) & set(remote_changes)

    conflicts = [
        {
            "path": path,
            "localStatus": local_changes[path],
            "remoteStatus": remote_changes[path],
            "autoMerge": path == MERGEABLE,
            **({"hint": NO_AUTO_HINT} if path == ".fireeye/evidence.jsonl" else {}),
        }
        for path in sorted(both)
    ]
    return {
        "diverged": True,
        "behind": False,
        "local": local.decode(),
        "remote": remote.decode(),
        "base": base.decode() if base else None,
        "conflicts": conflicts,
        "remoteOnly": sorted(set(remote_changes) - both),
        "localOnly": sorted(set(local_changes) - both),
    }


# ---- 解决 ----


def _blob_bytes(repo: Any, entry: tuple[int, bytes] | None) -> bytes | None:
    if entry is None:
        return None
    return repo.get_object(entry[1]).data


def _write(root: Path, path: str, data: bytes) -> None:
    if archive._excluded(path):
        return
    target = Path(root) / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def _unlink(root: Path, path: str) -> None:
    if archive._excluded(path):
        return
    (Path(root) / path).unlink(missing_ok=True)


def _variant_path(path: str, suffix: str) -> str:
    stem, dot, ext = path.rpartition(".")
    if not dot:
        return f"{path}_{suffix}"
    return f"{stem}_{suffix}.{ext}"


def _unique_variant(
    target: dict[str, tuple[int, bytes]], path: str, suffix: str
) -> str:
    candidate = _variant_path(path, suffix)
    n = 2
    while candidate in target:
        candidate = _variant_path(path, f"{suffix}{n}")
        n += 1
    return candidate


def _merge_findings(
    base_text: str, local_text: str, remote_text: str
) -> str:
    """合并 findings.jsonl（append-only 日志）：基准 + 两侧新增事件，重新编号 seq。

    说明：merge3 会在「双方都追加到文件末尾」这种最常见的情况下判为冲突，
    而事件日志的语义是并集，因此这里按事件做三方合并。
    """
    def lines_of(text: str) -> list[str]:
        return [line for line in text.splitlines() if line.strip()]

    def created_ids(text: str) -> set[str]:
        ids: set[str] = set()
        for line in lines_of(text):
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("event") == "created" and event.get("id"):
                ids.add(str(event["id"]))
        return ids

    base_lines = lines_of(base_text)
    base_set = set(base_lines)
    local_new = [line for line in lines_of(local_text) if line not in base_set]
    remote_new = [line for line in lines_of(remote_text) if line not in base_set]

    base_ids = created_ids(base_text)
    duplicated = (created_ids(local_text) - base_ids) & (
        created_ids(remote_text) - base_ids
    )
    if duplicated:
        raise ApiError(
            "E_DUPLICATE_ID",
            409,
            "error.duplicateFindingId",
            {"id": sorted(duplicated)[0]},
        )

    merged = list(base_lines)
    for line in [*local_new, *remote_new]:
        if line not in merged:
            merged.append(line)

    events: list[dict[str, Any]] = []
    for line in merged:
        try:
            events.append(json.loads(line))
        except ValueError as exc:
            raise ApiError("E_MERGE_CONFLICT", 409, "error.mergeConflict") from exc

    for index, event in enumerate(events, start=1):
        event["seq"] = index
    return "\n".join(json.dumps(e, ensure_ascii=False) for e in events) + "\n"


def _set(
    target: dict[str, tuple[int, bytes]],
    files: dict[str, tuple[int, bytes]],
    path: str,
) -> None:
    entry = files.get(path)
    if entry is None:
        target.pop(path, None)
    else:
        target[path] = entry


def _text(repo: Any, files: dict[str, tuple[int, bytes]], path: str) -> str:
    entry = files.get(path)
    if entry is None:
        return ""
    try:
        return repo.get_object(entry[1]).data.decode("utf-8")
    except (KeyError, UnicodeDecodeError):
        return ""


def resolve_conflict(
    root: Path,
    *,
    base: str,
    choices: dict[str, str],
    message: str,
    author: dict[str, str] | None = None,
    password: str | None = None,
) -> dict[str, Any]:
    """按文件选择合并为双亲 commit；不自动推送。"""
    if base not in {"local", "remote"}:
        raise ApiError("E_INVALID_BASE", 400, "error.internal")
    root = Path(root)
    check = check_conflict(root, password=password)
    if not check["diverged"]:
        raise ApiError("E_NOT_DIVERGED", 409, "error.notDiverged")

    resolved_author = archive.resolve_author(author)
    repo = archive._open(root)
    WORKSPACE_MUTATION_LOCK.acquire()
    try:
        if archive._status_paths(repo):
            raise ApiError("E_DIRTY_WORKTREE", 409, "error.dirtyWorktree")

        local = check["local"].encode()
        remote = check["remote"].encode()
        base_sha = check["base"].encode() if check["base"] else None
        base_files = archive._tree_files(
            repo, _commit(repo, base_sha).tree if base_sha else None
        )
        local_files = archive._tree_files(repo, _commit(repo, local).tree)
        remote_files = archive._tree_files(repo, _commit(repo, remote).tree)

        local_changes = _diff(base_files, local_files)
        remote_changes = _diff(base_files, remote_files)
        conflicts = {item["path"]: item for item in check["conflicts"]}

        other_changes = remote_changes if base == "local" else local_changes
        other_files = remote_files if base == "local" else local_files
        target = dict(local_files if base == "local" else remote_files)

        # 另一侧独占的改动全部应用
        for path in sorted(set(other_changes) - set(conflicts)):
            _set(target, other_files, path)

        used_choices: list[dict[str, str]] = []
        auto_paths: list[str] = []
        for path, _info in sorted(conflicts.items()):
            choice = choices.get(path, "local")
            used_choices.append({"path": path, "choice": choice})
            if choice == "local":
                _set(target, local_files, path)
            elif choice == "remote":
                _set(target, remote_files, path)
            elif choice == "both":
                # 基准侧保留原文件，另一侧写成 `<名称>_远程/本地.<后缀>`
                _set(target, local_files if base == "local" else remote_files, path)
                source = remote_files if base == "local" else local_files
                entry = source.get(path)
                if entry is not None:
                    variant = _unique_variant(
                        target, path, "远程" if base == "local" else "本地"
                    )
                    target[variant] = entry
            elif choice == "auto":
                if path != MERGEABLE:
                    raise ApiError("E_MERGE_CONFLICT", 409, "error.mergeConflict")
                auto_paths.append(path)
                _set(target, local_files, path)
            else:
                raise ApiError("E_INVALID_CHOICE", 400, "error.internal")

        # 工作区变成目标版本
        current_files = archive._commit_files(repo, _commit(repo, local))
        for path, (_mode, sha) in target.items():
            if archive._excluded(path):
                continue
            _write(root, path, repo.get_object(sha).data)
        for path in set(current_files) - set(target):
            _unlink(root, path)

        for path in auto_paths:
            merged = _merge_findings(
                _text(repo, base_files, path),
                _text(repo, local_files, path),
                _text(repo, remote_files, path),
            )
            _write(root, path, merged.encode("utf-8"))

        if base == "remote":
            stamp = now_iso().replace(":", "").replace("-", "")[:15]
            porcelain.tag_create(repo, f"{archive.TAG_PREFIX}local-{stamp}", objectish=local)

        archive_id = archive._next_archive_id(repo)
        final_message = message or f"合并归档 {now_iso()[:10]}"
        manifest = archive._archive_manifest(
            root,
            archive_id,
            resolved_author,
            final_message,
            merge={
                "base": base,
                "local": local.decode(),
                "remote": remote.decode(),
                "choices": used_choices,
            },
        )
        write_json_atomic(
            root / ".fireeye" / "archives" / f"{archive_id}.json", manifest
        )
        archive._stage_all(repo, root)

        index = repo.open_index()
        tree_id = index.commit(repo.object_store)
        import time

        stamp = int(time.time())
        commit = Commit()
        commit.tree = tree_id
        commit.parents = [local, remote] if base == "local" else [remote, local]
        commit.author = archive._author_bytes(resolved_author)
        commit.committer = commit.author
        commit.author_time = stamp
        commit.commit_time = stamp
        commit.author_timezone = 0
        commit.commit_timezone = 0
        commit.encoding = b"UTF-8"
        commit.message = final_message.encode("utf-8")
        repo.object_store.add_object(commit)
        repo.refs[b"refs/heads/main"] = commit.id
        porcelain.tag_create(repo, f"{archive.TAG_PREFIX}{archive_id}", objectish=commit.id)
    finally:
        WORKSPACE_MUTATION_LOCK.release()
        repo.close()

    return {
        "id": archive_id,
        "tag": f"{archive.TAG_PREFIX}{archive_id}",
        "commit": commit.id.decode(),
        "merge": True,
    }