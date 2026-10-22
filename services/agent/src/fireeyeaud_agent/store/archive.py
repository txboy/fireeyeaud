"""项目归档：Git 仓库初始化、归档提交（commit + tag）、远程推送、还原。

一次归档 = 一个 commit + 一个 `archive/A-xxxx` 标签；整个项目文件夹入库，
排除 DuckDB / 锁 / staging。使用 dulwich，不依赖用户安装系统 Git。

安全：远程凭据只在内存中拼进 URL，绝不写入文件或日志。
"""

from __future__ import annotations

import getpass
import io
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from dulwich import porcelain
from dulwich.objects import Commit, Tag
from dulwich.repo import Repo

from ..errors import ApiError
from ..util import now_iso
from . import app_settings
from . import secrets
from .fsutil import write_json_atomic
from .lock import WORKSPACE_MUTATION_LOCK

BRANCH = "main"
TAG_PREFIX = "archive/"
TAG_REF_PREFIX = b"refs/tags/archive/"
EXCLUDED = (
    ".fireeye/workspace.duckdb",
    ".fireeye/workspace.duckdb.wal",
    ".fireeye/workspace.duckdb.tmp",
    ".fireeye/.lock",
    ".fireeye/staging/",
)
GITIGNORE_LINES = [
    ".fireeye/workspace.duckdb",
    ".fireeye/workspace.duckdb.wal",
    ".fireeye/workspace.duckdb.tmp",
    ".fireeye/.lock",
    ".fireeye/staging/",
]
PUSH_STATE = "fireeye-push-state.json"
ARCHIVE_ID_RE = re.compile(r"^A-\d+$")


# ---- 基础 ----


def repo_path(root: Path) -> Path:
    return Path(root) / ".git"


def _open(root: Path) -> Repo:
    return porcelain.open_repo(str(root))


def _config_path(root: Path) -> Path:
    return Path(root) / ".fireeye" / "config" / "archive.json"


def _excluded(rel: str) -> bool:
    """排除 DuckDB / 锁 / staging：支持文件与目录前缀（Windows 分隔符也归一）。"""
    rel = rel.replace("\\", "/").lstrip("/")
    while rel.startswith("./"):
        rel = rel[2:]
    for item in EXCLUDED:
        if item.endswith("/"):
            if rel == item[:-1] or rel.startswith(item):
                return True
        elif rel == item:
            return True
    return False


def _author_bytes(author: dict[str, str] | None) -> bytes:
    name = (author or {}).get("name") or getpass.getuser() or "auditor"
    email = (author or {}).get("email") or "auditor@localhost"
    return f"{name} <{email}>".encode("utf-8")


def resolve_author(
    override: dict[str, str] | None = None,
) -> dict[str, str]:
    """作者解析：显式覆盖 → 应用设置 → 系统用户名。"""
    stored = app_settings.load().get("archive") or {}
    name = (override or {}).get("name") or stored.get("authorName") or getpass.getuser()
    email = (
        (override or {}).get("email")
        or stored.get("authorEmail")
        or f"{getpass.getuser() or 'auditor'}@localhost"
    )
    return {"name": name or "auditor", "email": email}


def _ensure_gitignore(root: Path) -> None:
    path = Path(root) / ".gitignore"
    existing = path.read_text("utf-8").splitlines() if path.exists() else []
    missing = [line for line in GITIGNORE_LINES if line not in existing]
    if not missing:
        return
    lines = existing + ([""] if existing else []) + missing
    path.write_text("\n".join(lines) + "\n", "utf-8")


def init_repo(root: Path) -> dict[str, Any]:
    root = Path(root)
    with WORKSPACE_MUTATION_LOCK:
        if not repo_path(root).exists():
            porcelain.init(str(root))
            repo = _open(root)
            try:
                try:
                    repo.refs.set_symbolic_ref(b"HEAD", b"refs/heads/main")
                except (AttributeError, KeyError):
                    pass
            finally:
                repo.close()
        # 即使用户删掉 .gitignore 或仓库已存在，也要补齐排除项
        _ensure_gitignore(root)
        config = _config_path(root)
        if not config.exists():
            write_json_atomic(
                config,
                {"remoteUrl": "", "username": "", "credRef": None, "autoPush": False},
            )
    return {"initialized": True}


# ---- 状态与暂存 ----


def _as_text(path: Any) -> str:
    if isinstance(path, bytes):
        return path.decode("utf-8", "replace")
    return str(path)


