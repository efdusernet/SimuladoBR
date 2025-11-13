# SimuladosBR — Notas de versão, esquema e uso

Este documento consolida o que foi implementado recentemente (multi-exames), como aplicar migrações, iniciar o backend, endpoints principais (incluindo filtros por exam_type), formatos aceitos no bulk de questões e links de páginas admin. No final há uma lista de pendências e próximos passos sugeridos.

## Resumo das mudanças recentes

- Suporte a múltiplos exames (Exam Types), com blueprint vindo do banco quando disponível.
- Campo `questao.exam_type_id` usado para vincular a questão ao tipo de exame.
- Seleção de perguntas ajustada:
	- Quando `count = 180` (PMP cheio), os filtros (domínios/áreas/grupos) são ignorados.
	- Se o pré-check indicar `available = 0` devido à restrição por exam_type, há fallback que ignora `exam_type` para viabilizar a seleção completa.
- Persistência de tentativas (`exam_attempt`, `exam_attempt_question`, `exam_attempt_answer`) com `Meta.sessionId` (recuperação após restart de servidor).
- Ponto de pausa e bloqueios do botão Continuar alinhados ao rótulo das questões 60 e 120 (índices 59 e 119, 0‑based) no exame completo.
- Endpoint de retomada: reconstrução de sessão em memória via `/api/exams/resume` quando o servidor é reiniciado.
- RBAC (papéis) implementado com tabelas `role` e `user_role`, middleware `requireAdmin` e proteção dos endpoints administrativos de questões (`POST /api/questions` e `POST /api/questions/bulk`).
- API de administração de papéis: `GET /api/roles`, `GET /api/roles/user/:userId`, `POST /api/roles/assign`, `POST /api/roles/remove` (todas requerem cabeçalho `X-Session-Token` de um usuário com papel `admin`).
- Script CLI para conceder papel admin: `npm run role:grant-admin`.

## Esquema (foco em exam_type)

- Tabela `exam_type` (id/slug/nome/duração/…); somente tipos ativos são usados.
- Tabela `questao` agora conta com `exam_type_id` (FK lógica usada nas queries).
- Tabelas de tentativas:
	- `exam_attempt` (UserId, ExamTypeId, Status, Meta JSON com `sessionId`, `source`, `examType`, BlueprintSnapshot e PauseState)
	- `exam_attempt_question` (AttemptId, QuestionId, Ordem)
	- `exam_attempt_answer` (AttemptQuestionId, OptionId, Resposta, Selecionada)

Arquivos SQL relevantes: `backend/sql/*.sql`

## Aplicando migrações e iniciando o backend

Pré‑requisitos: Node.js 18+, PostgreSQL acessível com as credenciais em `.env` (ver `backend/config/database.js`).

1) Instale dependências (backend):
	 - `cd backend`
	 - `npm install`

2) Aplique os SQLs (em ordem) usando o utilitário incluso:
	 - `npm run db:apply-sql`
	 - Por padrão, o script executa os arquivos em `backend/sql` na ordem numérica (001, 002, …).

3) Inicie o backend:
	 - `npm start`
	 - Alternativa com sync automático de modelos (dev): `npm run start:sync` (define também `DB_SYNC=true` se necessário)

Observações de ambiente:
- Se quiser forçar a leitura de tipos do DB (e não cair em fallback estático), defina `EXAM_TYPES_DISABLE_FALLBACK=true` no ambiente do backend.

## Endpoints principais e filtros por exam_type

Base: `http://localhost:3000`

- `GET /api/exams/types`
	- Lista os tipos de exame disponíveis (DB quando possível).

- `POST /api/exams/select`
	- Seleciona perguntas e retorna `{ sessionId, total, exam, questions: [...] }`.
	- Cabeçalhos/Body relevantes:
		- `X-Session-Token`: identifica o usuário (e‑mail ou id).
		- `examType`: slug (ex.: `pmp`).
		- `count`: quantidade de questões (quando `count=180`, filtros são ignorados).
		- `dominios`, `areas`, `grupos`: filtros opcionais (AND entre grupos, OR dentro do grupo).
	- Filtro por exame: se o exam type existe no DB, aplica `exam_type_id = <id>`; caso `ignoreExamType=true` é respeitado no fallback.

- `POST /api/exams/start-on-demand`
	- Similar a `/select`, mas persiste a ordem das questões no servidor e retorna `{ sessionId, total, attemptId, exam }`.

