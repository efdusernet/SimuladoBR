param(
  [string]$RepoRoot = $(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

$backendEnv = Join-Path $RepoRoot 'backend\.env'
$chatEnv = Join-Path $RepoRoot 'chat-service\.env'

function Get-EnvValueFromFile([string]$path, [string]$name) {
  if (!(Test-Path -LiteralPath $path)) { return $null }
  $line = Get-Content -LiteralPath $path | Where-Object { $_ -match ("^\s*" + [regex]::Escape($name) + "\s*=") } | Select-Object -First 1
  if (!$line) { return $null }
  $val = ($line -replace ("^\s*" + [regex]::Escape($name) + "\s*=\s*"), '').Trim()
  if ($val.StartsWith('"') -and $val.EndsWith('"') -and $val.Length -ge 2) { $val = $val.Substring(1, $val.Length - 2) }
  if ($val.StartsWith("'") -and $val.EndsWith("'") -and $val.Length -ge 2) { $val = $val.Substring(1, $val.Length - 2) }
  return $val
}

function Set-Or-AddEnv([string]$path, [string]$key, [string]$value, [switch]$Quote) {
  if ($null -eq $value) { return }

  $newLine = if ($Quote) {
    $escaped = ($value -replace '"', '\\"')
    $key + '="' + $escaped + '"'
  } else {
    "$key=$value"
  }

  if (!(Test-Path -LiteralPath $path)) {
    New-Item -ItemType File -Path $path -Force | Out-Null
  }

  $content = Get-Content -LiteralPath $path -Raw
  if ($content -match "(?m)^\s*$([regex]::Escape($key))\s*=") {
    $content = [regex]::Replace($content, "(?m)^\s*$([regex]::Escape($key))\s*=.*$", $newLine)
  } else {
    if ($content -and -not $content.EndsWith("`n")) { $content += "`r`n" }
    $content += $newLine + "`r`n"
  }

  Set-Content -LiteralPath $path -Value $content -Encoding UTF8
}

if (!(Test-Path -LiteralPath $backendEnv)) {
  throw "backend/.env not found at: $backendEnv"
}

$dbName = Get-EnvValueFromFile $backendEnv 'DB_NAME'
$dbUser = Get-EnvValueFromFile $backendEnv 'DB_USER'
$dbPass = Get-EnvValueFromFile $backendEnv 'DB_PASSWORD'
$dbHost = Get-EnvValueFromFile $backendEnv 'DB_HOST'
$dbPort = Get-EnvValueFromFile $backendEnv 'DB_PORT'

if (!$dbName -or !$dbUser -or !$dbHost -or !$dbPort) {
  throw 'Missing DB_NAME/DB_USER/DB_HOST/DB_PORT in backend/.env'
}

Set-Or-AddEnv $chatEnv 'COMMUNICATION_DB_NAME' $dbName
Set-Or-AddEnv $chatEnv 'COMMUNICATION_DB_USER' $dbUser
Set-Or-AddEnv $chatEnv 'COMMUNICATION_DB_PASSWORD' $dbPass -Quote
Set-Or-AddEnv $chatEnv 'COMMUNICATION_DB_HOST' $dbHost
Set-Or-AddEnv $chatEnv 'COMMUNICATION_DB_PORT' $dbPort
Set-Or-AddEnv $chatEnv 'COMMUNICATION_PGSSLMODE' 'disable'

# SMTP is required for notifications; copy if present
foreach ($k in 'SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','EMAIL_FROM','SMTP_ALLOW_SELF_SIGNED') {
  $v = Get-EnvValueFromFile $backendEnv $k
  if ($null -ne $v -and $v -ne '') {
    $quote = $k -in @('SMTP_USER','SMTP_PASS','EMAIL_FROM')
    Set-Or-AddEnv $chatEnv $k $v -Quote:$quote
  }
}

Write-Host 'Updated chat-service/.env with COMMUNICATION_DB_* (values not printed).'
