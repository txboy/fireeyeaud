# Phase 6 — 联网搜索 + MCP/Skills 面板 + safeStorage + 打包发版 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 建议按里程碑（M→N→O→P→Q）分批执行，每个里程碑结束运行一次验证并以一次提交收尾。

**Goal:** 补齐 Settings 存储与设置页「联网检索」；新增 MCP 与 Skills 管理面板（配置级，不真实执行 MCP）；新增默认关闭的 `web_search` 工具（Tavily + 自定义 HTTP）；把模型 key / DB 密码 / KB key 全量迁移到 Electron `safeStorage`（sidecar 内存持有，明文不落盘）；electron-builder + PyInstaller 双构建配置与 CI。

**Architecture:** 配置沿用 scope 感知 `config.store`（新增 `mcp` / `skills` 种类）；`settings.json` 仅 global（新增 `store/app_settings.py` + `api/settings.py`）。MCP 与 Skills 本期为**配置 + 面板**（不加载执行 MCP 工具；Skills 的提示词注入到 Agent 系统提示词）。Web 搜索经 `web/` 适配器（`tavily` / `custom`），工具默认关闭，`registry` 按设置过滤。凭据改为：渲染进程经 IPC 交主进程 `safeStorage` 加密存密文（`<userData>/secrets.json`），返回 `ref`；主进程在 sidecar 就绪与每次变更后 `POST /api/v1/secrets` 把明文推给 sidecar（仅内存）；sidecar `store/secrets.py` 内存字典供 DB/KB/模型读取；移除 `db_secrets.json` / `kb_secrets.json` 明文文件。打包：`services/agent/fireeyeaud-agent.spec`（PyInstaller）+ `apps/desktop/package.json` electron-builder 配置 + GitHub Actions。

**Tech Stack:** Python 3.12 · FastAPI · httpx · PyInstaller · Electron · electron-builder · React 18 · Zustand

---

## 决策与偏差（执行前须知，2026-10-10 用户确认）

1. **MCP 深度**：仅**面板与配置**（CRUD / 启停 / 状态=配置态 / 工具列表=`permissions.toolsAllow`）；**不**真实启动 / 调用 MCP Server（工具加载与执行留待后续）。
2. **Web 搜索**：内置 `tavily` + `custom`（自定义 HTTP）两类 Provider；默认关闭，设置页「联网检索」开启并配置 provider/key；key 走 safeStorage。
3. **safeStorage**：**全量迁移**——模型 key / DB 密码 / KB key 一律由主进程 `safeStorage` 加密成密文条目，sidecar 经推送在**内存**持有；删除现有明文 `db_secrets.json` / `kb_secrets.json`。
4. **打包**：产出 electron-builder 配置 + PyInstaller spec + GitHub Actions CI；本地**仅验证可构建**（PyInstaller 能产出 sidecar、electron-builder 配置有效），不实际产出 / 签名安装包。
5. **Skills**：内置技能（只读）+ 自定义技能（CRUD）；启用技能的 `prompt` 注入 Agent 系统提示词（`toolIds` 本期仅存储不联动执行）。
6. **Settings 端点**：新增 `GET/PATCH /settings`（仅 global）：`{locale, theme, webSearch:{enabled,provider,keyRef}, telemetry:false}`；前端设置页改读后端（保留 localStorage 作为首屏快照）。
7. **本机离线**：`web_search` 是唯一新增出站点；`telemetry` 恒 false。

---

## 里程碑总览

| 里程碑 | 内容 | 交付 |
|---|---|---|
| M | MCP 配置存储 + REST + 面板 | 活动栏「MCP」可用（配置级） |
| N | Skills 配置存储 + REST + 面板 + 提示词注入 | 活动栏「Skills」可用 |
| O | Settings 存储 + REST + 联网搜索（适配器 + 工具 + 设置页） | 联网检索可用（默认关） |
| P | safeStorage 全量迁移（主进程 + sidecar 内存凭据） | 敏感信息不落盘明文 |
| Q | 打包（electron-builder + PyInstaller + CI）+ 验收文档 | 可构建发布工程 |

---

## 里程碑 M — MCP 面板与配置

### Task M1: MCP 存储 + REST

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/config/store.py`（`_ID_PREFIX["mcp"] = "mcp"`）
- Create: `services/agent/src/fireeyeaud_agent/store/mcp.py`
- Create: `services/agent/src/fireeyeaud_agent/api/mcp.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_mcp_store.py`、`services/agent/tests/test_mcp_api.py`

**Step 1: `_ID_PREFIX`**

```python
_ID_PREFIX = {"models": "mdl", "db": "conn", "knowledge": "kb", "mcp": "mcp"}
```

**Step 2: 写失败测试（`test_mcp_store.py`）**

```python
from fireeyeaud_agent.store import mcp


def test_mcp_crud(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"

    item = mcp.create_server(
        {
            "name": "filesystem",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
            "enabled": True,
            "scope": "project",
            "permissions": {"net": False, "toolsAllow": ["read_file"]},
        },
        root=root,
    )
    assert item["id"] == "mcp_1"
    assert item["permissions"]["toolsAllow"] == ["read_file"]

    assert [s["id"] for s in mcp.list_servers(root)] == ["mcp_1"]
    mcp.update_server("mcp_1", "project", {"enabled": False}, root)
    assert mcp.get_server("mcp_1", "project", root)["enabled"] is False
    mcp.delete_server("mcp_1", "project", root)
    assert mcp.list_servers(root) == []


def test_mcp_rejects_bad_transport(tmp_path, monkeypatch):
    import pytest

    from fireeyeaud_agent.errors import ApiError

    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    with pytest.raises(ApiError) as ei:
        mcp.create_server({"name": "x", "transport": "grpc", "scope": "project"}, root=tmp_path / "ws")
    assert ei.value.code == "E_MCP_TRANSPORT"
```

**Step 3: 实现 `store/mcp.py`**

```python
"""MCP Server 配置存储（设计 §14 / §10 / 决策：本期仅配置，不执行）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import store

KIND = "mcp"
_TRANSPORTS = {"stdio", "sse", "http"}


def list_servers(root: Path | None = None) -> list[dict[str, Any]]:
    return store.load_effective(KIND, root)


def get_server(server_id: str, scope: str, root: Path | None = None) -> dict[str, Any] | None:
    return store.get_item(KIND, server_id, scope, root)


def create_server(data: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    from ..errors import ApiError

    transport = str(data.get("transport") or "").lower()
    if transport not in _TRANSPORTS:
        raise ApiError("E_MCP_TRANSPORT", 400, "error.mcpTransport", {"transport": transport})
    payload = dict(data)
    payload["transport"] = transport
    perms = payload.get("permissions") or {}
    payload["permissions"] = {
        "fsScope": perms.get("fsScope", "workspace"),
        "net": bool(perms.get("net", False)),
        "toolsAllow": list(perms.get("toolsAllow") or []),
    }
    return store.create_item(KIND, payload, root)


def update_server(
    server_id: str, scope: str, patch: dict[str, Any], root: Path | None = None
) -> dict[str, Any]:
    return store.update_item(KIND, server_id, scope, patch, root)


def delete_server(server_id: str, scope: str, root: Path | None = None) -> None:
    store.delete_item(KIND, server_id, scope, root)
```

**Step 4: 写失败测试（`test_mcp_api.py`）** — CRUD + no workspace

```python
import httpx

from fireeyeaud_agent.main import app


async def test_mcp_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws").mkdir()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/workspaces/open", json={"path": str(tmp_path / "ws")})
        res = await client.post(
            "/api/v1/mcp/servers",
            json={
                "name": "filesystem",
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "server-filesystem", "."],
                "enabled": True,
                "scope": "project",
            },
        )
        assert res.status_code == 200
        assert res.json()["id"] == "mcp_1"
        assert (await client.get("/api/v1/mcp/servers")).json()["items"][0]["name"] == "filesystem"
        await client.post("/api/v1/workspaces/close")


async def test_mcp_no_workspace():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/mcp/servers")).json()["items"] == []
```

**Step 5: 实现 `api/mcp.py`**

```python
"""MCP Server 路由（设计 §14.8；本期仅配置）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..config import store
from ..store import mcp
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["mcp"], dependencies=[Depends(require_token)])


