# 构建 sidecar 单文件可执行：services/agent/dist/fireeyeaud-agent.exe
# 用法（在 services/agent 目录）：pwsh -File scripts/build-agent.ps1
$ErrorActionPreference = "Stop"
Push-Location (Join-Path $PSScriptRoot "..")
try {
  uv run pyinstaller fireeyeaud-agent.spec --noconfirm --clean
  Write-Host "产物：dist/fireeyeaud-agent.exe"
} finally {
  Pop-Location
}
