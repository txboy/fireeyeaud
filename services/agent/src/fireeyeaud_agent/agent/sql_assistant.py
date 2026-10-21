"""SQL 助手：把表结构 / 当前查询 / 样本结果整理成上下文，流式生成只读 SQL。

设计要点（见 `docs/plans/2026-10-21-db-sql-assistant.md`）：
- 只生成只读查询；本模块**不连接数据库、不执行 SQL、不读取数据**。
- 上下文永不含密码、凭据引用、主机/连接串、授权信息。
- 服务端不信任前端：历史消息与上下文再做一次上限兜底，超限截断而非报错。
- 不引入会话概念；事件信封与 `graph.py` 的 SSE 结构一致。
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import TYPE_CHECKING, Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from ..util import now_iso

if TYPE_CHECKING:  # pragma: no cover - 仅类型检查用，避免循环导入
    from ..api.db import SqlChatBody

logger = logging.getLogger(__name__)

# ---- 上限（与前端 buildDbSqlContext 的限制保持一致） ----
MAX_CONTEXT_CHARS = 60_000
MAX_RESULT_ROWS = 20
MAX_RESULT_COLS = 100
MAX_CELL_CHARS = 500
MAX_CURRENT_COLUMNS = 80
MAX_RELATED_COLUMNS = 40
MAX_TABLES = 40
MAX_HISTORY_MESSAGES = 40
MAX_HISTORY_CHARS = 60_000
MAX_MESSAGE_CHARS = 8_000

_DIALECTS = {
    "sqlite": "SQLite",
    "postgresql": "PostgreSQL",
    "mysql": "MySQL",
    "mssql": "SQL Server（T-SQL）",
    "oracle": "Oracle（PL/SQL）",
    "access": "Access（Jet SQL）",
}

_IDENT_HINT = {
    "sqlite": "双引号 \"...\"",
    "postgresql": "双引号 \"...\"",
    "mysql": "反引号 `...`",
    "mssql": "方括号 [...]",
    "oracle": "双引号 \"...\"",
    "access": "方括号 [...]",
}

SYSTEM_PROMPT = """你是「火眼审计助手」的数据库查询助手，帮助审计人员用自然语言得到可执行的只读 SQL。

## 只读约束
- 只生成**只读**查询：SELECT、聚合、子查询、CTE（WITH）、EXPLAIN。
- 禁止 INSERT / UPDATE / DELETE / DROP / ALTER / CREATE / TRUNCATE、禁止调用存储过程、禁止多语句（一次只给一条语句）。

## 方言与标识符
- 必须严格使用上下文给出的数据库方言（本次为 {dialect}）；支持 PostgreSQL、MySQL、SQL Server、Oracle、SQLite、Access。
- 标识符引用遵循该方言：Access 用方括号 [...]，MySQL 用反引号 `...`，SQL Server 用方括号 [...]，其余用双引号 "..."（本次为 {ident_hint}）。
- 只能使用上下文中出现的表和列，不得编造表名、列名、函数或取值。

