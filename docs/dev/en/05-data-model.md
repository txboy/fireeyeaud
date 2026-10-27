# Data Model

> 中文版：[../zh/05-data-model.md](../zh/05-data-model.md)

## 1. What lands in the workspace

Opening a folder makes the backend create `.fireeye/` inside it:

```
<workspace>/
├─ .fireeye/
│  ├─ project.json          Project metadata + counters + data source registry
│  ├─ .lock                 pid / port of the process that has it open
│  ├─ findings.jsonl        Finding event stream (append-only)
│  ├─ evidence.jsonl        Evidence event stream (hash chain)
│  ├─ workspace.duckdb      Imported tables (analysis engine)
│  ├─ checkpoints.sqlite    Session and message projection
│  ├─ authorization.json    Table / column allowlist
│  ├─ config/               Project-level config (models, rules, skills, MCP, knowledge, archive)
│  ├─ templates/            docx templates uploaded for this project
│  ├─ index/
│  │  ├─ files.json         File fingerprints (detect changes, used for sync)
│  │  └─ schema.json        Table structure for every data source
│  └─ artifacts/            Outputs: working papers, reports, evidence forms, large query results
└─ 证据/                     Original copies of manual evidence files
```

`_SUBDIRS = ["config", "templates", "index", "artifacts"]` is ensured by `store/workspace.py` on open.

**This directory is the audit file.** Copy the whole workspace, open it on another machine, and the findings, evidence, sessions and artifacts are all there. Secrets are not included (see section 4).

## 2. Event streams

### Why event streams

Findings and evidence are **append-only, history is never rewritten**. Current state is derived by replaying events. The payoff: any record can answer "when did this change, who changed it, and why".

### `findings.jsonl`

One finding per line. Event types:

| `event` | Meaning |
|---|---|
| `created` | Finding created |
| `status_changed` | Status change (confirm / reject / in-review / false-positive) |
| `severity_changed` | Severity adjusted |
| `note_added` | Note added |
| `evidence_attached` | Evidence attached |
| `evidence_detached` | Evidence detached |
| `deleted` | Deleted |

State machine:

```
pending ──→ in_review ──→ confirmed
   │            │      └→ rejected
   └────────────┴────────→ false_positive
```

Severity has exactly three levels: `high` / `medium` / `low`.

### `evidence.jsonl`

Evidence is a **hash chain**, used for tamper detection. Shape:

```json
{
  "seq": 1,
  "id": "ev_1",
  "sessionId": "ses_...",
  "ts": "2026-10-27T...",
  "step": "tool_call | tool_result | manual",
  "findingRefs": ["F-0001"],
  "tool": "sql_query",
  "params": { "...": "..." },
  "resultSummary": "12 rows returned",
  "artifactRef": "artifacts/ev_1.json",
  "durationMs": 42,
  "tokens": {},
  "lang": "zh-CN",
  "prevHash": "sha256:...",
  "hash": "sha256:..."
}
```

**Hash computation** (`store/evidence.py::compute_hash`):

```
hash = "sha256:" + sha256( prevHash + canonical(event without "hash") )
```

`canonical` is compact JSON with keys sorted recursively after removing `hash`, so insertion order doesn't affect the digest.

The first record's `prevHash` is the empty string. Verification recomputes from the first record onward; the first mismatch returns `{ ok: false, breakAt: <seq>, reason: "hash_mismatch" }`.

The chain is verified automatically when a workspace opens; `POST /workspaces/{id}/verify-evidence` triggers it manually.

**Changing evidence means appending an event, never editing an old one** — editing breaks the chain.

### Large results

- Evidence results over **16KB** (`_ARTIFACT_THRESHOLD`) → the full result is written to `artifacts/ev_<seq>.json` and the event keeps only `artifactRef`.
- When `sql_query` is truncated at the row limit → the full result goes to `artifacts/query_<8-hex>.json`.

## 3. `project.json`