class ServerBody(BaseModel):
    name: str
    transport: str = "stdio"
    command: str | None = None
    args: list[str] | None = None
    env: dict | None = None
    url: str | None = None
    enabled: bool = True
    scope: str = "global"
    permissions: dict | None = None


class ServerPatch(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    permissions: dict | None = None
    args: list[str] | None = None
    url: str | None = None


@router.get("/mcp/servers")
def list_servers(scope: str | None = Query(default=None)) -> dict:
    root = workspace_manager.root
    if scope in ("global", "project"):
        return {"items": store.list_items(mcp.KIND, scope, root), "nextCursor": None}
    return {"items": mcp.list_servers(root), "nextCursor": None}


@router.post("/mcp/servers")
def create_server(body: ServerBody) -> dict:
    return mcp.create_server(body.model_dump(), workspace_manager.root)


@router.patch("/mcp/servers/{server_id}")
def update_server(server_id: str, body: ServerPatch, scope: str = Query(default="global")) -> dict:
    return mcp.update_server(
        server_id, scope, body.model_dump(exclude_unset=True), workspace_manager.root
    )


@router.delete("/mcp/servers/{server_id}")
def delete_server(server_id: str, scope: str = Query(default="global")) -> dict:
    mcp.delete_server(server_id, scope, workspace_manager.root)
    return {"ok": True}
```

**Step 6: `main.py` 注册**（`from .api import ... mcp as mcp_api`；`app.include_router(mcp_api.router, prefix=API_PREFIX)`，置于 `db` 后）

**Step 7: i18n**（zh-CN / en-US 的 `error` 增 `mcpTransport` / `mcpStart`）

**Step 8: 运行通过** — `uv run pytest tests/test_mcp_store.py tests/test_mcp_api.py -v` → PASS

**Step 9: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/config/store.py services/agent/src/fireeyeaud_agent/store/mcp.py services/agent/src/fireeyeaud_agent/api/mcp.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_mcp_store.py services/agent/tests/test_mcp_api.py packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts
git commit -m "feat(agent): MCP Server 配置存储与 REST"
```

---

### Task M2: 前端 MCP 面板

**Files:**
- Modify: `packages/shared/src/types.ts`（`McpTransport` / `McpPermissions` / `McpServer`）
- Modify: `apps/renderer/src/lib/api.ts`（`listMcpServers` / `createMcpServer` / `updateMcpServer` / `deleteMcpServer`）
- Create: `apps/renderer/src/store/mcp.ts`
- Modify: `packages/shared/src/locales/{zh-CN,en-US}.ts`（`mcp` 扩充）
- Modify: `apps/renderer/src/components/panels/PlaceholderPanel.tsx` 或新建 `McpPanel.tsx` + `SideBar.tsx`（`case 'mcp'`）

**Step 1: 类型**

```ts
export type McpTransport = 'stdio' | 'sse' | 'http';

export interface McpPermissions {
  fsScope?: 'workspace' | 'none';
  net?: boolean;
  toolsAllow?: string[];
}

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  enabled: boolean;
  scope: ConfigScope;
  permissions?: McpPermissions;
  createdAt?: string;
  updatedAt?: string;
}
```

**Step 2: API（`lib/api.ts`）**

```ts
export function listMcpServers(scope?: ConfigScope): Promise<{ items: McpServer[] }> { ... }
export function createMcpServer(input: McpServerInput): Promise<McpServer> { ... }
export function updateMcpServer(id: string, scope: ConfigScope, patch: Partial<McpServerInput>): Promise<McpServer> { ... }
export function deleteMcpServer(id: string, scope: ConfigScope): Promise<{ ok: boolean }> { ... }
```

**Step 3: store（`store/mcp.ts`）**：`items/loading/errorKey` + `load/create/update/toggle/remove/reset`，风格同 `store/knowledge.ts`。

**Step 4: i18n `mcp`**：扩充 `name`、`transport`、`command`、`args`、`url`、`enabled`、`tools`、`permissions`、`fsScope`、`net`、`save`、`cancel`、`delete`、`stdioHint`（提示可执行本机代码）。

**Step 5: `McpPanel.tsx`**：列表（name / transport / `ScopeBadge` / 启停开关 / 删除）+ 新建内联表单（依 transport 显示 command+args 或 url）+ 权限区（fsScope 下拉 / net 复选 / toolsAllow 逗号输入）；`SideBar` `case 'mcp'` 接入。

**Step 6: 验证** — `npm run renderer:typecheck`

**Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts apps/renderer/src/lib/api.ts apps/renderer/src/store/mcp.ts apps/renderer/src/components/panels/McpPanel.tsx apps/renderer/src/components/SideBar.tsx
git commit -m "feat(renderer): MCP 面板（配置/启停/权限）"
```

---

## 里程碑 N — Skills 面板与配置

### Task N1: Skills 存储 + REST + 提示词注入

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/config/store.py`（`_ID_PREFIX["skills"] = "sk"`）
- Create: `services/agent/src/fireeyeaud_agent/store/skills.py`
- Create: `services/agent/src/fireeyeaud_agent/api/skills.py`
- Modify: `services/agent/src/fireeyeaud_agent/agent/prompts.py`（`system_prompt` 增 `skills` 参数）
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py`（收集启用技能并注入）
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_skills_store.py`、`services/agent/tests/test_skills_api.py`、`services/agent/tests/test_prompt_skills.py`

**Step 1: `_ID_PREFIX`** 追加 `"skills": "sk"`。

**Step 2: 写失败测试（`test_skills_store.py`）**

```python
from fireeyeaud_agent.store import skills


def test_builtin_seeded_and_custom_crud(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    root = tmp_path / "ws"

    items = skills.list_skills(root)
    assert any(s["builtin"] for s in items)  # 内置技能始终存在

    custom = skills.create_skill(
        {"name": "舞弊风险聚焦", "prompt": "重点关注收入虚增与关联方交易。",
         "toolIds": ["sql_query"], "enabled": True, "scope": "project"},
        root=root,
    )
    assert custom["id"] == "sk_1"
    assert custom["builtin"] is False

    skills.update_skill("sk_1", "project", {"enabled": False}, root)
    enabled = [s for s in skills.list_skills(root) if s["enabled"] and not s.get("builtin")]
    assert enabled == []
```

**Step 3: 实现 `store/skills.py`**

```python
"""技能包存储（设计 §14 / 决策：内置只读 + 自定义 CRUD，prompt 注入系统提示词）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import store

KIND = "skills"

_BUILTIN: list[dict[str, Any]] = [
    {
        "id": "sk_builtin_going_concern",
        "name": "持续经营评估",
        "prompt": "评估持续经营假设：关注现金流、到期债务与重大不确定事项。",
        "toolIds": ["sql_query", "aggregate_subject"],
        "enabled": False,
    },
    {
        "id": "sk_builtin_related_party",
        "name": "关联方交易",
        "prompt": "识别关联方及异常定价、非经常性资金往来。",
        "toolIds": ["sql_query"],
        "enabled": False,
    },
]


def _overlay_builtin(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {i["id"]: i for i in items}
    out: list[dict[str, Any]] = []
    for b in _BUILTIN:
        merged = {**b, "scope": "builtin", "builtin": True, **by_id.pop(b["id"], {})}
        merged["builtin"] = True
        merged["scope"] = "builtin"
        out.append(merged)
    out.extend(by_id.values())
    return out


def list_skills(root: Path | None = None) -> list[dict[str, Any]]:
    return _overlay_builtin(store.load_effective(KIND, root))


def get_skill(skill_id: str, scope: str, root: Path | None = None) -> dict[str, Any] | None:
    for s in list_skills(root):
        if s.get("id") == skill_id:
            return s
    return None


def create_skill(data: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    payload = {**data, "builtin": False}
    return store.create_item(KIND, payload, root)


def update_skill(
    skill_id: str, scope: str, patch: dict[str, Any], root: Path | None = None
) -> dict[str, Any]:
    return store.update_item(KIND, skill_id, scope, patch, root)


def delete_skill(skill_id: str, scope: str, root: Path | None = None) -> None:
    store.delete_item(KIND, skill_id, scope, root)


def enabled_prompts(root: Path | None = None) -> list[dict[str, Any]]:
    return [s for s in list_skills(root) if s.get("enabled") and s.get("prompt")]
```

> 内置技能不可删除：`api` 层对 `id.startswith("sk_builtin_")` 的删除请求返回 `E_SKILL_BUILTIN`；`update` 允许改 `enabled`（落到 project/global 覆盖）。

**Step 4: 写失败 API 测试（`test_skills_api.py`）** — 列表含内置、创建自定义、删除内置被拒。

**Step 5: 实现 `api/skills.py`**

```python
"""技能包路由（设计 §14.8）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..errors import ApiError
from ..store import skills
from ..store.workspace import workspace_manager
from .deps import require_token

router = APIRouter(tags=["skills"], dependencies=[Depends(require_token)])


class SkillBody(BaseModel):
    name: str
    prompt: str
    toolIds: list[str] | None = None
    params: dict | None = None
    enabled: bool = False
    scope: str = "global"


class SkillPatch(BaseModel):
    name: str | None = None
    prompt: str | None = None
    toolIds: list[str] | None = None
    params: dict | None = None
    enabled: bool | None = None


@router.get("/skills")
def list_skills() -> dict:
    return {"items": skills.list_skills(workspace_manager.root), "nextCursor": None}


@router.post("/skills")
def create_skill(body: SkillBody) -> dict:
    return skills.create_skill(body.model_dump(), workspace_manager.root)


@router.patch("/skills/{skill_id}")
def update_skill(skill_id: str, body: SkillPatch, scope: str = Query(default="global")) -> dict:
    return skills.update_skill(
        skill_id, scope, body.model_dump(exclude_unset=True), workspace_manager.root
    )


@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: str, scope: str = Query(default="global")) -> dict:
    if skill_id.startswith("sk_builtin_"):
        raise ApiError("E_SKILL_BUILTIN", 400, "error.skillBuiltin", {"id": skill_id})
    skills.delete_skill(skill_id, scope, workspace_manager.root)
    return {"ok": True}
```

**Step 6: 提示词注入**

`prompts.py`：
```python
def system_prompt(locale, prompt_rules=None, skills=None) -> str:
    ...（原逻辑）
    if skills:
        lines = ["", "可参考的审计技能（方法与视角，非强制流程）："]
        for s in skills:
            lines.append(f"- {s.get('name','')}：{s.get('prompt','')}")
        text += "\n".join(lines) + "\n"
    return text + directive
```

`graph.py` 的 `run_agent`：
```python
from ..store.skills import enabled_prompts
...
messages = [SystemMessage(content=system_prompt(locale, prompt_rules, enabled_prompts(root)))]
```

**Step 7: i18n**（`error.skillBuiltin`）；**Step 8: 运行通过** — `uv run pytest tests/test_skills_store.py tests/test_skills_api.py tests/test_prompt_skills.py -v`

**Step 9: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/config/store.py services/agent/src/fireeyeaud_agent/store/skills.py services/agent/src/fireeyeaud_agent/api/skills.py services/agent/src/fireeyeaud_agent/agent/prompts.py services/agent/src/fireeyeaud_agent/agent/graph.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_skills_store.py services/agent/tests/test_skills_api.py services/agent/tests/test_prompt_skills.py packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts
git commit -m "feat(agent): 技能包存储、REST 与提示词注入"
```

---

### Task N2: 前端 Skills 面板

**Files:**
- Modify: `packages/shared/src/types.ts`（`Skill`）
- Modify: `apps/renderer/src/lib/api.ts`、新建 `apps/renderer/src/store/skills.ts`
- Modify: `packages/shared/src/locales/{zh-CN,en-US}.ts`（`skills` 扩充）
- 新建 `apps/renderer/src/components/panels/SkillsPanel.tsx`；`SideBar.tsx`（`case 'skills'`）

**Step 1: 类型**

```ts
export interface Skill {
  id: string;
  name: string;
  prompt: string;
  toolIds?: string[];
  params?: Record<string, unknown>;
  enabled: boolean;
  builtin: boolean;
  scope: ConfigScope | 'builtin';
  createdAt?: string;
  updatedAt?: string;
}
```

**Step 2–5**：API、store（`load/create/update/toggle/remove`）、i18n（`name`/`prompt`/`tools`/`enabled`/`builtin`（已有）/`save`/`cancel`/`delete`）、面板（内置显示 `builtin` 徽标且无删除；自定义可增删改与启停）。

**Step 6: 验证** — `npm run renderer:typecheck`

**Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts apps/renderer/src/lib/api.ts apps/renderer/src/store/skills.ts apps/renderer/src/components/panels/SkillsPanel.tsx apps/renderer/src/components/SideBar.tsx
git commit -m "feat(renderer): Skills 面板"
```

---

## 里程碑 O — Settings + 联网搜索

### Task O1: Settings 存储 + REST

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/app_settings.py`
- Create: `services/agent/src/fireeyeaud_agent/api/settings.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_settings_api.py`

**Step 1: 写失败测试**

```python
import httpx

from fireeyeaud_agent.main import app


async def test_settings_defaults_and_patch(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        default = (await client.get("/api/v1/settings")).json()
        assert default["locale"] == "zh-CN"
        assert default["telemetry"] is False
        assert default["webSearch"]["enabled"] is False

        res = await client.patch(
            "/api/v1/settings",
            json={"theme": "dark", "webSearch": {"enabled": True, "provider": "tavily"}},
        )
        body = res.json()
        assert body["theme"] == "dark"
        assert body["webSearch"]["enabled"] is True
        assert body["telemetry"] is False
        assert (await client.get("/api/v1/settings")).json()["theme"] == "dark"
```

**Step 2: 实现 `store/app_settings.py`**

```python
"""应用级设置（仅 global）——设计 §14.20 / §14.16。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..config import store

_DEFAULTS: dict[str, Any] = {
    "locale": "zh-CN",
    "theme": "light",
    "webSearch": {"enabled": False, "provider": "tavily", "keyRef": None},
    "telemetry": False,
}


def _path() -> Path:
    return store.global_config_dir() / "settings.json"


def load() -> dict[str, Any]:
    path = _path()
    data: dict[str, Any] = {}
    if path.exists():
        try:
            data = json.loads(path.read_text("utf-8")) or {}
        except (OSError, json.JSONDecodeError):
            data = {}
    merged = {**_DEFAULTS, **data}
    merged["webSearch"] = {**_DEFAULTS["webSearch"], **(data.get("webSearch") or {})}
    merged["telemetry"] = False
    return merged


def patch(update: dict[str, Any]) -> dict[str, Any]:
    current = load()
    merged = {**current, **{k: v for k, v in update.items() if v is not None}}
    if isinstance(update.get("webSearch"), dict):
        merged["webSearch"] = {**current["webSearch"], **update["webSearch"]}
    merged["telemetry"] = False
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), "utf-8")
    return merged
```

**Step 3: 实现 `api/settings.py`**

```python
"""应用设置路由（设计 §14.8）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..store import app_settings
from .deps import require_token

router = APIRouter(tags=["settings"], dependencies=[Depends(require_token)])


class WebSearchBody(BaseModel):
    enabled: bool | None = None
    provider: str | None = None
    keyRef: str | None = None


class SettingsPatch(BaseModel):
    locale: str | None = None
    theme: str | None = None
    webSearch: WebSearchBody | None = None


@router.get("/settings")
def get_settings() -> dict:
    return app_settings.load()


@router.patch("/settings")
def patch_settings(body: SettingsPatch) -> dict:
    update = body.model_dump(exclude_unset=True)
    return app_settings.patch(update)
```

**Step 4: `main.py` 注册**（`settings as settings_api`）

**Step 5: 运行通过** — `uv run pytest tests/test_settings_api.py -v`

**Step 6: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/app_settings.py services/agent/src/fireeyeaud_agent/api/settings.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_settings_api.py
git commit -m "feat(agent): 应用设置存储与 REST"
```

---

### Task O2: Web 搜索适配器 + `web_search` 工具

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/web/__init__.py`、`web/tavily.py`、`web/custom.py`
- Create: `services/agent/src/fireeyeaud_agent/tools/web_search.py`
- Modify: `services/agent/src/fireeyeaud_agent/tools/registry.py`（增 `WebSearchArgs`；按设置门控）
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py`（`build_tool_dict(root)`）
- Test: `services/agent/tests/test_web_adapters.py`、`services/agent/tests/test_web_search.py`

**Step 1: 写失败测试（`test_web_adapters.py`）** — 复用 `httpx.MockTransport` 注入。

```python
import json

import httpx

from fireeyeaud_agent.web import custom, tavily


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_tavily_normalizes():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["api_key"] == "k"
        assert body["query"] == "收入确认"
        assert body["max_results"] == 3
        return httpx.Response(
            200,
            json={
                "results": [
                    {"title": "T", "url": "http://a", "content": "C", "score": 0.7}
                ]
            },
        )

    out = tavily.search("k", "收入确认", max_results=3, client=_client(handler))
    assert out == [{"title": "T", "url": "http://a", "content": "C", "score": 0.7}]


def test_custom_normalizes():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer k"
        body = json.loads(request.content)
        assert body["query"] == "q"
        return httpx.Response(200, json={"results": [{"title": "T", "url": "u", "content": "c"}]})

    out = custom.search("http://engine", "k", "q", max_results=3, client=_client(handler))
    assert out[0]["title"] == "T"
```

**Step 2: 实现 `web/tavily.py`**

```python
"""Tavily 搜索适配器（设计 §10 / 决策：默认关闭）。"""

from __future__ import annotations

from typing import Any

import httpx

_ENDPOINT = "https://api.tavily.com/search"
_TIMEOUT = 30.0


def search(
    api_key: str, query: str, *, max_results: int = 5, client: httpx.Client | None = None
) -> list[dict[str, Any]]:
    owned = client is None
    c = client or httpx.Client(timeout=_TIMEOUT)
    try:
        res = c.post(_ENDPOINT, json={"api_key": api_key, "query": query, "max_results": max_results})
        res.raise_for_status()
        data = res.json().get("results", [])
    finally:
        if owned:
            c.close()
    return [
        {"title": r.get("title"), "url": r.get("url"), "content": r.get("content"), "score": r.get("score")}
        for r in data
    ]
```

**Step 3: 实现 `web/custom.py`**（`baseUrl` 由设置提供；POST `{query, max_results}`，Bearer key，解析 `results[]`）。

**Step 4: 实现 `web/__init__.py`**：`adapter_for(provider)`（`tavily`/`custom`），非法 → `E_WEB_PROVIDER`。

**Step 5: 写失败测试（`test_web_search.py`）** — 关闭时抛 `E_WEB_DISABLED`；开启 + monkeypatch `app_settings.load` 与适配器 → 归一化结果。

**Step 6: 实现 `tools/web_search.py`**

```python
"""web_search：联网检索（默认关闭；设计 §10 / §17.1）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import ApiError

DEFAULT_MAX = 5


def web_search(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    from ..store import app_settings, secrets
    from ..web import adapter_for

    cfg = app_settings.load().get("webSearch") or {}
    if not cfg.get("enabled"):
        raise ApiError("E_WEB_DISABLED", 403, "error.webDisabled")
    provider = cfg.get("provider") or "tavily"
    api_key = secrets.get(cfg.get("keyRef") or "") or ""
    query = str(params.get("query") or "")
    try:
        max_results = int(params.get("maxResults") or DEFAULT_MAX)
    except (TypeError, ValueError):
        max_results = DEFAULT_MAX
    adapter = adapter_for(provider)
    try:
        if provider == "custom":
            results = adapter.search(cfg.get("baseUrl") or "", api_key, query, max_results=max_results)
        else:
            results = adapter.search(api_key, query, max_results=max_results)
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError("E_WEB_CONN", 502, "error.webConn", {"reason": str(exc)}) from exc
    return {"results": results, "provider": provider}
```

> `secrets` 模块在里程碑 P 创建；O2 中先以 `settings.webSearch` 的 `keyRef` 经 `store/secrets.py`（P 前置可先建最小内存版，见 P1）。**执行顺序建议：先做 P1 的 `store/secrets.py` 骨架，再做 O2**，或 O2 暂用 `settings.model_api_key` 兜底。计划采用：O2 依赖 P1 的最小 `secrets.get()`（内存字典，默认空），P 再补主进程推送链路。

**Step 7: registry 门控**

```python
class WebSearchArgs(BaseModel):
    query: str = Field(description="搜索查询")
    maxResults: int | None = Field(default=None, description="结果条数上限")


def _web_enabled() -> bool:
    from ..store import app_settings

    return bool((app_settings.load().get("webSearch") or {}).get("enabled"))


def _specs() -> list[...]:
    return [* _SPECS, ("web_search", "联网搜索（需在设置页开启）。", web_search, WebSearchArgs)] if _web_enabled() else _SPECS
```

`build_tool_dict(root=None)`、`build_langchain_tools(root)` 改用 `_specs()`；`graph.py` 的 `build_tool_dict(root)` 传 root。

**Step 8: i18n**（`error.webDisabled` / `error.webConn` / `error.webProvider`）；**Step 9: 运行通过** — `uv run pytest tests/test_web_adapters.py tests/test_web_search.py tests/test_tool_registry.py -v`

**Step 10: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/web services/agent/src/fireeyeaud_agent/tools/web_search.py services/agent/src/fireeyeaud_agent/tools/registry.py services/agent/src/fireeyeaud_agent/agent/graph.py services/agent/tests/test_web_adapters.py services/agent/tests/test_web_search.py services/agent/tests/test_tool_registry.py packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts
git commit -m "feat(agent): web_search 联网检索工具（Tavily/自定义）"
```

---

### Task O3: 设置页联网检索区 + 前端 settings 对接

**Files:**
- Modify: `packages/shared/src/types.ts`（`AppSettings` / `WebSearchSettings`）
- Modify: `apps/renderer/src/lib/api.ts`（`getSettings` / `patchSettings`）
- Modify: `apps/renderer/src/store/settings.ts`（加载/保存后端设置，保留 localStorage 首屏）
- Modify: `apps/renderer/src/components/panels/SettingsPanel.tsx`（`web` 区）
- Modify: `packages/shared/src/locales/{zh-CN,en-US}.ts`（`settings` 扩充）

**Step 1: 类型**

```ts
export interface WebSearchSettings {
  enabled: boolean;
  provider: 'tavily' | 'custom' | string;
  keyRef?: string | null;
  baseUrl?: string | null;
}
export interface AppSettings {
  locale: string;
  theme: ThemeMode;
  webSearch: WebSearchSettings;
  telemetry: boolean;
}
```

**Step 2: API + store**：`getSettings()` / `patchSettings(patch)`；store 增 `loadSettings` / `saveWebSearch`（key 经 `window.fireeyeaud.putSecret` 得 ref 再 PATCH）。

**Step 3: SettingsPanel `web` 区**：开关（enabled）、provider 下拉、key 输入（password）、custom 时 baseUrl。

**Step 4: i18n `settings`**：`webEnabled`、`webProvider`、`webKey`、`webBaseUrl`、`webHint`。

**Step 5: 验证** — `npm run renderer:typecheck`

**Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/locales/zh-CN.ts packages/shared/src/locales/en-US.ts apps/renderer/src/lib/api.ts apps/renderer/src/store/settings.ts apps/renderer/src/components/panels/SettingsPanel.tsx
git commit -m "feat(renderer): 设置页联网检索"
```

---

## 里程碑 P — safeStorage 全量迁移

> **风险最高**：改凭据来源并改动 Phase 5/5.5 的现有测试。执行时按 P1→P2→P3 顺序，先让 sidecar 内存凭据 + 端点就绪，再改 DB/KB/模型读取，最后接主进程。

### Task P1: sidecar 内存凭据存储 + `/secrets` 端点

**Files:**
- Create: `services/agent/src/fireeyeaud_agent/store/secrets.py`
- Create: `services/agent/src/fireeyeaud_agent/api/secrets.py`
- Modify: `services/agent/src/fireeyeaud_agent/main.py`
- Test: `services/agent/tests/test_secrets_api.py`

**Step 1: 写失败测试**

```python
import httpx

from fireeyeaud_agent.main import app
from fireeyeaud_agent.store import secrets


async def test_secrets_push_and_get(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    secrets.clear()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.post("/api/v1/secrets", json={"items": {"sec_1": "p@ss"}})
        assert res.status_code == 200
        assert secrets.get("sec_1") == "p@ss"
    secrets.clear()
```

**Step 2: 实现 `store/secrets.py`**

```python
"""sidecar 内存凭据（设计 §17.2：明文仅内存持有，不落盘、不写日志）。"""

from __future__ import annotations

_SECRETS: dict[str, str] = {}


def set_all(items: dict[str, str]) -> None:
    _SECRETS.clear()
    _SECRETS.update({str(k): str(v) for k, v in (items or {}).items()})


def get(ref: str | None) -> str | None:
    if not ref:
        return None
    return _SECRETS.get(ref)


def clear() -> None:
    _SECRETS.clear()
```

**Step 3: 实现 `api/secrets.py`**

```python
"""凭据下发路由（设计 §17.2）。仅 127.0.0.1 + token，写入内存。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..store import secrets
from .deps import require_token

router = APIRouter(tags=["secrets"], dependencies=[Depends(require_token)])


class SecretsBody(BaseModel):
    items: dict[str, str]


@router.post("/secrets")
def push_secrets(body: SecretsBody) -> dict:
    secrets.set_all(body.items)
    return {"ok": True, "count": len(body.items)}
```

**Step 4: `main.py` 注册**；**Step 5: 运行通过**；**Step 6: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/secrets.py services/agent/src/fireeyeaud_agent/api/secrets.py services/agent/src/fireeyeaud_agent/main.py services/agent/tests/test_secrets_api.py
git commit -m "feat(agent): sidecar 内存凭据存储与下发端点"
```

---

### Task P2: DB / KB / 模型改读内存凭据，移除明文文件

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/db.py`（`set_secret`/`get_secret`/`_load_secrets`/`_secrets_path` → 走 `secrets`；`create_connection` 接受 `credRef`）
- Modify: `services/agent/src/fireeyeaud_agent/store/knowledge.py`（同上，`apiKeyRef`）
- Modify: `services/agent/src/fireeyeaud_agent/config/models.py`（`build_chat_model` 读有效模型配置 + `secrets.get(apiKeyRef)`）
- Modify: `services/agent/src/fireeyeaud_agent/api/db.py`、`api/knowledge.py`、`api/models.py`（创建体改用 `credRef`/`apiKeyRef`，不再收明文）
- Test: 更新 `tests/test_db_store.py`、`tests/test_knowledge_store.py`；新增 `tests/test_model_config_store.py`

**Step 1: 改写 `store/db.py` 凭据部分**

```python
from . import secrets


def set_secret(connection_id: str, password: str | None) -> None:
    # 兼容测试：直接写入内存凭据（主进程推送为正式路径）
    if password:
        current = dict(secrets._SECRETS)  # noqa: SLF001 - 测试写入
        current[connection_id] = password
        secrets.set_all(current)
    else:
        current = dict(secrets._SECRETS)
        current.pop(connection_id, None)
        secrets.set_all(current)


def get_secret(connection_id: str) -> str | None:
    return secrets.get(connection_id)
```

> 更干净的做法：给 `secrets` 增 `set_one(ref,value)` / `remove(ref)`，避免触碰私有字段。**采用**：
> `secrets.set_one(ref, value)`、`secrets.remove(ref)`；`db.set_secret`/`knowledge.set_secret` 改调它们。

`create_connection`：`payload` 保留入参 `credRef`（若前端传来）；未传则回退 `item["id"]`。

**Step 2: 更新 `test_db_store.py`** — 去掉文件断言，改为：
```python
from fireeyeaud_agent.store import secrets
...
db.set_secret("conn_1", "p@ss")
assert secrets.get("conn_1") == "p@ss"
db.delete_connection("conn_1", "project", root=...)
assert secrets.get("conn_1") is None
```
（并在测试开头 `secrets.clear()`；临时改 `FIREYEAUD_GLOBAL_DIR` 不再影响凭据。）

**Step 3: `store/knowledge.py`** 同理：`_secrets_path`/`_load_secrets` 删除，`set_secret`/`get_secret` 走 `secrets`；`create_provider` 接受 `apiKeyRef`。

**Step 4: `config/models.py`**

```python
def build_chat_model(root: Path | None = None) -> ChatOpenAI:
    from ..store import secrets
    from ..config import store as cfg_store

    profile = None
    try:
        items = cfg_store.load_effective("models", root)
        if items:
            profile = next((m for m in items if m.get("isDefault")), items[0])
    except Exception:  # noqa: BLE001
        profile = None
    if profile:
        base_url = str(profile.get("baseUrl") or "").strip()
        model = str(profile.get("model") or "qwen2.5")
        temperature = float(profile.get("temperature") or 0.2)
        api_key = secrets.get(profile.get("apiKeyRef")) or settings.model_api_key or "not-needed"
    else:
        base_url = (settings.model_base_url or "").strip()
        model = settings.model_name
        temperature = settings.model_temperature
        api_key = settings.model_api_key or "not-needed"
    if not base_url:
        raise ApiError("E_LLM_UNAVAILABLE", 503, "error.llmUnavailable")
    return ChatOpenAI(base_url=base_url, model=model, api_key=api_key, temperature=temperature)
```

`graph.py`：`build_chat_model(root)`。

> 保留 `test_model_config.py` 既有两条（无 store 项时回退 settings）：在测试中确保 global/project 无 models 项（`monkeypatch.setenv` 指向空目录）即可通过；新增一条：写入 project models 项 + `secrets.set_one("mdl_1", "sk-x")` → `build_chat_model(root)` 用该 base_url/model。

**Step 5: API 层去明文**
- `api/db.py` `ConnectionBody`：`password` → `credRef`（可选）；`create_connection(data)` 不再 pop password。
- `api/knowledge.py` `ProviderBody`：`apiKey` → `apiKeyRef`（可选）。
- `api/models.py` `ModelBody`：`apiKeyRef`（已有），去 `password` 类字段（无）。

**Step 6: 运行通过** — `uv run pytest tests/test_db_store.py tests/test_knowledge_store.py tests/test_model_config.py tests/test_model_config_store.py tests/test_db_api.py tests/test_kb_api.py -v`

**Step 7: Commit**

```bash
git add services/agent/src/fireeyeaud_agent/store/db.py services/agent/src/fireeyeaud_agent/store/knowledge.py services/agent/src/fireeyeaud_agent/config/models.py services/agent/src/fireeyeaud_agent/api/db.py services/agent/src/fireeyeaud_agent/api/knowledge.py services/agent/src/fireeyeaud_agent/agent/graph.py services/agent/tests/
git commit -m "refactor(agent): 凭据改读内存存储，移除明文密钥文件"
```

---

### Task P3: Electron 主进程 safeStorage + IPC + 推送

**Files:**
- Create: `apps/desktop/src/secrets.cjs`
- Modify: `apps/desktop/src/main.cjs`（注册 secrets IPC；sidecar 就绪/变更时推送）
- Modify: `apps/desktop/src/sidecar.cjs`（暴露 `pushSecrets()` 或主进程直接 fetch；见下）
- Modify: `apps/desktop/src/preload.cjs`、`apps/renderer/src/env.d.ts`
- Modify: `apps/renderer/src/lib/api.ts`（创建体改用 ref）/ `DatabasePanel.tsx` / `KnowledgePanel.tsx` / 模型表单
- Test: `apps/desktop/test/secrets.test.mjs`

**Step 1: 实现 `secrets.cjs`**（可注入 `safeStorage` 便于测试）

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createSecretsStore({ dir, safeStorage, logger } = {}) {
  const file = path.join(dir, 'secrets.json');
  const load = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
  };
  const save = (data) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };
  const canEncrypt = () => Boolean(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
  return {
    put(plaintext) {
      const ref = `sec_${crypto.randomBytes(9).toString('hex')}`;
      const data = load();
      data[ref] = canEncrypt()
        ? safeStorage.encryptString(plaintext).toString('base64')
        : Buffer.from(plaintext, 'utf8').toString('base64');
      save(data);
      if (!canEncrypt() && logger) logger.error('[secrets] safeStorage unavailable; plaintext base64 fallback');
      return ref;
    },
    get(ref) {
      const raw = load()[ref];
      if (raw == null) return null;
      const buf = Buffer.from(raw, 'base64');
      return canEncrypt() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    },
    remove(ref) { const d = load(); delete d[ref]; save(d); },
    refs() { return Object.keys(load()); },
    all() { return Object.fromEntries(Object.keys(load()).map((r) => [r, this.get(r)])); },
  };
}
module.exports = { createSecretsStore };
```

**Step 2: 写测试（`test/secrets.test.mjs`）** — 用假的 `safeStorage`（`isEncryptionAvailable:()=>true`, `encryptString:(s)=>Buffer.from('ENC:'+s)`, `decryptString:(b)=>b.toString().slice(4)`）验证 put/get/remove/持久化。

**Step 3: `main.cjs`**：
- `const secrets = createSecretsStore({ dir: app.getPath('userData'), safeStorage, logger })`（在 `app.whenReady` 后，`app.getPath` 可用）。
- IPC：`secret:put` → `secrets.put(plaintext)`；`secret:delete` → `secrets.remove(ref)`；`secret:refs`。
- 推送：`pushSecretsToSidecar()` 用 `sidecar.getInfo().port/token` `fetch('http://127.0.0.1:'+port+'/api/v1/secrets', {method:'POST', headers, body: JSON.stringify({items: secrets.all()})})`；在 `sidecar.onStatus` 变为 running 时与每次 secret 写/删后调用。
- `preload.cjs`：`putSecret`, `deleteSecret`。
- `env.d.ts`：`putSecret(plaintext:string):Promise<string>`, `deleteSecret(ref:string):Promise<{ok:boolean}>`。

**Step 4: renderer**：`DatabasePanel` 提交前 `const credRef = form.password ? await window.fireeyeaud.putSecret(form.password) : undefined`，body 传 `credRef`；`KnowledgePanel` 同（`apiKeyRef`）；模型表单同。

**Step 5: 验证** — `npm run desktop:test`（含新 secrets 测试）→ 全绿；`npm run renderer:typecheck`。

**Step 6: Commit**

```bash
git add apps/desktop/src/secrets.cjs apps/desktop/src/main.cjs apps/desktop/src/preload.cjs apps/desktop/test/secrets.test.mjs apps/renderer/src/env.d.ts apps/renderer/src/lib/api.ts apps/renderer/src/components/panels/DatabasePanel.tsx apps/renderer/src/components/panels/KnowledgePanel.tsx
git commit -m "feat(desktop): safeStorage 凭据存储与 sidecar 下发"
```

---

### Task P4: 移除遗留明文文件处理与偏差清理

**Files:**
- Modify: 删除 `store/db.py` / `store/knowledge.py` 中 `_secrets_path` 残留（P2 已删；本任务确认无引用）
- Modify: `services/agent/tests/test_db_store.py` / `test_knowledge_store.py`（若 P2 未清）
- 文档：README 偏差段更新

**Step 1**：`grep -rn "db_secrets\|kb_secrets" services/agent/src` → 无命中。
**Step 2**：`uv run pytest` → 全绿。
**Step 3: Commit**

```bash
git add -A
git commit -m "chore(agent): 清理明文密钥文件残留"
```

---

## 里程碑 Q — 打包发版

### Task Q1: PyInstaller sidecar

**Files:**
- Create: `services/agent/fireeyeaud-agent.spec`
- Create: `services/agent/scripts/build-agent.ps1`（Windows）/ `.sh`
- Modify: `services/agent/pyproject.toml`（dev 依赖增 `pyinstaller`）
- Test: 无单测；本地构建验证

**Step 1: 安装** — `cd services/agent && uv add --dev pyinstaller`

**Step 2: 实现 `fireeyeaud-agent.spec`**

```python
# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("sqlalchemy.dialects")
    + collect_submodules("sqlglot")
)

