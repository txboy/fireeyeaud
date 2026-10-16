"""MCP 工具 → LangChain `StructuredTool` 适配（Phase 9 / 设计 §5.3）。

- 命名：`mcp__<serverId>__<toolName>`（双下划线避免与内置工具/其它 server 冲突）。
- JSON Schema → pydantic 动态模型（`create_model`），转换失败由调用方跳过该工具。
- 结果：`CallToolResult.content` → 文本拼接，非文本块以类型占位，并按上限截断。
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model

from ..config.settings import settings
from .client import McpToolSpec, result_text

# 工具名只允许 [A-Za-z0-9_-]，且多数 provider 限制 ≤64 字符。
_INVALID_NAME_CHARS = re.compile(r"[^A-Za-z0-9_-]")
_MAX_TOOL_NAME = 64


def tool_name(server_id: str, name: str) -> str:
    raw = f"mcp__{server_id}__{name}"
    safe = _INVALID_NAME_CHARS.sub("_", raw)
    if len(safe) > _MAX_TOOL_NAME:
        digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:8]
        safe = safe[: _MAX_TOOL_NAME - 9] + "_" + digest
    return safe


def tool_description(server_name: str, spec: McpToolSpec) -> str:
    desc = (spec.description or "").strip()
    prefix = f"[{server_name}]"
    return f"{prefix} {desc}".strip()


def _annotation(spec: Any, field_name: str) -> Any:
    """JSON Schema 片段 → Python 类型注解。无法识别时退回 `Any`。"""
    if not isinstance(spec, dict):
        return Any

    enum = spec.get("enum")
    if isinstance(enum, list) and enum:
        return Literal[tuple(enum)]  # type: ignore[valid-type]

    declared = spec.get("type")
    if isinstance(declared, list):
        # 形如 ["string", "null"]：去掉 null，其余取并集。
        non_null = [t for t in declared if t != "null"]
        anns = [_annotation({"type": t}, field_name) for t in non_null]
        if not anns:
            return Any
        if len(anns) == 1:
            return anns[0]
        from typing import Union

        return Union[tuple(anns)]  # type: ignore[return-value]

    if declared == "string":
        return str
    if declared == "integer":
        return int
    if declared == "number":
        return float
    if declared == "boolean":
        return bool
    if declared == "array":
        items = spec.get("items")
        inner = _annotation(items, field_name) if isinstance(items, dict) else Any
        return list[inner]  # type: ignore[valid-type]
    if declared == "object":
        props = spec.get("properties")
        if isinstance(props, dict) and props:
            return _model_from_props(
                f"{field_name}Model".replace("-", "_"), dict(props), spec.get("required") or []
            )
        return dict[str, Any]
    return Any


def _field_for(field_name: str, spec: Any, required: bool) -> tuple[Any, Any]:
    annotation = _annotation(spec, field_name)
    default: Any = ... if required else None
    if not required:
        annotation = Optional[annotation] if annotation is not Any else Any
        if isinstance(spec, dict) and "default" in spec:
            default = spec["default"]
    kwargs: dict[str, Any] = {}
    if isinstance(spec, dict) and spec.get("description"):
        kwargs["description"] = str(spec["description"])
    return annotation, Field(default=default, **kwargs)


def _model_from_props(name: str, props: dict[str, Any], required: list[str]) -> type[BaseModel]:
    req = {str(r) for r in required}
    fields: dict[str, Any] = {}
    for key, pspec in props.items():
        fields[str(key)] = _field_for(f"{name}_{key}", pspec, str(key) in req)
    return create_model(name, **fields)


def schema_to_model(name: str, schema: dict[str, Any] | None) -> type[BaseModel]:
    """把 MCP 工具的 `inputSchema` 转成 pydantic 模型（总有可用模型，最坏为空模型）。"""
    schema = schema or {}
    props = schema.get("properties") or {}
    required = schema.get("required") or []
    if not isinstance(props, dict):
        props = {}
    return _model_from_props(name or "Args", props, required)


def truncate(text: str, limit: int | None = None) -> str:
    cap = int(limit if limit is not None else getattr(settings, "mcp_max_output_chars", 20_000))
    if cap > 0 and len(text) > cap:
        return f"{text[:cap]}\n...[truncated {len(text) - cap} chars]"
    return text


def normalize_result(result: Any) -> str:
    """`CallToolResult` → 受限长度文本（供模型消费与 evidence 留痕）。"""
    return truncate(result_text(result))


def build_tool(
    *,
    name: str,
    description: str,
    args_schema: type[BaseModel],
    call: Callable[[dict[str, Any]], Awaitable[Any]],
) -> StructuredTool:
    """把 MCP 调用封装为异步 `StructuredTool`（模型可直接绑定）。"""

    async def _run(**kwargs: Any) -> Any:
        return await call(kwargs)

    return StructuredTool.from_function(
        coroutine=_run, name=name, description=description, args_schema=args_schema
    )


def dict_entry(
    call: Callable[[dict[str, Any]], Awaitable[Any]],
) -> Callable[[Path, dict[str, Any]], Awaitable[Any]]:
    """生成 `tool_dict[name](root, args)` 形式的执行入口（与内置工具一致）。"""

    async def _entry(_root: Path, args: dict[str, Any]) -> Any:
        return await call(args or {})

    return _entry
