# P0 安全与可靠性加固 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把“只读 SQL”从提示词/正则约束升级为 AST + 引擎级约束，并给工具执行与同一会话并发加上硬边界。

**Architecture:** 用 sqlglot AST 校验替换关键词正则；工作区 DuckDB 关闭外部文件访问并支持中断式超时；外部数据库在事务层设置只读与语句超时；MCP 默认拒绝显式标注为写的工具；SSE 入口按会话加互斥锁，第二个并发请求直接返回 `error.sessionBusy`。

**Tech Stack:** Python 3.12、sqlglot 30.x、DuckDB 1.5、SQLAlchemy、pytest、FastAPI/SSE。

---

## 背景与范围

对应评审中的 P0 项：

1. SQL 只读沙箱可被 `read_csv`、`setval`、`EXPLAIN ANALYZE`、`FOR UPDATE` 绕过。
2. `sql_timeout_seconds` 是死配置，工具执行没有超时。
3. 外部数据库连接不是只读事务。
4. MCP 白名单可以暴露写工具，和 README 的安全承诺冲突。
5. 同一会话并发对话没有互斥。

**不在本计划内**：字段级授权与 `SELECT *` 展开、CI 门禁、工具结果预算。工具结果预算见 P2 计划；其余两项作为后续独立事项。

---

### Task 1: 用 sqlglot AST 替换 SQL 关键词正则

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/sandbox.py`
- Modify: `services/agent/src/fireeyeaud_agent/tools/sql_query.py:51`
- Modify: `services/agent/src/fireeyeaud_agent/store/db_engine.py:267,342`
- Modify: `services/agent/src/fireeyeaud_agent/store/access_source.py:222,272`
- Test: `services/agent/tests/test_sandbox.py`

**Step 1: 写失败测试**

把 `services/agent/tests/test_sandbox.py` 改成：

```python
import pytest

from fireeyeaud_agent.errors import ApiError
from fireeyeaud_agent.store.sandbox import validate_sql


def test_allows_select_and_with():
    validate_sql("SELECT 1")
    validate_sql("WITH t AS (SELECT 1) SELECT * FROM t")
    validate_sql("EXPLAIN SELECT 1")
    validate_sql("DESCRIBE t")


@pytest.mark.parametrize(
    "sql",
    [
        "ATTACH 'x.db'",
        "COPY t TO 'x.csv'",
        "INSTALL httpfs",
        "LOAD x",
        "EXPORT DATABASE 'x'",
        "PRAGMA database_list",
        "DROP TABLE t",
        "INSERT INTO t VALUES (1)",
        "SELECT 1; DROP TABLE t",
        # 新增：绕过面
        "SELECT * FROM read_csv('/etc/passwd')",
        "SELECT * FROM read_parquet('/tmp/x.parquet')",
        "SELECT * FROM read_text('/etc/passwd')",
        "SELECT setval('s', 1)",
        "SELECT * FROM t FOR UPDATE",
        "SELECT * INTO backup FROM t",
        "EXPLAIN ANALYZE SELECT 1",
    ],
)
def test_rejects_dangerous(sql):
    with pytest.raises(ApiError) as exc:
        validate_sql(sql)
    assert exc.value.code == "E_SQL_REJECTED"


def test_rejects_empty():
    with pytest.raises(ApiError) as exc:
        validate_sql("   ")
    assert exc.value.code == "E_SQL_REJECTED"


