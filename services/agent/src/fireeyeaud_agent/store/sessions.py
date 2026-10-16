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


def _db_path(fe: Path) -> Path:
    return Path(fe) / "checkpoints.sqlite"


def _next_seq(con: sqlite3.Connection, table: str, prefix: str) -> int:
    """按已有 id 的最大数字后缀 +1 生成序号。

    id 的唯一性以 sqlite 投影为准，而非 project.json 的计数器：后者会随工作区
    元数据重建/丢失而被重置，若照旧使用会复用已占用的 id（IntegrityError）。
    """
    marker = f"{prefix}_"
    highest = 0
    for row in con.execute(f'SELECT id FROM "{table}"'):
        raw = str(row[0])
        if not raw.startswith(marker):
            continue
        suffix = raw[len(marker) :]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return highest + 1


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
    # 上下文压缩状态（Phase 9）：摘要与诊断字段，摘要不进 messages 表。
    for column, decl in (
        ("summary", "TEXT"),
        ("compactedUpTo", "INTEGER"),
        ("summaryModel", "TEXT"),
        ("summaryWindow", "INTEGER"),
        ("tokensEstimate", "INTEGER"),
    ):
        if column not in existing:
            con.execute(f"ALTER TABLE sessions ADD COLUMN {column} {decl}")
    con.commit()
    return con


def create_session(fe: Path, root: Path, title: str | None) -> dict[str, Any]:
    ts = now_iso()
    con = _connect(fe)
    try:
        session_id = f"s_{_next_seq(con, 'sessions', 's')}"
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
            "SELECT id, title, createdAt, lastMessageAt, context, modelId, "
            "compactedUpTo, tokensEstimate FROM sessions ORDER BY createdAt"
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
    con = _connect(fe)
    try:
        seq = _next_seq(con, "messages", "m")
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


def get_summary(fe: Path, session_id: str) -> dict[str, Any] | None:
    """读取会话摘要；无摘要返回 None。

    返回 {text, upTo, createdAt, modelId, window}。
    """
    con = _connect(fe)
    try:
        row = con.execute(
            "SELECT summary, compactedUpTo, summaryModel, summaryWindow "
            "FROM sessions WHERE id=?",
            (session_id,),
        ).fetchone()
    finally:
        con.close()
    if row is None:
        return None
    raw = row["summary"]
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    return {
        "text": str(data.get("text") or ""),
        "upTo": int(row["compactedUpTo"] or data.get("upTo") or 0),
        "createdAt": data.get("createdAt"),
        "modelId": row["summaryModel"],
        "window": row["summaryWindow"],
    }


def set_summary(
    fe: Path,
    session_id: str,
    summary: dict[str, Any],
    *,
    model_id: str | None,
    window: int | None,
) -> bool:
    """写入/更新会话摘要，并记录生成时的模型与窗口（诊断用，不用于回滚）。"""
    created = summary.get("createdAt") or now_iso()
    stored = {
        "text": str(summary.get("text") or ""),
        "upTo": int(summary.get("upTo") or 0),
        "createdAt": created,
    }
    con = _connect(fe)
    try:
        cur = con.execute(
            "UPDATE sessions SET summary=?, compactedUpTo=?, summaryModel=?, "
            "summaryWindow=? WHERE id=?",
            (
                json.dumps(stored, ensure_ascii=False),
                stored["upTo"],
                model_id,
                window,
                session_id,
            ),
        )
        con.commit()
        return cur.rowcount > 0
    finally:
        con.close()


def clear_summary(fe: Path, session_id: str) -> None:
    con = _connect(fe)
    try:
        con.execute(
            "UPDATE sessions SET summary=NULL, compactedUpTo=NULL, "
            "summaryModel=NULL, summaryWindow=NULL WHERE id=?",
            (session_id,),
        )
        con.commit()
    finally:
        con.close()


def set_tokens_estimate(fe: Path, session_id: str, tokens: int) -> None:
    """记录最近一轮估算总 token（诊断 / UI 用）。"""
    con = _connect(fe)
    try:
        con.execute(
            "UPDATE sessions SET tokensEstimate=? WHERE id=?",
            (int(tokens), session_id),
        )
        con.commit()
    finally:
        con.close()
