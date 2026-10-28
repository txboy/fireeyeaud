# FireEyeAud

<sub>[中文](README.md) · English</sub>

**An AI audit workbench that runs on your own machine.**

Open the folder holding your accounting data, talk to the AI in plain language, and let it help you trace transactions, surface findings, and build the evidence — then export deliverables you can hand over: working papers, evidence forms, and audit reports.

Your files and outputs stay in that folder. No relay server sits in between, and with a local model the whole thing runs offline.

---

## Screenshots

**Main workspace** — explorer on the left, the AI conversation in the middle, findings on the right:

<p>
  <img src="docs/design/preview/01-workspace.png" alt="Main workspace - light" width="100%">
</p>

<p>
  <img src="docs/design/preview-dark/01-workspace.png" alt="Main workspace - dark" width="100%">
</p>

**From opening a folder to handing over evidence forms and reports:**

| | |
|---|---|
| ![Welcome](docs/design/preview/00-welcome.png)<br><sub>Welcome · open a folder</sub> | ![Database connections](docs/design/preview/02-database.png)<br><sub>Database connections · read-only, table/column grants</sub> |
| ![Models](docs/design/preview/03-models.png)<br><sub>Models · local or cloud</sub> | ![Knowledge base](docs/design/preview/04-knowledge.png)<br><sub>Knowledge base · Dify / RAGFlow</sub> |
| ![SQL rules](docs/design/preview/05-sql.png)<br><sub>SQL library · custom audit rules</sub> | ![MCP](docs/design/preview/06-mcp.png)<br><sub>MCP · bring in external tools</sub> |
| ![Skills](docs/design/preview/07-skills.png)<br><sub>Skills · reusable skill packs</sub> | ![Templates](docs/design/preview/08-templates.png)<br><sub>Templates · export with your own formats</sub> |
| ![Reports](docs/design/preview/09-reports.png)<br><sub>Project reports</sub> | ![Evidence forms](docs/design/preview/10-evidence-forms.png)<br><sub>Evidence forms</sub> |
| ![Archive](docs/design/preview/11-archive.png)<br><sub>Archive · Git-based versioning</sub> | |

<sub>Dark theme previews live in [`docs/design/preview-dark/`](docs/design/preview-dark/). These are design mockups matching the boards in `docs/design/main.pen`; see the [design notes](docs/design/设计说明.md) (Chinese).</sub>

---

## Why it exists

The usual routine: dig through vouchers in Excel → hand-filter the anomalies → screenshot the evidence → stitch together a Word working paper. Any rework along the way scatters the record you built.

FireEyeAud collapses that into one loop:

**Open folder → Ask → Findings with a trail → Chained evidence → Export**

What makes it hold together is that **every step leaves something behind**: which tables the AI looked at, what SQL it ran, which rows a conclusion rests on — all traceable.

---

## Highlights

### 1. Open a folder — no import, no export

There is no "create a project, then upload files" ceremony. Point it at the folder where your books live and start working; whatever is in the folder is what you can analyze.

Everything it produces lands in a `.fireeye/` subfolder of that same directory. Copy the folder to another machine and your findings, evidence, sessions and reports come with it.

### 2. The AI talks like a person, but conclusions need receipts

Ask the way you'd ask a colleague:

> Check whether administrative expenses moved abnormally this year — focus on vouchers with large round amounts

It won't hand you a conclusion out of thin air. It inspects the schema first, writes read-only SQL to query, stores the rows it found as evidence, and only then tells you what it saw.

### 3. Read-only by design — your data can't be damaged

Every query against your data is read-only: after parsing, only `SELECT` / `WITH` / `EXPLAIN` / `DESCRIBE` are allowed, and anything else is rejected outright.

**The AI has no tool that writes files.** It can read, query and search, but it cannot modify or delete your files. That's a property of the toolset, not a prompting convention.

### 4. An evidence trail behind every finding

Each finding carries its evidence: which SQL ran, what came back, which rows were involved, and when.