def test_dialect_is_respected():
    # T-SQL 方括号标识符不应该被当成解析错误。
    validate_sql("SELECT [name] FROM [dbo].[users]", dialect="tsql")
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_sandbox.py -v
```

Expected: 新增的 `read_csv` / `setval` / `FOR UPDATE` / `SELECT INTO` / `EXPLAIN ANALYZE` 用例 FAIL。

**Step 3: 重写 sandbox.py**

```python
"""SQL 只读沙箱（设计 §17.3）。

从「首词 + 关键词正则」升级为 sqlglot AST 校验：
- 只允许单条 SELECT / WITH / DESCRIBE；
- EXPLAIN 允许，但 EXPLAIN ANALYZE 拒绝（会真正执行）；
- 拒绝 FOR UPDATE / SELECT INTO；
- 拒绝可读写文件或产生副作用的函数（read_csv / setval ...）。
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp

from ..errors import ApiError

_DIALECT_ALIASES = {
    "postgresql": "postgres",
    "mssql": "tsql",
    "access": "tsql",
}
_ALLOWED_DIALECTS = {
    "duckdb",
    "sqlite",
    "postgres",
    "mysql",
    "tsql",
    "oracle",
}
# 这些函数要么能读工作区外的文件，要么会在数据库里产生副作用。
_FORBIDDEN_FUNCS = {
    "read_csv",
    "read_csv_auto",
    "read_parquet",
    "read_json",
    "read_json_auto",
    "read_text",
    "glob",
    "sniff_csv",
    "parquet_scan",
    "csv_scan",
    "setval",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "pg_sleep",
    "dblink",
    "lo_export",
    "lo_import",
    "xp_cmdshell",
}


def _reject(reason: str) -> None:
    raise ApiError("E_SQL_REJECTED", 400, "error.sqlRejected", {"reason": reason})


def _dialect(name: str | None) -> str:
    key = (name or "duckdb").lower()
    key = _DIALECT_ALIASES.get(key, key)
    return key if key in _ALLOWED_DIALECTS else "duckdb"


def _func_name(node: exp.Func) -> str:
    if isinstance(node, exp.Anonymous):
        return str(node.this or "").lower()
    return str(node.sql_name() or "").lower()


def validate_sql(sql: str, dialect: str | None = None) -> str:
    text = (sql or "").strip().rstrip(";").strip()
    if not text:
        _reject("empty")
    if ";" in text:
        _reject("multiple_statements")

    first = text.split(None, 1)[0].lower()
    body = text
    if first == "explain":
        rest = text[len("explain") :].strip()
        if rest.lower().startswith("analyze"):
            _reject("explain_analyze")
        body = rest
    elif first in ("describe", "desc"):
        # DESCRIBE 只读元数据，且 sqlglot 对各方言支持不一致，直接放行。
        return text

    try:
        statements = [s for s in sqlglot.parse(body, read=_dialect(dialect)) if s]
    except Exception as exc:  # 解析失败按拒绝处理，避免“看不懂就放行”
        _reject(f"parse_error: {exc}")

    if len(statements) != 1:
        _reject("multiple_statements")
    tree = statements[0]
    if not isinstance(tree, (exp.Select, exp.Describe)):
        _reject("not_readonly")
    if isinstance(tree, exp.Select):
        if tree.args.get("locks"):
            _reject("for_update")
        if tree.args.get("into") is not None:
            _reject("select_into")
    for node in tree.walk():
        if isinstance(node, exp.Func):
            name = _func_name(node)
            if name in _FORBIDDEN_FUNCS:
                _reject(f"forbidden_function: {name}")
    return text
```

**Step 4: 更新所有调用方传入方言**

`tools/sql_query.py`：

```python
text = validate_sql(params.get("sql", ""), dialect="duckdb")
```

`store/db_engine.py` 两处：

```python
text_sql = validate_sql(sql, dialect=dialect_for(conn))
```

`store/access_source.py` 两处：

```python
sql = validate_sql(sql, dialect="tsql")
```

**Step 5: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_sandbox.py tests/test_tool_sql_query.py tests/test_db_engine.py -v
```

Expected: PASS。若 `db_engine` 既有测试中有 Access 方言 SQL 解析失败，给该测试显式传 `dialect="tsql"`。

**Step 6: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/sandbox.py \
        services/agent/src/fireeyeaud_agent/tools/sql_query.py \
        services/agent/src/fireeyeaud_agent/store/db_engine.py \
        services/agent/src/fireeyeaud_agent/store/access_source.py \
        services/agent/tests/test_sandbox.py
git commit -m "fix(agent): validate read-only SQL with sqlglot AST"
```

---

### Task 2: DuckDB 关闭外部文件访问并支持中断超时

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/duckdb.py`
- Modify: `services/agent/src/fireeyeaud_agent/tools/sql_query.py:58-82`
- Modify: `services/agent/src/fireeyeaud_agent/store/db_engine.py:414-442`
- Test: `services/agent/tests/test_duckdb.py`
- Test: `services/agent/tests/test_tool_sql_query.py`

**Step 1: 写失败测试**

在 `services/agent/tests/test_duckdb.py` 追加：

```python
import pytest

from fireeyeaud_agent.store.duckdb import Database


def test_duckdb_blocks_external_files(tmp_path):
    db = Database(tmp_path / "x.duckdb")
    try:
        with pytest.raises(Exception) as exc:
            db.query("SELECT * FROM read_csv('/etc/passwd')").fetchall()
        assert "disabled by configuration" in str(exc.value) or "Permission" in str(
            exc.value
        )
    finally:
        db.close()


def test_fetchall_interrupts_on_timeout(tmp_path):
    db = Database(tmp_path / "x.duckdb")
    seen = {"interrupted": False}

    class _SlowCursor:
        description = [("a",)]

        def fetchall(self):
            import time

            time.sleep(0.2)
            return [[1]]

    class _SlowCon:
        def execute(self, *_args, **_kwargs):
            return _SlowCursor()

        def interrupt(self):
            seen["interrupted"] = True

    db._con = _SlowCon()
    rows, cols = db.fetchall("SELECT 1", timeout_seconds=0.05)
    assert rows == [[1]]
    assert cols == ["a"]
    assert seen["interrupted"] is True
    db.close()
```

在 `services/agent/tests/test_tool_sql_query.py` 追加：

```python
def test_sql_query_blocks_file_functions(tmp_path):
    _seed(tmp_path)
    with pytest.raises(ApiError) as exc:
        sql_query(tmp_path, {"sql": "SELECT * FROM read_csv('/etc/passwd')"})
    assert exc.value.code == "E_SQL_REJECTED"
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_duckdb.py tests/test_tool_sql_query.py -v
```

Expected: `test_duckdb_blocks_external_files` 与 `test_fetchall_interrupts_on_timeout` FAIL（`fetchall` 不存在）。

**Step 3: 修改 Database**

`store/duckdb.py`：

```python
import threading

_DUCKDB_CONFIG = {
    # 工作区数据已经导入 DuckDB；运行期不需要读任何外部文件。
    "enable_external_access": "false",
    # 禁止 SQL 或后续连接把安全选项改回去。
    "lock_configuration": "true",
}


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._con = duckdb.connect(str(path), config=dict(_DUCKDB_CONFIG))

    def fetchall(
        self,
        sql: str,
        params: Sequence[Any] | None = None,
        *,
        timeout_seconds: float | None = None,
    ):
        """执行查询并在超时时调用 DuckDB interrupt。

        超时覆盖 execute + fetchall 整段，而不只是 execute 调用。
        """
        timer = None
        if timeout_seconds and timeout_seconds > 0:
            timer = threading.Timer(float(timeout_seconds), self._con.interrupt)
            timer.daemon = True
            timer.start()
        try:
            cursor = self._con.execute(sql, list(params or []))
            return cursor.fetchall(), [str(d[0]) for d in (cursor.description or [])]
        finally:
            if timer is not None:
                timer.cancel()
```

保留 `query()` 给现有调用方；`fetchall()` 是新路径。

**Step 4: 让 sql_query 使用新路径**

`tools/sql_query.py` 的 DuckDB 分支改为：

```python
from ..config.settings import settings

db = Database(Path(root) / ".fireeye" / "workspace.duckdb")
try:
    if first in ("explain", "describe"):
        fetched, columns = db.fetchall(
            text, timeout_seconds=settings.sql_timeout_seconds
        )
        truncated = False
        rows = fetched
    else:
        fetched, columns = db.fetchall(
            f"SELECT * FROM ({text}) AS _sub LIMIT {limit + 1}",
            timeout_seconds=settings.sql_timeout_seconds,
        )
        truncated = len(fetched) > limit
        rows = fetched[:limit]
```

**Step 5: 给 db_engine 的内置 DuckDB 路径加同样的中断**

`store/db_engine.py` 顶部加：

```python
from ..config.settings import settings
```

把 `_duckdb_execute` 改成：

```python
def _duckdb_execute(conn: dict[str, Any], sql: str, params: list[Any] | None = None):
    with _duckdb_connect(conn) as handle:
        timer = threading.Timer(
            float(settings.sql_timeout_seconds), handle.interrupt
        )
        timer.daemon = True
        timer.start()
        try:
            cursor = handle.execute(sql, params or [])
            return cursor.fetchall(), list(cursor.description or [])
        finally:
            timer.cancel()
```

`_duckdb_connect` 里的连接也加同样的 config：

```python
handle = duckdb.connect(path, config={
    "enable_external_access": "false",
    "lock_configuration": "true",
})
```

**Step 6: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_duckdb.py tests/test_tool_sql_query.py tests/test_importer.py tests/test_sync.py -v
```

Expected: PASS。导入与同步测试确认关闭外部访问不影响正常写入。

**Step 7: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/duckdb.py \
        services/agent/src/fireeyeaud_agent/tools/sql_query.py \
        services/agent/src/fireeyeaud_agent/store/db_engine.py \
        services/agent/tests/test_duckdb.py \
        services/agent/tests/test_tool_sql_query.py
git commit -m "fix(agent): block DuckDB external file access and add query timeout"
```

---

### Task 3: 外部数据库设置只读事务与语句超时

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/store/db_engine.py:258-328`
- Test: `services/agent/tests/test_db_engine.py`

**Step 1: 写失败测试**

在 `services/agent/tests/test_db_engine.py` 追加：

```python
def test_readonly_setup_sql_postgres():
    stmts = db_engine._readonly_setup_sql("postgresql", 30)
    assert stmts == [
        "SET TRANSACTION READ ONLY",
        "SET LOCAL statement_timeout = 30000",
    ]


def test_readonly_setup_sql_mysql():
    stmts = db_engine._readonly_setup_sql("mysql", 30)
    assert stmts == [
        "SET SESSION TRANSACTION READ ONLY",
        "SET SESSION MAX_EXECUTION_TIME = 30000",
    ]


def test_readonly_setup_sql_local_drivers_are_noop():
    assert db_engine._readonly_setup_sql("sqlite", 30) == []
    assert db_engine._readonly_setup_sql("access", 30) == []
    assert db_engine._readonly_setup_sql("mssql", 30) == []
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_db_engine.py -k readonly_setup -v
```

Expected: FAIL，`_readonly_setup_sql` 不存在。

**Step 3: 实现 helper**

在 `store/db_engine.py` 的 `run_query` 前加：

```python
def _readonly_setup_sql(driver: str, timeout_seconds: int) -> list[str]:
    """返回执行用户 SQL 前必须发送的只读/超时设置。

    SQLite 已经用 mode=ro 打开；Access/MSSQL 暂不设置语句超时，
    但它们的连接仍然只通过 validate_sql 的 SELECT 通道执行。
    """
    ms = max(1, int(timeout_seconds)) * 1000
    if driver == "postgresql":
        return [
            "SET TRANSACTION READ ONLY",
            f"SET LOCAL statement_timeout = {ms}",
        ]
    if driver == "mysql":
        return [
            "SET SESSION TRANSACTION READ ONLY",
            f"SET SESSION MAX_EXECUTION_TIME = {ms}",
        ]
    if driver == "oracle":
        return ["SET TRANSACTION READ ONLY"]
    return []
```

**Step 4: 在 run_query 中执行**

在 `with engine.connect() as con:` 之后、执行用户 SQL 之前：

```python
for stmt in _readonly_setup_sql(driver, settings.sql_timeout_seconds):
    con.execute(text(stmt))
```

注意 `driver` 在 `run_query` 里已经定义；把这段放在 `first = ...` 之后、`try` 内部。

**Step 5: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_db_engine.py tests/test_db_query_api.py tests/test_sql_query_db.py -v
```

Expected: PASS。

**Step 6: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/store/db_engine.py \
        services/agent/tests/test_db_engine.py
git commit -m "fix(agent): enforce read-only transactions on external databases"
```

---

### Task 4: 所有工具执行加硬超时，同步工具移出事件循环

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/config/settings.py`
- Modify: `services/agent/src/fireeyeaud_agent/agent/graph.py:388-408`
- Test: `services/agent/tests/test_agent_tool_timeout.py`（新建）
- Test: `services/agent/tests/test_error_codes.py`（如需补错误码）

**Step 1: 写失败测试**

新建 `services/agent/tests/test_agent_tool_timeout.py`：

```python
import asyncio

import pytest

from fireeyeaud_agent.agent.graph import _run_tool
from fireeyeaud_agent.errors import ApiError


@pytest.mark.asyncio
async def test_async_tool_timeout_raises_api_error(tmp_path):
    async def slow(_root, _args):
        await asyncio.sleep(1)
        return {"ok": True}

    with pytest.raises(ApiError) as exc:
        async with asyncio.timeout(0.05):
            await _run_tool({"slow": slow}, "slow", {}, tmp_path)
    assert exc.value.code == "E_TOOL_TIMEOUT"


@pytest.mark.asyncio
async def test_sync_tool_runs_off_event_loop(tmp_path):
    import threading

    def blocking(_root, _args):
        return {"thread": threading.current_thread().name}

    out = await _run_tool({"blocking": blocking}, "blocking", {}, tmp_path)
    assert out["thread"] != threading.main_thread().name
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_agent_tool_timeout.py -v
```

Expected: FAIL，`_run_tool` 不存在 / 没有超时。

**Step 3: 添加配置**

`config/settings.py` 在 `turn_timeout_seconds` 后加：

```python
    tool_timeout_seconds: int = 60
```

**Step 4: 实现 _run_tool 并在 execute_tool 中使用**

在 `agent/graph.py` 的 `_maybe_bind` 附近加：

```python
async def _run_tool(
    tool_dict: dict[str, Any], name: str, args: dict[str, Any], root: Path
) -> Any:
    """执行一个工具；同步工具放到线程，避免阻塞事件循环。"""
    if name not in tool_dict:
        raise ValueError(f"unknown tool: {name}")
    fn = tool_dict[name]
    if inspect.iscoroutinefunction(fn):
        return await fn(root, args)
    return await asyncio.to_thread(fn, root, args)
```

把 `run_agent` 里的 `execute_tool` 改为：

```python
async def execute_tool(name: str, args: dict[str, Any]) -> Any:
    if name == "report_finding":
        ...  # 保持原样
    try:
        async with asyncio.timeout(settings.tool_timeout_seconds):
            return await _run_tool(tool_dict, name, args, root)
    except TimeoutError as exc:
        raise ApiError(
            "E_TOOL_TIMEOUT",
            504,
            "error.toolTimeout",
            {"tool": name},
        ) from exc
```

`graph.py` 顶部补 `from ..errors import ApiError`。

**Step 5: 补 i18n**

`packages/shared/src/locales/zh-CN.ts` 的 `error` 块，在 `sqlTimeout` 后加：

```ts
    toolTimeout: '工具执行超时，请缩小查询范围或重试',
```

`packages/shared/src/locales/en-US.ts` 对应位置加：

```ts
    toolTimeout: 'Tool execution timed out. Narrow the query or retry.',
```

**Step 6: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_agent_tool_timeout.py tests/test_agent_graph.py tests/test_error_codes.py -v
```

Expected: PASS。

**Step 7: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/config/settings.py \
        services/agent/src/fireeyeaud_agent/agent/graph.py \
        services/agent/tests/test_agent_tool_timeout.py \
        packages/shared/src/locales/zh-CN.ts \
        packages/shared/src/locales/en-US.ts
git commit -m "fix(agent): bound tool execution time and run sync tools off-loop"
```

---

### Task 5: MCP 默认拒绝显式标注为写的工具

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/mcp/client.py:22-28,90-102`
- Modify: `services/agent/src/fireeyeaud_agent/mcp/manager.py:160-249`
- Modify: `services/agent/src/fireeyeaud_agent/store/mcp.py:24-48`
- Test: `services/agent/tests/test_mcp_client.py`
- Test: `services/agent/tests/test_mcp_manager.py`
- Test: `services/agent/tests/test_mcp_store.py`

**Step 1: 写失败测试**

`tests/test_mcp_client.py` 追加（用一个带 annotations 的伪 tool）：

```python
def test_list_tools_projects_read_only_hint():
    from types import SimpleNamespace

    from fireeyeaud_agent.mcp.client import McpSession

    tool = SimpleNamespace(
        name="write_rows",
        description="write",
        input_schema={},
        annotations=SimpleNamespace(read_only_hint=False),
    )
    session = SimpleNamespace(list_tools=lambda: _async([SimpleNamespace(tools=[tool])]))

    specs = asyncio.run(McpSession(session).list_tools())
    assert specs[0].read_only is False
```

`tests/test_mcp_manager.py` 更新 `_connector`，让 `danger` 带 `read_only=False`：

```python
specs = [
    McpToolSpec(
        name=t,
        description=f"{t} desc",
        input_schema=_schema(t),
        read_only=False if t == "danger" else True,
    )
    for t in (server.get("_tools") or ["echo", "danger"])
]
```

把 `test_build_tools_allow_star_exposes_all` 改为默认拒绝写工具：

```python
async def test_build_tools_star_still_denies_write_tools(tmp_path, monkeypatch):
    root = _workspace(tmp_path, monkeypatch)
    _write_servers(root, [_server("mcp_1", permissions={"toolsAllow": ["*"]})])
    fake_open, _ = _connector({})
    result = await manager.build_mcp_tools(root, {"mcp_1"}, open_session=fake_open)
    try:
        names = [t.name for t in result.tools]
        assert "mcp__mcp_1__echo" in names
        assert "mcp__mcp_1__danger" not in names
        assert any(e.get("code") == "E_MCP_WRITE_DENIED" for e in result.errors)
    finally:
        await result.aclose()


async def test_build_tools_can_opt_in_to_write_tools(tmp_path, monkeypatch):
    root = _workspace(tmp_path, monkeypatch)
    _write_servers(
        root,
        [
            _server(
                "mcp_1",
                permissions={"toolsAllow": ["*"], "allowWrite": True},
            )
        ],
    )
    fake_open, _ = _connector({})
    result = await manager.build_mcp_tools(root, {"mcp_1"}, open_session=fake_open)
    try:
        assert any(t.name == "mcp__mcp_1__danger" for t in result.tools)
    finally:
        await result.aclose()
```

`tests/test_mcp_store.py` 追加：

```python
def test_create_server_defaults_allow_write_false(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    root = tmp_path / "ws"
    (root / ".fireeye").mkdir(parents=True)
    from fireeyeaud_agent.store import mcp

    item = mcp.create_server(
        {"name": "x", "transport": "stdio", "command": "echo", "permissions": {}},
        root,
    )
    assert item["permissions"]["allowWrite"] is False
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_mcp_client.py tests/test_mcp_manager.py tests/test_mcp_store.py -v
```

Expected: FAIL，`read_only` 字段与 `allowWrite` 不存在。

**Step 3: 扩展 McpToolSpec 与 list_tools**

`mcp/client.py`：

```python
@dataclass(frozen=True)
class McpToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    read_only: bool | None = None
```

`list_tools`：

```python
annotations = getattr(tool, "annotations", None)
read_only = getattr(annotations, "read_only_hint", None) if annotations else None
specs.append(
    McpToolSpec(
        name=str(tool.name),
        description=str(getattr(tool, "description", "") or ""),
        input_schema=dict(schema) if isinstance(schema, dict) else {},
        read_only=read_only,
    )
)
```

**Step 4: manager 过滤写工具**

`build_mcp_tools` 读取：

```python
allow_write = bool(perms.get("allowWrite", False))
```

在 `for spec in specs:` 内、`toolsAllow` 过滤之后加：

```python
if not allow_write and spec.read_only is False:
    errors.append(
        {
            "serverId": sid,
            "tool": spec.name,
            "code": "E_MCP_WRITE_DENIED",
            "message": "tool is annotated readOnlyHint=false; enable permissions.allowWrite to use it",
        }
    )
    continue
```

未知 annotations（`read_only is None`）保持放行，避免破坏没有注解的存量 Server；精确控制仍由 `toolsAllow` 负责。

**Step 5: 配置层持久化 allowWrite**

`store/mcp.py` 抽出并复用：

```python
def _normalize_permissions(perms: dict[str, Any] | None) -> dict[str, Any]:
    perms = perms or {}
    return {
        "fsScope": perms.get("fsScope", "workspace"),
        "net": bool(perms.get("net", False)),
        "toolsAllow": list(perms.get("toolsAllow") or []),
        "allowWrite": bool(perms.get("allowWrite", False)),
    }
```

`create_server` 用它；`update_server` 在 `"permissions" in patch` 时也用它：

```python
def update_server(...):
    if isinstance(patch.get("permissions"), dict):
        patch = {**patch, "permissions": _normalize_permissions(patch["permissions"])}
    return store.update_item(KIND, server_id, scope, patch, root)
```

**Step 6: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_mcp_client.py tests/test_mcp_manager.py tests/test_mcp_store.py tests/test_mcp_api.py -v
```

Expected: PASS。

**Step 7: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/mcp/client.py \
        services/agent/src/fireeyeaud_agent/mcp/manager.py \
        services/agent/src/fireeyeaud_agent/store/mcp.py \
        services/agent/tests/test_mcp_client.py \
        services/agent/tests/test_mcp_manager.py \
        services/agent/tests/test_mcp_store.py
git commit -m "fix(mcp): deny tools annotated as writable unless explicitly allowed"
```

---

### Task 6: 同一会话并发对话返回 sessionBusy

**Files:**
- Modify: `services/agent/src/fireeyeaud_agent/api/sessions.py:100-122`
- Test: `services/agent/tests/test_chat_sse.py`
- Modify: `packages/shared/src/locales/zh-CN.ts`、`en-US.ts`

**Step 1: 写失败测试**

在 `tests/test_chat_sse.py` 追加：

```python
async def test_session_lock_is_shared(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    from fireeyeaud_agent.api import sessions

    lock_a = sessions._session_lock("s_busy")
    lock_b = sessions._session_lock("s_busy")
    assert lock_a is lock_b


async def test_busy_stream_emits_error_event(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    from fireeyeaud_agent.api import sessions

    events = [json.loads(item["data"]) async for item in sessions._busy_stream("s_busy")]
    assert events[0]["type"] == "error"
    assert events[0]["data"]["messageKey"] == "error.sessionBusy"
    assert events[-1]["type"] == "done"
```

**Step 2: 运行测试，确认失败**

```bash
cd services/agent
uv run pytest tests/test_chat_sse.py -k "session_lock or busy_stream" -v
```

Expected: FAIL，`_session_lock` / `_busy_stream` 不存在。

**Step 3: 实现锁与 busy 事件**

`api/sessions.py`：

```python
import asyncio
import json

from ..util import now_iso

_LOCKS: dict[str, asyncio.Lock] = {}


def _session_lock(session_id: str) -> asyncio.Lock:
    key = f"{workspace_manager.root}|{session_id}"
    return _LOCKS.setdefault(key, asyncio.Lock())


def _busy_stream(session_id: str):
    async def _gen():
        def envelope(etype: str, seq: int, data: dict) -> dict[str, str]:
            return {
                "event": "message",
                "data": json.dumps(
                    {
                        "type": etype,
                        "seq": seq,
                        "sessionId": session_id,
                        "ts": now_iso(),
                        "data": data,
                    },
                    ensure_ascii=False,
                ),
            }

        yield envelope(
            "error",
            1,
            {
                "code": "E_SESSION_BUSY",
                "messageKey": "error.sessionBusy",
                "params": {},
            },
        )
        yield envelope("done", 2, {"usage": {}})

    return _gen()
```

把 `chat()` 的返回改为：

```python
    lock = _session_lock(session_id)
    if lock.locked():
        return EventSourceResponse(_busy_stream(session_id), media_type="text/event-stream")

    async def _locked_stream():
        async with lock:
            async for item in stream_chat(
                session_id,
                body.message,
                body.locale,
                body.modelId,
                {
                    "skillIds": body.skillIds,
                    "kbProviderIds": body.kbProviderIds,
                    "dbConnectionIds": body.dbConnectionIds,
                    "mcpServerIds": body.mcpServerIds,
                    "ruleIds": body.ruleIds,
                },
                body.attachments,
                body.mentions,
            ):
                yield item

    return EventSourceResponse(_locked_stream(), media_type="text/event-stream")
```

**Step 4: 补 i18n**

`zh-CN.ts`：

```ts
    sessionBusy: '上一轮对话还在执行，请等待完成或先停止',
```

`en-US.ts`：

```ts
    sessionBusy: 'The previous turn is still running. Wait for it or stop it first.',
```

**Step 5: 运行测试**

```bash
cd services/agent
uv run pytest tests/test_chat_sse.py tests/test_sessions.py -v
```

Expected: PASS。既有 SSE 测试只发一个请求，不会触发锁。

**Step 6: 提交**

```bash
git add services/agent/src/fireeyeaud_agent/api/sessions.py \
        services/agent/tests/test_chat_sse.py \
        packages/shared/src/locales/zh-CN.ts \
        packages/shared/src/locales/en-US.ts
git commit -m "fix(agent): reject concurrent chat turns on the same session"
```

---

## 验收清单

- [ ] `SELECT * FROM read_csv(...)` / `setval(...)` / `EXPLAIN ANALYZE` / `FOR UPDATE` 全部被 `E_SQL_REJECTED` 拒绝。
- [ ] 工作区 DuckDB 连接直接执行 `read_csv` 也被配置层拒绝。
- [ ] 慢查询会在 `FIREYEAUD_SQL_TIMEOUT_SECONDS` 后中断，并转成工具错误。
- [ ] PostgreSQL/MySQL/Oracle 查询在只读事务中执行。
- [ ] MCP 中 `readOnlyHint=false` 的工具默认不暴露，除非 `permissions.allowWrite=true`。
- [ ] 同一会话第二个并发聊天请求收到 `error.sessionBusy`。

## 后续

- 工具结果预算与 artifact 修复：见 P2 计划。
- CI 门禁（pytest / ruff / typecheck）、证据链、日志治理：见 P3 计划。
- 字段级授权与 `SELECT *` 展开：后续独立安全事项。
