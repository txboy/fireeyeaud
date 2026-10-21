# Git 项目归档 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把「归档」做成 Git 式快照：一次归档 = 整个项目文件夹的一次 commit + 标签 `archive/A-0001`；支持项目级远程、推送、从远程 clone 还原、从历史还原；分叉时按文件选择本地/远程/两份都留，生成 merge commit，不 force push。

**Architecture:** 用 `dulwich` 直接操作项目根目录的 `.git`，不依赖系统 Git。归档时写入 `.fireeye/archives/A-xxxx.json`，提交全部项目文件（排除 DuckDB、锁、暂存区），然后打标签。项目模板（`.fireeye/config/templates.json` + `.fireeye/templates/`）和产物内的 `template.docx` 快照随项目提交；全局模板在 `<global_dir>/`，不进入项目历史。远程认证走 HTTPS + 用户名/Token，Token 只存在 Electron 内存凭据库，sidecar 通过 `POST /secrets` 获取。分叉检测用 fetch + 三方文件集合比较；解决时先选定基准侧，再逐文件应用另一侧或另存副本，最后用 `do_commit(merge_heads=[...])` 生成双亲 merge commit。

**Tech Stack:** FastAPI + dulwich + merge3 + pytest、React + Zustand + Ant Design、Electron IPC。

**Depends on:** P1（项目数据与成果栏骨架）。建议在 P2/P3 完成后实施，以便归档覆盖模板与生成物。

---

## 0. 范围与非目标

本计划做：

- 项目根目录初始化 `.git`，单分支 `main`。
- 一次归档 = commit + `archive/A-xxxx` 标签。
- 排除 `.fireeye/workspace.duckdb`、`.fireeye/workspace.duckdb.wal`、`.fireeye/.lock`、`.fireeye/staging/`。
- 项目级 remote 配置、推送、推送状态。
- 从远程 clone 还原到新文件夹，并重建 DuckDB。
- 从本地历史还原到新文件夹。
- 分叉检测、文件级冲突解决、merge commit。
- 归档历史、变更文件列表。
- 作者姓名/邮箱设置。

不做：SSH 认证、强制推送、自动三方合并所有文件、服务端仓库管理、分支管理 UI、镜像/子模块。

---

## 1. 归档模型

```text
<项目根>/
├─ .git/
│  └─ fireeye-push-state.json       # 本地推送状态，不提交
├─ .gitignore
├─ .fireeye/
│  ├─ config/archive.json           # remoteUrl / username / credRef / autoPush，提交
│  ├─ config/templates.json         # 项目模板清单，提交
│  ├─ archives/A-0001.json          # 归档说明，提交
│  ├─ project.json
│  ├─ findings.jsonl
│  ├─ evidence.jsonl
│  ├─ artifacts/                    # 含每份产物的 template.docx 快照
│  ├─ templates/                    # 项目模板文件，提交
│  └─ workspace.duckdb              # 不提交
├─ 证据/
├─ 回执单/
└─ 其他项目文件
```

全局模板位于 `<global_dir>/config/templates.json` 与 `<global_dir>/templates/`，在项目根目录之外，因此不会被本项目归档；如果某个产物使用了全局模板，它仍带有自己的 `template.docx` 快照，可随项目追溯。

### 1.1 `.gitignore`

```gitignore
.fireeye/workspace.duckdb
.fireeye/workspace.duckdb.wal
.fireeye/workspace.duckdb.tmp
.fireeye/.lock
.fireeye/staging/
```

> `.fireeye/.lock` 被忽略但文件仍存在；`.fireeye/staging/` 整个目录不进入历史。

### 1.2 归档清单

`.fireeye/archives/A-0001.json`：

```jsonc
{
  "id": "A-0001",
  "createdAt": "2026-10-21T10:00:00+08:00",
  "author": { "name": "张审计", "email": "zhang@example.com" },
  "message": "归档 2026-10-21 · 3 份取证单 · 1 份报告",
  "branch": "main",
  "counts": { "findings": 12, "evidenceForms": 3, "reports": 1 },
  "appVersion": "0.0.0",
  "schemaVersion": 1,
  "merge": null
}
```

合并归档时 `merge` 记录：

```jsonc
{
  "merge": {
    "base": "local",
    "local": "<sha>",
    "remote": "<sha>",
    "choices": [
      { "path": ".fireeye/findings.jsonl", "choice": "auto" },
      { "path": "证据/银行回单.pdf", "choice": "remote" }
    ]
  }
}
```

`commit` 字段不写进清单；归档标签本身指向 commit，历史接口返回 `commit`。

### 1.3 远程配置

`.fireeye/config/archive.json`：

```jsonc
{
  "remoteUrl": "https://github.com/example/audit-project.git",
  "username": "zhang",
  "credRef": "cred_xxx",
  "autoPush": false
}
```

`credRef` 只是 Electron 内存凭据的引用，不含明文 Token。

### 1.4 推送状态

`.git/fireeye-push-state.json`（不提交）：

```jsonc
{
  "archives": {
    "A-0001": { "sha": "<sha>", "pushedAt": "..." }
  }
}
```