def _status_groups(repo: Any) -> tuple[list[str], list[str], list[str]]:
    status = porcelain.status(repo, untracked_files="all")
    staged_raw = status.staged
    if isinstance(staged_raw, dict):
        staged = [_as_text(p) for group in staged_raw.values() for p in group]
    else:
        staged = [_as_text(p) for p in staged_raw]
    unstaged = [_as_text(p) for p in (status.unstaged or [])]
    untracked = [_as_text(p) for p in (status.untracked or [])]
    return staged, unstaged, untracked


def _tracked_paths(repo: Repo) -> set[str]:
    return {_as_text(p).replace("\\", "/") for p in repo.open_index()}


def _status_paths(repo: Repo) -> set[str]:
    staged, unstaged, untracked = _status_groups(repo)
    paths = {*staged, *unstaged, *untracked}
    return {p.replace("\\", "/") for p in paths if not _excluded(p)}


def _stage_all(repo: Repo, root: Path) -> None:
    """只暂存未被排除的文件；同时处理删除。"""
    staged, unstaged, untracked = _status_groups(repo)
    tracked = _tracked_paths(repo)
    present: list[str] = []
    removed: list[str] = []
    for rel in sorted({*staged, *unstaged, *untracked}):
        rel = rel.replace("\\", "/")
        if _excluded(rel):
            continue
        path = Path(root) / rel
        if path.is_file():
            present.append(rel)
        elif rel in tracked and not path.exists():
            removed.append(rel)
    if present:
        porcelain.add(repo, paths=present)
    if removed:
        porcelain.rm(repo, paths=removed)


def _tags(repo: Repo) -> dict[str, str]:
    refs = repo.refs.as_dict(TAG_REF_PREFIX)
    out: dict[str, str] = {}
    for name, sha in refs.items():
        text = _as_text(name)
        # dulwich 可能返回完整 ref 名，也可能剥掉前缀，两种都兼容
        for prefix in ("refs/tags/archive/", "archive/"):
            if text.startswith(prefix):
                text = text[len(prefix) :]
                break
        out[text] = sha.decode() if isinstance(sha, bytes) else str(sha)
    return out


def _archive_tags(repo: Repo) -> dict[str, str]:
    """只保留正式归档 A-xxxx；`local-<时间>` 等保护标签不算归档。"""
    return {name: sha for name, sha in _tags(repo).items() if ARCHIVE_ID_RE.match(name)}


def _next_archive_id(repo: Repo) -> str:
    numbers = [
        int(name[2:])
        for name in _archive_tags(repo)
        if name.startswith("A-") and name[2:].isdigit()
    ]
    return f"A-{(max(numbers) + 1) if numbers else 1:04d}"


def _peel_commit(repo: Repo, sha: bytes) -> Commit | None:
    obj = repo.get_object(sha)
    if isinstance(obj, Tag):
        obj = repo.get_object(obj.object[1])
    return obj if isinstance(obj, Commit) else None


def _head_sha(repo: Repo) -> bytes | None:
    try:
        return repo.head()
    except KeyError:
        return None


def _tree_files(repo: Repo, tree_sha: bytes | None) -> dict[str, tuple[int, bytes]]:
    """递归展开 tree → {相对路径: (mode, blob sha)}。"""
    out: dict[str, tuple[int, bytes]] = {}
    if tree_sha is None:
        return out
    import stat

    def walk(tree_id: bytes, prefix: str) -> None:
        tree = repo.get_object(tree_id)
        for name, mode, sha in tree.iteritems():
            rel = f"{prefix}{name.decode('utf-8', 'replace')}"
            if stat.S_ISDIR(mode):
                walk(sha, rel + "/")
            else:
                out[rel] = (mode, sha)

    walk(tree_sha, "")
    return out


def _commit_files(repo: Repo, commit: Commit | None) -> dict[str, tuple[int, bytes]]:
    return _tree_files(repo, commit.tree if commit is not None else None)


def _read_manifest(repo: Repo, commit: Commit, archive_id: str) -> dict[str, Any] | None:
    import json

    files = _commit_files(repo, commit)
    entry = files.get(f".fireeye/archives/{archive_id}.json")
    if entry is None:
        return None
    try:
        return json.loads(repo.get_object(entry[1]).data.decode("utf-8"))
    except (KeyError, ValueError, AttributeError):
        return None


def _counts(root: Path) -> dict[str, int]:
    from . import evidence_forms, findings, reports

    return {
        "findings": len(findings.load_findings(root)),
        "evidenceForms": len(evidence_forms.list_evidence_forms(root)),
        "reports": len(reports.list_reports(root)),
    }


