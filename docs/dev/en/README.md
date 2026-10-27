# Developer Documentation

For anyone changing this project: understand how it's built, and know which layer a change belongs in.

> User-facing docs live at the repo root: [`README.md`](../../../README.md) (Chinese) and [`README.en.md`](../../../README.en.md) (English).
> 中文版见 [`../zh/`](../zh/).

## Where to start

| What you want to do | Read this |
|---|---|
| Just took over; want to see how it fits together | [Architecture](01-architecture.md) |
| Add a backend endpoint or an agent tool | [Backend](02-backend.md) |
| Add a panel or a right-hand tab | [Frontend](03-frontend.md) |
| Look up an endpoint path or an SSE field | [API & protocols](04-api-reference.md) |
| Figure out what the files in `.fireeye/` are | [Data model](05-data-model.md) |
| Follow a checklist to do one concrete thing | [Common tasks](06-workflows.md) |

## Three kinds of docs

This repo keeps three kinds of documentation. Don't mix them up:

- **`docs/dev/`** — the reference manual for the current implementation, in [`en/`](./) and [`zh/`](../zh/). It describes **the code as it is today**; when the code changes, this should change with it.
- **`docs/plans/`** — phase- and date-based implementation records and design proposals. These are **history**: they record why something was done at the time, not what the code does now. Some contain superseded approaches — don't copy from them.
- **`docs/design/`** — UI design files (`.pen` sources and preview images) plus the interface design notes.

`docs/plans/fireeyeaud-design.md` is the early overall design doc. Its product positioning, constraints and some data-format conventions are still valid, but the Phase 1–7 plans in it are long since completed and surpassed. For tool counts and directory layout, trust the code.

## Codebase size

Rough scale at the time of writing (2026-10), as a reference for how big a change is:

| Part | Files | Lines |
|---|---|---|
| `services/agent/` (Python) | 113 | ~18,000 |
| `services/agent/tests/` | 116 | ~14,400 |
| `apps/renderer/src/` | 155 | ~21,900 |
| `apps/desktop/src/` | 8 | ~1,600 |
| `packages/shared/src/` | 5 | ~3,000 |

## Rules for editing these docs

- Document **facts**, not intentions. If something isn't implemented, don't write it up.
- For anything behaviour-specific (ports, limits, error codes, file names), go back and check the code before writing — these values drift.
- Leave `docs/plans/` alone. It's a record of the past. To correct a fact, change files here.