Evidence is hash-chained, and the chain is verified every time you open the workspace, so tampering shows up. During review, nobody has to ask "where did this conclusion come from?"

### 5. Findings can be confirmed — or challenged

Mark a finding as confirmed, in review, rejected or a false positive; change its severity; add review comments.

The AI's findings aren't necessarily right — your judgement is the final word, and the system keeps a full record of how you got there.

### 6. Three deliverables, all in the formats you need

| Deliverable | Purpose | Formats |
|---|---|---|
| **Working paper** | All findings, evidence index, audit conclusions | Word / Excel / PDF |
| **Evidence form** | Per-finding documentation, using your firm's template | Word |
| **Audit report** | The formal report body, written section by section | Word |

Evidence forms and reports can be **produced from a template you upload** — fonts, sizes, line spacing and page margins are carried over, so the output matches your internal house style.

### 7. Connect the databases you already have

Beyond Excel and CSV files, query SQLite, PostgreSQL, MySQL, SQL Server and Access directly in read-only mode.

Connection passwords are encrypted with the OS keychain (Electron `safeStorage`) and kept on this machine — **never written into the project folder**, never carried along with it.

Access can be granted per table and per column: unauthorized tables can't be queried, and unauthorized columns are rejected when named in SQL (`*` grants every column of that table).

### 8. Knowledge bases, web search and external tools — all opt-in

- **Knowledge bases**: connect Dify or RAGFlow so the AI can ground answers in your firm's standards and policies.
- **Web search**: off by default. Once enabled, the AI can look up regulations and public information online.
- **MCP**: mount external MCP servers to bring their tools into the conversation (advanced).

All of these are **off by default** and require you to configure and enable them. When web search or a knowledge base is enabled, note that query text is sent to the provider you chose.

### 9. Install it and go — no environment to set up

One installer, double-click, done. No Python to install, no database to configure; the built-in analysis engine starts with the app.

On first run you only need to give it a model endpoint — either a local Ollama / vLLM instance (the default, no internet needed) or a cloud service you have an account with.

---

## Getting started

### Step 1: Install and configure a model

1. On first launch, click the **chip icon (Models)** in the left activity bar.
2. Add a model profile with three fields:
   - **Endpoint**: for a local Ollama, `http://127.0.0.1:11434/v1`
   - **Model name**: e.g. `qwen2.5`
   - **API key**: leave empty for local models
3. Click **Test connection**, save, and mark it as the **default model**.

> Prefer a model with a long context window — it handles large tables more reliably. If you need to read data from scanned PDFs or images, pick a model with vision support and enable the **Vision** option.

### Step 2: Open your data folder

- Click **Open folder** and choose the directory holding your books, statements and vouchers.
- Or jump straight into a project from **Open recent**.

Once open, the folder's file tree appears on the left. The activity bar gives you:

| Icon | Name | What it's for |
|---|---|---|
| Folder | Explorer | Browse, preview and open files in the workspace |
| Magnifier | Search | Find by file name or content |
| Database | Databases | Register file sources and database connections |
| Book | Knowledge | Connect Dify / RAGFlow |
| Plug | MCP | Mount tools from external MCP servers |
| Sparkles | Skills | Manage reusable audit skills (loaded on demand) |
| Shield | Rules | Manage custom SQL audit rules |
| Chip | Models | Configure AI models |
| Layout | Templates | Upload evidence form and report templates |
| Check | Reports | Write and export audit reports |
| Document | Evidence Forms | Produce evidence forms for findings |
| Archive | Archive | Version your project (optionally backed by a Git remote) |

### Step 3: Let the AI start looking

Ask in the chat pane on the right. Use **@** above the input to reference a specific file, or attach files as temporary reference material.

Some questions that work well:

```
First tell me what's in this folder — which files are the voucher journals
```

```
Do debits and credits balance in this voucher table? If not, which entries are off
```

```
Summarize activity by account and flag any receivables that have been sitting unresolved
```

```
@journal.xlsx Are there records with large round amounts owed to suppliers I've never seen before
```