Metadata and counters only, no business data:

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "name": "workspace name",
  "createdAt": "...",
  "updatedAt": "...",
  "defaultModelId": null,
  "counters": {
    "finding": 0, "rule": 0, "session": 0, "message": 0,
    "dataSource": 0, "connection": 0, "workingPaper": 0,
    "evidenceForm": 0, "report": 0
  },
  "dataSources": []
}
```

**`schemaVersion` is a compatibility gate**: if the file's version is newer than the program supports, opening is refused outright (`E_WS_SCHEMA_TOO_NEW`). No downgrade is attempted — that prevents an older build from corrupting data written by a newer one.

Session id uniqueness **comes from `checkpoints.sqlite`**, not `counters.session` (counters duplicate when a workspace is copied).

## 4. Data that lives outside the workspace

| Location | Contents | Why it's separate |
|---|---|---|
| `<userData>/secrets.json` | Model keys, DB passwords, knowledge keys, remote tokens | Encrypted with Electron `safeStorage`; kept out of the project so collaboration doesn't leak it |
| `~/.fireeye/` | Global-scope config | Reused across projects (global models, global rules, …) |

How a secret travels:

```
Renderer → ipcRenderer.invoke('secret:put', plaintext)
        → main process safeStorage.encryptString → writes secrets.json
        → main process pushes ciphertext via POST /secrets
        → sidecar decrypts and holds it in memory only, never on disk
```

That's why secrets are re-pushed after a sidecar restart. **Never write a plaintext secret into `.fireeye/`.**

## 5. Config scopes

Taking models as the example:

```
~/.fireeye/config/models.json            ← global
<workspace>/.fireeye/config/models.json  ← project
```

Reads merge global ⊕ project, with **project overriding global** (matched by id). List endpoints take `?scope=global|project` to view a single layer.

The same mechanism applies to `rules` / `skills` / `kb` / `mcp` / `db`. Global-side id counters live in `~/.fireeye/config/_counters.json`.

## 6. Data sources and indexes

After importing a spreadsheet:

1. Contents go into `workspace.duckdb`, with table names like `src_ds1_序时账`
2. `index/schema.json` records that source's tables and columns
3. `index/files.json` records the file fingerprint (used by sync to tell "changed or not")
4. One entry is appended to `dataSources[]` in `project.json`

Database connections use the same path: `reflect` walks the schema and registers it as a data source too. When the agent calls `sql_query`, `sourceId` decides whether it hits DuckDB or an external database.

**Sync** compares fingerprints in `files.json` against what's on disk: new files get imported, vanished ones removed, changed ones replaced.

## 7. Archive

The `archive` panel is Git-based:

- One archive = one commit + one `archive/A-xxxx` tag (`TAG_PREFIX = "archive/"`)
- The whole project folder is tracked; `.gitignore` excludes only regenerable or conflict-prone files:
  `.fireeye/workspace.duckdb` (plus `.wal` / `.tmp`), `.fireeye/.lock`, `.fireeye/staging/`
- Remote config lives in `.fireeye/config/archive.json`

**Note**: archiving is folder-level. Findings, evidence and session records inside `.fireeye/` are under version control, so their history is protected by Git. `workspace.duckdb` is not tracked — after cloning on another machine the tables must be re-imported (the source files are still in the workspace; one sync does it).

## 8. Artifacts

```
.fireeye/artifacts/
├─ working-paper/wp_<n>/        working-paper.docx | .xlsx | .pdf
├─ evidence-forms/QZ-xxxx/      body.json + exported docx
├─ reports/RPT-xxxx/            same as above
├─ ev_<seq>.json                evidence results over 16KB
└─ query_<hex>.json             truncated SQL results
```

The frontend reads these via `GET /artifacts/{path:path}` (with path-traversal protection), or hands them to the OS with the main process's `openPath` / `showItemInFolder`.

## 9. Rules for changing data formats

- **Adding fields is fine; removing them is not.** When an older workspace file lacks a new field, the reader must supply a default.
- **Breaking changes bump `schemaVersion`**, with a migration in `store/migrate.py`. A failed migration must not block opening the workspace (see `migrate_evidence_form_workspace`: retry next time).
- **Event streams are append-only.** To "undo" something, append the opposite event rather than deleting the original line.
- Run `npm run agent:test` afterwards — data-structure tests all live in `services/agent/tests/`.