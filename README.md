# SimuladosBR — Notas de versão, esquema e uso

Este documento consolida o que foi implementado recentemente (multi-exames), como aplicar migrações, iniciar o backend, endpoints principais (incluindo filtros por exam_type), formatos aceitos no bulk de questões e links de páginas admin. No final há uma lista de pendências e próximos passos sugeridos.

Leitura rápida recomendada (onboarding): `CONTEXT.md`, `FEATURES.md` e `KNOWN_ISSUES.md`.

## Resumo das mudanças recentes

- Suporte a múltiplos exames (Exam Types), com blueprint vindo do banco quando disponível.
- Campo `questao.exam_type_id` usado para vincular a questão ao tipo de exame.
- Seleção de perguntas ajustada:
	- Quando `count = 180` (PMP cheio), os filtros (domínios/áreas/grupos) são ignorados.
	- Se o pré-check indicar `available = 0` devido à restrição por exam_type, há fallback que ignora `exam_type` para viabilizar a seleção completa.
- Persistência de tentativas (`exam_attempt`, `exam_attempt_question`, `exam_attempt_answer`) com `Meta.sessionId` (recuperação após restart de servidor).
- Ponto de pausa e bloqueios do botão Continuar alinhados ao rótulo das questões 60 e 120 (índices 59 e 119, 0‑based) no exame completo.
- Endpoint de retomada: reconstrução de sessão em memória via `/api/exams/resume` quando o servidor é reiniciado.
- RBAC (papéis) implementado com tabelas `role` e `user_role`, middleware `requireAdmin` e proteção de rotas administrativas (ex.: `/api/questions`, `/api/questions/bulk`, `/api/admin/*`).
	- Script CLI para conceder papel admin: `npm --prefix backend run role:grant-admin`.
- Autenticação atual: JWT com sessão única por usuário (cookie httpOnly `sessionToken` no browser; ou `Authorization: Bearer <token>` / `X-Session-Token: <token>` em clientes).
- Review de tentativas finalizadas:
	- Endpoint `GET /api/exams/result/:attemptId` e páginas `frontend/pages/examReviewFull.html` / `frontend/pages/examReviewQuiz.html`.
- Chat-service integrado via reverse-proxy em `/chat/*`.
- Insights da IA:
	- Endpoint `GET /api/ai/insights` expandido com `ai.explainability` (rastreabilidade do porquê dos alertas) e plano 7 dias.
	- Base para modelo temporal: grava snapshots diários em `public.user_daily_snapshot` (upsert 1x/dia), somente para pagantes (`BloqueioAtivado=false`).
	- Admin UI: seção no modal Admin para consultar snapshots via `GET /api/admin/users/:id/insights-snapshots`.

## Premium por expiração (PremiumExpiresAt) + ponte com checkout (Asaas)

O app principal (este backend) agora suporta um campo `Usuario.PremiumExpiresAt` (timestamptz no Postgres) para armazenar **até quando** o usuário tem acesso premium.

Estado atual do gating:

- O código legado considera **premium** quando `BloqueioAtivado=false`.
- O campo `PremiumExpiresAt` foi adicionado para permitir expiração por data.
- A ponte com o checkout mantém ambos consistentes: atualiza `PremiumExpiresAt` e também ajusta `BloqueioAtivado`.

### Endpoints admin (leitura/edição manual)

Protegidos por `requireAdmin` (JWT/cookie) e sujeitos a CSRF nos métodos de escrita.

- `GET /api/admin/users/:id/premium-expires-at`
	- Resposta: `{ Id, PremiumExpiresAt }` (ISO string ou `null`)

- `PUT /api/admin/users/:id/premium-expires-at`
	- Body: `{ "PremiumExpiresAt": "2026-02-01T12:00:00.000Z" }` ou `{ "PremiumExpiresAt": null }`
	- Resposta: `{ Id, PremiumExpiresAt }`

Obs: também existem as rotas versionadas em `/api/v1/*`.

### Endpoint interno (server-to-server) para sincronização do premium

Para integrar com o checkout (simuladospmpbr) sem depender de login/admin nem CSRF, foi criado um endpoint **interno** (fora de `/api`):

