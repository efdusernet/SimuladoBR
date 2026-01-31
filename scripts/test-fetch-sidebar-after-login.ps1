$ErrorActionPreference = 'Stop'

$base = if ($env:SIMULADOS_BASE_URL) { [string]$env:SIMULADOS_BASE_URL } else { 'http://app.localhost:3000' }
$email = [string]$env:SIMULADOS_TEST_EMAIL
$passwordPlain = [string]$env:SIMULADOS_TEST_PASSWORD

if (-not $email) {
  throw 'Missing SIMULADOS_TEST_EMAIL env var (e.g. your-admin@example.com)'
}
if (-not $passwordPlain) {
  throw 'Missing SIMULADOS_TEST_PASSWORD env var (plain password)'
}

function Get-Sha256Hex([string]$s) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($s)
    $hash = $sha.ComputeHash($bytes)
    return ($hash | ForEach-Object { $_.ToString('x2') }) -join ''
  } finally {
    $sha.Dispose()
  }
}

$ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$csrf = Invoke-RestMethod -Uri ($base + '/api/csrf-token') -Method Get -WebSession $ws -Headers @{ Accept='application/json' } -TimeoutSec 15
$csrfToken = [string]$csrf.csrfToken
if (-not $csrfToken) { throw 'Failed to obtain csrfToken' }

$senhaHash = Get-Sha256Hex $passwordPlain
$body = @{ Email=$email; SenhaHash=$senhaHash } | ConvertTo-Json

$null = Invoke-RestMethod -Uri ($base + '/api/auth/login') -Method Post -Body $body -ContentType 'application/json' -WebSession $ws -Headers @{ 'X-CSRF-Token'=$csrfToken; Accept='application/json' } -TimeoutSec 15
'login ok'

$html = Invoke-WebRequest -Uri ($base + '/components/sidebar.html') -Method Get -WebSession $ws -Headers @{ Accept='text/html,*/*' } -UseBasicParsing -TimeoutSec 15
('sidebar status=' + $html.StatusCode)

$snippet = ($html.Content | Select-String -Pattern 'Deterministic fallback: /api/users/me' -SimpleMatch)
if ($snippet) { 'sidebar contains deterministic fallback: YES' } else { 'sidebar contains deterministic fallback: NO' }