def _archive_manifest(
    root: Path,
    archive_id: str,
    author: dict[str, str],
    message: str,
    merge: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from ..config.settings import settings

    return {
        "id": archive_id,
        "createdAt": now_iso(),
        "author": author,
        "message": message,
        "branch": BRANCH,
        "counts": _counts(Path(root)),
        "appVersion": settings.app_version,
        "schemaVersion": 1,
        "merge": merge,
    }


def commit_archive(
    root: Path,
    *,
    message: str | None = None,
    author: dict[str, str] | None = None,
    merge: dict[str, Any] | None = None,
) -> dict[str, Any]:
    root = Path(root)
    init_repo(root)
    resolved = resolve_author(author)

    with WORKSPACE_MUTATION_LOCK:
        repo = _open(root)
        try:
            if not _status_paths(repo):
                raise ApiError("E_NOTHING_TO_ARCHIVE", 409, "error.nothingToArchive")

            archive_id = _next_archive_id(repo)
            final_message = message or f"归档 {now_iso()[:10]}"
            manifest = _archive_manifest(root, archive_id, resolved, final_message, merge)
            write_json_atomic(
                root / ".fireeye" / "archives" / f"{archive_id}.json", manifest
            )
            _stage_all(repo, root)
            sha = porcelain.commit(
                repo,
                message=final_message.encode("utf-8"),
                author=_author_bytes(resolved),
                committer=_author_bytes(resolved),
            )
            porcelain.tag_create(repo, f"{TAG_PREFIX}{archive_id}", objectish=sha)
        finally:
            repo.close()

    return {
        "id": archive_id,
        "tag": f"{TAG_PREFIX}{archive_id}",
        "commit": sha.decode(),
        "manifest": manifest,
    }


def archive_status(root: Path) -> dict[str, Any]:
    root = Path(root)
    config = load_archive_config(root)
    author = resolve_author()
    if not repo_path(root).exists():
        return {
            "initialized": False,
            "branch": BRANCH,
            "head": None,
            "lastArchive": None,
            "remote": config,
            "author": author,
            "dirty": False,
            "changed": [],
            "canPush": False,
        }

    repo = _open(root)
    try:
        head = _head_sha(repo)
        changed = sorted(_status_paths(repo))
        tags = _archive_tags(repo)
    finally:
        repo.close()

    branch = BRANCH
    head_path = repo_path(root) / "HEAD"
    if head_path.is_file():
        text = head_path.read_text("utf-8").strip()
        if text.startswith("ref:"):
            branch = text.rsplit("/", 1)[-1]

    return {
        "initialized": True,
        "branch": branch,
        "head": head.decode() if head else None,
        "lastArchive": max(tags) if tags else None,
        "remote": config,
        "author": author,
        "dirty": bool(changed),
        "changed": changed,
        "canPush": bool(config.get("remoteUrl")),
    }


def list_archives(root: Path) -> list[dict[str, Any]]:
    root = Path(root)
    if not repo_path(root).exists():
        return []
    pushed = _load_push_state(root).get("archives", {})
    repo = _open(root)
    try:
        items: list[dict[str, Any]] = []
        for archive_id, sha_hex in _archive_tags(repo).items():
            commit = _peel_commit(repo, sha_hex.encode())
            if commit is None:
                continue
            manifest = _read_manifest(repo, commit, archive_id)
            author = manifest.get("author") if manifest else {}
            created = manifest.get("createdAt") if manifest else None
            items.append(
                {
                    "id": archive_id,
                    "tag": f"{TAG_PREFIX}{archive_id}",
                    "commit": commit.id.decode(),
                    "message": (manifest or {}).get("message")
                    or commit.message.decode("utf-8", "replace").strip(),
                    "author": author or {},
                    "createdAt": created
                    or datetime.fromtimestamp(
                        commit.commit_time, tz=timezone.utc
                    ).astimezone().isoformat(),
                    "manifest": manifest,
                    "pushed": archive_id in pushed,
                }
            )
    finally:
        repo.close()
    items.sort(key=lambda i: str(i.get("createdAt") or ""), reverse=True)
    return items


def archive_changes(root: Path, archive_id: str) -> list[dict[str, str]]:
    repo = _open(Path(root))
    try:
        tags = _tags(repo)
        if archive_id not in tags:
            raise ApiError("E_NOT_FOUND", 404, "error.archiveNotFound", {"id": archive_id})
        commit = _peel_commit(repo, tags[archive_id].encode())
        if commit is None:
            raise ApiError("E_NOT_FOUND", 404, "error.archiveNotFound", {"id": archive_id})
        current = _commit_files(repo, commit)
        parent = repo.get_object(commit.parents[0]) if commit.parents else None
        previous = _commit_files(repo, parent)
    finally:
        repo.close()

    changes: list[dict[str, str]] = []
    for path in sorted(set(current) | set(previous)):
        if path not in previous:
            status = "added"
        elif path not in current:
            status = "deleted"
        elif previous[path][1] != current[path][1]:
            status = "modified"
        else:
            continue
        changes.append({"path": path, "status": status})
    return changes


# ---- 远程配置与推送 ----


def load_archive_config(root: Path) -> dict[str, Any]:
    import json

    path = _config_path(Path(root))
    data: dict[str, Any] = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text("utf-8"))
            data = loaded if isinstance(loaded, dict) else {}
        except (OSError, ValueError):
            data = {}
    return {
        "remoteUrl": str(data.get("remoteUrl") or ""),
        "username": str(data.get("username") or ""),
        "credRef": data.get("credRef") or None,
        "autoPush": bool(data.get("autoPush")),
    }