a = Analysis(
    ["src/fireeyeaud_agent/__main__.py"],
    pathex=["src"],
    hiddenimports=hiddenimports,
    datas=[],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, name="fireeyeaud-agent", console=False)
```

**Step 3: 新建 `src/fireeyeaud_agent/__main__.py`**

```python
"""PyInstaller 入口：以随机/环境端口启动 uvicorn。"""
import os
import uvicorn


def main() -> None:
    port = int(os.environ.get("FIREYEAUD_PORT", "8765"))
    uvicorn.run("fireeyeaud_agent.main:app", host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
```

**Step 4: 构建脚本 `scripts/build-agent.ps1`**：`uv run pyinstaller fireeyeaud-agent.spec --noconfirm --clean`，产物 `dist/fireeyeaud-agent.exe`。

**Step 5: 本地验证（可构建）** — `uv run pyinstaller fireeyeaud-agent.spec --noconfirm` → 产出 `dist/fireeyeaud-agent.exe`；`./dist/fireeyeaud-agent.exe` 能启动 `GET /health`（人工/脚本）。

**Step 6: Commit**

```bash
git add services/agent/fireeyeaud-agent.spec services/agent/src/fireeyeaud_agent/__main__.py services/agent/scripts/build-agent.ps1 services/agent/pyproject.toml services/agent/uv.lock
git commit -m "build(agent): PyInstaller sidecar 打包配置"
```

---

### Task Q2: electron-builder 配置 + 主进程消费打包产物

**Files:**
- Modify: `apps/desktop/package.json`（`build` 字段：`appId`、`productName`、`files`、`extraResources`）
- Modify: `apps/desktop/src/sidecar.cjs`（发布态解析 `process.resourcesPath/agent/fireeyeaud-agent.exe`）

**Step 1: `apps/desktop/package.json` 增**

```json
"build": {
  "appId": "com.fireeyeaud.app",
  "productName": "火眼审计助手",
  "files": ["src/**/*", "loading.html"],
  "extraResources": [
    { "from": "../../services/agent/dist/fireeyeaud-agent.exe", "to": "agent/fireeyeaud-agent.exe" }
  ],
  "directories": { "output": "release" },
  "win": { "target": "nsis" }
}
```

**Step 2: `sidecar.cjs`** — 发布态（`app.isPackaged`）用 `path.join(process.resourcesPath, 'agent', 'fireeyeaud-agent.exe')`；开发态维持 `pythonExeFor`。

**Step 3: 验证** — `npm run renderer:build && npx electron-builder --help`（配置解析）；**不**实际产出安装包（决策）。

**Step 4: Commit**

```bash
git add apps/desktop/package.json apps/desktop/src/sidecar.cjs
git commit -m "build(desktop): electron-builder 打包配置"
```

---

### Task Q3: GitHub Actions CI + 安全加固复核

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `apps/desktop/src/main.cjs`（CSP 增 `img-src 'self' data:;` 等必要项复核；保持严格）

**Step 1: `release.yml`**（windows-latest）：setup-python → uv sync → pyinstaller 构建 sidecar → setup-node → npm ci → renderer:build → electron-builder --win → 上传 artifact（不签名）。

**Step 2: CSP 复核**：确认 `connect-src 'self' http://127.0.0.1:*`（已有）；补 `img-src 'self' data:`（图谱/图标可能需要）；`object-src 'none'`、`base-uri 'self'`、`frame-ancestors 'none'`。

**Step 3: 本地验证** — `npm run renderer:build && npm run desktop:test` → 全绿。

**Step 4: Commit**

```bash
git add .github/workflows/release.yml apps/desktop/src/main.cjs
git commit -m "ci: 发布流水线与 CSP 加固"
```

---

### Task Q4: 端到端验收 + 文档

**Step 1: 后端全量** — `cd services/agent && uv run pytest` → 全绿。
**Step 2: 前端** — `npm run renderer:typecheck && npm run renderer:build && npm run desktop:test` → 全绿。
**Step 3: 手动 E2E**（需 GUI/真实服务）：
1. 设置页开启联网检索 → 填 Tavily key → 对话「联网查…」→ `web_search` 生效并留证据；
2. MCP/Skills 面板增删列项；启用技能后系统提示词生效；
3. DB/KB/模型填 key → 确认 `<userData>/secrets.json` 为密文、无明文 `db_secrets.json`/`kb_secrets.json`；
4. `scripts/build-agent.ps1` 产出 sidecar；`electron-builder` 可解析配置。
**Step 4: 更新 README**（Phase 6 段 + 偏差：MCP 配置级不执行、web 默认关、打包仅配置 + CI）+ 本计划「Phase 6 实现记录」。
**Step 5: Commit**

```bash
git add -A
git commit -m "docs: Phase 6 验收记录与偏差说明"
```

---

## 风险与注意事项

- **safeStorage 改动面大**：触达 Phase 5/5.5 测试与 DB/KB/模型三处凭据来源；建议严格 P1→P2→P3 顺序，每步全量回归。
- **主进程推送时序**：sidecar 未就绪时推送会失败；需在 `onStatus=running` 与 secret 变更后都触发，并容错重试。
- **模型配置驱动**：`build_chat_model` 改为读 store 可能改变既有行为（此前忽略面板配置）；需确保无配置时回退 settings，且 `test_model_config.py` 通过。
- **MCP 不执行**：面板「工具列表」为配置项 `permissions.toolsAllow`，非真实发现；README 明示。
- **PyInstaller 体积/冷启**：单文件体积大、首次启动慢；CI 产出可能偏慢，本地仅验证可构建。
- **CI 无签名**：Windows 安装包未签名，安装提示；README 标注。
- **`_specs()` 门控**：web 工具按设置动态加入会导致 `test_tool_registry` 需按不同设置断言；测试默认关闭时应为 6。
- **`svg`/图谱 CSP**：新增 `img-src` 等需复核不破坏既有渲染。

---

## Phase 6 实现记录（2026-10-10）

**执行方式**：本会话内逐里程碑执行（用户选项 1），全部在 `main` 分支；实际顺序
M → N → P1 → O → P2 → P3 → P4 → Q（O2 依赖 P1 的 `store/secrets.py`，O3 的密钥经 P3 的
`putSecret` 落地）。

**提交序列**

| 提交 | 里程碑 | 说明 |
|---|---|---|
| `4b4e7e2` | M1 | MCP Server 配置存储与 REST |
| `a7ede9a` | M2 | MCP 面板（配置/启停/权限） |
| `89581ad` | N1 | 技能包存储、REST 与提示词注入 |
| `6ab87bd` | N2 | Skills 面板 |
| `18eb507` | O1 | 应用设置存储与 REST |
| `4bb1023` | P1 | sidecar 内存凭据存储与下发端点 |
| `85bb6da` | O2 | web_search 联网检索工具（Tavily/自定义） |
| `0251766` | O3 | 设置页联网检索 |
| `aa52434` | P2 | 凭据改读内存存储，移除明文密钥文件 |
| `f8a8758` | P2 补 | `sql_query`/`kb_search` 按 `credRef`/`apiKeyRef` 读取凭据 |
| `cd36583` | P3 | safeStorage 凭据存储与 sidecar 下发 |
| `befeaf0` | Q1 | PyInstaller sidecar 打包配置 |
| `6d1f2d5` | Q2 | electron-builder 打包配置 |
| `ad79863` | Q3 | 发布流水线与 CSP 加固 |

**验证证据**

- 后端：`uv run pytest` → **149 passed**（Phase 5.5 末 130，+19）。
- 渲染层：`npm run renderer:typecheck` ✓、`npm run renderer:build` ✓。
- 桌面：`npm run desktop:test` → **5 pass**（新增 `test/secrets.test.mjs` 3 条 + 原 sidecar 2 条；
  首次冷启动因 Python 依赖变化偶发超时，预热后通过，非回归）。
- 打包：`uv run pyinstaller fireeyeaud-agent.spec` 产出 `dist/fireeyeaud-agent.exe`，启动后
  `GET /api/v1/health` 返回 `{"status":"ok",...}`；electron-builder `build` 配置经 Node 校验
  （`appId`/`productName`/`extraResources` 源存在）。

**实现偏差 / 说明**

1. **P4 为纯验证任务**：`grep -rn "db_secrets|kb_secrets|_load_secrets|_secrets_path" services/agent/src`
   无命中（P2 已删除），无代码改动，故无独立提交。
2. **O3 与 P3 的时序**：O3 提交时 `putSecret` IPC 尚未落地，`env.d.ts` 先以可选方法声明、
   store 以 `window.fireeyeaud?.putSecret` 守卫；P3 落地后改为必选并实现真实 IPC。
3. **模型 key UI**：Models 面板本期未提供 API Key 输入框；`build_chat_model` 已支持
   `profile.apiKeyRef → secrets`，无 ref 时回退 `FIREYEAUD_MODEL_API_KEY`。
4. **MCP 仅配置级**：不加载 / 执行 MCP Server；面板「工具列表」=`permissions.toolsAllow`。
5. **打包**：仅本地验证 PyInstaller 可产出 sidecar 与 electron-builder 配置有效；未产出 / 签名安装包，
   CI 安装包未签名。
6. **`*.spec` 忽略修正**：`.gitignore` 增 `!services/agent/fireeyeaud-agent.spec` 以纳入版本管理。
