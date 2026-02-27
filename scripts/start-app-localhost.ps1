[CmdletBinding()]
param(
  [int]$Port = 3000
)

$base = "http://app.localhost:$Port"

$env:PORT = "$Port"
$env:FRONTEND_URL = $base
$env:APP_BASE_URL = $base
$env:BACKEND_BASE = $base
$env:APP_HOST = 'app.localhost'

Write-Host "[start-app-localhost] PORT=$env:PORT" -ForegroundColor Cyan
Write-Host "[start-app-localhost] FRONTEND_URL=$env:FRONTEND_URL" -ForegroundColor Cyan
Write-Host "[start-app-localhost] APP_BASE_URL=$env:APP_BASE_URL" -ForegroundColor Cyan

# Reuse the existing Windows start script (Gemini timeouts, etc.)
$backendStart = Join-Path (Split-Path -Parent $PSScriptRoot) 'backend\start-windows.ps1'

if (-not (Test-Path $backendStart)) {
  throw "Script não encontrado: $backendStart"
}

& $backendStart