---

## 2. 关键文件

后端：

- `services/agent/pyproject.toml`（新增 `dulwich`、`merge3`）
- `services/agent/src/fireeyeaud_agent/store/archive.py`（新建）
- `services/agent/src/fireeyeaud_agent/store/archive_conflict.py`（新建）
- `services/agent/src/fireeyeaud_agent/api/archive.py`（新建）
- `services/agent/src/fireeyeaud_agent/main.py`
- `services/agent/src/fireeyeaud_agent/store/app_settings.py`
- `services/agent/src/fireeyeaud_agent/api/settings.py`
- `services/agent/tests/test_archive_store.py`（新建）
- `services/agent/tests/test_archive_conflict.py`（新建）
- `services/agent/tests/test_archive_api.py`（新建）

共享与前端：

- `packages/shared/src/types.ts`
- `packages/shared/src/locales/zh-CN.ts`
- `packages/shared/src/locales/en-US.ts`
- `apps/renderer/src/lib/api.ts`
- `apps/renderer/src/store/archive.ts`（新建）
- `apps/renderer/src/components/results/ArchiveView.tsx`
- `apps/renderer/src/components/archive/ArchiveSettingsDialog.tsx`（新建）
- `apps/renderer/src/components/archive/ConflictDialog.tsx`（新建）
- `apps/renderer/src/components/archive/RestoreDialog.tsx`（新建）
- `apps/renderer/src/components/archive/RestoreFromRemoteDialog.tsx`（新建）
- `apps/renderer/src/components/Welcome.tsx`
- `apps/renderer/src/styles/global.css`

---

## Task 1: 依赖与设置

**Files:**
- Modify: `services/agent/pyproject.toml`
- Modify: `services/agent/src/fireeyeaud_agent/store/app_settings.py`
- Modify: `services/agent/src/fireeyeaud_agent/api/settings.py`
- Modify: `packages/shared/src/types.ts`

**Step 1: 安装依赖**

Run: `cd services/agent && uv add dulwich merge3`

Expected: 依赖与 lock 更新。

**Step 2: 设置默认值**

`app_settings._DEFAULTS` 增加：

```python
"archive": {
    "authorName": "",
    "authorEmail": "",
},
```

`load()` 合并：

```python
merged["archive"] = {**_DEFAULTS["archive"], **(data.get("archive") or {})}
```

`patch()` 合并：

```python
if isinstance(update.get("archive"), dict):
    merged["archive"] = {**current.get("archive", {}), **update["archive"]}
```

`api/settings.py` 增加：

```python
class ArchiveBody(BaseModel):
    authorName: str | None = None
    authorEmail: str | None = None

class SettingsPatch(BaseModel):
    # ...existing
    archive: ArchiveBody | None = None
```

**Step 3: 共享类型**

```ts
export interface ArchiveAuthor {
  name: string;
  email: string;
}

export interface ArchiveConfig {
  remoteUrl: string;
  username: string;
  credRef: string | null;
  autoPush: boolean;
}

export interface ArchiveManifest {
  id: string;
  createdAt: string;
  author: ArchiveAuthor;
  message: string;
  branch: string;
  counts: { findings: number; evidenceForms: number; reports: number };
  appVersion: string;
  schemaVersion: number;
  merge: null | {
    base: 'local' | 'remote';
    local: string;
    remote: string;
    choices: Array<{ path: string; choice: 'local' | 'remote' | 'both' | 'auto' }>;
  };
}

export interface ArchiveHistoryItem {
  id: string;
  tag: string;
  commit: string;
  message: string;
  author: ArchiveAuthor;
  createdAt: string;
  manifest: ArchiveManifest | null;
  pushed: boolean;
}

export interface ArchiveStatus {
  initialized: boolean;
  branch: string;
  head: string | null;
  lastArchive: string | null;
  remote: ArchiveConfig;
  author: ArchiveAuthor;
  dirty: boolean;
  changed: string[];
  canPush: boolean;
}

export interface ArchiveConflictFile {
  path: string;
  localStatus: 'added' | 'modified' | 'deleted';
  remoteStatus: 'added' | 'modified' | 'deleted';
  autoMerge: boolean;
  hint?: string;
}

export interface ArchiveConflictCheck {
  diverged: boolean;
  behind: boolean;
  local: string | null;
  remote: string | null;
  base: string | null;
  conflicts: ArchiveConflictFile[];
  remoteOnly: string[];
  localOnly: string[];
}
```

`AppSettings` 增加 `archive: { authorName: string; authorEmail: string }`。

**Step 4: 测试设置**

新增/追加 `test_settings_archive.py`：

```python
from fireeyeaud_agent.store import app_settings


def test_archive_settings_patch():
    app_settings.patch({"archive": {"authorName": "张审计", "authorEmail": "a@b.c"}})
    data = app_settings.load()
    assert data["archive"]["authorName"] == "张审计"
    assert data["archive"]["authorEmail"] == "a@b.c"
```

Run: `npm run agent:test -- tests/test_settings_archive.py -q`