## 输出格式
- 先给一句简短说明，再给 SQL；如有筛选条件或假设，简要列出。
- 最终答复必须包含至少一个 ```sql 代码块；一个代码块只放一条可执行语句。
- 不能声称「已执行」「已查到结果」——执行由用户点击按钮完成。
- 上下文中的查询结果是**样本**，不代表全量数据，不要据此编造统计结论。

## 澄清
- 需求不明确或缺少关键条件时，先提一个澄清问题，不要猜测。

## 语言
- 使用与用户相同的语言回复（参考 locale：{locale}）。

## 上下文
{context}"""


def _truncate(value: Any, limit: int = MAX_CELL_CHARS) -> Any:
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + "…"
    return value


_SECRET_KEYS = frozenset(
    {
        "password",
        "passwd",
        "pwd",
        "credref",
        "credRef",
        "secret",
        "apikey",
        "apiKey",
        "apiKeyRef",
        "token",
        "host",
        "port",
        "url",
        "connectionString",
        "authorization",
        "username",
    }
)


def _scrub(value: Any, depth: int = 0) -> Any:
    """递归剔除凭据类字段：上下文不允许把密码 / 凭据引用 / 连接串送给模型。"""
    if depth > 6:
        return value
    if isinstance(value, dict):
        return {
            k: _scrub(v, depth + 1)
            for k, v in value.items()
            if str(k) not in _SECRET_KEYS
        }
    if isinstance(value, list):
        return [_scrub(v, depth + 1) for v in value]
    return value


def _trim_rows(context: dict[str, Any]) -> dict[str, Any]:
    """结果行按上限截断（返回副本，不修改入参）。"""
    data = dict(context)
    result = data.get("result")
    if not isinstance(result, dict):
        return data
    rows = result.get("rows") or []
    columns = list(result.get("columns") or [])
    truncated = bool(data.get("resultTruncated"))

    if len(columns) > MAX_RESULT_COLS:
        columns = columns[:MAX_RESULT_COLS]
        truncated = True
    if len(rows) > MAX_RESULT_ROWS:
        truncated = True
        rows = rows[:MAX_RESULT_ROWS]

    trimmed: list[list[Any]] = []
    for row in rows:
        values = list(row)[:MAX_RESULT_COLS]
        if len(list(row)) > MAX_RESULT_COLS:
            truncated = True
        trimmed.append([_truncate(v) for v in values])
    # 每行按列数对齐，避免前端行列不齐导致误读
    trimmed = [[*r, *([None] * (len(columns) - len(r)))] for r in trimmed]

    data["result"] = {**result, "columns": columns, "rows": trimmed}
    data["resultTruncated"] = truncated
    return data


def _trim_tables(context: dict[str, Any]) -> dict[str, Any]:
    """表数量与列数按上限截断；当前表始终保留其列。"""
    data = dict(context)
    current = data.get("table")
    truncated = bool(data.get("tablesTruncated"))

    if isinstance(current, dict):
        cols = list(current.get("columns") or [])
        if len(cols) > MAX_CURRENT_COLUMNS:
            current = {**current, "columns": cols[:MAX_CURRENT_COLUMNS]}
            truncated = True
            data["table"] = current

    tables = []
    for entry in list(data.get("tables") or [])[:MAX_TABLES]:
        if not isinstance(entry, dict):
            continue
        cols = list(entry.get("columns") or [])
        if len(cols) > MAX_RELATED_COLUMNS:
            entry = {**entry, "columns": cols[:MAX_RELATED_COLUMNS], "truncated": True}
            truncated = True
        tables.append(entry)
    if len(list(data.get("tables") or [])) > MAX_TABLES:
        truncated = True

    data["tables"] = tables
    data["tablesTruncated"] = truncated
    return data


def _serialize(context: dict[str, Any]) -> str:
    return json.dumps(context, ensure_ascii=False, default=str)


def compact_context(context: dict[str, Any], *, max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """按上限裁剪上下文并序列化。

    裁剪顺序：1) 结果行列上限 → 2) 非当前表结构只留表名 → 3) 结果行从尾部减少
    → 4) 结果列从尾部减少 → 5) 相关表全部丢弃。任一步发生裁剪都会置
    `tablesTruncated` / `resultTruncated`。
    """
    if not isinstance(context, dict):
        context = {}

    data = _trim_rows(_trim_tables(_scrub(context)))
    text = _serialize(data)

    def mark_tables() -> None:
        data["tablesTruncated"] = True

    def mark_result() -> None:
        data["resultTruncated"] = True

    # 2) 非当前表结构只留表名
    if len(text) > max_chars and data.get("tables"):
        data["tables"] = [{"name": t.get("name")} for t in data["tables"]]
        mark_tables()
        text = _serialize(data)

    # 3) 结果行从尾部减少
    while len(text) > max_chars:
        result = data.get("result")
        rows = list(result.get("rows") or []) if isinstance(result, dict) else []
        if not rows:
            break
        rows = rows[: max(0, len(rows) - max(1, len(rows) // 4))]
        data["result"] = {**result, "rows": rows}
        mark_result()
        text = _serialize(data)

    # 4) 结果列从尾部减少
    while len(text) > max_chars:
        result = data.get("result")
        columns = list(result.get("columns") or []) if isinstance(result, dict) else []
        if not columns:
            break
        columns = columns[: max(0, len(columns) - max(1, len(columns) // 4))]
        rows = [
            list(r)[: len(columns)] for r in (result.get("rows") or [])
        ]
        data["result"] = {**result, "columns": columns, "rows": rows}
        mark_result()
        text = _serialize(data)

    # 5) 相关表全部丢弃
    if len(text) > max_chars and data.get("tables"):
        data["tables"] = []
        mark_tables()
        text = _serialize(data)

    if len(text) > max_chars:
        # 兜底：整段硬截断，保证不把超长请求发给模型
        text = text[:max_chars]
    return text


def _compact_for_model(context: dict[str, Any]) -> dict[str, Any]:
    """返回与 compact_context 相同裁剪结果的结构体（供测试/调试）。"""
    return json.loads(compact_context(context))


def normalize_history(history: list[dict[str, str]] | None) -> list[dict[str, str]]:
    """历史消息兜底：只保留 user/assistant，最近 40 条，单条 ≤8000 字符，总量 ≤60KB。"""
    items: list[dict[str, str]] = []
    for item in history or []:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        items.append({"role": role, "content": content[:MAX_MESSAGE_CHARS]})

    items = items[-MAX_HISTORY_MESSAGES:]

    total = 0
    kept: list[dict[str, str]] = []
    for item in reversed(items):
        total += len(item["content"])
        if total > MAX_HISTORY_CHARS:
            break
        kept.append(item)
    kept.reverse()
    return kept


def _dialect_of(context: dict[str, Any]) -> str:
    conn = context.get("connection") if isinstance(context.get("connection"), dict) else {}
    driver = str(conn.get("driver") or "").lower()
    return _DIALECTS.get(driver, driver or "未知方言（以表结构中可见的写法为准）")


def _ident_hint_of(context: dict[str, Any]) -> str:
    conn = context.get("connection") if isinstance(context.get("connection"), dict) else {}
    driver = str(conn.get("driver") or "").lower()
    return _IDENT_HINT.get(driver, "按目标方言选择")


def build_sql_assistant_messages(
    *,
    context: dict[str, Any],
    history: list[dict[str, str]],
    locale: str | None,
) -> list[BaseMessage]:
    """组装 [SystemMessage(含上下文), *历史消息]。"""
    context_text = compact_context(context or {})
    system = SYSTEM_PROMPT.format(
        dialect=_dialect_of(context or {}),
        ident_hint=_ident_hint_of(context or {}),
        locale=locale or "zh-CN",
        context=context_text,
    )
    messages: list[BaseMessage] = [SystemMessage(content=system)]
    for item in normalize_history(history):
        if item["role"] == "user":
            messages.append(HumanMessage(content=item["content"]))
        else:
            messages.append(AIMessage(content=item["content"]))
    return messages


def _envelope(kind: str, seq: int, data: dict[str, Any]) -> dict[str, Any]:
    return {"type": kind, "seq": seq, "ts": now_iso(), "data": data}


async def stream_sql_assistant(
    *,
    root: Path | None,
    body: "SqlChatBody",
) -> AsyncIterator[dict[str, Any]]:
    """流式生成：status → token* → done，出错则 error。

    本函数只与模型通信；不查库、不取凭据。
    """
    from ..config.models import build_chat_model
    from ..errors import ApiError

    seq = 0
    seq += 1
    yield _envelope("status", seq, {"phase": "thinking"})

    try:
        messages = build_sql_assistant_messages(
            context=body.context, history=[m.model_dump() for m in body.messages], locale=body.locale
        )
        model = build_chat_model(root, body.modelId)
        async for chunk in model.astream(messages):
            delta = chunk.content
            if not isinstance(delta, str) or not delta:
                continue
            seq += 1
            yield _envelope("token", seq, {"delta": delta})
    except ApiError as exc:
        seq += 1
        yield _envelope(
            "error",
            seq,
            {
                "code": exc.code,
                "messageKey": exc.message_key,
                "params": exc.params,
            },
        )
        return
    except Exception:  # noqa: BLE001 - 模型侧异常统一转 error 事件
        logger.exception("sql assistant stream failed")
        seq += 1
        yield _envelope("error", seq, {"messageKey": "error.internal"})
        return

    seq += 1
    yield _envelope("done", seq, {"usage": {}})