- `GET /api/exams/:sessionId/question/:index`
	- Retorna a pergunta por índice, lendo opções de `respostaopcao`.

- `POST /api/exams/submit`
	- Submete respostas (parcial ou final). Para parcial, envia `partial: true`.
	- Caso a sessão em memória não exista, tenta recuperar `attemptId` por `Meta.sessionId` (fallback DB), e segue persistindo.

- `POST /api/exams/resume`
	- Reconstrói a sessão em memória a partir do banco, usando `sessionId` (Meta) ou `attemptId`.

## Bulk de questões — formatos aceitos (JSON e XML)

Endpoint: `POST /api/questions/bulk` (requer papel admin).

Aceita:
1) JSON (array de questões)

```json
[
	{
		"descricao": "Enunciado da questão 1",
		"tiposlug": "single",
		"examTypeSlug": "pmp",
		"iddominio": 1,
		"codareaconhecimento": 2,
		"codgrupoprocesso": 3,
		"dica": "Opcional",
		"options": [
			{ "descricao": "A", "correta": true },
			{ "descricao": "B" },
			{ "descricao": "C" },
			{ "descricao": "D" }
		],
		"explicacao": "Texto opcional"
	}
]
```

2) JSON (objeto com defaults + questions)

```json
{
	"examTypeSlug": "pmp",
	"iddominio": 1,
	"questions": [
		{ "descricao": "Questão 1", "tiposlug": "single", "options": [
			{ "descricao": "A", "correta": true },
			{ "descricao": "B" }
		]},
		{ "descricao": "Questão 2", "tiposlug": "multi", "options": [
			{ "descricao": "A", "correta": true },
			{ "descricao": "B", "correta": true },
			{ "descricao": "C" }
		], "explicacao": "Exemplo com multi" }
	]
}
```

3) XML (multipart/form-data com arquivo `file`)

```xml
<questions examType="pmp">
	<question>
		<descricao>Enunciado XML</descricao>
		<tipo>single</tipo>
		<alternativas>
			<alternativa correta="true">A</alternativa>
			<alternativa>B</alternativa>
			<alternativa>C</alternativa>
			<alternativa>D</alternativa>
		</alternativas>
		<explicacao>Comentário</explicacao>
	</question>
</questions>
```

Notas do bulk:
- É obrigatório informar um tipo de exame (por item ou no default do lote): `examTypeId` ou `examTypeSlug`.
- Para `single`, o backend força no máximo uma correta.
- Explicações (quando presentes) são inseridas em `explicacaoguia`.

## Páginas admin

- Formulário de questão: `frontend/pages/admin/questionForm.html`
- Importação em massa: `frontend/pages/admin/questionBulk.html`
	- Aliases protegidos (recomendado usar estes links):
		- `/admin/questions/form`
		- `/admin/questions/bulk`

<!--
TODO (futuro): Trabalhos planejados para admin UI/entrega de HTML:
- Mover proteção server-side/do middleware para todos os assets admin (CSS/JS) ou servir assets combinados via rota protegida.
- Adicionar página administrativa central (/admin) com navegação, listagem de usuários e atribuição de papéis.
- Melhorar autenticação: migrar de resolução por `X-Session-Token` para tokens JWT e cookies Secure/SameSite em produção.
- Escrever testes de integração para endpoints e páginas admin (incluir fluxos de role grant/revoke).
-- Priorizar: adicionar índice em `exam_attempt` para acelerar `/api/exams/resume` quando for necessário.
-- Observação: esta lista registra intenções — implementar quando houver janela de trabalho apropriada.
-- Autor: implementado parcialmente em branch `alteracao-para-multiplos-exames` (proteção de rotas e aliases já adicionados).
-- Data: 2025-11-02
--
-->

### Planejado (para implementação posterior)

- [ ] Centralizar assets/admin sob rota protegida
- [ ] Criar dashboard `/admin` para gerenciamento de usuários e papéis
- [ ] Trocar para auth baseada em JWT + cookie Secure em produção
- [ ] Cobertura de testes de integração para fluxos admin

## Postman

Coleção e instruções em: `postman/README.md`
- Inclui fluxo de registro/login/verificação, exemplos de seleção/execução de exames, submissão de respostas e um grupo "Admin — Roles" com requests para listar papéis, consultar papéis de um usuário, atribuir e remover papel `admin`.