Expected: PASS（测试需清理全局配置，或用 monkeypatch 指到 tmp 目录；按现有 settings 测试风格处理）。

**Step 5: Commit**

```bash
git add services/agent/pyproject.toml services/agent/uv.lock services/agent/src/fireeyeaud_agent/store/app_settings.py services/agent/src/fireeyeaud_agent/api/settings.py packages/shared/src/types.ts services/agent/tests/test_settings_archive.py
git commit -m "feat(archive): add archive dependencies settings and types"
```

---

## Task 2: 仓库初始化、状态与归档提交

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/archive.py`
- Test: `services/agent/tests/test_archive_store.py`

**Step 1: 写失败测试**

```python
from pathlib import Path

from fireeyeaud_agent.store.archive import archive_status, commit_archive, init_repo


def _project(tmp_path: Path) -> Path:
    fe = tmp_path / ".fireeye"
    (fe / "artifacts").mkdir(parents=True)
    (fe / "staging" / "x").mkdir(parents=True)
    (fe / "project.json").write_text('{"name":"P","counters":{}}', "utf-8")
    (fe / "findings.jsonl").write_text('{"event":"created","id":"F-0001"}\n', "utf-8")
    (fe / "workspace.duckdb").write_bytes(b"duck")
    (fe / ".lock").write_text("{}", "utf-8")
    (fe / "staging" / "x" / "tmp.docx").write_bytes(b"tmp")
    (tmp_path / "证据").mkdir()
    (tmp_path / "证据" / "回单.pdf").write_bytes(b"pdf")
    return tmp_path


def test_init_and_commit(tmp_path):
    root = _project(tmp_path)
    init_repo(root, author={"name": "张审计", "email": "a@b.c"})
    result = commit_archive(root, message="首次归档", author={"name": "张审计", "email": "a@b.c"})
    assert result["id"] == "A-0001"
    assert result["tag"] == "archive/A-0001"
    assert len(result["commit"]) == 40

    status = archive_status(root)
    assert status["initialized"] is True
    assert status["branch"] == "main"
    assert status["dirty"] is False
    assert status["lastArchive"] == "A-0001"

    # 排除项不在历史中
    from dulwich import porcelain

    repo = porcelain.open_repo(root)
    index = repo.open_index()
    paths = {p.decode() for p in index}
    assert ".fireeye/workspace.duckdb" not in paths
    assert ".fireeye/.lock" not in paths
    assert ".fireeye/staging/x/tmp.docx" not in paths
    assert ".fireeye/findings.jsonl" in paths
    assert "证据/回单.pdf" in paths
```

**Step 2: 运行确认失败**

Run: `npm run agent:test -- tests/test_archive_store.py -q`

Expected: `ModuleNotFoundError`。

**Step 3: 实现**

核心函数：

```python
def repo_path(root: Path) -> Path
def init_repo(root: Path, *, author: dict) -> dict
def _open(root: Path) -> Repo
def _ensure_gitignore(root: Path) -> None
def _author(repo, override: dict | None) -> bytes   # b"Name <email>"
def _archive_id(repo) -> str
def _archive_manifest(root, archive_id, author, message, merge=None) -> dict
def commit_archive(root, *, message: str | None, author: dict, merge=None) -> dict
def archive_status(root: Path) -> dict
def list_archives(root: Path) -> list[dict]
def archive_changes(root: Path, archive_id: str) -> list[dict]
```

`init_repo`：

```python
if (root / ".git").exists():
    return {"initialized": True}
porcelain.init(root)
repo = porcelain.open_repo(root)
repo.refs.set_symbolic_ref(b"HEAD", b"refs/heads/main")
_ensure_gitignore(root)
config = root / ".fireeye" / "config" / "archive.json"
if not config.exists():
    write_json_atomic(config, {"remoteUrl": "", "username": "", "credRef": None, "autoPush": False})
return {"initialized": True}
```

`_ensure_gitignore`：若文件不存在则写入固定内容；若存在但缺少某行，追加缺失行（不覆盖用户自定义）。

`commit_archive`：

1. `init_repo`（幂等）。
2. `repo = _open(root)`。
3. 检查 `porcelain.status(repo)` 是否为空（无 staged/unstaged/untracked，忽略 ignored）。为空则抛 `ApiError("E_NOTHING_TO_ARCHIVE", 409, "error.nothingToArchive")`。
4. `archive_id = _archive_id(repo)`。
5. 统计 `load_findings`、`list_evidence_forms`、`list_reports`。
6. 写 `.fireeye/archives/<id>.json`。
7. `porcelain.add(repo, [os.fspath(root)])`；确认 ignored 未进入 index（测试覆盖）。
8. `sha = porcelain.commit(repo, message=final_message, author=_author(...), committer=_author(...))`。
9. `porcelain.tag_create(repo, f"archive/{archive_id}", ref=sha)`。
10. 返回 `{id, tag, commit: sha.decode(), manifest}`。

> 若 `porcelain.add` 把 ignored 文件加入索引，改用 `repo.stage(paths)` 前先用 `porcelain.status(repo, ignored=True)` 过滤；实现时以测试为准。

`archive_status`：

- 无 `.git`：`{initialized:false, ...}`。
- 有：读 config、author、HEAD、last tag、`porcelain.status`。
- `changed` 汇总 `staged/unstaged/untracked` 的路径，过滤 `.fireeye/workspace.duckdb*`、`.fireeye/.lock`、`.fireeye/staging/`。
- `dirty = bool(changed)`。

`list_archives`：

```python
refs = repo.refs.as_dict(b"refs/tags")
for name, sha in refs.items():
    if not name.startswith(b"archive/"): continue
    commit = repo[sha]
    manifest = _read_manifest(repo, commit, name.decode().split("/", 1)[1])
    yield {...}
