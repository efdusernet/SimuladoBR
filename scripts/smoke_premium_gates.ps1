param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$FreeEmail = 'free_test@example.com',
  [string]$PremiumEmail = 'premium_test@example.com',
  [SecureString]$Password,
  [switch]$KeepServer
)

$ErrorActionPreference = 'Stop'

function Get-Sha256Hex([string]$s) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($s)
  $hash = $sha.ComputeHash($bytes)
  return ([System.BitConverter]::ToString($hash)).Replace('-','').ToLowerInvariant()
}

function Get-JsonCodeFromResponse([string]$text) {
  try {
    $obj = $text | ConvertFrom-Json
    if ($null -ne $obj -and $obj.PSObject.Properties.Name -contains 'code') {
      return [string]$obj.code
    }
  } catch {}
  return $null
}

function ConvertFrom-SecureStringToPlaintext([SecureString]$sec) {
  if ($null -eq $sec) { return '' }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Invoke-Status([string]$Method, [string]$Url, [hashtable]$Headers = $null, $Body = $null) {
  try {
    if ($null -ne $Body) {
      $json = ($Body | ConvertTo-Json -Depth 10)
      $r = Invoke-WebRequest -Method $Method -Uri $Url -Headers $Headers -ContentType 'application/json' -Body $json -UseBasicParsing
    } else {
      $r = Invoke-WebRequest -Method $Method -Uri $Url -Headers $Headers -UseBasicParsing
    }
    Write-Host ("$($r.StatusCode) $Url")
    return
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $status = [int]$resp.StatusCode
      Write-Host ("$status $Url")
      try {
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $txt = $sr.ReadToEnd(); $sr.Close()
        if ($txt) {
          $code = Get-JsonCodeFromResponse $txt
          if ($code) { Write-Host ("  code=$code") }
        }
      } catch {}
      return
    }

    Write-Host ("ERR $Url $($_.Exception.Message)")
  }
}

function Stop-NodeOnPort3000 {
  try {
    $connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    foreach ($c in @($connections)) {
      $owningPid = $c.OwningProcess
      if ($owningPid) {
        $p = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
        if ($p -and ($p.ProcessName -match '^node')) {
          Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
          Start-Sleep -Milliseconds 300
        }
      }
    }
  } catch {}
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$logOutPath = Join-Path $repoRoot 'backend\logs\smoke-server.out.log'
$logErrPath = Join-Path $repoRoot 'backend\logs\smoke-server.err.log'
New-Item -ItemType Directory -Path (Split-Path $logOutPath) -Force | Out-Null

Stop-NodeOnPort3000
if (Test-Path $logOutPath) { Remove-Item $logOutPath -Force }
if (Test-Path $logErrPath) { Remove-Item $logErrPath -Force }

$serverProc = Start-Process -FilePath 'node' -ArgumentList @('backend/index.js') -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $logOutPath -RedirectStandardError $logErrPath

try {
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-WebRequest -Uri "$BaseUrl/api/meta/user-params" -UseBasicParsing | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $ready) {
    Write-Host 'Server did not become ready in time. Last log lines:'
    if (Test-Path $logOutPath) { Get-Content $logOutPath -Tail 60 }
    if (Test-Path $logErrPath) { Get-Content $logErrPath -Tail 60 }
    exit 2
  }

  # CSRF: fetch token + cookie, then send X-CSRF-Token on state-changing requests
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $csrfResp = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/csrf-token" -WebSession $session
  $csrfToken = if ($csrfResp -and $csrfResp.csrfToken) { [string]$csrfResp.csrfToken } else { '' }
  if (-not $csrfToken) { throw 'Failed to fetch CSRF token from /api/csrf-token' }

  if ($null -eq $Password) {
    try { $Password = Read-Host -Prompt 'Password (will be SHA-256 hashed client-side, then used for login)' -AsSecureString } catch {}
  }
  $passwordPlain = ConvertFrom-SecureStringToPlaintext $Password
  if (-not $passwordPlain) { throw 'Password is required. Pass -Password or input it when prompted.' }
  $sha = Get-Sha256Hex $passwordPlain

  $csrfHeaders = @{ 'X-CSRF-Token' = $csrfToken }
  $freeLogin = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -WebSession $session -Headers $csrfHeaders -ContentType 'application/json' -Body (@{ Email=$FreeEmail; SenhaHash=$sha } | ConvertTo-Json)
  $premLogin = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -WebSession $session -Headers $csrfHeaders -ContentType 'application/json' -Body (@{ Email=$PremiumEmail; SenhaHash=$sha } | ConvertTo-Json)

  $hFree = @{ Authorization = ('Bearer ' + $freeLogin.token) }
  $hPrem = @{ Authorization = ('Bearer ' + $premLogin.token) }

  Invoke-Status 'GET' "$BaseUrl/api/meta/user-params"
  Invoke-Status 'GET' "$BaseUrl/api/indicators/probability" $hFree
  Invoke-Status 'GET' "$BaseUrl/api/indicators/probability" $hPrem
  Invoke-Status 'GET' "$BaseUrl/api/ai/insights" $hFree
  Invoke-Status 'GET' "$BaseUrl/api/ai/insights" $hPrem

} finally {
  if (-not $KeepServer) {
    try { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}

if (-not $KeepServer) {
  Write-Host ("Server stopped (pid $($serverProc.Id))")
} else {
  Write-Host ("Server kept running (pid $($serverProc.Id))")
}