## Itens pendentes / próximos passos

- Opcional: Autenticação baseada em JWT para rotas admin (atualmente `X-Session-Token` resolve usuário por id/e‑mail/username e valida papel no DB).
- Completar requests no Postman para:
	- Admin de questões (create/bulk) com exemplos de payloads reais.
	- Sessão de retomada (`/api/exams/resume`) e recuperação após restart.
- Engine de correção para tipos avançados (além de single/multi):
	- `tiposlug` não básicos (ex.: interação/arrastar & soltar) — definir schema e regra de correção.
- Índices de performance:
	- Considerar índice em `exam_attempt(meta->>'sessionId')` para acelerar `/resume`.
- Harden de UX:
	- Consolidar lógica de pausa/bloqueio (evitar duplicidade entre overlay e runtime).

---

Se algo não estiver claro ou faltar um exemplo específico, abra uma issue ou peça que eu amplie a seção correspondente.

## Reset de Dados de Exames

Existem dois mecanismos para limpar tentativas e respostas de exame em ambientes de desenvolvimento/teste:

1. Script Node seguro (`backend/scripts/reset_exam_data.js`)
2. Script SQL direto (`backend/sql/reset_exam_data.sql`)

### 1) Script Node

Proteções incorporadas:
- Requer variável de ambiente `ALLOW_RESET=TRUE`.
- Requer flag `--force` (sem ela o script aborta).
- Sem `--execute` faz apenas DRY-RUN (mostra plano, não deleta nada).

Tabelas afetadas (por padrão): `exam_attempt_answer`, `exam_attempt_question`, `exam_attempt`. Opcionalmente `exam_type` com `--include-types`.

Comandos (PowerShell):
```pwsh
Set-Location backend
$env:ALLOW_RESET="TRUE"
node scripts/reset_exam_data.js --force            # dry-run (sem backup)
node scripts/reset_exam_data.js --force --execute  # executa (backup JSON automático por padrão)
node scripts/reset_exam_data.js --force --execute --no-backup  # executa sem backup
node scripts/reset_exam_data.js --force --execute --backup     # força backup (igual padrão)
node scripts/reset_exam_data.js --force --execute --include-types  # inclui exam_type
```

Adicionar atalhos em `backend/package.json` (opcional):
```json
"scripts": {
	"reset:dry": "ALLOW_RESET=TRUE node scripts/reset_exam_data.js --force",
	"reset:full": "ALLOW_RESET=TRUE node scripts/reset_exam_data.js --force --execute"
}
```
Executando:
```pwsh
Set-Location backend
$env:ALLOW_RESET="TRUE"
npm run reset:dry
npm run reset:full
```

Backups:
- São gravados em `backend/backups/reset_<timestamp>/` como arquivos JSON (um por tabela).
- Para desativar em uma execução use `--no-backup`.
- Para garantir mesmo comportamento futuro use flag explícita `--backup`.

### 2) Script SQL direto

Arquivo: `backend/sql/reset_exam_data.sql`

Conteúdo principal (por padrão preserva `exam_type`):
```sql
BEGIN;
TRUNCATE TABLE exam_attempt_answer RESTART IDENTITY CASCADE;
TRUNCATE TABLE exam_attempt_question RESTART IDENTITY CASCADE;
TRUNCATE TABLE exam_attempt RESTART IDENTITY CASCADE;
-- Opcional: TRUNCATE TABLE exam_type RESTART IDENTITY CASCADE;
COMMIT;
```

Executar via psql (PowerShell):
```pwsh
psql -h $env:DB_HOST -U $env:DB_USER -d $env:DB_NAME -f backend/sql/reset_exam_data.sql
```

### Quando usar cada um

- Use o script Node quando quiser camada de segurança, logs e fácil extensão.
- Use o SQL quando estiver em um fluxo de CI simples ou precisar auditar tudo manualmente.

### Passos recomendados de limpeza
1. Rodar dry-run para revisar.
2. Fazer backup opcional (pg_dump ou COPY).
3. Executar limpeza real.
4. Verificar contagens:
	 ```sql
	 SELECT COUNT(*) FROM exam_attempt;
	 SELECT COUNT(*) FROM exam_attempt_question;
	 SELECT COUNT(*) FROM exam_attempt_answer;
	 ```

Se desejar posso adicionar etapa automática de backup antes do truncate (COPY para CSV). Solicite se necessário.