```

`_read_manifest`：从 commit tree 读取 `.fireeye/archives/<id>.json`；读不到时为 `null`。

`archive_changes`：比较 commit 与第一父提交的 tree，返回 `{path, status}`；首提交所有文件为 `added`。

**Step 4: 运行测试**

Run: `npm run agent:test -- tests/test_archive_store.py -q`

Expected: PASS。

**Step 5: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/archive.py services/agent/tests/test_archive_store.py
git commit -m "feat(archive): init repo commit snapshots and history"
```

---

## Task 3: 远程配置与推送

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/archive.py`
- Test: `services/agent/tests/test_archive_store.py`

**Step 1: 写失败测试**

用本地裸仓库模拟远程：

```python
from dulwich import porcelain


def test_push_to_bare_remote(tmp_path):
    root = _project(tmp_path / "project")
    remote = tmp_path / "remote.git"
    porcelain.init_bare(remote)
    init_repo(root, author={"name": "A", "email": "a@b.c"})
    result = commit_archive(root, message="A-0001", author={"name": "A", "email": "a@b.c"})
    set_remote(root, url=str(remote), username="", cred_ref=None, auto_push=False)
    push_result = push_archive(root, archive_id=result["id"], password=None)
    assert push_result["ok"] is True
    assert (remote / "refs" / "tags" / "archive" / "A-0001").is_file()
```

**Step 2: 实现**

```python
def load_archive_config(root: Path) -> dict
def save_archive_config(root: Path, *, url: str, username: str, cred_ref: str | None, auto_push: bool) -> dict
def set_remote(root: Path, ...) -> dict
def push_archive(root: Path, *, archive_id: str | None, password: str | None) -> dict
```

`save_archive_config`：写 `.fireeye/config/archive.json`，不写密码。

`push_archive`：

1. 读 config；无 `remoteUrl` → `E_NO_REMOTE`。
2. 若 `credRef` 且未传 password，从 `store.secrets.get(credRef)` 取。
3. `auth_url = _with_credentials(url, username, password)`；只在内存中使用，不写日志。
4. `refspecs = ["refs/heads/main:refs/heads/main"]`。
5. 若指定 archive_id，加 `refs/tags/archive/<id>:refs/tags/archive/<id>`；否则推送所有未推送标签。
6. `porcelain.push(repo, auth_url, refspecs=refspecs)`。
7. 更新 `.git/fireeye-push-state.json`。
8. 捕获 `porcelain.PushResult` 中的错误；拒绝时返回 409 `E_PUSH_REJECTED`，提示先检查冲突。

`_with_credentials`：

```python
from urllib.parse import quote, urlsplit, urlunsplit

def _with_credentials(url: str, username: str, password: str | None) -> str:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not username:
        return url
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    netloc = f"{quote(username)}:{quote(password or '')}@{host}{port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
```

> 不要把这个 URL 写入异常消息或日志。

**Step 3: 运行测试**

Run: `npm run agent:test -- tests/test_archive_store.py -q`

Expected: PASS。

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/archive.py services/agent/tests/test_archive_store.py
git commit -m "feat(archive): configure remote and push branches tags"
```

---

## Task 4: 从远程 clone 与本地还原

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/archive.py`
- Test: `services/agent/tests/test_archive_store.py`

**Step 1: 写失败测试**

```python
def test_clone_and_restore(tmp_path):
    root = _project(tmp_path / "project")
    init_repo(root, author={"name": "A", "email": "a@b.c"})
    result = commit_archive(root, message="A-0001", author={"name": "A", "email": "a@b.c"})

    target = tmp_path / "restored"
    restored = restore_archive(root, archive_id=result["id"], target=target)
    assert restored["target"] == str(target)
    assert (target / ".fireeye" / "project.json").is_file()
    assert (target / "证据" / "回单.pdf").is_file()
