# 自动更新

> English: [../en/07-updater.md](../en/07-updater.md)

应用在 Windows NSIS 安装版中支持版本监测与静默升级。底层是 `electron-updater` 的 generic provider，更新包放在 GitHub Releases。

## 行为

- 设置 → 版本更新里可开关「启动时自动检查更新」，默认开启。
- 开关打开时，应用启动约 9 秒后检查一次；关掉后不再自动检查，但仍可在设置里手动点「检查更新」。
- 发现新版本只提示，不自动下载；用户点「下载」后才开始，下载完成提示「立即重启安装 / 稍后」。
- 选「稍后」则在下次正常退出应用时静默安装并重启；退出前会先停掉 Python sidecar，最多等 5 秒。
- 「立即重启安装」也走正常退出路径：先停 sidecar，再交给 electron-updater 拉起安装器。
- 开发模式（`npm run desktop:dev`）不检查更新，设置里会显示「开发模式不检查更新」。

---

## 配置

文件：`%APPDATA%\fireeyeaud\update-settings.json`

```json
{
  "enabled": true,
  "feedUrl": "https://github.com/txboy/fireeyeaud/releases/latest/download/"
}
```

- `enabled` 只控制启动时的自动检查，不影响手动检查，也不会取消已经开始的下载。
- `feedUrl` 只接受 http(s)，不能带用户名密码；保存时会去掉 query/hash，并补上结尾的 `/`。
- 内网部署时把 `feedUrl` 指向镜像目录。镜像里需要有 `latest.yml`、安装包和安装包的 `.blockmap`。
- 写入采用临时文件 + rename 的原子替换，不会留下写坏的 JSON；不做 fsync，极端断电时可能丢失最后一次偏好变更，对开关类配置可以接受。

---

## 发布新版本

1. 改 `apps/desktop/package.json` 的 `version`（例如 `0.1.1`）。安装版的应用版本取自这里。

2. 按顺序准备打包输入（少了任何一样，安装包里就会是旧前端或旧后端）：

   ```powershell
   cd services/agent
   uv sync --dev
   uv run pyinstaller fireeyeaud-agent.spec --noconfirm --clean
   cd ../..
   npm run renderer:build
   ```

3. 构建 NSIS 安装包：

   ```powershell
   cd apps/desktop
   npx electron-builder --win --publish never
   ```

   也可以从仓库根跑 `npm run dist -w @fireeyeaud/desktop`；该脚本不带 `--publish` 参数，默认同样是 `never`。产物在 `apps/desktop/release/`：安装包（`火眼审计助手 Setup x.y.z.exe`）、`.blockmap`、`latest.yml`。

   首次打包时 electron-builder 会下载 Electron 与 NSIS/winCodeSign 工具链；国内网络卡住时先设置镜像再重试：

   ```powershell
   $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
   $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
   ```

4. 在 GitHub 创建 tag `v0.1.1` 的 Release。不要存为 draft，也不要勾选 pre-release（`releases/latest` 会跳过这两种）。上传安装包、`.blockmap`、`latest.yml` 三个文件。

5. 已安装旧版本的用户下次启动时会看到更新提示。

generic provider 不会自动上传（`--publish always` 对它不生效），所以保持 `--publish never`，构建完手动上传。推 tag 会触发 `.github/workflows/release.yml` 构建并留下 Actions artifact，但流水线同样不发 Release，上传这一步仍然手动。

---

## 注意

- `releases/latest` 取的是最新的非 draft、非 pre-release Release，按创建时间排，不比较版本号。一次发布多个版本时，务必最后创建 semver 最大的那个，否则 `latest/download` 会指向旧版本。
- `latest.yml` 里的版本必须高于用户已安装的版本，否则不会提示。
- 安装包没做代码签名时，Windows SmartScreen 可能对下载的安装包给出警告；正式分发建议补签名。
- 更新源默认在 GitHub，国内网络可能较慢，可改为内网镜像地址。
- 只支持 NSIS 安装版。便携版、直接运行 `release/win-unpacked`、非 NSIS 安装方式都不受支持——这类环境没有 NSIS 的安装/卸载路径，更新装不上或会装到别处。
- 检查更新失败不会阻塞应用启动；设置界面会显示失败状态，可换源或稍后再试。
