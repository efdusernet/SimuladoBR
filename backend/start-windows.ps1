param(
  [int]$GeminiTimeoutMs = 60000,
  [int]$GeminiInsightsTimeoutMs = 60000
)

$env:GEMINI_TIMEOUT_MS = "$GeminiTimeoutMs"
$env:GEMINI_INSIGHTS_TIMEOUT_MS = "$GeminiInsightsTimeoutMs"

Write-Host "[start-windows] GEMINI_TIMEOUT_MS=$env:GEMINI_TIMEOUT_MS GEMINI_INSIGHTS_TIMEOUT_MS=$env:GEMINI_INSIGHTS_TIMEOUT_MS"

node "$(Join-Path $PSScriptRoot 'index.js')"