```

**Step 2: 实现**

`clone_from_remote(rootless, *, url, target, username, password)`：

1. 校验 `target` 不存在或为空；父目录存在（不存在则 `mkdir(parents=True)`）。
2. `auth_url`；`porcelain.clone(auth_url, str(target))`。
3. 校验 `target/.fireeye/project.json`；不存在则 `shutil.rmtree(target)` 并报错。
4. 写 `.fireeye/config/archive.json`（远程 URL、username、credRef、autoPush）。
5. `sync_sources(target, full=True)` 重建 DuckDB；失败不阻塞，返回 `warnings`。
6. 返回 `{target, warnings}`。

`restore_archive(root, *, archive_id, target)`：

1. 校验 tag 存在。
2. `porcelain.clone(str(root), str(target))`。
3. `new_repo = porcelain.open_repo(target)`；`porcelain.reset(new_repo, "hard", treeish=f"refs/tags/archive/{archive_id}")`。
4. 关闭 repo。
5. `sync_sources(target, full=True)`。
6. 返回。

> DuckDB 被排除，所以还原后必须重建。`sync_sources` 会扫描项目内 csv/xlsx 并导入；若用户数据源不在项目文件夹，`project.json.dataSources` 的 `path` 可能是绝对路径，`sync_sources` 的扫描只覆盖项目内文件，需在实现时检查并补充：对 `dataSources` 中路径存在但不在扫描结果内的文件，直接 `import_source`。这条务必在测试中覆盖。

**Step 3: 运行测试**

Run: `npm run agent:test -- tests/test_archive_store.py -q`

Expected: PASS。

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/archive.py services/agent/tests/test_archive_store.py
git commit -m "feat(archive): clone remote projects and restore history"
```

---

## Task 5: 分叉检测

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/archive_conflict.py`
- Test: `services/agent/tests/test_archive_conflict.py`

**Step 1: 写失败测试**

用裸仓库 + 两个 clone：

```python
def test_conflict_check(tmp_path):
    remote = tmp_path / "remote.git"
    porcelain.init_bare(remote)

    a = _project(tmp_path / "a")
    init_repo(a, author={"name": "A", "email": "a@b.c"})
    commit_archive(a, message="A-0001", author={"name": "A", "email": "a@b.c"})
    set_remote(a, url=str(remote), username="", cred_ref=None, auto_push=False)
    push_archive(a, archive_id="A-0001", password=None)

    b = tmp_path / "b"
    clone_from_remote(None, url=str(remote), target=b, username="", password=None)

    (b / "证据" / "远程.txt").write_text("remote", "utf-8")
    init_repo(b, author={"name": "B", "email": "b@b.c"})
    commit_archive(b, message="B-0001", author={"name": "B", "email": "b@b.c"})
    push_archive(b, archive_id="A-0001", password=None)

    (a / "证据" / "本地.txt").write_text("local", "utf-8")
    commit_archive(a, message="A-0002", author={"name": "A", "email": "a@b.c"})

    check = check_conflict(a, password=None)
    assert check["diverged"] is True
    assert any(f["path"] == "证据/远程.txt" for f in check["conflicts"]) is False
    assert "证据/远程.txt" in check["remoteOnly"]
```

> 注意 clone 后标签也复制过来；B 的 `commit_archive` 会生成 `A-0001` 冲突。测试里 B 应使用不同归档号逻辑：`_archive_id` 基于标签，clone 已含 A-0001，因此 B 会生成 A-0002。断言按实际编号调整。

**Step 2: 实现**

```python
def check_conflict(root: Path, *, password: str | None) -> dict
```

步骤：

1. 读 config / remote；无远程 → `{diverged:false}`。
2. fetch：`porcelain.fetch(repo, auth_url)`；读取 `refs/remotes/origin/main`。
3. `local = repo.head()`；`remote = repo.refs[b"refs/remotes/origin/main"]`。
4. 若 `is_ancestor(repo, remote, local)` → 本地领先，`{diverged:false, remoteOnly:[]}`。
5. 若 `is_ancestor(repo, local, remote)` → 本地落后，`{diverged:false, behind:true, ...}`。
6. 否则分叉：`base = merge_base(repo, local, remote)`。
7. `base_files/local_files/remote_files = _tree_files(...)`。
8. `local_changes = _diff(base, local)`；`remote_changes = _diff(base, remote)`。
9. `conflicts = local_changes.keys() & remote_changes.keys()`；`remoteOnly = remote_changes - conflicts`；`localOnly = local_changes - conflicts`。
10. 每个冲突文件返回双方状态、是否 `autoMerge`（仅 `.fireeye/findings.jsonl`）、提示（证据链不可自动合并等）。

辅助：

```python
def _tree_files(repo, tree_sha, prefix=b"") -> dict[str, tuple[int, bytes]]
def _diff(base: dict, head: dict) -> dict[str, str]
def is_ancestor(repo, ancestor: bytes, descendant: bytes) -> bool
def merge_base(repo, a: bytes, b: bytes) -> bytes | None
```

`_tree_files` 递归 `Tree.iteritems()`；目录用 `stat.S_ISDIR(mode)`。

`is_ancestor`：从 descendant 向上 BFS 父提交，遇到 ancestor 即真。

`merge_base`：收集 a 的所有祖先（含自身），从 b 向上 BFS，第一个在集合中的提交即候选；再在候选中选一个“最高”的（可用 `commit_time` 最大）。

**Step 3: 运行测试**

Run: `npm run agent:test -- tests/test_archive_conflict.py -q`

Expected: PASS。

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/archive_conflict.py services/agent/tests/test_archive_conflict.py
git commit -m "feat(archive): detect divergence and file conflicts"
```

---

