# Frontend (Renderer)

> 中文版：[../zh/03-frontend.md](../zh/03-frontend.md)

`apps/renderer/` is the React + TypeScript + Zustand + Ant Design UI layer, running inside the Electron renderer process.

## State: Zustand

One store per domain, under `src/store/`:

| Store | Holds |
|---|---|
| `workspace.ts` | Current workspace path, recent list, open/close flow |
| `chat.ts` | Session list, message stream, SSE event handling |
| `ui.ts` | Activity-bar view, right-hand tabs, selection — **the single source of layout** |
| `settings.ts` | Theme, language, web search and other settings |
| `sidecar.ts` | Backend process state (port / token / status) |
| `findings.ts` `reports.ts` `forms.ts` … | Per-domain data and actions |

**Conventions:**

- **No JSX in stores.** Data and actions only.
- On failure, async actions store an `errorKey` string; components translate it:

```ts
catch (err) {
  set({ errorKey: errorKeyOf(err) });
}
```

- `errorKeyOf` lives in `lib/errorKey.ts`. It only reads `err.messageKey` and doesn't depend on `api.ts` — **keep it that way**, or node unit tests will fail wholesale by dragging in sidecar dependencies.
- Pass a second argument for a scenario-specific fallback: `errorKeyOf(err, 'error.deleteFailed')`.

## The right-hand area: the tab model

The right side of the UI is a tab container; "open something" always means "open a tab". Types live in `store/ui.ts`:

```ts
export type RightTab =
  | SessionTab      // session (always present; only this kind has id 'session')
  | PreviewTab      // file preview, one per file
  | FormTab         // config form, form:<domain>:<id|new>
  | SettingsTab     // settings
  | RuleRunTab      // rule dry-run
  | DbSchemaTab     // database table schema
  | DbDataTab       // database table data
  | KbBrowseTab     // knowledge base browser
  | KbQueryTab      // knowledge base trial query
  | ReportTab       // report workspace
  | EvidenceFormTab // evidence-form workspace
  | ArchiveDiffTab  // archive diff (singleton)
  | ArchiveChangesTab
  | ArchiveRemoteTab
```

Adding a tab kind touches three places:

1. The `RightTab` union in `store/ui.ts`
2. An `openXxx()` action in `store/ui.ts` (see `openReport`)
3. The render branch in `components/RightArea.tsx`

**Leave guard**: when a tab has unsaved content, switching or closing calls `allowLeave()`, which prompts "Save / Don't save / Cancel". To participate, a new tab must hook into the same mechanism (see `components/forms/UnsavedGuard.tsx`).

## HTTP calls

`lib/api.ts` is **just a re-export barrel**; the implementation is under `lib/api/`:

```
lib/api/
  client.ts    ApiError / request / safeFetch / toApiError / base URL and auth headers
  sse.ts       consumeSseGeneric
  chat.ts      streamChat + context types shared with sessions
  sessions.ts  findings.ts  reports.ts  db.ts  ...  (17 domain modules)
```

Add endpoints to the matching `xxx.ts`, **never by adding functions to `api.ts`**.

Using SSE:

```ts
await streamChat(sessionId, message, {
  onEvent: (event) => { /* event.type: status | context | token | tool_call | tool_result | done | error */ },
  signal,
});
```

## Using main-process capabilities

The renderer can't touch the filesystem directly. Capabilities are exposed as `window.fireeyeaud` via the `preload.cjs` allowlist:

| Method | Purpose |
|---|---|
| `openFolder()` / `openFiles(kind)` | Native pickers |
| `readDir({ root, path })` | List a directory |
| `readFile({ root, path })` | Read a file (main process verifies it's inside the workspace) |
| `writeTextFile({ root, path, text })` | Write text (extension allowlist + size cap) |
| `deletePath` `copyFiles` `movePath` `createDir` `createFile` `renamePath` | File operations |
| `putSecret(plaintext)` / `deleteSecret(ref)` | safeStorage encrypt/decrypt |
| `openPath` / `showItemInFolder` / `openExternal` | Hand off to the OS |
| `onWorkspaceFsChanged(cb)` | Workspace file-change notifications |
| `onSidecarStatus(cb)` | Backend status changes |

**Always use optional chaining** when calling (`window.fireeyeaud?.readFile?.(...)`) — the object doesn't exist when running previews or unit tests in a plain browser.

Adding an IPC capability means changing three places: the `ipcMain.handle` in `main.cjs`, the allowlist in `preload.cjs`, and the call site in the renderer.

## Component organization

```
components/
  workspace/   Workspace shell (WorkspaceShell / WorkspaceChat / WorkspacePreview)
  panels/      Activity-bar panels (Explorer / Search / Database / Knowledge / ...)
  forms/       Config forms (DatabaseForm / ModelForm / RuleForm / ...)
  reports/     Report workspace
  archive/     Archive pieces (Panel / DiffTab / ChangesTab / RemoteTab)
  preview/     File previews (Text / Spreadsheet / Pdf / Image / Docx / Csv)
  results/     Finding list and detail
```

File names are PascalCase, one main component per file. Heavy dependencies (CodeMirror, pdfjs, exceljs, docx-preview, Cytoscape) are **loaded with dynamic import**, never into the main bundle.

## Internationalization

Copy lives in `packages/shared/src/locales/`, grouped by namespace (`navigation` / `error` / `welcome` / `working-paper` …).

```tsx
const { t } = useTranslation('error');
t('notFound')
```

- **Add to both languages**, or the other locale shows the raw key.
- Error copy uses the `error` namespace; keys correspond to the backend's `message_key` with the `error.` prefix stripped.

## Styling

- Global styles are in `src/styles/`, themed through CSS variables (`--fg` / `--bg` / `--border`, etc.).
- Class names follow BEM: `activitybar__item`, `activitybar__item--active`.
- Light/dark switching only changes CSS variables — **never hardcode colors in components**.

## Tests

```bash
cd apps/renderer
node --experimental-transform-types --test tests/*.test.ts
```

Note: node loads TS as-is and **cannot resolve extension-less relative imports**. So any file pulled in by a test must either have no runtime dependencies, or import them with an explicit `.ts` suffix (see `store/reportWorkspace.ts`).

## Frontend self-check

- [ ] New store actions set an `errorKey` on failure
- [ ] New UI copy added in both languages
- [ ] New tab kinds added to the `RightTab` union and the `RightArea` branches
- [ ] IPC calls use optional chaining
- [ ] Heavy dependencies use dynamic import
- [ ] `npx tsc --noEmit` and `node --test tests/*.test.ts` both pass