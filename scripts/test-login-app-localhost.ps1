$ErrorActionPreference = 'Stop'

$base = if ($env:SIMULADOS_BASE_URL) { [string]$env:SIMULADOS_BASE_URL } else { 'http://app.localhost:3000' }
$email = [string]$env:SIMULADOS_TEST_EMAIL
$passwordPlain = [string]$env:SIMULADOS_TEST_PASSWORD

if (-not $email) {
  throw 'Missing SIMULADOS_TEST_EMAIL env var (e.g. premium_test@example.com)'
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
if (-not $csrfToken) { throw 'Failed to obtain csrfToken from /api/csrf-token' }

$senhaHash = Get-Sha256Hex $passwordPlain
$body = @{ Email=$email; SenhaHash=$senhaHash } | ConvertTo-Json

$login = Invoke-RestMethod -Uri ($base + '/api/auth/login') -Method Post -Body $body -ContentType 'application/json' -WebSession $ws -Headers @{ 'X-CSRF-Token'=$csrfToken; Accept='application/json' } -TimeoutSec 15
'login ok'

$me = Invoke-RestMethod -Uri ($base + '/api/users/me') -Method Get -WebSession $ws -Headers @{ Accept='application/json' } -TimeoutSec 15
('me ok TipoUsuario=' + $me.TipoUsuario)

try {
  $probe = Invoke-WebRequest -Uri ($base + '/api/admin/data-explorer/tables') -Method Get -WebSession $ws -Headers @{ Accept='application/json' } -UseBasicParsing -TimeoutSec 15
  ('admin probe status=' + $probe.StatusCode)
} catch {
  'admin probe FAILED: ' + $_.Exception.Message
  if ($_.Exception.Response) {
    try { 'admin probe status=' + [int]$_.Exception.Response.StatusCode } catch {}
  }
}

try {
  $sidebar = Invoke-WebRequest -Uri ($base + '/components/sidebar.html') -Method Get -WebSession $ws -Headers @{ Accept='*/*' } -UseBasicParsing -TimeoutSec 15
  ('sidebar.html status=' + $sidebar.StatusCode)

  try {
    $hdrMtime = $sidebar.Headers['X-SimuladosBR-Static-Mtime']
    $hdrFile = $sidebar.Headers['X-SimuladosBR-Static-File']
    if ($hdrFile) { ('sidebar hdr X-SimuladosBR-Static-File=' + $hdrFile) }
    if ($hdrMtime) { ('sidebar hdr X-SimuladosBR-Static-Mtime=' + $hdrMtime) }
  } catch {}

  try {
    $localSidebarPath = Join-Path $PSScriptRoot '..\frontend\components\sidebar.html'
    $localItem = Get-Item $localSidebarPath
    ('sidebar local path=' + $localSidebarPath)
    ('sidebar local mtimeUtc=' + $localItem.LastWriteTimeUtc.ToString('o'))
    ('sidebar local sha256=' + (Get-FileHash $localSidebarPath -Algorithm SHA256).Hash)
  } catch {
    ('sidebar local hash FAILED: ' + $_.Exception.Message)
  }

  try {
    $hashAlg = [System.Security.Cryptography.SHA256]::Create()
    try {
      $respHash = [System.BitConverter]::ToString($hashAlg.ComputeHash([Text.Encoding]::UTF8.GetBytes($sidebar.Content))).Replace('-', '')
    } finally {
      $hashAlg.Dispose()
    }
    ('sidebar resp sha256=' + $respHash)
  } catch {
    ('sidebar resp hash FAILED: ' + $_.Exception.Message)
  }

  $hasAdmin = ($sidebar.Content -match 'id="sidebarAdminAccordion"')
  $hasFallback = ($sidebar.Content -match 'Deterministic fallback: /api/users/me')
  ('sidebar has admin accordion=' + $hasAdmin)
  ('sidebar has me-fallback=' + $hasFallback)

  $idx = $sidebar.Content.IndexOf('async function checkAdminAccess')
  if ($idx -ge 0) {
    $start = [Math]::Max(0, $idx - 180)
    $len = [Math]::Min(900, $sidebar.Content.Length - $start)
    '--- sidebar snippet (checkAdminAccess) ---'
    $sidebar.Content.Substring($start, $len)
    '--- end snippet ---'
  } else {
    'checkAdminAccess not found in sidebar content'
  }
} catch {
  'sidebar.html fetch FAILED: ' + $_.Exception.Message
  if ($_.Exception.Response) {
    try { 'sidebar.html status=' + [int]$_.Exception.Response.StatusCode } catch {}
  }
}
