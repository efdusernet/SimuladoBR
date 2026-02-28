param(
  [int]$Port = 3000
)

$env:CHAT_SERVICE_BASE_URL = "http://localhost:4010"
$env:PORT = "$Port"
Write-Host "[start-windows] PORT=$env:PORT" -ForegroundColor Cyan
node "$(Join-Path $PSScriptRoot 'index.js')"