def save_archive_config(
    root: Path,
    *,
    url: str,
    username: str = "",
    cred_ref: str | None = None,
    auto_push: bool = False,
) -> dict[str, Any]:
    config = {
        "remoteUrl": url.strip(),
        "username": username.strip(),
        "credRef": cred_ref or None,
        "autoPush": bool(auto_push),
    }
    write_json_atomic(_config_path(Path(root)), config)
    return config


def set_remote(
    root: Path,
    *,
    url: str,
    username: str = "",
    cred_ref: str | None = None,
    auto_push: bool = False,
) -> dict[str, Any]:
    return save_archive_config(
        root, url=url, username=username, cred_ref=cred_ref, auto_push=auto_push
    )


def _with_credentials(url: str, username: str, password: str | None) -> str:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not username:
        return url
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    netloc = f"{quote(username, safe='')}:{quote(password or '', safe='')}@{host}{port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def _push_state_path(root: Path) -> Path:
    return repo_path(root) / PUSH_STATE


def _load_push_state(root: Path) -> dict[str, Any]:
    import json

    path = _push_state_path(root)
    if not path.exists():
        return {"archives": {}}
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return {"archives": {}}
    data.setdefault("archives", {})
    return data


def _push_refs(repo: Repo, auth_url: str, refspecs: list[str]) -> dict[bytes, Any]:
    """推送一组 refspec，返回 `ref_status`（值为 None 表示成功）。"""
    result = porcelain.push(
        repo,
        auth_url,
        refspecs=refspecs,
        outstream=io.BytesIO(),
        errstream=io.BytesIO(),
    )
    return dict(getattr(result, "ref_status", {}) or {})


def push_archive(
    root: Path, *, archive_id: str | None, password: str | None = None
) -> dict[str, Any]:
    """推送分支与归档标签。

    逐个标签推送：某个标签在远端已存在且指向不同提交（两边各自归档出同号）时
    跳过它并报告，而不是让整个推送失败；`local-*` 保护标签永不推送。
    """
    root = Path(root)
    config = load_archive_config(root)
    url = config.get("remoteUrl") or ""
    if not url:
        raise ApiError("E_NO_REMOTE", 409, "error.noRemote")
    if not password and config.get("credRef"):
        password = secrets.get(str(config["credRef"]))
    auth_url = _with_credentials(url, str(config.get("username") or ""), password)

    repo = _open(root)
    try:
        tags = _archive_tags(repo)
        if archive_id and archive_id not in tags:
            raise ApiError(
                "E_NOT_FOUND", 404, "error.archiveNotFound", {"id": archive_id}
            )
        targets = [archive_id] if archive_id else sorted(tags)

        branch_ref = f"refs/heads/{BRANCH}:refs/heads/{BRANCH}"
        try:
            status = _push_refs(repo, auth_url, [branch_ref])
        except Exception as exc:  # noqa: BLE001
            raise ApiError(
                "E_PUSH_FAILED", 409, "error.pushFailed", {"reason": type(exc).__name__}
            ) from exc
        if any(status.values()):
            raise ApiError("E_PUSH_FAILED", 409, "error.pushFailed", {"reason": "branch"})

        pushed: list[str] = []
        skipped: list[str] = []
        for name in targets:
            refspec = f"refs/tags/{TAG_PREFIX}{name}:refs/tags/{TAG_PREFIX}{name}"
            try:
                status = _push_refs(repo, auth_url, [refspec])
            except Exception:  # noqa: BLE001 - 单个标签失败不影响其他
                skipped.append(name)
                continue
            if any(status.values()):
                skipped.append(name)
            else:
                pushed.append(name)
        shas = {name: tags[name] for name in pushed}
    finally:
        repo.close()

    if archive_id and archive_id in skipped:
        raise ApiError(
            "E_PUSH_TAG_CONFLICT",
            409,
            "error.pushTagConflict",
            {"id": archive_id},
        )

    state = _load_push_state(root)
    for name in pushed:
        state["archives"][name] = {"sha": shas[name], "pushedAt": now_iso()}
    write_json_atomic(_push_state_path(root), state)
    return {"ok": True, "pushed": pushed, "skipped": skipped}


