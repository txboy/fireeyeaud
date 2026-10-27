# Architecture

> 中文版：[../zh/01-architecture.md](../zh/01-architecture.md)

## Three processes

```
┌─────────────────────────────────────────────────────┐
│  Electron main process (apps/desktop/src/main.cjs)   │
│  · Creates windows, manages lifecycle                │
│  · Spawns and supervises the Python sidecar          │
│  · File IPC (read / write / delete / copy / move     │
│    inside the workspace)                             │
│  · safeStorage key encryption                        │
└───────────────┬─────────────────────┬───────────────┘
                │ ipcMain/ipcRenderer │ HTTP + SSE
                │ (preload.cjs allowlist) │ 127.0.0.1:<random port>
┌───────────────▼─────────────┐ ┌─────▼─────────────────┐
│ Renderer (apps/renderer)     │ │ Python sidecar        │
│ React + Zustand + Ant Design │ │ (services/agent)      │
│ UI and state only            │ │ FastAPI + LangGraph   │
│ No direct filesystem access, │ │ Owns DuckDB / SQLite  │
│ no keys                      │ │                       │
└─────────────────────────────┘ └───────────────────────┘
```

**Why it's split this way**: a UI crash doesn't take down a running analysis; the Python ecosystem (LangGraph, DuckDB, python-docx) has no real substitute; filesystem access is funnelled through the main process, so the renderer only ever gets an allowlisted surface.

## How a request travels

Take "asking a question" — one message crosses all three layers:

```
User types a question
  → renderer/store/chat.ts assembles the arguments
  → lib/api/chat.ts: streamChat()
  → POST http://127.0.0.1:<port>/api/v1/sessions/{id}/chat
  → api/sessions.py receives it (validates the Bearer token)
  → agent/graph.py runs the LangGraph loop
       planning → tool call (tools/*.py) → reflecting → plan again
  → each event is pushed back immediately over SSE
  → the renderer receives status / token / tool_call / tool_result / done
  → the chat store updates messages; the UI fills in progressively
```

Key points:

- **SSE is one-way.** The frontend can't send data through it — it issues one POST and then reads events.
- **Every event carries a `seq`.** The UI renders in order, and `seq` is also what you look at when the UI seems stuck.
- **Tools execute on the backend.** The frontend only sees `tool_call` / `tool_result` summaries; it never runs tools itself.

## Directory responsibilities

```
apps/desktop/src/
  main.cjs          App entry, windows, every ipcMain.handle registration
  preload.cjs       Allowlisted API exposed to the renderer (contextBridge)
  sidecar.cjs       Sidecar lifecycle: free port, spawn, health check, cleanup
  file-preview.cjs  Reading files inside the workspace (with containment check)
  file-ops.cjs      Write / delete / copy / move (containment + protected dirs)
  secrets.cjs       safeStorage encrypt/decrypt
  search.cjs        Workspace traversal and keyword search

apps/renderer/src/
  store/            Zustand: one store per domain, the single source of UI state
  lib/api.ts        ⚠ Re-export barrel only — implementation is in lib/api/*
  lib/api/client.ts HTTP core: ApiError / request / safeFetch
  lib/api/*.ts      Domain modules for API calls (17 of them)
  components/       UI components; panels/ = activity-bar panels, forms/ = config forms
  hooks/            Logic shared across components

services/agent/src/fireeyeaud_agent/
  main.py           FastAPI assembly; mounts 20 routers under /api/v1
  api/              HTTP layer: parse, validate, delegate to store / agent
  agent/            LangGraph graph, system prompts, compaction, chat flows
  tools/            The 12 built-in tools the agent can call
  store/            Persistence: JSONL event streams, DuckDB, files, crypto, archive
  config/           Global / project config read-write
  kb/ web/ mcp/     External integration adapters

packages/shared/src/
  types.ts          Types shared by frontend and backend (SSE events, findings, evidence…)
  locales/          Chinese and English copy
```

## Two boundaries that bite

### The renderer never reads files directly

Previews and edits go through `window.fireeyeaud.readFile / writeTextFile / ...` (the preload allowlist), and the main process verifies the path is inside the workspace. **Don't** work around it with `fetch('file://...')` in the renderer.

### `lib/api.ts` is not the implementation

It's a re-export barrel; the real code lives in the 17 modules under `lib/api/`. When adding an API call, edit the matching domain module — **don't pile more functions into `api.ts`**. That file used to be 1,597 lines and has already been split once.

## Process relationships in development

`npm run desktop:dev` does the following:

1. Starts the Vite dev server (renderer hot reload)
2. Starts the Electron main process
3. The main process spawns the sidecar: `findFreePort` picks a free port, then it launches
   `python -m uvicorn fireeyeaud_agent.main:app --host 127.0.0.1 --port <port>`
   (once packaged, it runs the PyInstaller executable directly)
4. Polls `/api/v1/health` every 500ms until `status === 'ok'`
5. Reclaims the sidecar process tree when Electron exits

While the sidecar is starting, the UI shows "starting the agent service" rather than treating it as an error. If the backend needs a dozen seconds to warm up, the frontend keeps probing in the background and lets you open the UI meanwhile.

## Where data lives

| Location | Contents | Travels with the workspace? |
|---|---|---|
| `<workspace>/.fireeye/` | Findings, evidence, sessions, indexes, artifacts | Yes |
| `<userData>/secrets.json` | Model keys, database passwords, etc. (safeStorage-encrypted) | No |
| `~/.fireeye/` | Global-scope config (global models, global rules, …) | No |

See the [data model](05-data-model.md) for details.

## Next

- Changing the backend → [Backend](02-backend.md)
- Changing the frontend → [Frontend](03-frontend.md)
- Looking up API details → [API & protocols](04-api-reference.md)