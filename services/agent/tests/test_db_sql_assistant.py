"""SQL 助手：提示词、上下文格式化与裁剪（不连库、不调模型）。"""

from __future__ import annotations

import json

from fireeyeaud_agent.agent.sql_assistant import (
    build_sql_assistant_messages,
    compact_context,
    normalize_history,
)


def _context(*, rows: int = 2, tables: int = 2) -> dict:
    cols = [
        {"name": "id", "type": "INTEGER", "nullable": False, "primaryKey": True},
        {"name": "科目", "type": "TEXT", "nullable": True},
    ]
    related = [
        {"name": f"t{i}", "columns": [{"name": "a", "type": "INT"}, {"name": "b", "type": "TXT"}]}
        for i in range(tables)
    ]
    return {
        "connection": {"id": "c1", "name": "本地", "driver": "sqlite", "database": "book.db"},
        "table": {"name": "voucher", "columns": cols},
        "tables": related,
        "tablesTruncated": False,
        "currentSql": "SELECT * FROM voucher",
        "executedSql": "SELECT * FROM voucher LIMIT 50",
        "result": {
            "columns": ["id", "科目"],
            "rows": [[i, f"现金{i}"] for i in range(rows)],
        },
        "resultTruncated": False,
        "error": "no such column: 金额",
        "page": 2,
        "pageSize": 50,
        "total": 120,
    }


def _text_of(messages) -> str:
    return "\n".join(
        m.content if isinstance(m.content, str) else json.dumps(m.content, ensure_ascii=False)
        for m in messages
    )


def test_system_prompt_states_readonly_and_dialect_constraints() -> None:
    messages = build_sql_assistant_messages(
        context=_context(), history=[], locale="zh-CN"
    )
    system = messages[0].content

    assert messages[0].type == "system"
    # 只读：允许的语句形态
    for word in ("SELECT", "EXPLAIN"):
        assert word in system
    # 只读：禁止的写语句必须逐条列出
    for word in (
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "ALTER",
        "CREATE",
        "TRUNCATE",
    ):
        assert word in system
    # 方言与标识符引用
    assert "Access" in system and "MySQL" in system
    # 禁止编造
    assert "编造" in system
    # 必须给出 sql 代码块、一个代码块一条语句
    assert "```sql" in system
    # 不得声称已执行
    assert "已执行" in system
    # 结果只是样本
    assert "样本" in system


def test_system_prompt_carries_locale() -> None:
    zh = build_sql_assistant_messages(context=_context(), history=[], locale="zh-CN")[0]
    en = build_sql_assistant_messages(context=_context(), history=[], locale="en-US")[0]
    assert "zh-CN" in zh.content
    assert "en-US" in en.content


def test_history_order_and_roles_are_preserved() -> None:
    history = [
        {"role": "user", "content": "统计各科目金额"},
        {"role": "assistant", "content": "```sql\nSELECT 1\n```"},
        {"role": "user", "content": "只看大于 100 万的"},
    ]
    messages = build_sql_assistant_messages(
        context=_context(), history=history, locale="zh-CN"
    )

    assert messages[0].type == "system"
    tail = messages[1:]
    assert [m.type for m in tail] == ["human", "ai", "human"]
    assert tail[0].content == "统计各科目金额"
    assert "SELECT 1" in tail[1].content
    assert tail[2].content == "只看大于 100 万的"


def test_context_carries_table_columns_result_error_and_paging() -> None:
    messages = build_sql_assistant_messages(
        context=_context(), history=[{"role": "user", "content": "q"}], locale="zh-CN"
    )
    # 上下文随系统提示词进入首条消息
    system = messages[0].content

    assert "voucher" in system
    assert "科目" in system
    assert "primaryKey" in system or "主键" in system
    assert "t0" in system and "t1" in system
    assert "SELECT * FROM voucher" in system
    assert "no such column: 金额" in system
    assert '"page": 2' in system or "page=2" in system
    assert "120" in system
    assert "现金0" in system


def test_context_never_carries_secrets() -> None:
    context = _context()
    context["connection"].update(
        {
            "password": "hunter2",
            "credRef": "cred-secret",
            "host": "10.0.0.9",
            "username": "admin",
        }
    )
    text = _text_of(
        build_sql_assistant_messages(context=context, history=[], locale="zh-CN")
    )
    for secret in ("hunter2", "cred-secret", "10.0.0.9"):
        assert secret not in text


def test_compact_context_caps_result_rows() -> None:
    text = compact_context(_context(rows=21))
    data = json.loads(text)
    assert len(data["result"]["rows"]) == 20
    assert data["resultTruncated"] is True

    # 恰好 20 行不裁剪，也不应错误地标记截断
    at_limit = json.loads(compact_context(_context(rows=20)))
    assert len(at_limit["result"]["rows"]) == 20
    assert at_limit["resultTruncated"] is False


def test_compact_context_drops_related_tables_before_current_table() -> None:
    context = _context(tables=40)
    context["tables"] = [
        {"name": f"t{i}", "columns": [{"name": f"c{j}", "type": "TEXT"} for j in range(40)]}
        for i in range(40)
    ]
    text = compact_context(context, max_chars=4000)
    data = json.loads(text)

    assert len(text) <= 4000
    assert data["tablesTruncated"] is True
    # 当前表结构永远保留
    assert data["table"]["name"] == "voucher"
    assert [c["name"] for c in data["table"]["columns"]] == ["id", "科目"]
    # 相关表被裁成只剩表名
    for entry in data["tables"]:
        assert "columns" not in entry


def test_compact_context_respects_max_chars() -> None:
    context = _context(rows=20)
    context["result"]["columns"] = [f"col{i}" for i in range(100)]
    context["result"]["rows"] = [
        ["x" * 500 for _ in range(100)] for _ in range(20)
    ]
    text = compact_context(context, max_chars=3000)
    assert len(text) <= 3000


def test_compact_context_keeps_small_context_intact() -> None:
    context = _context()
    data = json.loads(compact_context(context))
    assert data["tablesTruncated"] is False
    assert data["resultTruncated"] is False
    assert len(data["result"]["rows"]) == 2
    assert data["tables"] == context["tables"]


def test_normalize_history_caps_count_and_size() -> None:
    history = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"}
        for i in range(60)
    ]
    kept = normalize_history(history)
    # 只保留最近 40 条
    assert len(kept) == 40
    assert kept[-1]["content"] == "m59"
    assert kept[0]["content"] == "m20"

    huge = [{"role": "user", "content": "y" * 20000}]
    assert len(normalize_history(huge)[0]["content"]) <= 8000

    # 非法角色被丢弃
    assert normalize_history([{"role": "system", "content": "x"}]) == []