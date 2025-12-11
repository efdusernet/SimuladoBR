# Script para adicionar logger.js em todos os HTMLs
# Uso: .\add-logger-to-htmls.ps1

$frontendPath = $PSScriptRoot

$htmlFiles = @(
    @{ Path = "pages\exam.html"; Depth = 1 },
    @{ Path = "pages\examFull.html"; Depth = 1 },
    @{ Path = "pages\examSetup.html"; Depth = 1 },
    @{ Path = "pages\Indicadores.html"; Depth = 1 },
    @{ Path = "pages\settings.html"; Depth = 1 },
    @{ Path = "pages\progressoGeral.html"; Depth = 1 },
    @{ Path = "pages\admin\questionForm.html"; Depth = 2 },
    @{ Path = "pages\admin\questionBulk.html"; Depth = 2 },
    @{ Path = "components\sidebar.html"; Depth = 1 }
)

foreach ($file in $htmlFiles) {
    $filePath = Join-Path $frontendPath $file.Path
    
    if (-not (Test-Path $filePath)) {
        Write-Warning "Arquivo não encontrado: $($file.Path)"
        continue
    }
    
    Write-Host "Processando: $($file.Path)" -ForegroundColor Cyan
    
    # Ler conteúdo
    $content = Get-Content $filePath -Raw -Encoding UTF8
    
    # Verificar se já tem logger.js
    if ($content -match 'utils/logger\.js') {
        Write-Host "  - Já possui logger.js" -ForegroundColor Gray
        continue
    }
    
    # Determinar o caminho relativo correto
    $loggerPath = if ($file.Depth -eq 2) { "/utils/logger.js" } else { "/utils/logger.js" }
    
    # Encontrar a tag <head> e adicionar após ela
    if ($content -match '(?s)(<head>.*?<meta[^>]+charset[^>]+>)') {
        $loggerScript = "`n  <!-- Controlled Logging System (must load before other scripts) -->`n  <script src=`"$loggerPath`"></script>"
        $content = $content -replace '(?s)(<head>.*?<meta[^>]+charset[^>]+>)', "`$1$loggerScript"
        
        Set-Content $filePath -Value $content -Encoding UTF8 -NoNewline
        Write-Host "  ✓ Logger adicionado" -ForegroundColor Green
    } else {
        Write-Warning "  ! Não foi possível encontrar <head> ou charset meta"
    }
}

Write-Host "`n✅ Logger.js adicionado a todos os HTMLs!" -ForegroundColor Green
