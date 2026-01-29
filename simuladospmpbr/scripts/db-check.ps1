param(
  [string]$DatabaseUrl
)

function Import-DotEnv([string]$envPath) {
  if (-not (Test-Path $envPath)) { return }

  Get-Content $envPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    if ($line.StartsWith('#')) { return }

    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }

    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if (-not $key) { return }

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not (Test-Path Env:$key)) {
      Set-Item -Path Env:$key -Value $value
    }
  }
}

if (-not $DatabaseUrl) {
  $envPath = Join-Path $PSScriptRoot "..\.env"
  Import-DotEnv $envPath
  $DatabaseUrl = $env:DATABASE_URL
}

if (-not $DatabaseUrl) {
  Write-Error "DATABASE_URL not set. Configure .env or pass -DatabaseUrl."
  exit 1
}

function Mask-DbUrl([string]$url) {
  # Mask password in postgres://user:pass@host/db
  return ($url -replace '(postgres(?:ql)?://[^:/\s]+:)([^@/\s]+)(@)', '$1***$3')
}

function Parse-DbUrl([string]$url) {
  $pattern = '^postgres(?:ql)?:\/\/(?<user>[^:\/\s]+)(:(?<pass>[^@\/\s]*))?@(?<host>[^:\/\s]+)(:(?<port>\d+))?\/(?<db>[^?\s]+)'
  $m = [regex]::Match($url, $pattern)
  if (-not $m.Success) {
    throw "Unsupported DATABASE_URL format. Expected postgres://user:pass@host:port/db"
  }

  $user = $m.Groups['user'].Value
  $pass = $m.Groups['pass'].Value
  $host = $m.Groups['host'].Value
  $port = $m.Groups['port'].Value
  if (-not $port) { $port = '5432' }
  $db = $m.Groups['db'].Value

  return @{ user = $user; pass = $pass; host = $host; port = $port; db = $db }
}

function Build-DbUrl($parts, [string]$dbName) {
  $cred = $parts.user
  if ($parts.pass -ne $null -and $parts.pass -ne '') {
    $cred = "$($parts.user):$($parts.pass)"
  }
  return "postgres://$cred@$($parts.host):$($parts.port)/$dbName"
}

$masked = Mask-DbUrl $DatabaseUrl
Write-Host "[db:check] Connecting to: $masked"

$output = & psql $DatabaseUrl -v ON_ERROR_STOP=1 -c "select 1 as ok" 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
  Write-Host $output
  Write-Host "[db:check] OK"
  exit 0
}

if ($output -match 'database ".*" does not exist' -or $output -match 'FATAL:.*does not exist') {
  $parts = Parse-DbUrl $DatabaseUrl
  $adminUrl = Build-DbUrl $parts 'postgres'

  Write-Host "[db:check] Database '$($parts.db)' does not exist. Creating..."
  $createSql = 'create database "' + $parts.db + '";'
  $createOut = & psql $adminUrl -v ON_ERROR_STOP=1 -c $createSql 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Error $createOut
    exit $LASTEXITCODE
  }

  Write-Host "[db:check] Created. Re-checking connection..."
  $output2 = & psql $DatabaseUrl -v ON_ERROR_STOP=1 -c "select 1 as ok" 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Error $output2
    exit $LASTEXITCODE
  }

  Write-Host $output2
  Write-Host "[db:check] OK"
  exit 0
}

Write-Error $output
exit $LASTEXITCODE