**Tips for better answers:**
- Name the **table** and the **field** you care about. It beats "look for anything odd".
- For numeric work (amounts, periods, tie-outs), state your criteria explicitly.
- Split a complex task into a few steps rather than one huge prompt.

### Step 4: Review the findings

Findings the AI raises appear in the **Findings** list in the results pane. Open one to see:

- Description, amount involved, severity
- **Evidence trail**: the data it relied on
- **Review history**: who changed what, and when

Make your call here — confirm, reject, mark as false positive, adjust severity. The process is recorded, so you can filter on it when producing working papers and reports.

### Step 5: Produce the deliverables

- **Working paper**: with a finding selected, open the working paper preview and export to Word / Excel / PDF in one click — or export only the selected finding.
- **Evidence form**: **Evidence Forms** in the left bar → New, choose a template, tick the findings, write it section by section, then export.
- **Audit report**: **Reports** in the left bar → New, write the body section by section, optionally link evidence forms, then export.

All outputs live under `.fireeye/artifacts/` in your workspace and can be opened directly or revealed in the folder.

---

## FAQ

**Does it need an internet connection?**
No. With a local model the whole thing works offline. Requests only leave your machine when you enable web search or connect a cloud model.

**Is my data uploaded?**
Your files are not uploaded. If you use a cloud model, however, your prompts and the data excerpts the AI reads are sent to that provider — that is true of any cloud AI tool. For confidential engagements, use a local model.

**Can the AI modify my files?**
No. The AI has read-only query access and no file-writing tools, so it cannot modify or delete workspace files. Editing a text file in the preview pane is you at the keyboard — a different thing entirely.

**How much data can it handle?**
Tables are loaded into the built-in analysis engine (DuckDB), which comfortably handles tens of thousands to millions of rows. But what reaches the AI is sampled and summarized: a single query returns 200 rows by default (10,000 max). It does not read the entire dataset.

**Which file formats are supported?**

| Type | Formats | Preview |
|---|---|---|
| Spreadsheets | `.xlsx` `.xlsm` `.csv` | Yes (Excel sheet by sheet) |
| Documents | `.docx` | Yes |
| PDF | `.pdf` | Yes (scanned PDFs need a vision model) |
| Images | Common image formats | Yes |
| Text | `.txt` `.md` `.json`, etc. | Yes (editable) |

Legacy `.doc` / `.xls` files need to be re-saved in Office first. Word, Excel and PDF are preview-only — they can't be edited in the app.

**I'm switching machines — what about my work?**
Copy the whole working folder, including `.fireeye/`. Model profiles and database passwords are stored on the machine itself, so you'll re-enter those once.

**Can several people work on the same engagement?**
Use the **Archive** panel, which is Git-based: each archive is a version, with change views, remote comparison, push and restore. A shared network folder works too.

---

## Security notes

### What stays on this machine

- The app listens only on the loopback address (`127.0.0.1`) and opens no external ports.
- Model keys, database passwords and knowledge base keys are encrypted with OS-level storage on this machine — never written into the project folder.
- Files outside the workspace cannot be read or written (enforced by path checks).
- File contents are treated as **untrusted input**: if a spreadsheet contains "ignore previous instructions", the AI won't comply.

### What leaves this machine (please read)

**All four are opt-in.** They only happen after you configure and enable the feature. Once enabled, nothing on this machine constrains what is sent — assess your data sensitivity before turning each one on.

**1. Remote model APIs receive your prompts and the data the AI reads**

If your model is a cloud service rather than a local Ollama / vLLM, the following is sent to **the endpoint you configured**, under that provider's data policy:

| Sent | Detail |
|---|---|
| Your prompt | Including `@`-referenced file names and the parsed text of attachments |
| Data the AI reads | SQL results, table schemas, file extracts, text OCR'd from images / PDFs |
| Conversation context | Prior turns, for coherence |

This is true of any cloud AI tool; the app cannot shield you from it. For confidential books, use a local model — local models run fully offline with no outbound traffic.

**2. The SQL assistant extracts data samples**