- `POST /internal/v1/premium/sync`
	- Auth: header `x-access-api-key` deve bater com `ACCESS_API_KEY` no `.env`.
	- Body: `{ email, active, expiresAt }`
		- `active=true`  → `BloqueioAtivado=false` e `PremiumExpiresAt=expiresAt` (ou `null` para acesso vitalício)
		- `active=false` → `BloqueioAtivado=true` e `PremiumExpiresAt=null`

- `POST /internal/v1/premium/grant`
	- Auth: header `x-access-api-key`.
	- Body: `{ email, days }`
	- Efeito: estende `PremiumExpiresAt` por `days` a partir de `max(agora, PremiumExpiresAt atual)` e seta `BloqueioAtivado=false`.

Variáveis de ambiente necessárias neste backend:

- `ACCESS_API_KEY` (deve ser igual ao valor configurado no checkout para chamadas internas)

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

### Rodando em app.localhost (subdomínio local) + PWA

Para simular o cenário de produção em subdomínio (ex.: `app.seudominio.com`) localmente, rode o app em `http://app.localhost:3000`.

1) (Windows) Registre `app.localhost` no arquivo hosts (precisa Admin):
	 - `powershell -ExecutionPolicy Bypass -File .\scripts\setup-app-localhost.ps1`

2) Inicie o servidor já configurado para `app.localhost:3000`:
	 - `powershell -ExecutionPolicy Bypass -File .\scripts\start-app-localhost.ps1`

3) Acesse:
	 - `http://app.localhost:3000`

Observação (PWA/Service Worker): `localhost:3000` e `app.localhost:3000` são origens diferentes; se estiver alternando entre eles, pode precisar limpar cache/unregister do SW no DevTools (Application).

Observações de ambiente:
- Se quiser forçar a leitura de tipos do DB (e não cair em fallback estático), defina `EXAM_TYPES_DISABLE_FALLBACK=true` no ambiente do backend.

## Endpoints principais e filtros por exam_type

Base (dev): `http://app.localhost:3000`

Observação: as rotas também existem em `/api/v1/*` (preferencial). O prefixo `/api/*` permanece por compatibilidade.

- `GET /api/exams/types`
	- Lista os tipos de exame disponíveis (DB quando possível).

- `POST /api/exams/select`
	- Seleciona perguntas e retorna `{ sessionId, total, exam, questions: [...] }`.
	- Cabeçalhos/Body relevantes:
		- Autenticação: cookie `sessionToken` (browser) ou `Authorization: Bearer <token>` (recomendado) / `X-Session-Token: <token>` (legado).
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

### Endpoint admin para geração de fixtures

Para testes rápidos e ajustes estatísticos existe o endpoint protegido `POST /api/admin/exams/fixture-attempt` que cria uma tentativa finalizada artificial ("fixture") sem percorrer questões manualmente.

Resumo:
- Auth: usuário com papel `admin` (JWT via cookie `sessionToken` ou header `Authorization`/`X-Session-Token`).
- Body mínimo: `{ userId, overallPct }` (opcionais: `totalQuestions`, `examTypeSlug`).
- Domínios (`peoplePct`, `processPct`, `businessPct`): ou envia todos ou nenhum. Se enviados, a média deve ficar dentro da tolerância (default 2) de `overallPct`.
- Query param opcional: `tolerance=<n>` para ajustar coerência.
- Resposta inclui contagem de questões por domínio e corretas distribuídas. Metadados detalhados (percentuais solicitados, gerados e diferenças) ficam em `exam_attempt.Meta`.
 - As respostas salvas simulam seleção real de opções: para cada questão correta, todas as opções corretas são marcadas; para questões incorretas, é marcada uma opção incorreta (fallback para uma única correta se não houver incorreta). Isso torna indicadores que dependem da comparação de opções (ex.: radar de domínios IND10) coerentes com os percentuais solicitados.
 - Meta inclui `fixtureVersion` (ex.: 1.1.0) e `answerStrategy` (ex.: `all-correct-options`) para rastrear evolução da simulação e permitir auditoria/fallback futuro.

