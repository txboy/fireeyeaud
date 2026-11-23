# Auto update

> 中文版：[../zh/07-updater.md](../zh/07-updater.md)

The Windows NSIS build can check for new versions and upgrade silently. It uses `electron-updater` with the generic provider, and update packages are hosted on GitHub Releases.

## Behaviour

- Settings → Version updates has a "Check for updates at startup" switch, on by default.
- With the switch on, the app checks about 9 seconds after launch. With it off, nothing is checked automatically, but "Check for updates" still works from Settings.
- Finding a new version only shows a prompt; nothing downloads until the user clicks "Download". When the download finishes, the prompt offers "Restart and install" or "Later".
- Choosing "Later" installs silently and restarts the app on the next normal quit. The Python sidecar is stopped first, waiting at most 5 seconds.
- "Restart and install" uses the same quit path: stop the sidecar, then let electron-updater launch the installer.
- Development mode (`npm run desktop:dev`) never checks for updates; Settings shows "Update checks are disabled in development mode".

---

## Configuration

File: `%APPDATA%\fireeyeaud\update-settings.json`

```json
{
  "enabled": true,
  "feedUrl": "https://github.com/txboy/fireeyeaud/releases/latest/download/"
}
```

- `enabled` only controls the startup check. It does not affect manual checks and does not cancel a download in progress.
- `feedUrl` accepts http(s) only and must not contain a username or password. On save, query and fragment are dropped and a trailing `/` is added if missing.
- For intranet deployments, point `feedUrl` at a mirror. The mirror needs `latest.yml`, the installer, and the installer's `.blockmap`.
- Writes go through a temp file plus rename, so a half-written JSON file is never left behind. There is no fsync: a hard power loss can drop the last preference change, which is acceptable for a toggle.

---

## Releasing a new version

1. Bump `version` in `apps/desktop/package.json` (for example to `0.1.1`). This is the version the installed app reports.

2. Prepare the packaging inputs in this order (skip one and the installer ships a stale renderer or sidecar):

   ```powershell
   cd services/agent
   uv sync --dev
   uv run pyinstaller fireeyeaud-agent.spec --noconfirm --clean
   cd ../..
   npm run renderer:build
   ```

3. Build the NSIS installer:

   ```powershell
   cd apps/desktop
   npx electron-builder --win --publish never
   ```

   `npm run dist -w @fireeyeaud/desktop` from the repo root is equivalent. Output lands in `apps/desktop/release/`: the installer (`火眼审计助手 Setup x.y.z.exe`), its `.blockmap`, and `latest.yml`.

4. Create a GitHub Release for tag `v0.1.1`. Don't save it as a draft and don't mark it pre-release — `releases/latest` skips both. Upload the installer, the `.blockmap`, and `latest.yml`.

5. Users on older versions see the update prompt on their next launch.

The generic provider never uploads for you (`--publish always` has no effect on it), so keep `--publish never` and upload manually. Pushing the tag does run `.github/workflows/release.yml`, which builds the app and leaves an Actions artifact, but the workflow does not create a Release either — the upload is still manual.

---

## Caveats

- `releases/latest` returns the newest non-draft, non-pre-release Release by creation time, not by version number. When publishing several versions, create the highest semver last, or `latest/download` will keep pointing at an older one.
- The version in `latest.yml` must be higher than the installed version, or no prompt appears.
- Without code signing, Windows SmartScreen may warn about the downloaded installer. Sign it before distributing widely.
- The default feed is on GitHub, which can be slow from mainland China; switch to an intranet mirror if needed.
- Only NSIS installs are supported. Portable builds, running `release/win-unpacked` directly, and non-NSIS installs are not — they have no NSIS install/uninstall path, so the update either fails to install or installs somewhere else.
- A failed check never blocks app startup. Settings shows the failure; try another feed or retry later.