The "let the AI understand this table" feature sends **real sample rows**, not just the schema. Limits per sample:

| Item | Limit |
|---|---|
| Rows | **5** |
| Columns | **50** |
| Per cell | **200 characters** (truncated with `…`) |

That is at most 5 × 50 = 250 cells per authorized table. **These are actual rows**, including raw values in fields such as ID numbers, bank accounts and customer names — not masked placeholders. The preview query is a single server-built `SELECT`; the model can only name a table and cannot make the app dump or aggregate the whole table. The sample itself, however, is real data.

**Do not authorize this feature on sensitive tables**, or substitute a view / masked table first.

**3. Knowledge base retrieval sends your query to Dify / RAGFlow**

With a knowledge base enabled, the AI's retrieval query is sent verbatim to the Dify / RAGFlow address you configured — your own private deployment or their cloud, depending on the URL you enter.

**4. Web search sends your query to the search service**

Web search is **off by default**. Once enabled, the keywords the AI generates go to Tavily or your custom search endpoint. If those keywords include names or amounts from your books, they leave the machine too.

> **In short:** with a local model, data does not leave this machine. Once you connect a cloud model, a knowledge base or web search, **whatever the AI sees is sent** — including the 5 real sample rows taken by the SQL assistant. Weigh each feature separately.

---

## Known limitations

- **AI findings need human review.** It can miss things and it can be wrong; your professional judgement comes first.
- **Column-level authorization has a blind spot.** A `SELECT *`, or a column that isn't table-qualified, isn't checked column by column — unauthorized columns may come back. For sensitive databases, rely on table-level grants and authorize only the tables you actually need.
- **Skills** are made available to the AI on demand, but the tool list a skill declares is not automatically enabled.
- The installer is unsigned, so Windows may show a security prompt — choose **Run anyway**.

---

## For developers

Stack: Electron + React / TypeScript + Ant Design + Zustand (UI), FastAPI + LangGraph (agent service, packaged as a PyInstaller sidecar), DuckDB (analysis) + SQLite (state).

Prerequisites: Node ≥ 20, [`uv`](https://docs.astral.sh/uv/), Python 3.12 (fetched automatically by uv).

```bash
# Install dependencies
npm install
cd services/agent && uv sync

# From the repository root
npm run desktop:dev      # Launch the app (spawns the sidecar: random port, health check, cleanup on exit)
npm run desktop:test     # Electron shell tests
npm run renderer:build   # Build the frontend
npm run agent:dev        # Run the agent service alone (fixed port 8765, hot reload)
npm run agent:test       # Backend tests
npm run agent:lint       # Backend lint
```

Model defaults can be overridden with environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `FIREYEAUD_MODEL_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible endpoint |
| `FIREYEAUD_MODEL_NAME` | `qwen2.5` | Model name |
| `FIREYEAUD_MODEL_API_KEY` | empty (uses `not-needed`) | Auth for cloud services |
| `FIREYEAUD_MODEL_TEMPERATURE` | `0.2` | Sampling temperature |
| `FIREYEAUD_GLOBAL_DIR` | `~/.fireeye` | Global config directory |

> If downloading the Electron binary is slow, use a mirror:
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx electron --version`

Layout:

```
fireeyeaud/
├─ apps/desktop/      # Electron main process (windows, file IPC, sidecar lifecycle, safeStorage)
├─ apps/renderer/     # Frontend UI
├─ services/agent/    # FastAPI + LangGraph sidecar
├─ packages/shared/   # Shared TS types and locale resources
└─ docs/              # Design and implementation docs
```

Further reading:

- Developer docs: [`docs/dev/`](docs/dev/) (architecture, layering, API protocol, data formats, common tasks)
- Design and implementation record: [`docs/plans/fireeyeaud-design.md`](docs/plans/fireeyeaud-design.md)
- UI design notes: [`docs/design/设计说明.md`](docs/design/设计说明.md)
- Historical progress and known deviations: [`docs/plans/`](docs/plans/)

---

<sub>中文版：[README.md](README.md)</sub>