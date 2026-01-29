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

$checkPath = Join-Path $PSScriptRoot "db-check.ps1"
if (Test-Path $checkPath) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $checkPath -DatabaseUrl $DatabaseUrl
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$schemaPath = Join-Path $PSScriptRoot "..\db\schema.sql"
if (-not (Test-Path $schemaPath)) {
  Write-Error "Schema file not found: $schemaPath"
  exit 1
}

Write-Host "[db:init] Applying schema: $schemaPath"
& psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $schemaPath
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "[db:init] Done."
