"""知识库 Provider 与启用集存储（设计 §14.19 / §14.20）。

- Provider 元数据：`config.store(kind="knowledge")` → `<scope>/knowledge.json`。
- API Key：由 Electron 主进程经 `/secrets` 下发，仅内存持有（设计 §17.2）。
- 启用集：`<scope config>/kb_enabled.json`（`{items:[...]}`）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..config import store
from . import secrets as secret_store

KIND = "knowledge"
_TYPES = {"dify", "ragflow"}


def set_secret(ref: str, api_key: str | None) -> None:
    if api_key:
        secret_store.set_one(ref, api_key)
    else:
        secret_store.remove(ref)


def get_secret(ref: str | None) -> str | None:
    return secret_store.get(ref)


def list_providers(root: Path | None = None) -> list[dict[str, Any]]:
    return store.load_effective(KIND, root)


def get_provider(
    provider_id: str, scope: str, root: Path | None = None
) -> dict[str, Any] | None:
    return store.get_item(KIND, provider_id, scope, root)


def create_provider(
    data: dict[str, Any],
    *,
    api_key: str | None = None,
    api_key_ref: str | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    from ..errors import ApiError

    ptype = str(data.get("type") or "").lower()
    if ptype not in _TYPES:
        raise ApiError("E_KB_TYPE", 400, "error.kbType", {"type": ptype})
    payload = {k: v for k, v in data.items() if k not in ("apiKey", "apiKeyRef")}
    payload["type"] = ptype
    item = store.create_item(KIND, payload, root)
    ref = api_key_ref or item["id"]
    updated = store.update_item(
        KIND, item["id"], item["scope"], {"apiKeyRef": ref}, root
    )
    if api_key:
        set_secret(ref, api_key)
    return updated


def update_provider(
    provider_id: str,
    scope: str,
    patch: dict[str, Any],
    *,
    api_key: str | None = None,
    api_key_ref: str | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    merged = dict(patch)
    if api_key_ref:
        merged["apiKeyRef"] = api_key_ref
        if api_key:
            set_secret(api_key_ref, api_key)
    elif api_key:
        set_secret(provider_id, api_key)
    return store.update_item(KIND, provider_id, scope, merged, root)


def delete_provider(provider_id: str, scope: str, root: Path | None = None) -> None:
    provider = store.get_item(KIND, provider_id, scope, root)
    store.delete_item(KIND, provider_id, scope, root)
    refs = {provider_id}
    if provider and provider.get("apiKeyRef"):
        refs.add(str(provider["apiKeyRef"]))
    for ref in refs:
        set_secret(ref, None)


# ---- 启用集 ----


def _enabled_path(scope: str, root: Path | None) -> Path:
    from ..errors import ApiError

    if scope == "project":
        if root is None:
            raise ApiError("E_NO_WORKSPACE", 409, "error.noWorkspace")
        return store.project_config_dir(root) / "kb_enabled.json"
    return store.global_config_dir() / "kb_enabled.json"


def _read_enabled(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = data.get("items", []) if isinstance(data, dict) else []
    return items if isinstance(items, list) else []


def list_enabled(scope: str, root: Path | None = None) -> list[dict[str, Any]]:
    return _read_enabled(_enabled_path(scope, root))


def set_enabled(
    scope: str, items: list[dict[str, Any]], root: Path | None = None
) -> list[dict[str, Any]]:
    normalized = [
        {
            "providerId": i.get("providerId"),
            "knowledgeId": i.get("knowledgeId"),
            "name": i.get("name"),
            "scope": scope,
            "enabled": bool(i.get("enabled", True)),
        }
        for i in items
    ]
    path = _enabled_path(scope, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"items": normalized}, ensure_ascii=False, indent=2), "utf-8"
    )
    return normalized


def list_enabled_effective(root: Path | None = None) -> list[dict[str, Any]]:
    """global ⊕ project，键 (providerId, knowledgeId)；project 覆盖 global。"""
    merged: dict[tuple, dict[str, Any]] = {
        (e.get("providerId"), e.get("knowledgeId")): e
        for e in list_enabled("global", None)
    }
    if root is not None:
        for e in list_enabled("project", root):
            merged[(e.get("providerId"), e.get("knowledgeId"))] = {
                **e,
                "scope": "project",
            }
    return list(merged.values())
