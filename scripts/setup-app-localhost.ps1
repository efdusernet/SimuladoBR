[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Remove
)

$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$hostName = 'app.localhost'
$entryV4 = "127.0.0.1\t$hostName"
$entryV6 = "::1\t$hostName"

function Assert-Admin {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Este script precisa ser executado como Administrador para editar o hosts: $hostsPath"
  }
}

Assert-Admin

if (-not (Test-Path $hostsPath)) {
  throw "Arquivo hosts não encontrado: $hostsPath"
}

$raw = Get-Content -Raw -ErrorAction Stop $hostsPath
$lines = $raw -split "\r?\n"

if ($Remove) {
  $newLines = $lines | Where-Object { $_ -notmatch "(^|\s)$([regex]::Escape($hostName))(\s|$)" }
  if ($PSCmdlet.ShouldProcess($hostsPath, "Remover entradas de $hostName")) {
    Set-Content -LiteralPath $hostsPath -Value ($newLines -join "`r`n") -Encoding ascii
  }
  Write-Host "[setup-app-localhost] Removido: $hostName" -ForegroundColor Yellow
  exit 0
}

$hasEntry = $lines | Where-Object { $_ -match "(^|\s)$([regex]::Escape($hostName))(\s|$)" } | Select-Object -First 1
if ($hasEntry) {
  Write-Host "[setup-app-localhost] Já existe no hosts: $hostName" -ForegroundColor Green
  exit 0
}

$append = @()
$append += $entryV4
$append += $entryV6

if ($PSCmdlet.ShouldProcess($hostsPath, "Adicionar $hostName")) {
  $out = @()
  $out += $lines
  if ($out.Count -gt 0 -and $out[-1].Trim() -ne '') { $out += '' }
  $out += "# SimuladosBR (dev)"
  $out += $append
  Set-Content -LiteralPath $hostsPath -Value ($out -join "`r`n") -Encoding ascii
}

Write-Host "[setup-app-localhost] Adicionado: $hostName -> 127.0.0.1 / ::1" -ForegroundColor Green
