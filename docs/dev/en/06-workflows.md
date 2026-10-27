# Common Tasks

> 中文版：[../zh/06-workflows.md](../zh/06-workflows.md)

Each section is a checklist you can follow. Commands run from the repo root unless noted.

## Getting it running for the first time

```bash
npm install                      # JS workspace (includes Electron)
cd services/agent && uv sync     # Python deps; uv fetches Python 3.12 for you
cd ../..
npm run desktop:dev              # starts the UI and spawns the sidecar
```

If it won't start, check in this order:

1. Does `npm run agent:dev` start on its own? If not → Python environment problem
2. Open `http://127.0.0.1:8765/api/v1/health` in a browser — do you get `{"status":"ok"}`?
3. UI stuck on "starting the agent service"? → check the main-process console for `[sidecar]` logs
4. "Can't reach the local backend"? → port conflict or the sidecar crashed; restart `npm run desktop:dev`

---

## Adding an agent tool

Example: adding `check_vat` (VAT tie-out check).

**1. Write the tool function** in `tools/check_vat.py`:

```python
"""check_vat: verifies input/output VAT tie-out."""

from __future__ import annotations

from pathlib import Path
from typing import Any

def check_vat(root: Path, params: dict[str, Any]) -> dict[str, Any]:
    table = params.get("table")
    # ... query with DuckDB
    return {"ok": True, "diff": 0}
```

**2. Register it** in `tools/registry.py`:

```python
from .check_vat import check_vat

class CheckVatArgs(BaseModel):
    table: str = Field(description="table name")

_SPECS = [
    ...
    ("check_vat", "Verify input/output VAT tie-out.", check_vat, CheckVatArgs),
]
```

**3. Add it to the system prompt** — one line in `_BASE` in `agent/prompts.py`. **Without this line the model doesn't know the tool exists.**

**4. Add tests** in `tests/test_check_vat.py`; follow the existing tool tests (`httpx.ASGITransport`, or call the function directly).

**5. Verify**

```bash
npm run agent:test
npm run agent:lint
```

**No frontend change needed** — tool results flow to the UI automatically as `tool_result` events.

> If the tool needs permission control, follow how `sql_query` / `kb_search` work inside `_context_wrapper`: inject an allowlist from `context` and do the final check inside the tool.

---

## Adding a REST endpoint

Example: "export findings as CSV".

**1. Backend**, in `api/findings.py`:

```python
@router.get("/findings/export.csv")
def export_findings_csv() -> Response:
    root = _root()
    if root is None:
        raise ApiError("E_NO_WORKSPACE", 400, "error.noWorkspace")
    ...
```

Conventions:

- Raise `ApiError`; don't assemble error JSON yourself
- Add the error key to the `error` namespace in both `zh-CN.ts` and `en-US.ts`

**2. Shared types** (if the frontend needs them) in `packages/shared/src/types.ts`

**3. Frontend wrapper** in `apps/renderer/src/lib/api/findings.ts`:

```ts
export function exportFindingsCsv(): Promise<Blob> { ... }
```

**4. Frontend call** — add a store action; on failure set `errorKey: errorKeyOf(err)`.

**5. Verify**

```bash
npm run agent:test && npm run agent:lint
cd apps/renderer && npx tsc --noEmit
```

---

## Adding a config entity (say, "voucher templates")

Config entities all go through `config/store.py`; you just add a `kind`:

1. Create a router under `api/` implementing `GET/POST/PATCH/DELETE`, calling `config.store.list_items/create_item/update_item/delete_item`
2. Mount it in `main.py` with `app.include_router(xxx.router, prefix=API_PREFIX)`
3. Define types in `packages/shared/src/types.ts`
4. Add a domain module under `apps/renderer/src/lib/api/`
5. Frontend: a store in `store/`, a panel in `components/panels/`, a form in `components/forms/`
6. Add an entry to `TOP_ITEMS` in `ActivityRail.tsx` (if it belongs in the activity bar)

Mind the scope: `global ⊕ project` with `project` overriding `global`.

---

## Adding a right-hand tab

1. `store/ui.ts`: add a kind to the `RightTab` union
2. `store/ui.ts`: add an `openXxx()` action (see `openReport`)
3. `components/RightArea.tsx`: add the render branch (remember both the title and the close-confirmation paths)
4. If it needs a leave guard (unsaved content), hook into the `allowLeave` mechanism

---

## Adding an export format

Export code lives in `store/working_paper.py` (working papers) and `store/report_docs.py` / `docx_render.py` (reports, evidence forms).

1. Add a render function (see the existing `_render_docx` / `_render_xlsx` / `_render_pdf`)
2. Add the file name to the `_FILE` map
3. Add a value to the request `format` enum (`WorkingPaperFormat` in `packages/shared/src/types.ts`)
4. Add a button to `FORMATS` in `WorkingPaperView.tsx`
5. Run `npm run agent:test`

**Chinese text in PDF**: with reportlab you rely on the bundled `STSong-Light` font. Don't introduce external font files — they get lost during packaging.

---

## Adding a file preview format

1. `apps/desktop/src/file-preview.cjs`: map the extension to a type
2. Add a component under `apps/renderer/src/components/preview/`
3. Add a branch in `WorkspacePreview.tsx`
4. Use dynamic `import()` for heavy dependencies; keep them out of the main bundle
5. If the format is text-editable, also add it to the main process's write allowlist

---

## Debugging the sidecar

**Watch the logs**: the main-process console from `npm run desktop:dev` prefixes sidecar output with `[sidecar]`.

**Run it standalone** (recommended when changing the backend — hot reload):

```bash
npm run agent:dev          # fixed port 8765
# in another terminal
npm run desktop:dev
```

**Call the API directly**:

```powershell
# development leaves FIREYEAUD_TOKEN unset, so no Authorization header needed
curl "http://127.0.0.1:8765/api/v1/health"
curl "http://127.0.0.1:8765/api/v1/findings"
```

**OpenAPI**: browse to `http://127.0.0.1:8765/docs`.

**The sidecar takes ages to start**: the main process waits up to 120s, probing every 500ms. A first-time dependency install, antivirus scanning or a large workspace index can all slow it down. See `docs/plans/2026-10-27-startup-performance.md` for diagnosis.

---

## Common symptoms

| Symptom | Look here first |
|---|---|
| UI shows a raw `error.xxx` | That key is missing from the corresponding locale |
| "Can't reach the local backend" | Sidecar crashed or the port is taken; check main-process logs |
| Stuck on "starting the agent service" | `_waitReady` is still probing; curl the health endpoint |
| Evidence chain verification fails | Someone hand-edited `evidence.jsonl`; use `verify-evidence` to locate `breakAt` |
| Workspace won't open, schema too new | `schemaVersion` in `.fireeye/project.json` is newer than the program |
| Model unreachable | Check base URL and model name; `POST /models/{id}/test` |
| Database query returns unauthorized | The table/column allowlist in `authorization.json` |
| Module not found in node unit tests | A relative import is missing its `.ts` suffix |

---

## Before you commit

```bash
npm run agent:lint        # ruff
npm run agent:test        # pytest
npm run desktop:test      # Electron shell
cd apps/renderer
npx tsc --noEmit
node --experimental-transform-types --test tests/*.test.ts
cd ../.. && npm run renderer:build
```

---

## Editing these docs

- Changing the **current implementation** → edit `docs/dev/` (this directory)
- Touching a **historical decision** → leave `docs/plans/` alone; it records the past

Before writing a behavioural detail into a doc (port, limit, file name, error code), go check the code again — these values drift and docs go stale.