# ---- 还原 ----


def _rebuild_sources(target: Path) -> list[str]:
    """还原后重建 DuckDB；项目外仍存在的绝对路径数据源也补导。"""
    from .project import load_project
    from .sync import FILE_SOURCE_TYPES, import_source, sync_sources

    warnings: list[str] = []
    fe = Path(target) / ".fireeye"
    before = list((load_project(fe) or {}).get("dataSources", []))
    try:
        sync_sources(Path(target), full=True)
    except Exception as exc:  # noqa: BLE001 - 重建失败不阻塞还原
        warnings.append(f"sync: {exc}")

    current = {
        str(s.get("id")) for s in (load_project(fe) or {}).get("dataSources", [])
    }
    for source in before:
        if source.get("type") not in FILE_SOURCE_TYPES:
            continue
        raw = str(source.get("path") or "")
        path = Path(raw)
        if not path.is_file() or raw.startswith(str(target)):
            continue
        if str(source.get("id")) in current:
            continue
        try:
            import_source(Path(target), path)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"{path.name}: {exc}")
    return warnings


def _validate_target(target: Path) -> None:
    if target.exists():
        if not target.is_dir() or any(target.iterdir()):
            raise ApiError("E_TARGET_NOT_EMPTY", 409, "error.targetNotEmpty")


def clone_from_remote(
    *,
    url: str,
    target: Path,
    username: str = "",
    password: str | None = None,
    cred_ref: str | None = None,
) -> dict[str, Any]:
    target = Path(target)
    _validate_target(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    auth_url = _with_credentials(url, username, password)
    try:
        new_repo = porcelain.clone(
            auth_url,
            str(target),
            branch=BRANCH,
            outstream=io.BytesIO(),
            errstream=io.BytesIO(),
        )
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(target, ignore_errors=True)
        raise ApiError(
            "E_CLONE_FAILED", 502, "error.cloneFailed", {"reason": type(exc).__name__}
        ) from exc

    # 绝不把带凭据的 URL 留在 .git/config 里
    try:
        config = new_repo.get_config()
        config.set((b"remote", b"origin"), b"url", url.encode("utf-8"))
        config.write_to_path(str(target / ".git" / "config"))
    except Exception:  # noqa: BLE001 - 配置重写失败不应让 clone 失败
        pass
    finally:
        new_repo.close()

    if not (target / ".fireeye" / "project.json").is_file():
        shutil.rmtree(target, ignore_errors=True)
        raise ApiError("E_NOT_A_PROJECT", 400, "error.notAProject")

    save_archive_config(
        target, url=url, username=username, cred_ref=cred_ref, auto_push=False
    )
    warnings = _rebuild_sources(target)
    return {"target": str(target), "warnings": warnings}


def restore_archive(root: Path, *, archive_id: str, target: Path) -> dict[str, Any]:
    root = Path(root)
    if not repo_path(root).exists():
        raise ApiError("E_NOT_INITIALIZED", 409, "error.archiveNotInitialized")
    repo = _open(root)
    try:
        if archive_id not in _archive_tags(repo):
            raise ApiError("E_NOT_FOUND", 404, "error.archiveNotFound", {"id": archive_id})
    finally:
        repo.close()

    target = Path(target)
    _validate_target(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        new_repo = porcelain.clone(
            str(root),
            str(target),
            outstream=io.BytesIO(),
            errstream=io.BytesIO(),
        )
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(target, ignore_errors=True)
        raise ApiError(
            "E_RESTORE_FAILED", 502, "error.restoreFailed", {"reason": type(exc).__name__}
        ) from exc
    try:
        porcelain.reset(
            new_repo, "hard", treeish=f"{TAG_PREFIX}{archive_id}".encode()
        )
        # 还原出来的项目不应保留指向来源目录的 origin（推送走 archive.json）
        try:
            config = new_repo.get_config()
            config.remove_section((b"remote", b"origin"))
            config.write_to_path(str(target / ".git" / "config"))
        except Exception:  # noqa: BLE001
            pass
    finally:
        new_repo.close()

    warnings = _rebuild_sources(target)
    return {"target": str(target), "warnings": warnings}