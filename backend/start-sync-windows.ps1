param(
  [int]$Port = 3000
)

$env:PORT = "$Port"
Write-Host "[start-sync-windows] PORT=$env:PORT" -ForegroundColor Cyan

node "$(Join-Path $PSScriptRoot 'syncStart.js')"
