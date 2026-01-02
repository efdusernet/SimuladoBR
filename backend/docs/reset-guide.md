# Guia de Reset de Dados de Exames

Este guia detalha as abordagens para limpar dados de tentativas de exame (desenvolvimento / teste) com reforço de segurança e backup.

## Escopo
Remove conteúdo das tabelas:
- `exam_attempt_answer`
- `exam_attempt_question`
- `exam_attempt`
Opcionalmente: `exam_type` (não recomendado se quiser manter os tipos configurados).

Não afeta:
- Usuários
- Questões e opções (`questao`, `respostaopcao`)
- Metadados (domínios / áreas / grupos)

## Abordagens
1. Script Node com salvamento automático de backup JSON
2. Script SQL direto (sem proteção lógica)

## 1. Script Node
Arquivo: `backend/scripts/reset_exam_data.js`

Segurança:
- Exige `ALLOW_RESET=TRUE`
- Exige `--force`
- Sem `--execute` → DRY-RUN
- Backup JSON automático antes do truncate (desativável com `--no-backup`)

Flags:
- `--execute` aplica truncates
- `--include-types` inclui `exam_type`
- `--no-backup` desativa backup
- `--backup` força backup (já é padrão em modo execute)

### Exemplos (PowerShell)
```pwsh
Set-Location backend
$env:ALLOW_RESET="TRUE"
# Dry-run
node scripts/reset_exam_data.js --force
# Executa (com backup)
node scripts/reset_exam_data.js --force --execute
# Executa sem backup
node scripts/reset_exam_data.js --force --execute --no-backup
# Executa incluindo exam_type
node scripts/reset_exam_data.js --force --execute --include-types
```

Backups salvos em: `backend/backups/reset_<timestamp>/` (um .json por tabela).

### Integrando em package.json
```json
"scripts": {
  "reset:dry": "ALLOW_RESET=TRUE node scripts/reset_exam_data.js --force",
  "reset:full": "ALLOW_RESET=TRUE node scripts/reset_exam_data.js --force --execute"
}
```

## 2. Script SQL
Arquivo: `backend/sql/reset_exam_data.sql`

Conteúdo principal:
```sql
BEGIN;
TRUNCATE TABLE exam_attempt_answer RESTART IDENTITY CASCADE;
TRUNCATE TABLE exam_attempt_question RESTART IDENTITY CASCADE;
TRUNCATE TABLE exam_attempt RESTART IDENTITY CASCADE;
-- Opcional: TRUNCATE TABLE exam_type RESTART IDENTITY CASCADE;
COMMIT;
```

Execução:
```pwsh
psql -h $env:DB_HOST -U $env:DB_USER -d $env:DB_NAME -f backend/sql/reset_exam_data.sql
```

## Estratégia de Backup Adicional
Para exportar CSV antes da limpeza (manual):
```sql
COPY exam_attempt TO STDOUT WITH CSV HEADER;
COPY exam_attempt_question TO STDOUT WITH CSV HEADER;
COPY exam_attempt_answer TO STDOUT WITH CSV HEADER;
```
Usar via psql redirecionando para arquivos:
```bash
psql -h host -U user -d db -c "COPY exam_attempt TO STDOUT WITH CSV HEADER" > exam_attempt.csv
```

## Pós-Reset: Verificações
```sql
SELECT COUNT(*) FROM exam_attempt;
SELECT COUNT(*) FROM exam_attempt_question;
SELECT COUNT(*) FROM exam_attempt_answer;
```
Todos devem retornar 0 após execução normal.

## Boas Práticas
- Sempre fazer dry-run primeiro.
- Manter backups (JSON ou CSV) em controle de acesso adequado.
- Nunca rodar em produção sem concordância explícita (adicionar camada adicional de confirmação se necessário).

## Extensões Futuras
- Adicionar opção `--backup-format=csv` para gerar saída CSV.
- Adicionar prompt interativo quando `NODE_ENV=production`.

Dúvidas ou solicitações de extensão: abra issue ou peça diretamente.