## Task 6: 文件级解决与 merge commit

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/archive_conflict.py`
- Modify: `services/agent/src/fireeyeaud_agent/store/archive.py`
- Test: `services/agent/tests/test_archive_conflict.py`

**Step 1: 写失败测试**

```python
def test_resolve_with_remote_choice(tmp_path):
    # 前置：a、b 已分叉，且同一文件被双方修改
    ...
    result = resolve_conflict(
        a,
        base="local",
        choices={"证据/共同.txt": "remote"},
        message="合并远程",
        author={"name": "A", "email": "a@b.c"},
        password=None,
    )
    assert result["id"] == "A-0003"
    assert (a / "证据" / "共同.txt").read_text("utf-8") == "remote"
    commit = porcelain.open_repo(a)[result["commit"].encode()]
    assert len(commit.parents) == 2
```

**Step 2: 解决流程**

```python
def resolve_conflict(
    root: Path,
    *,
    base: str,                 # local | remote
    choices: dict[str, str],   # path -> local | remote | both | auto
    message: str,
    author: dict,
    password: str | None,
) -> dict
```

步骤：

1. `check = check_conflict(...)`；未分叉则 409。
2. 工作区必须干净（`porcelain.status` 无 staged/unstaged/untracked）；否则 409 `E_DIRTY_WORKTREE`。
3. 读取 base/remote/local 文件表。
4. 若 `base == "remote"`：
   - 先打本地保护标签 `archive/local-<timestamp>`（不推送）。
   - `_apply_tree(repo, remote_tree, root, remove_missing=True)`：把工作区变成远程版本；跳过 `.git` 与排除项。
5. 计算要自动应用的“另一侧变更”：
   - `base=local`：`remoteOnly` 全部应用远程版本/删除。
   - `base=remote`：`localOnly` 全部应用本地版本/删除。
6. 冲突逐个按 `choices[path]`：
   - `local`：应用本地版本/删除。
   - `remote`：应用远程版本/删除。
   - `both`：先应用基准版本，再把另一侧存在的内容写成 `<stem>_远程<suffix>`（base=remote 时写 `_本地`）。
   - `auto`：仅 `.fireeye/findings.jsonl`。
7. `auto` 处理：
   - `merge3.Merge3(base_lines, local_lines, remote_lines)`。
   - 有冲突 → 409 `E_MERGE_CONFLICT`，要求用户改用整份选择。
   - 合并结果逐行解析；重新编号 `seq`；若本地/远程各自新增的 `created` id 有交集 → 409 `E_DUPLICATE_ID`。
   - 写回合并后的 `findings.jsonl`。
   - `.fireeye/evidence.jsonl` 永不 auto；UI 明确提示拼接会破坏哈希链。
8. 写新归档清单，`merge` 字段记录 base/双方 sha/choices。
9. `porcelain.add(repo, ['.'])`；`repo.do_commit(message, author, committer, merge_heads=[other_sha])`。
   - `base=local` 时 `other_sha=remote`；`base=remote` 时 `other_sha=local`。
10. `porcelain.tag_create(repo, f"archive/{new_id}", ref=sha)`。
11. 返回 `{id, tag, commit}`。

辅助：

```python
def _apply_file(root, path: str, mode: int, sha: bytes | None, repo) -> None
def _apply_tree(repo, tree_sha, root, *, remove_missing: bool) -> None
def _write_variant(root, path: str, suffix: str, mode: int, sha: bytes) -> None
```

`_apply_file`：

- `sha is None` 或 mode 为删除 → `unlink(missing_ok=True)`。
- 否则 `blob = repo[sha]`，确保父目录存在，`write_bytes(blob.data)`。
- 对 `.fireeye/workspace.duckdb*`、`.fireeye/.lock`、`.fireeye/staging/` 直接跳过。

`_apply_tree`：

- 遍历目标 tree 的所有文件写入。
- `remove_missing=True` 时，遍历当前 HEAD tree，删除不在目标 tree 中且不在排除列表里的文件。
- 不删除 `.git`。

> 冲突解决不自动 push；返回后 UI 提示用户点「推送」。

**Step 3: 运行测试**

Run: `npm run agent:test -- tests/test_archive_conflict.py -q`

Expected: PASS。

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/archive_conflict.py services/agent/src/fireeyeaud_agent/store/archive.py services/agent/tests/test_archive_conflict.py
git commit -m "feat(archive): resolve conflicts per file and create merge commits"
```

---

## Task 7: 归档 API

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/api/archive.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_archive_api.py`

**Step 1: 路由**

```python
router = APIRouter(tags=["archive"], dependencies=[Depends(require_token)])

class CommitBody(BaseModel):
    message: str | None = None

class RemoteBody(BaseModel):
    url: str
    username: str = ""
    credRef: str | None = None
    autoPush: bool = False

class PushBody(BaseModel):
    archiveId: str | None = None

class ConflictResolveBody(BaseModel):
    base: Literal["local", "remote"]
    choices: dict[str, Literal["local", "remote", "both", "auto"]]
    message: str
    authorName: str | None = None
    authorEmail: str | None = None

