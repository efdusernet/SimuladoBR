# Script para migrar console.* para logger.* no frontend
# Uso: .\migrate-console-to-logger-frontend.ps1

$frontendPath = $PSScriptRoot

# Arquivos JavaScript standalone
$jsFiles = @(
    "script_exam.js",
    "script_indicadores.js",
    "utils\offlineDB.js",
    "utils\syncManager.js",
    "utils\layoutManager.js",
    "utils\logout.js",
    "utils\csrf.js",
    "utils\sanitize.js",
    "utils\secureStorage.js",
    "components\offlineIndicator.js",
    "sw.js"
)

# Arquivos HTML (migrar apenas scripts inline)
$htmlFiles = @(
    "index.html",
    "pages\examSetup.html",
    "pages\Indicadores.html",
    "pages\exam.html",
    "pages\examFull.html",
    "pages\settings.html",
    "pages\progressoGeral.html",
    "pages\admin\questionForm.html",
    "pages\admin\questionBulk.html",
    "components\sidebar.html"
)

function Migrate-ConsoleToLogger {
    param(
        [string]$filePath,
        [string]$relativeName
    )
    
    if (-not (Test-Path $filePath)) {
        Write-Warning "Arquivo não encontrado: $relativeName"
        return
    }
    
    Write-Host "Processando: $relativeName" -ForegroundColor Cyan
    
    # Ler conteúdo
    $content = Get-Content $filePath -Raw -Encoding UTF8
    $originalContent = $content
    
    # Substituições usando fallback pattern para compatibilidade
    $replacements = 0
    
    # console.error → logger?.error || console.error
    $pattern = '(?<!logger\?\.)(?<!\/\/ )console\.error\('
    $replacement = 'logger?.error || console.error)('
    $matches = [regex]::Matches($content, $pattern)
    if ($matches.Count -gt 0) {
        $content = [regex]::Replace($content, $pattern, 'logger.error(')
        $replacements += $matches.Count
    }
    
    # console.warn → logger.warn
    $pattern = '(?<!logger\?\.)(?<!\/\/ )console\.warn\('
    $matches = [regex]::Matches($content, $pattern)
    if ($matches.Count -gt 0) {
        $content = [regex]::Replace($content, $pattern, 'logger.warn(')
        $replacements += $matches.Count
    }
    
    # console.info → logger.info
    $pattern = '(?<!logger\?\.)(?<!\/\/ )console\.info\('
    $matches = [regex]::Matches($content, $pattern)
    if ($matches.Count -gt 0) {
        $content = [regex]::Replace($content, $pattern, 'logger.info(')
        $replacements += $matches.Count
    }
    
    # console.log → logger.info (contexto geral) ou logger.debug (se parece debug)
    $pattern = '(?<!logger\?\.)(?<!\/\/ )console\.log\('
    $matches = [regex]::Matches($content, $pattern)
    if ($matches.Count -gt 0) {
        # Analise simples: se tem [DEBUG] ou [debug], use logger.debug
        $content = [regex]::Replace($content, $pattern, {
            param($match)
            $context = $content.Substring([Math]::Max(0, $match.Index - 50), [Math]::Min(100, $content.Length - [Math]::Max(0, $match.Index - 50)))
            if ($context -match '\[DEBUG\]|\[debug\]|debug') {
                return 'logger.debug('
            } else {
                return 'logger.info('
            }
        })
        $replacements += $matches.Count
    }
    
    # console.debug → logger.debug
    $pattern = '(?<!logger\?\.)(?<!\/\/ )console\.debug\('
    $matches = [regex]::Matches($content, $pattern)
    if ($matches.Count -gt 0) {
        $content = [regex]::Replace($content, $pattern, 'logger.debug(')
        $replacements += $matches.Count
    }
    
    # Salvar apenas se houve mudanças
    if ($content -ne $originalContent) {
        Set-Content $filePath -Value $content -Encoding UTF8 -NoNewline
        Write-Host "  ✓ $replacements substituições realizadas" -ForegroundColor Green
    } else {
        Write-Host "  - Nenhuma alteração necessária" -ForegroundColor Gray
    }
}

Write-Host "=== Migrando arquivos JavaScript ===" -ForegroundColor Yellow
foreach ($file in $jsFiles) {
    $filePath = Join-Path $frontendPath $file
    Migrate-ConsoleToLogger -filePath $filePath -relativeName $file
}

Write-Host "`n=== Migrando arquivos HTML ===" -ForegroundColor Yellow
foreach ($file in $htmlFiles) {
    $filePath = Join-Path $frontendPath $file
    Migrate-ConsoleToLogger -filePath $filePath -relativeName $file
}

Write-Host "`n✅ Migração do frontend concluída!" -ForegroundColor Green
Write-Host "Lembre-se:" -ForegroundColor Yellow
Write-Host "1. Verificar se logger.js está carregado em todos os HTMLs" -ForegroundColor Yellow
Write-Host "2. Testar funcionalidade em localhost e produção" -ForegroundColor Yellow
Write-Host "3. Revisar manualmente casos especiais" -ForegroundColor Yellow
