# Script para migrar console.* para logger.* no backend
# Uso: .\migrate-console-to-logger.ps1

$backendPath = $PSScriptRoot

# Arquivos a processar
$files = @(
    "controllers\examController.js",
    "controllers\questionController.js",
    "controllers\indicatorController.js",
    "controllers\userController.js",
    "controllers\metaController.js",
    "controllers\paymentController.js",
    "controllers\integrityController.js",
    "routes\users.js",
    "routes\auth.js",
    "routes\feedback.js",
    "models\index.js",
    "middleware\requireAdmin.js",
    "config\security.js",
    "services\SessionManager.js"
)

foreach ($file in $files) {
    $filePath = Join-Path $backendPath $file
    
    if (-not (Test-Path $filePath)) {
        Write-Warning "Arquivo não encontrado: $filePath"
        continue
    }
    
    Write-Host "Processando: $file" -ForegroundColor Cyan
    
    # Ler conteúdo
    $content = Get-Content $filePath -Raw -Encoding UTF8
    $originalContent = $content
    
    # Verificar se já tem import do logger
    $hasLoggerImport = $content -match "require\('\.\.\/utils\/logger'\)|require\('\..\/\.\.\/utils\/logger'\)"
    
    # Adicionar import do logger se necessário
    if (-not $hasLoggerImport) {
        # Encontrar última linha de require antes do código
        if ($content -match "(?s)(^.*?require\([^\)]+\);?\s*\n)") {
            $lastRequire = $matches[1]
            # Determinar o caminho relativo correto
            $depth = ($file -split '\\').Count - 1
            $relativePath = if ($depth -eq 1) { "." } else { ".." * ($depth - 1) }
            $loggerImport = "const { logger } = require('$relativePath/utils/logger');"
            
            $content = $content -replace "(?s)(^.*?require\([^\)]+\);?\s*\n)", "`$1$loggerImport`n"
            Write-Host "  ✓ Adicionado import do logger" -ForegroundColor Green
        }
    }
    
    # Substituições
    $replacements = 0
    
    # console.error → logger.error
    $newContent = $content -replace '\bconsole\.error\(', 'logger.error('
    if ($newContent -ne $content) {
        $replacements += ([regex]::Matches($content, '\bconsole\.error\(')).Count
        $content = $newContent
    }
    
    # console.warn → logger.warn
    $newContent = $content -replace '\bconsole\.warn\(', 'logger.warn('
    if ($newContent -ne $content) {
        $replacements += ([regex]::Matches($content, '\bconsole\.warn\(')).Count
        $content = $newContent
    }
    
    # console.info → logger.info
    $newContent = $content -replace '\bconsole\.info\(', 'logger.info('
    if ($newContent -ne $content) {
        $replacements += ([regex]::Matches($content, '\bconsole\.info\(')).Count
        $content = $newContent
    }
    
    # console.log → logger.info (escolha apropriada)
    $newContent = $content -replace '\bconsole\.log\(', 'logger.info('
    if ($newContent -ne $content) {
        $replacements += ([regex]::Matches($content, '\bconsole\.log\(')).Count
        $content = $newContent
    }
    
    # console.debug → logger.debug
    $newContent = $content -replace '\bconsole\.debug\(', 'logger.debug('
    if ($newContent -ne $content) {
        $replacements += ([regex]::Matches($content, '\bconsole\.debug\(')).Count
        $content = $newContent
    }
    
    # Salvar apenas se houve mudanças
    if ($content -ne $originalContent) {
        Set-Content $filePath -Value $content -Encoding UTF8 -NoNewline
        Write-Host "  ✓ $replacements substituições realizadas" -ForegroundColor Green
    } else {
        Write-Host "  - Nenhuma alteração necessária" -ForegroundColor Gray
    }
}

Write-Host "`n✅ Migração concluída!" -ForegroundColor Green
Write-Host "Verifique os arquivos e teste o backend antes de fazer commit." -ForegroundColor Yellow