class CloneBody(BaseModel):
    url: str
    targetDir: str
    username: str = ""
    credRef: str | None = None

class RestoreBody(BaseModel):
    archiveId: str
    targetDir: str
```

路由：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/archive/status` | 状态 + 配置 |
| POST | `/archive/init` | 初始化 |
| POST | `/archive/commit` | 归档 |
| GET | `/archive/history` | 历史 |
| GET | `/archive/{archive_id}/changes` | 变更文件 |
| POST | `/archive/remote` | 保存远程 |
| POST | `/archive/push` | 推送 |
| POST | `/archive/conflict/check` | fetch + 检查分叉 |
| POST | `/archive/conflict/resolve` | 解决并 merge commit |
| POST | `/archive/clone` | 从远程 clone（无需工作区） |
| POST | `/archive/restore` | 从本地历史还原 |

`clone` 不依赖 `workspace_manager.root`；其余用 `_root()`。

`author` 解析顺序：body 覆盖 → `app_settings.load()["archive"]` → `getpass.getuser()` / `user@localhost`。

`push` 密码：若 config 有 `credRef`，`secrets.get(credRef)`；body 不接受明文密码。

**Step 2: 注册**

`main.py` 导入 `archive as archive_api` 并 `include_router`。

**Step 3: API 测试**

覆盖：status → init → commit → history → changes → remote（本地裸仓库）→ push → conflict check。clone/restore 的 API 测试可直接调用 store 测试的辅助函数。

Run: `npm run agent:test -- tests/test_archive_api.py -q`

Expected: PASS。

**Step 4: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/api/archive.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_archive_api.py
git commit -m "feat(api): add archive routes"
```

---

## Task 8: 前端 API、Store 与归档视图

**Files:**
- Modify: `apps/renderer/src/lib/api.ts`
- Create: `apps/renderer/src/store/archive.ts`
- Replace: `apps/renderer/src/components/results/ArchiveView.tsx`
- Create: `apps/renderer/src/components/archive/ArchiveSettingsDialog.tsx`
- Create: `apps/renderer/src/components/archive/ConflictDialog.tsx`
- Create: `apps/renderer/src/components/archive/RestoreDialog.tsx`
- Modify: `apps/renderer/src/styles/global.css`

**Step 1: API**

```ts
export function getArchiveStatus(): Promise<ArchiveStatus> { ... }
export function initArchive(): Promise<{ initialized: boolean }> { ... }
export function commitArchive(message?: string): Promise<{ id: string; tag: string; commit: string }> { ... }
export function listArchiveHistory(): Promise<{ items: ArchiveHistoryItem[] }> { ... }
export function getArchiveChanges(id: string): Promise<{ items: Array<{ path: string; status: string }> }> { ... }
export function setArchiveRemote(input: {
  url: string; username: string; credRef: string | null; autoPush: boolean;
}): Promise<ArchiveConfig> { ... }
export function pushArchive(archiveId?: string): Promise<{ ok: boolean }> { ... }
export function checkArchiveConflict(): Promise<ArchiveConflictCheck> { ... }
export function resolveArchiveConflict(input: {
  base: 'local' | 'remote';
  choices: Record<string, 'local' | 'remote' | 'both' | 'auto'>;
  message: string;
  authorName?: string;
  authorEmail?: string;
}): Promise<{ id: string; tag: string; commit: string }> { ... }
export function cloneArchive(input: {
  url: string; targetDir: string; username?: string; credRef?: string | null;
}): Promise<{ target: string; warnings: string[] }> { ... }
export function restoreArchive(input: {
  archiveId: string; targetDir: string;
}): Promise<{ target: string; warnings: string[] }> { ... }
```

**Step 2: Store**

```ts
interface ArchiveState {
  status: ArchiveStatus | null;
  history: ArchiveHistoryItem[];
  loading: boolean;
  errorKey: string | null;
  load: () => Promise<void>;
  init: () => Promise<void>;
  commit: (message?: string) => Promise<void>;
  push: (archiveId?: string) => Promise<void>;
  saveRemote: (input: { url: string; username: string; credRef: string | null; autoPush: boolean }) => Promise<void>;
  check: () => Promise<ArchiveConflictCheck>;
  resolve: (input: ...) => Promise<void>;
  reset: () => void;
}
```

`commit` / `push` / `resolve` 后重新 `load()`。

**Step 3: ArchiveView**

未初始化：

```tsx
<div className="panel-empty">
  <p>{t('uninitialized')}</p>
  <button className="button" onClick={() => void init()}>{t('init')}</button>