Documentação completa em `docs/api-endpoints.md`.

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
		"iddominio_desempenho": 1,
		"codareaconhecimento": 2,
		"codgrupoprocesso": 3,
		"dica": "Opcional",
		"options": [
			{ "descricao": "A", "correta": true, "explicacao": "Por que A é correta (opcional)" },
			{ "descricao": "B" },
			{ "descricao": "C" },
			{ "descricao": "D" }
		],
		"explicacao": "(legado) explicação opcional; usada como fallback para a alternativa correta"
	}
]
```

2) JSON (objeto com defaults + questions)

```json
{
	"examTypeSlug": "pmp",
	"iddominio_desempenho": 1,
	"questions": [
		{ "descricao": "Questão 1", "tiposlug": "single", "options": [
			{ "descricao": "A", "correta": true },
			{ "descricao": "B" }
		]},
		{ "descricao": "Questão 2", "tiposlug": "multi", "options": [
			{ "descricao": "A", "correta": true, "explicacao": "(opcional) justificativa para A" },
			{ "descricao": "B", "correta": true },
			{ "descricao": "C" }
		], "explicacao": "(legado) fallback para a primeira correta se options[].explicacao vier vazio" }
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
- Explicações são gravadas em `explicacaoguia` por alternativa (uma linha por opção de resposta). Use `options[].explicacao`.
- O campo `explicacao` (legado) é aceito e usado como fallback para a alternativa correta quando `options[].explicacao` não vier.

## Páginas admin

- Formulário de questão: `frontend/pages/admin/questionForm.html`
- Importação em massa: `frontend/pages/admin/questionBulk.html`

- Data Explorer (admin): `frontend/pages/admin/dataExplorer.html`
	- Docs: `docs/admin-data-explorer.md`
- Flashcards (admin): `frontend/pages/admin/flashcards.html`
	- Docs: `docs/flashcards-admin.md`
- Dicas (admin): `frontend/pages/admin/dicas.html`
	- Docs: `docs/dicas.md`

- Parâmetro Usuários (admin): `frontend/pages/admin/userParams.html`
	- Docs: `docs/IMPLEMENTATION_ADMIN_USER_PARAMS_CHAT_SERVICE.md`
	- Aliases protegidos (recomendado usar estes links):
		- `/admin/questions/form`
		- `/admin/questions/bulk`

<!--
TODO (futuro): Trabalhos planejados para admin UI/entrega de HTML:
- Mover proteção server-side/do middleware para todos os assets admin (CSS/JS) ou servir assets combinados via rota protegida.
- Adicionar página administrativa central (/admin) com navegação, listagem de usuários e atribuição de papéis.
- Autenticação (feito): sessão por JWT + cookie httpOnly `sessionToken` e política de sessão única.
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
- [x] Trocar para auth baseada em JWT + cookie Secure em produção
- [ ] Cobertura de testes de integração para fluxos admin

## Postman

Coleção e instruções em: `postman/README.md`
- Inclui fluxo de registro/login/verificação, exemplos de seleção/execução de exames, submissão de respostas e requests admin (quando aplicável). O token retornado no login é um JWT e pode ser usado em `Authorization: Bearer`.

## Documentação adicional

- CSRF: docs/csrf-implementation.md
- Logging: docs/logging-guide.md
- Endpoints da API: docs/api-endpoints.md
- Implementação (chat-service + parâmetros free/premium + UI admin): docs/IMPLEMENTATION_ADMIN_USER_PARAMS_CHAT_SERVICE.md
- IA com contexto da Web (admin): docs/ai-web-context.md
- IA — Classificação de Questões (admin): docs/ai-question-classification.md
- Erros Conhecidos: docs/known-errors.md

### Dicas de desenvolvimento local
- Preferir servir o frontend pelo backend (mesma origem) ou ajustar `SIMULADOS_CONFIG.BACKEND_BASE` para apontar ao backend (ex.: `http://app.localhost:3000`).
- Garanta que `frontend/utils/csrf.js` carregue antes de `frontend/script_exam.js` nas páginas de exame.
- Se o POST `/api/exams/select` retornar 403, verifique que o cabeçalho `X-CSRF-Token` está presente e o cookie `csrfToken` está sendo enviado; consulte docs/known-errors.md.

## Itens pendentes / próximos passos

- Postman: manter requests atualizados para auth JWT (preferir `Authorization: Bearer <token>` e lembrar CSRF em métodos state-changing).
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

## Manutenção de ENUMs de Notificações

Para adicionar novos valores aos tipos ENUM usados por notificações (ex.: nova categoria), siga o guia detalhado em `docs/notifications-maintenance.md`. Resumo:
- Primeiro execute `ALTER TYPE ... ADD VALUE` no PostgreSQL.
- Depois atualize o model Sequelize adicionando o literal.
- Atualize o frontend (select de categoria) se aplicável.
- Evite recriar tipos ou depender de `sync({ alter: true })` em produção para ENUMs.

Casos especiais (renomear valor, migrar para TEXT + constraint, estratégia de rollback) também estão cobertos no documento.

## Melhorias de Interface Recentes (Nov 2025)

### Indicadores de Desempenho (Indicadores.html)

Implementado histórico de tentativas completo com paginação, filtros e exportação:
- **Tabela de Histórico**: Exibe todas as tentativas do usuário com detalhes (tipo de exame, quantidade de questões, score, status).
- **Paginação**: 15 tentativas por página com navegação intuitiva.
- **Filtro por Status**: Permite filtrar entre "Todos", "Completos" (finalizados) e "Incompletos".
- **Exportação CSV**: Botão para exportar histórico respeitando filtro ativo.
- **Persistência**: Último filtro selecionado salvo em localStorage.
- **Indicadores Visuais de Score**:
  - Scores ≥75% em verde, <75% em vermelho.
  - Ícones de aprovação por faixa: ✔ (75-80%), ★★★ (81-90%), ★★★★ (91-98%), ★★★★★ (99-100%).
- **Renomeação de Labels**: Status "Completo" → "Finalizado", Tipo "Completo" → "Simulado Completo".

Arquivos modificados:
- `frontend/pages/Indicadores.html`
- `backend/controllers/indicatorController.js` (endpoint `/api/indicators/attempts-history-extended`)
- `backend/routes/indicators.js`

### Filtros de Personalização (examSetup.html)

Nova aba "Abordagem" para filtrar por categoria de questão:
- **UI**: Checklist multi-seleção (consistente com abas Domínios/Grupos/Áreas).
- **Backend**: Endpoint `/api/meta/abordagens` lista as abordagens (com alias legado em `/api/meta/categorias`).
- **Persistência**: Seleções salvas em `localStorage.examFilters.categorias`.
- **Integração Completa**:
  - Contagem dinâmica de questões disponíveis.
	- Filtro aplicado em `/api/exams/select` via `WHERE id_abordagem IN (...)`.
  - Bypass automático em exames completos (180 questões).
- **Correções**: Mapeamento correto de `abaAtual === 'abordagem'` para `selecionados.categorias` em `renderChecklist`.

Arquivos modificados:
- `frontend/pages/examSetup.html`
- `backend/controllers/examController.js` (suporte a filtro `categorias`)
- `frontend/pages/exam.html`, `examFull.html` (bypass de categorias em exames completos)

Commits principais (branch `melhorias_adicionais-interface`):
- `69452af`: feat(exam-setup): adicionar aba Abordagem (categorias)
- `a65bc42`: refactor: substituir select por checklist multi-seleção
- `b2f24e1`: fix: corrigir seleção na aba Abordagem

### Próximos Passos Sugeridos
- Validar fluxo end-to-end: iniciar simulado com filtro de categoria selecionado.
- Considerar limitar Abordagem a seleção única se desejado (atualmente permite múltiplas).
- Expandir indicadores com gráfico de evolução temporal (histórico de scores).

## Componentes UI

- `sb-hbar` (barra horizontal): Web Component reutilizável para exibir barras simples ou múltiplas com dataset JSON.
	- Arquivo: `frontend/components/sb-hbar.js`
	- Importe em páginas onde for usar: `<script type="module" src="/components/sb-hbar.js"></script>`
	- Uso rápido (única barra): `<sb-hbar value="72" max="100" label="Aproveitamento" show-percent unit="%"></sb-hbar>`
	- Uso com dataset JSON: `<sb-hbar data='[{"label":"Domínio 1","value":45},{"label":"Domínio 2","value":80}]' show-percent></sb-hbar>`
	- Documentação completa: `docs/ui-components.md`

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

