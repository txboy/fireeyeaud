"""会话与消息投影（`.fireeye/checkpoints.sqlite`，设计 §14.13）。

Phase 1 采用简化的 sqlite 投影表（sessions / messages），完整 LangGraph
checkpointer 语义作为后续增强。
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from ..util import now_iso
from .project import next_counter


def _db_path(fe: Path) -> Path:
    return Path(fe) / "checkpoints.sqlite"


def _connect(fe: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(_db_path(fe)))
    con.row_factory = sqlite3.Row
    con.execute(
        "CREATE TABLE IF NOT EXISTS sessions ("
        "id TEXT PRIMARY KEY, title TEXT, createdAt TEXT, lastMessageAt TEXT)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS messages ("
        "id TEXT PRIMARY KEY, sessionId TEXT, seq INTEGER, role TEXT, content TEXT, ts TEXT)"
    )
    # 会话级上下文（勾选资源 + 模型）落库，重开应用/切换会话后仍可恢复。
    existing = {row[1] for row in con.execute("PRAGMA table_info(sessions)").fetchall()}
    if "context" not in existing:
        con.execute("ALTER TABLE sessions ADD COLUMN context TEXT")
    if "modelId" not in existing:
        con.execute("ALTER TABLE sessions ADD COLUMN modelId TEXT")
    con.commit()
    return con


def create_session(fe: Path, root: Path, title: str | None) -> dict[str, Any]:
    seq = next_counter(fe, "session", root)
    session_id = f"s_{seq}"
    ts = now_iso()
    con = _connect(fe)
    try:
        con.execute(
            "INSERT INTO sessions (id, title, createdAt, lastMessageAt) VALUES (?,?,?,?)",
            (session_id, title, ts, ts),
        )
        con.commit()
    finally:
        con.close()
    return {"id": session_id, "title": title, "createdAt": ts}


def list_sessions(fe: Path) -> list[dict[str, Any]]:
    con = _connect(fe)
    try:
        rows = con.execute(
            "SELECT id, title, createdAt, lastMessageAt, context, modelId "
            "FROM sessions ORDER BY createdAt"
        ).fetchall()
    finally:
        con.close()
    items = []
    for row in rows:
        item = dict(row)
        raw = item.get("context")
        try:
            item["context"] = json.loads(raw) if raw else None
        except (json.JSONDecodeError, TypeError):
            item["context"] = None
        items.append(item)
    return items


def update_session_context(
    fe: Path,
    session_id: str,
    context: dict[str, Any] | None,
    model_id: str | None,
) -> bool:
    """保存会话级上下文（勾选资源）与模型选择。"""
    con = _connect(fe)
    try:
        cur = con.execute(
            "UPDATE sessions SET context=?, modelId=? WHERE id=?",
            (
                json.dumps(context, ensure_ascii=False) if context is not None else None,
                model_id,
                session_id,
            ),
        )
        con.commit()
        return cur.rowcount > 0
    finally:
        con.close()


def delete_session(fe: Path, session_id: str) -> None:
    con = _connect(fe)
    try:
        con.execute("DELETE FROM messages WHERE sessionId=?", (session_id,))
        con.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        con.commit()
    finally:
        con.close()


def update_session_title(fe: Path, session_id: str, title: str) -> None:
    con = _connect(fe)
    try:
        con.execute("UPDATE sessions SET title=? WHERE id=?", (title, session_id))
        con.commit()
    finally:
        con.close()


def add_message(
    fe: Path, root: Path, session_id: str, role: str, content: Any
) -> dict[str, Any]:
    seq = next_counter(fe, "message", root)
    con = _connect(fe)
    try:
        count = con.execute(
            "SELECT COUNT(*) FROM messages WHERE sessionId=?", (session_id,)
        ).fetchone()[0]
        ts = now_iso()
        con.execute(
            "INSERT INTO messages (id, sessionId, seq, role, content, ts) VALUES (?,?,?,?,?,?)",
            (
                f"m_{seq}",
                session_id,
                count + 1,
                role,
                json.dumps(content, ensure_ascii=False),
                ts,
            ),
        )
        con.execute("UPDATE sessions SET lastMessageAt=? WHERE id=?", (ts, session_id))
        con.commit()
    finally:
        con.close()
    return {"id": f"m_{seq}", "sessionId": session_id, "seq": count + 1, "role": role}


def get_messages(fe: Path, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
    con = _connect(fe)
    try:
        rows = con.execute(
            "SELECT id, sessionId, seq, role, content, ts FROM messages "
            "WHERE sessionId=? ORDER BY seq LIMIT ?",
            (session_id, limit),
        ).fetchall()
    finally:
        con.close()
    items = []
    for row in rows:
        item = dict(row)
        try:
            item["content"] = json.loads(item["content"])
        except (json.JSONDecodeError, TypeError):
            pass
        items.append(item)
    return items