</div>
```

已初始化：

- 状态卡：分支、HEAD 短 sha、远程（未配置/URL）、最近归档、作者、未提交变更数。
- 工具栏：立即归档、推送、检查冲突、远程设置。
- 归档历史列表：`A-0001`、时间、作者、message、变更文件数；展开显示 changes；操作：还原到此版本、推送此归档。
- 未提交变更提示：`dirty` 时显示「归档将包含当前全部变更」。

**Step 4: 远程设置**

`ArchiveSettingsDialog`：

- remote URL、用户名、Token（`Input.Password`，留空表示不修改）。
- Token 保存：`const credRef = await window.fireeyeaud.putSecret(token)`；然后 `setArchiveRemote({url, username, credRef, autoPush})`。
- 作者姓名/邮箱：`patchSettings({archive: {authorName, authorEmail}})`。
- 自动推送 switch。

**Step 5: 冲突弹窗**

`ConflictDialog`：

- 收到 `ArchiveConflictCheck`。
- 顶部选择基准：`本地版本` / `远程版本`（默认本地）。
- 冲突文件列表：每行 path、双方状态、`Select` 选择 `本地 / 远程 / 两份都留`；`findings.jsonl` 额外提供 `自动合并`。
- 对 `.fireeye/evidence.jsonl` 显示固定警告：不能自动合并，整份选择。
- 底部提示：解决后会生成 merge commit，不会覆盖历史。
- 确认调用 `resolve`；成功后关闭并 `load()`。

**Step 6: 还原**

`RestoreDialog`（本地历史）：

- 选择归档版本（下拉）。
- 选择父文件夹（`window.fireeyeaud.openFolder()`）+ 子文件夹名。
- `targetDir = parent + '/' + name`；调用 `restoreArchive`。
- 成功后询问是否立即打开；是则 `useWorkspaceStore.openPath(target)`。

`RestoreFromRemoteDialog`（欢迎页）：

- 远程 URL、用户名、Token（`putSecret` → `credRef`）、父文件夹、子文件夹名。
- 调用 `cloneArchive`；成功后 `openPath(target)`。

**Step 7: 欢迎页入口**

`Welcome.tsx` 增加按钮：

```tsx
<button className="welcome__btn welcome__btn--ghost" onClick={() => setRestoreOpen(true)}>
  <CloudDownload size={15} />
  {t('restoreFromRemote')}
</button>
```

`welcome` 命名空间增加 `restoreFromRemote`。

**Step 8: 样式**

```css
.archive-status { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
.archive-status__label { font-size: 12px; color: var(--text-muted); }
.archive-status__value { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.archive-row { padding: 8px 0; border-bottom: 1px solid var(--border); }
.archive-row__top { display: flex; align-items: center; gap: 8px; }
.archive-row__id { font-family: var(--font-mono); font-weight: 600; }
.archive-row__meta { font-size: 12px; color: var(--text-muted); }
.archive-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.conflict-row { display: grid; grid-template-columns: 1fr 150px; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); }
```

**Step 9: 手测（本地裸仓库）**

1. 初始化 → 状态显示 main。
2. 修改文件 → 立即归档 → 历史出现 A-0001；变更列表正确。
3. 配置本地裸仓库路径 → 推送 → 裸仓库有 refs。
4. 修改后 A-0002，clone 到新目录 → 可打开，DuckDB 重建。
5. 两处修改同一文件 → 检查冲突 → 选择远程 → merge commit 有两个父提交。
6. 证据文件冲突只能整份选择；findings.jsonl 可选自动合并。

**Step 10: Commit**

```bash
git add apps/renderer/src/lib/api.ts apps/renderer/src/store/archive.ts apps/renderer/src/components/results/ArchiveView.tsx apps/renderer/src/components/archive apps/renderer/src/components/Welcome.tsx apps/renderer/src/styles/global.css packages/shared/src/locales
git commit -m "feat(archive): add archive view settings conflict and restore ui"
```

---

## Task 9: 全量验证

Run: `npm run agent:test`

Run: `npm run renderer:typecheck`

Run: `npm run renderer:build`

Run: `npm run desktop:test`

Expected: 全部通过。

额外检查：

- `.gitignore` 忽略项正确；`git` 历史中无 DuckDB / 锁 / staging。
- 归档提交包含 `证据/`、`回执单/`、`.fireeye/config/templates.json`、`.fireeye/templates/`、`.fireeye/artifacts/`、`.fireeye/archives/`。
- 归档提交不包含全局模板（`<global_dir>/config/templates.json`、`<global_dir>/templates/`）；生成物中的 `template.docx` 快照必须包含在内。
- 还原后项目模板仍可列出并继续生成；全局模板按还原机器的全局配置重新解析，不要求随项目一起还原。
- 推送失败（无凭据/网络）有明确错误，不 force push。
- clone 还原后 `workspace.duckdb` 能重建，数据源可用。
- 冲突解决后 `evidence.jsonl` 没有两条分支拼接；哈希链校验通过。
- 归档历史在只读模式下可查看。

---

## 验收标准

- 一次归档 = 一个 commit + 一个 `archive/A-xxxx` 标签。
- 整个项目文件夹被提交，排除项不进入历史。
- 每个项目可配置独立远程，HTTPS + 用户名/Token 推送。
- 项目模板与产物模板快照随项目归档；全局模板不进入项目历史，但产物不因全局模板缺失而失去可追溯性。
- 可从远程 clone 到新文件夹并打开；DuckDB 自动重建。
- 可从本地历史还原到新文件夹。
- 分叉可检测；冲突按文件选择本地/远程/两份都留；生成双亲 merge commit；不 force push。
- 证据链不会被自动合并破坏。
