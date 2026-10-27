# Backend (Python sidecar)

> 中文版：[../zh/02-backend.md](../zh/02-backend.md)

`services/agent/` holds a FastAPI application that listens only on `127.0.0.1` and is launched by the Electron main process.

## Layering

```
api/      HTTP layer — parse requests, validate, turn exceptions into the error envelope
  │
  ├─→ agent/  Agent layer — LangGraph graph, system prompts, compaction, chat flows
  │     │
  │     └─→ tools/  Tool layer — what the agent can call (12 built-in tools)
  │
  └─→ store/  Persistence — JSONL event streams, DuckDB, files, crypto, Git archive
        ↑
        └── tools/ also call store/; they never touch files directly
```

**Layering rules:**

- `api/` does protocol conversion only, no business logic. It calls `store/` or `agent/`.
- `store/` knows nothing about HTTP or the agent. It's plain functions plus file/database work.
- `tools/` bridges the agent and `store/`; each tool is a `(root, params) -> dict` function.
- No reverse dependencies across layers: `import api.` inside `store/` is wrong.

## App assembly

`main.py` mounts 20 routers under `/api/v1`:

```python
API_PREFIX = "/api/v1"

def create_app() -> FastAPI:
    ...
    app.include_router(sessions.router, prefix=API_PREFIX)
    ...
```

Each router declares its own `tags` and auth dependency:

```python
router = APIRouter(tags=["findings"], dependencies=[Depends(require_token)])
```

`require_token` (`api/deps.py`) only validates `Authorization: Bearer <token>` when `FIREYEAUD_TOKEN` is set; in development it's unset and requests pass through. In production the Electron main process generates a random token and injects it as an environment variable.

## Error convention

There is exactly one error type across the backend: `ApiError(code, http_status, message_key, params)`.

```python
raise ApiError("E_NOT_FOUND", 404, "error.notFound", {"id": finding_id})
```

- `message_key` is **the key the frontend translates**, shaped like `error.notFound`. It must exist in both the Chinese and English locales.
- Don't use `error.internal` anymore. Phase B replaced its 9 occurrences with semantic keys, and a regression test guards it (`tests/test_error_codes.py`).
- Raised exceptions go through a shared handler that produces the JSON envelope; `toApiError` in the frontend's `client.ts` turns it back into an `ApiError`.

When adding an error code: add it to both `packages/shared/src/locales/zh-CN.ts` and `en-US.ts`, or the UI will show the raw key.

## Agent layer

`agent/graph.py` is the core. It runs a `planning → executing → reflecting` loop:

```python
event("status", {"phase": "planning"})
yield event("context", {"options": options})    # snapshot of what was actually included
yield event("token", {"delta": piece})          # streamed body text
yield event("tool_call", {...})                 # a tool call
yield event("tool_result", {...})               # tool result summary
yield event("done", {"usage": ...})             # finished
```

The key files:

| File | Responsibility |
|---|---|
| `agent/graph.py` | Main loop, event emission, tool dispatch |
| `agent/prompts.py` | System prompt assembly (injects custom rules, skill catalog) |
| `agent/compaction.py` | Context compaction (trim long chats + summarize) |
| `agent/token_budget.py` | Trimming policy: cap tool results before they hit the model |
| `agent/context_snapshot.py` | Builds the "what was included this turn" payload for the UI |
| `agent/sql_assistant.py` | Standalone chat flow for the SQL assistant |
| `agent/report_agent.py` / `form_agent.py` | Report / evidence-form writing flows |
| `agent/attachment_reader.py` | Temp attachment extraction (scanned files go through a vision model) |

**Security invariant**: workspace file contents are always treated as untrusted data, never as instructions. The prompt states this explicitly — don't delete it when editing prompts.

## Tools

The 12 built-in tools under `tools/`, each shaped `fn(root: Path, params: dict) -> dict`:

| Tool | Purpose |
|---|---|
| `list_files` | List the directory tree |
| `search_files` | Search by glob or content keyword |
| `read_file` | Read a file (text/spreadsheet/docx/PDF; images and scans need a vision model) |
| `describe_source` | Inspect table schema (must run before writing SQL) |
| `sql_query` | Read-only SQL through the sandbox |
| `run_rule` | Run one saved custom SQL rule |
| `parse_ledger` | Voucher table → normalized voucher rows |
| `aggregate_subject` | Summarize debit/credit/balance by account |
| `check_tie` | Account tie-out / table-level debit-credit balance |
| `report_finding` | Record a finding (intercepted by the graph, not returned directly) |
| `kb_search` | Search enabled knowledge bases |
| `load_skill` | Fetch a skill's body by id |
| `web_search` | Web search (registered only when enabled in settings) |

### How permissions are injected

Tools don't decide permissions themselves; `registry.build_tool_dict(context=...)` injects them:

```python
# registry._context_wrapper adds allowlists to specific tools
if fn in (sql_query, run_rule):
    merged["allowedConnectionIds"] = context["allowedConnectionIds"]
elif fn is kb_search:
    merged["allowedProviderIds"] = context["allowedProviderIds"]
elif fn is load_skill:
    merged["allowedSkillIds"] = context["allowedSkillIds"]
```

`context` is computed from the session's "defaults ∪ checked items". Each tool then does the final check against that allowlist — **don't enforce only in the frontend**; the frontend is just the experience layer.

`web_search` is special: it isn't in the fixed list. It's registered into the tool dict only when `webSearch.enabled` is true in settings — so while disabled, the model never even sees it.

## Persistence layer

`store/` is the largest directory. The conventions:

- **Event streams are JSONL**: findings (`findings.jsonl`) and evidence (`evidence.jsonl`) are append-only; reading replays events to derive current state. No in-place edits.
- **Large results spill to artifacts, in two places**:
  - When an evidence event's result exceeds 16KB (`_ARTIFACT_THRESHOLD` in `store/evidence.py`), the full result is written to `.fireeye/artifacts/ev_<seq>.json` and the event keeps only `artifactRef`.
  - When `sql_query` is truncated at the row limit, the full result goes to `.fireeye/artifacts/query_<8-hex>.json` and the return value carries `artifactRef`.
  - `dump_artifact` in `tools/base.py` is just a writer; whether to spill is the caller's decision.
- **Write files via `fsutil.write_json_atomic`**: write a temp file, then swap, so a crash can't leave half a JSON document.
- **Workspace mutations take the lock**: `WORKSPACE_MUTATION_LOCK`. Keep database round-trips outside the lock; disk writes go inside it.
- **DuckDB for analysis, SQLite for state**: `workspace.duckdb` holds imported tables; `checkpoints.sqlite` holds the session/message projection.

## Tests

```bash
npm run agent:test      # pytest, 116 test files
npm run agent:lint      # ruff
```

Tests connect to the app through `httpx.ASGITransport` without opening a real port:

```python
transport = httpx.ASGITransport(app=app)
async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
    ...
```

## Backend self-check

- [ ] New error codes exist in both locales
- [ ] No `error.internal` introduced
- [ ] `store/` has no reverse dependency on `api/` or `agent/`
- [ ] File writes use `write_json_atomic`; mutations take the lock
- [ ] Tools check permissions, based on `context` rather than trusting the frontend
- [ ] `npm run agent:test` and `npm run agent:lint` both pass