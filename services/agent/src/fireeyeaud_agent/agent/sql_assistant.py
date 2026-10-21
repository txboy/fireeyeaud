"""SQL 助手：把表结构 / 当前查询 / 样本结果整理成上下文，流式生成只读 SQL。

设计要点（见 `docs/plans/2026-10-21-db-sql-assistant.md`）：
- 只生成只读查询。可经 `preview_table` 工具按表名读取**样本行**（服务端拼接
  `SELECT ... LIMIT 5`，不接受模型生成的 SQL），用于确认列含义与取值风格。
- 上下文永不含密码、凭据引用、主机/连接串、授权信息。
- 上下文永不含密码、凭据引用、主机/连接串、授权信息。
- 服务端不信任前端：历史消息与上下文再做一次上限兜底，超限截断而非报错。
- 不引入会话概念；事件信封与 `graph.py` 的 SSE 结构一致。
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

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
# 单条 SQL / 错误文本上限：只裁结果与表结构无法压住超长 SQL。
MAX_SQL_CHARS = 8_000
MAX_ERROR_CHARS = 2_000
# 整个请求（系统提示词 + 上下文 + 历史）的总字符上限。
MAX_PROMPT_CHARS = 120_000

# ---- 样本行工具（B2）：只按表名取样，绝不执行模型生成的 SQL ----
PREVIEW_TOOL_NAME = "preview_table"
SAMPLE_ROWS = 5
SAMPLE_COLS = 50
SAMPLE_CELL_CHARS = 200
MAX_TOOL_ROUNDS = 3
# 单条工具结果上限：需大于一次完整采样（5×50×200 ≈ 50KB），否则编码会为了
# 迁就预算把样本清空。
MAX_TOOL_MESSAGE_CHARS = 60_000
MAX_TOOL_LIMIT = 5

# 自由文本里的连接串与主机:端口（列注释、表注释、错误信息都可能带）。
# 注意：两段都必须「有序、无嵌套量词」——否则长文本上正则回溯退化成平方级
# （曾用 [a-zA-Z0-9+.-]* 匹配 300KB 的 SQL 会卡死数分钟）。
_URL_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9+.-]{0,31}://[^\s\"',;]{0,2048}")
_HOSTPORT_RE = re.compile(r"(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?![\d.])")
_SECRET_VALUE = "***"

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

## 样本行
{tool_hint}

## 裁切说明
{truncation}

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


def _scrub_text(text: str) -> str:
    """自由文本脱敏：连接串整体替换，内网 IP:端口 只保留占位符。"""
    cleaned = _URL_RE.sub(_SECRET_VALUE, text)
    return _HOSTPORT_RE.sub(_SECRET_VALUE, cleaned)


def _scrub(value: Any, depth: int = 0) -> Any:
    """递归剔除凭据类字段：上下文不允许把密码 / 凭据引用 / 连接串送给模型。"""
    if depth > 6:
        return value
    if isinstance(value, dict):
        return {
            k: _scrub(v, depth + 1)
            for k, v in value.items()
            if str(k).lower() not in _SECRET_KEYS
        }
    if isinstance(value, list):
        return [_scrub(v, depth + 1) for v in value]
    if isinstance(value, str):
        return _scrub_text(value)
    return value


def _scrub_result_columns(
    columns: list[Any], rows: list[list[Any]]
) -> tuple[list[Any], list[list[Any]], bool]:
    """结果列名同样是数据：名为 password / host / token 的列整体丢弃。"""
    keep = [i for i, name in enumerate(columns) if str(name).lower() not in _SECRET_KEYS]
    dropped = len(keep) != len(columns)
    kept_columns = [columns[i] for i in keep]
    kept_rows = [[row[i] if i < len(row) else None for i in keep] for row in rows]
    return kept_columns, kept_rows, dropped


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
        trimmed.append([_truncate(_scrub_text(v)) if isinstance(v, str) else _truncate(v) for v in values])
    # 每行按列数对齐，避免前端行列不齐导致误读
    trimmed = [[*r, *([None] * (len(columns) - len(r)))] for r in trimmed]

    columns, trimmed, dropped = _scrub_result_columns(columns, trimmed)
    if dropped:
        truncated = True

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


def _cap_sql_fields(context: dict[str, Any]) -> dict[str, Any]:
    """超长的当前 / 已执行 SQL 截断并打标记（否则只裁结果压不到预算）。"""
    data = dict(context)
    for field, flag in (("currentSql", "currentSqlTruncated"), ("executedSql", "executedSqlTruncated")):
        value = data.get(field)
        if isinstance(value, str) and len(value) > MAX_SQL_CHARS:
            data[field] = value[:MAX_SQL_CHARS] + "\n-- …（已截断）"
            data[flag] = True
    error = data.get("error")
    if isinstance(error, str) and len(error) > MAX_ERROR_CHARS:
        data["error"] = error[:MAX_ERROR_CHARS] + "…"
    return data


def compact_context(context: dict[str, Any], *, max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """按上限裁剪上下文并序列化。

    裁剪顺序：1) 结果行列上限 → 2) 非当前表结构只留表名 → 3) 结果行从尾部减少
    → 4) 结果列从尾部减少 → 5) 相关表全部丢弃。任一步发生裁剪都会置
    `tablesTruncated` / `resultTruncated`。
    """
    if not isinstance(context, dict):
        context = {}

    data = _cap_sql_fields(_trim_rows(_trim_tables(_scrub(context))))
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

    # 3) 结果行从尾部减少（rows 为空时必须跳出，否则 rows[:0] 永远不变 → 死循环）
    while len(text) > max_chars:
        result = data.get("result")
        rows = list(result.get("rows") or []) if isinstance(result, dict) else []
        if not rows:
            break
        keep = max(0, len(rows) - max(1, len(rows) // 4))
        data["result"] = {**result, "rows": rows[:keep]}
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
        # 兜底：硬截断会把 JSON 截坏，改为整体降级为纯文本说明（模型仍能看懂）
        minimal = {
            "note": "上下文超出预算，已省略；请依据表结构与用户问题作答",
            "connection": data.get("connection"),
            "table": data.get("table"),
            "tablesTruncated": True,
            "result": None,
            "resultTruncated": True,
        }
        text = _serialize(minimal)
        if len(text) > max_chars:
            text = json.dumps(
                {"note": "上下文超出预算，已省略", "tablesTruncated": True},
                ensure_ascii=False,
            )
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


def _truncation_note(context: dict[str, Any]) -> str:
    """把裁剪标记写进提示词，让模型知道「列表/结果不完整」，别当全量数据下结论。"""
    notes: list[str] = []
    if context.get("tablesTruncated"):
        notes.append("- 表结构列表或列数已截断，缺少的表/列不要猜测。")
    if context.get("resultTruncated"):
        notes.append("- 当前结果只是截断后的样本（行/列/敏感列已省略）。")
    if context.get("currentSqlTruncated") or context.get("executedSqlTruncated"):
        notes.append("- 编辑器中的 SQL 过长已截断，只可参考其结构。")
    return "\n".join(notes) if notes else "- 无（上下文完整）。"


def _dialect_of(context: dict[str, Any]) -> str:
    conn = context.get("connection") if isinstance(context.get("connection"), dict) else {}
    driver = str(conn.get("driver") or "").lower()
    return _DIALECTS.get(driver, driver or "未知方言（以表结构中可见的写法为准）")


def _ident_hint_of(context: dict[str, Any]) -> str:
    conn = context.get("connection") if isinstance(context.get("connection"), dict) else {}
    driver = str(conn.get("driver") or "").lower()
    return _IDENT_HINT.get(driver, "按目标方言选择")


def _quote_ident(driver: str, name: str) -> str:
    """按驱动转义标识符（与前端 DbDataView.quoteIdent 对齐）。"""
    if driver == "mysql":
        return f"`{name.replace('`', '``')}`"
    if driver in ("mssql", "access"):
        return f"[{name.replace(']', ']]')}]"
    return f'"{name.replace(chr(34), chr(34) * 2)}"'


def build_preview_sql(driver: str, table: str, limit: int = SAMPLE_ROWS) -> str:
    """样本行查询：恒为单条 SELECT，表名整体作为标识符转义。

    这是 B2 的安全核心——模型只能给表名，SQL 由服务端拼接，因此不存在写入、
    注入或全表聚合的通道。
    """
    try:
        size = int(limit)
    except (TypeError, ValueError):
        size = SAMPLE_ROWS
    size = max(1, min(size, MAX_TOOL_LIMIT))
    return f"SELECT * FROM {_quote_ident(driver, table)} LIMIT {size}"


def compact_sample(result: Any) -> tuple[dict[str, Any], bool]:
    """把查询结果裁成样本：5 行 / 50 列 / 单元格 200 字符。"""
    raw = result if isinstance(result, dict) else {}
    columns = list(raw.get("columns") or [])
    rows = [list(r) for r in (raw.get("rows") or [])]
    truncated = False

    if len(columns) > SAMPLE_COLS:
        columns = columns[:SAMPLE_COLS]
        truncated = True
    if len(rows) > SAMPLE_ROWS:
        rows = rows[:SAMPLE_ROWS]
        truncated = True

    trimmed: list[list[Any]] = []
    for row in rows:
        values = row[:SAMPLE_COLS]
        if len(row) > SAMPLE_COLS:
            truncated = True
        cells: list[Any] = []
        for value in values:
            if isinstance(value, str) and len(value) > SAMPLE_CELL_CHARS:
                cells.append(value[:SAMPLE_CELL_CHARS] + "…")
                truncated = True
            else:
                cells.append(value)
        trimmed.append(cells)

    payload = {
        "columns": columns,
        "rows": trimmed,
        "rowCount": len(trimmed),
    }
    return payload, truncated


# 工具可用时注入的说明；未绑定工具时必须为空，否则模型会调用不存在的工具。
TOOL_HINT = (
    "- 需要确认列含义或取值风格时，可调用 `preview_table` 查看某张表的**前 5 行样本**"
    "（只接受表名，不接受 SQL）。\n"
    "- 样本只是取样，不代表全量数据；不要据此下统计结论。"
)


def _allowed_tables(context: dict[str, Any]) -> set[str]:
    """模型可预览的表：仅请求上下文中已反射的当前表与相关表。"""
    names: set[str] = set()
    current = context.get("table")
    if isinstance(current, dict) and current.get("name"):
        names.add(str(current["name"]))
    for entry in context.get("tables") or []:
        if isinstance(entry, dict) and entry.get("name"):
            names.add(str(entry["name"]))
    return names


def encode_tool_result(
    table: str,
    payload: dict[str, Any],
    truncated: bool,
    *,
    max_chars: int = MAX_TOOL_MESSAGE_CHARS,
) -> str:
    """序列化工具结果，并保证**始终是合法 JSON** 且不超过上限。

    超限时依次降级：收紧单元格 → 砍列 → 只留 1 行 → 占位。绝不按字符截断
    （那会让模型收到半截 JSON）。
    """
    data: dict[str, Any] = {
        "table": table,
        "columns": list(payload.get("columns") or []),
        "rows": [list(r) for r in (payload.get("rows") or [])],
        "rowCount": int(payload.get("rowCount") or 0),
        "truncated": truncated,
    }

    def dump() -> str:
        return json.dumps(data, ensure_ascii=False, default=str)

    text = dump()
    if len(text) <= max_chars:
        return text

    # 1) 收紧单元格：按剩余预算反推每个单元格能占多少字符
    cells = max(1, len(data["rows"]) * max(1, len(data["columns"])))
    per_cell = max(12, (max_chars - 400) // cells - 8)
    cap = min(SAMPLE_CELL_CHARS, per_cell)
    data["rows"] = [
        [
            (cell[:cap] + "…" if isinstance(cell, str) and len(cell) > cap else cell)
            for cell in row
        ]
        for row in data["rows"]
    ]
    data["truncated"] = True
    text = dump()

    # 2) 砍列（保留至少 2 列，模型才看得出结构）
    while len(text) > max_chars and len(data["columns"]) > 2:
        keep = max(2, len(data["columns"]) - max(1, len(data["columns"]) // 4))
        data["columns"] = data["columns"][:keep]
        data["rows"] = [row[:keep] for row in data["rows"]]
        text = dump()

    # 3) 砍行（至少留 1 行）
    while len(text) > max_chars and len(data["rows"]) > 1:
        data["rows"] = data["rows"][:-1]
        data["rowCount"] = len(data["rows"])
        text = dump()

    # 4) 兜底：合法 JSON 的占位，仍明确告知模型「有表但样本被省略」
    if len(text) > max_chars:
        text = json.dumps(
            {
                "table": table[:80],
                "columns": data["columns"][:5],
                "rows": [],
                "rowCount": 0,
                "truncated": True,
                "omitted": True,
            },
            ensure_ascii=False,
        )
    return text


def _bind_tools(model: Any, tools: list[Any]) -> Any:
    """模型不支持工具绑定时退回纯生成（例如未配置模型能力）。"""
    try:
        return model.bind_tools(tools)
    except (AttributeError, NotImplementedError):
        return model


def _preview_tool() -> Any:
    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, Field

    class PreviewTableArgs(BaseModel):
        table: str = Field(description="要查看样本行的表名（必须出现在给定的表结构中）")

    def _stub(**_kwargs: Any) -> dict[str, Any]:  # pragma: no cover - 仅提供 schema
        return {}

    return StructuredTool.from_function(
        func=_stub,
        name=PREVIEW_TOOL_NAME,
        description=(
            "查看某张表的样本行（最多 5 行），用于确认列含义与取值风格。"
            "只能传表名，不接受 SQL；表必须出现在给定的表结构中。"
        ),
        args_schema=PreviewTableArgs,
    )


def _messages_chars(messages: list[BaseMessage]) -> int:
    return sum(len(str(m.content)) for m in messages)


def _shrink_tool_message(message: ToolMessage, *, max_chars: int = 2_000) -> ToolMessage:
    """请求整体超预算时，把工具结果重新编码成更小的**合法 JSON**（不按字符截断）。"""
    raw = str(message.content)
    if len(raw) <= max_chars:
        return message
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        data = {"omitted": True, "truncated": True}
    if isinstance(data, dict) and "columns" in data:
        content = encode_tool_result(
            str(data.get("table") or ""),
            {
                "columns": data.get("columns") or [],
                "rows": data.get("rows") or [],
                "rowCount": data.get("rowCount") or 0,
            },
            True,
            max_chars=max_chars,
        )
    else:
        content = json.dumps({"omitted": True, "truncated": True}, ensure_ascii=False)
    return ToolMessage(content=content, tool_call_id=message.tool_call_id)


def build_sql_assistant_messages(
    *,
    context: dict[str, Any],
    history: list[dict[str, str]],
    locale: str | None,
    tool_hint: str = "",
) -> list[BaseMessage]:
    """组装 [SystemMessage(含上下文), *历史消息]，并对**整个请求**施加总量上限。

    `tool_hint` 仅在绑定了样本行工具时传入；为空时提示词不提及任何工具。
    """
    messages: list[BaseMessage] = [SystemMessage(content="")]
    context_budget = MAX_CONTEXT_CHARS
    history = normalize_history(history)

    # 整体超限：先收紧上下文预算，再把历史从最旧的开始丢弃。
    while True:
        context_text = compact_context(context or {}, max_chars=context_budget)
        try:
            flags = json.loads(context_text)
        except (TypeError, ValueError):
            flags = {}
        system = SYSTEM_PROMPT.format(
            dialect=_dialect_of(context or {}),
            ident_hint=_ident_hint_of(context or {}),
            locale=locale or "zh-CN",
            tool_hint=tool_hint or "- 本次不提供样本行工具，请仅依据表结构作答。",
            truncation=_truncation_note(flags if isinstance(flags, dict) else {}),
            context=context_text,
        )
        messages = [SystemMessage(content=system)]
        for item in history:
            if item["role"] == "user":
                messages.append(HumanMessage(content=item["content"]))
            else:
                messages.append(AIMessage(content=item["content"]))

        overflow = sum(len(str(m.content)) for m in messages) - MAX_PROMPT_CHARS
        if overflow <= 0:
            return messages

        if history:
            # 至少丢一条，丢的越多调用次数越少
            drop = max(1, overflow // MAX_MESSAGE_CHARS + 1)
            history = history[drop:]
            # 历史被裁后若首条是助手消息，补上占位用户消息，保持对话结构合法
            if history and history[0]["role"] == "assistant":
                history = [{"role": "user", "content": "（更早的对话已省略）"}, *history]
            continue

        # 历史已空仍超限 → 收紧上下文预算后重试
        if context_budget <= 1_000:
            return messages
        context_budget = max(1_000, context_budget // 2)


def _envelope(kind: str, seq: int, data: dict[str, Any]) -> dict[str, Any]:
    return {"type": kind, "seq": seq, "ts": now_iso(), "data": data}


async def stream_sql_assistant(
    *,
    root: Path | None,
    body: "SqlChatBody",
    model: Any = None,
    preview: "Callable[[str], dict[str, Any]] | None" = None,
) -> AsyncIterator[dict[str, Any]]:
    """流式生成：status → (tool_call → tool_result)* → token* → done，出错则 error。

    `preview` 由路由注入：只接受表名，按服务端拼接的 `SELECT ... LIMIT 5` 取样本。
    本模块不持有凭据；`preview` 为 None 时不绑定工具，退回纯生成。
    """
    from ..config.models import build_chat_model
    from ..errors import ApiError

    seq = 0

    def emit(kind: str, data: dict[str, Any]) -> dict[str, Any]:
        nonlocal seq
        seq += 1
        return _envelope(kind, seq, data)

    yield emit("status", {"phase": "thinking"})

    try:
        messages: list[BaseMessage] = build_sql_assistant_messages(
            context=body.context,
            history=[m.model_dump() for m in body.messages],
            locale=body.locale,
            tool_hint=TOOL_HINT if preview is not None else "",
        )
        chat = model if model is not None else build_chat_model(root, body.modelId)
        bound = _bind_tools(chat, [_preview_tool()]) if preview is not None else chat
        allowed = _allowed_tables(body.context if isinstance(body.context, dict) else {})
        driver = str(
            (body.context.get("connection") or {}).get("driver")
            if isinstance(body.context, dict)
            else ""
        ) or str(body.driver or "")

        for round_index in range(MAX_TOOL_ROUNDS + 1):
            ai: Any = None
            async for chunk in bound.astream(messages):
                ai = chunk if ai is None else ai + chunk
                delta = chunk.content
                if isinstance(delta, str) and delta:
                    yield emit("token", {"delta": delta})

            tool_calls = list(getattr(ai, "tool_calls", []) or []) if ai is not None else []
            if not tool_calls or preview is None or round_index >= MAX_TOOL_ROUNDS:
                break

            messages.append(ai)
            for call in tool_calls:
                call_id = str(call.get("id") or f"call_{round_index + 1}")
                name = str(call.get("name") or "")
                args = call.get("args") or {}
                table = str(args.get("table") or "")

                yield emit(
                    "tool_call",
                    {"callId": call_id, "tool": name, "params": {"table": table}},
                )

                data: dict[str, Any]
                content: str
                if name != PREVIEW_TOOL_NAME:
                    data = {"callId": call_id, "ok": False, "summary": f"未知工具：{name}"}
                    content = json.dumps({"error": "unknown tool"}, ensure_ascii=False)
                elif table not in allowed:
                    data = {
                        "callId": call_id,
                        "ok": False,
                        "summary": f"{table or '（空表名）'}：不在可查看的表结构中",
                    }
                    content = json.dumps({"error": "table not available"}, ensure_ascii=False)
                else:
                    try:
                        payload, truncated = compact_sample(preview(table))
                    except ApiError as exc:
                        data = {
                            "callId": call_id,
                            "ok": False,
                            "messageKey": exc.message_key,
                            "summary": f"{table}：查询失败",
                        }
                        content = json.dumps({"error": exc.code}, ensure_ascii=False)
                    except Exception:  # noqa: BLE001 - 查询失败不应中断整轮
                        logger.exception("sql assistant preview failed")
                        data = {
                            "callId": call_id,
                            "ok": False,
                            "messageKey": "error.internal",
                            "summary": f"{table}：查询失败",
                        }
                        content = json.dumps({"error": "internal"}, ensure_ascii=False)
                    else:
                        data = {
                            "callId": call_id,
                            "ok": True,
                            "summary": (
                                f"{table}：{payload['rowCount']} 行 × "
                                f"{len(payload['columns'])} 列"
                                + ("（已截断）" if truncated else "")
                            ),
                        }
                        content = encode_tool_result(table, payload, truncated)

                yield emit("tool_result", data)
                messages.append(ToolMessage(content=content, tool_call_id=call_id))

            # 工具结果可能撑大请求：超预算就把工具结果重新编码成更小的合法 JSON
            if _messages_chars(messages) > MAX_PROMPT_CHARS:
                messages = [
                    _shrink_tool_message(item) if isinstance(item, ToolMessage) else item
                    for item in messages
                ]
    except ApiError as exc:
        yield emit(
            "error",
            {
                "code": exc.code,
                "messageKey": exc.message_key,
                "params": exc.params,
            },
        )
        return
    except Exception:  # noqa: BLE001 - 模型侧异常统一转 error 事件
        logger.exception("sql assistant stream failed")
        yield emit("error", {"messageKey": "error.internal"})
        return

    yield emit("done", {"usage": {}})