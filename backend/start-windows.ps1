param(
  [int]$OllamaTimeoutMs = 60000,
  [int]$OllamaInsightsTimeoutMs = 180000
)

$env:OLLAMA_TIMEOUT_MS = "$OllamaTimeoutMs"
$env:OLLAMA_INSIGHTS_TIMEOUT_MS = "$OllamaInsightsTimeoutMs"

Write-Host "[start-windows] OLLAMA_TIMEOUT_MS=$env:OLLAMA_TIMEOUT_MS OLLAMA_INSIGHTS_TIMEOUT_MS=$env:OLLAMA_INSIGHTS_TIMEOUT_MS"

node "$(Join-Path $PSScriptRoot 'index.js')"
