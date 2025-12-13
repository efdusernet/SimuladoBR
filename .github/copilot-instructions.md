# Instruções do Copilot para SimuladosBR

## Visão Geral
- Aplicativo full-stack para simulados com suporte a multi-exames, ferramentas admin com RBAC, persistência de sessão e logging estruturado.
- Backend: Node.js 18+, Express + Sequelize (PostgreSQL), Redis opcional; Frontend: HTML/JS estático com logger próprio; Postman para fluxos ponta a ponta.

## Arquitetura & Fluxo de Dados
- Tipos de Exame: Toda lógica é chaveada por `exam_type` (tabela `exam_type`; questões vinculam via `questao.exam_type_id`).
- Tentativas: `exam_attempt` (Meta JSON inclui `sessionId`, blueprint, estado de pausa), `exam_attempt_question`, `exam_attempt_answer`.
- Sessões: `Meta.sessionId` permite retomar via `/api/exams/resume` após reinício do servidor (reconstrói estado em memória).
- RBAC Admin: Endpoints protegidos usam `X-Session-Token` de usuário com papel `admin` (middleware `requireAdmin`). CLI concede papéis.
- Segurança: CSRF, rate limiting, request IDs e logging estruturado em `backend/middleware/`.

## Fluxos de Desenvolvimento
- Backend:
  - `cd backend && npm install`
  - Aplicar migrações: `npm run db:apply-sql` (executa `backend/sql/*.sql` em ordem numérica)
  - Iniciar servidor: `npm start` ou `npm run start:sync` (dev sync; defina `DB_SYNC=true` se necessário)
  - Variáveis: ver `backend/config/database.js`; opcional `EXAM_TYPES_DISABLE_FALLBACK=true` para forçar tipos do DB.
- Conceder papel admin:
  - `cd backend`
  - `npm run role:grant-admin -- --email "user@example.com"` (suporta id/e-mail/username)
- Fluxos Postman (`postman/`):
  - Importe coleção + ambiente; defina `BACKEND_BASE`, `sessionToken`, `examType` (ex.: `pmp`).
  - Use "Exams / Select" para sessões efêmeras; "Start On Demand" para persistir `exam_attempt`.
  - Código de verificação por e-mail: 6 alfanuméricos; habilite `SMTP_ALLOW_SELF_SIGNED=true` em dev apenas se houver interceptação TLS.

## Padrões de API
- Base: `http://localhost:3000`.
- Filtros: Com `count=180` (PMP completo), filtros de domínio/área/grupo são ignorados. Se o DB retornar `available=0` por `exam_type`, o fallback pode ignorar `exam_type` para cumprir a seleção.
- Endpoints-chave:
  - `GET /api/exams/types` — lista tipos de exame ativos.
  - `POST /api/exams/select` — retorna `{ sessionId, total, exam, questions }`; body usa `examType`, `count`, `dominios`, `areas`, `grupos`.
  - `POST /api/exams/start-on-demand` — persiste ordem e retorna `{ sessionId, attemptId }`.
  - `GET /api/exams/:sessionId/question/:index` — busca pergunta/opções.
  - `POST /api/exams/submit` — suporta parcial via `partial: true` e fallback no DB quando memória estiver ausente.
  - `POST /api/exams/resume` — reconstrói sessão a partir do DB.
- Endpoint de fixture admin: `POST /api/admin/exams/fixture-attempt` (requer `admin`); body `{ userId, overallPct, ... }` gera tentativa finalizada com scores coerentes por domínio.

## Convenções de Bulk Upload
- `POST /api/questions/bulk` (admin apenas): aceita
  - Array JSON de questões; ou JSON com defaults + `questions`.
  - XML via `multipart/form-data` arquivo `file`.
- Para `single`, o backend força no máximo uma correta; explicações vão para `explicacaoguia`.

## Logging & Frontend
- Use os loggers fornecidos; evite `console.*` em produção:
  - Backend: `backend/middleware/logging.js` (Winston) → logs JSON em `backend/logs/`.
  - Frontend: `frontend/utils/logger.js` (ver `docs/logging-frontend-guide.md`).
- Páginas admin e aliases:
  - `frontend/pages/admin/questionForm.html` → `/admin/questions/form`
  - `frontend/pages/admin/questionBulk.html` → `/admin/questions/bulk`

## Referências (ponto de partida)
- Config: `backend/config/database.js`, `backend/config/security.js`, `backend/config/validateEnv.js`.
- Controllers: `backend/controllers/*` (ex.: `examController.js`, `questionController.js`).
- Models & SQL: `backend/models/*`, `backend/sql/*`.
- Docs: `docs/api-endpoints.md`, `README.md`, `docs/logging-guide.md`, `postman/README.md`.

Se algo estiver pouco claro ou faltando, peça exemplos ou apontadores de arquivos.
