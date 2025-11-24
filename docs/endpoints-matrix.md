# Matriz de Endpoints — SimuladosBR API

Este documento consolida **todos** os endpoints do backend em formato de referência rápida, incluindo método HTTP, autenticação, permissões (roles), parâmetros principais e tipo de resposta.

**Legenda:**
- **Auth**: tipo de autenticação exigida
  - `X-Session-Token`: header com id/nome/email do usuário
  - `JWT`: header `Authorization: Bearer <token>`
  - `Admin`: requer papel admin (via `X-Session-Token` validado por middleware `requireAdmin`)
  - `None`: endpoint público
- **Params**: principais parâmetros (query, body, path)
- **Response**: formato de retorno simplificado

---

## Autenticação (`/api/auth`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| POST | `/api/auth/login` | None | Body: `{ Email, SenhaHash }` | `{ Id, NomeUsuario, Nome, Email, EmailConfirmado, BloqueioAtivado, token, tokenType }` | Login com email e senha (SHA256 client-side → bcrypt server). Retorna JWT. |
| POST | `/api/auth/verify` | None | Body/Query: `{ token }` | `{ message, userId }` | Verifica token de email (6 chars). Marca email como confirmado. |
| GET | `/api/auth/me` | X-Session-Token | Header: `X-Session-Token` | `{ Id, NomeUsuario, Nome, Email, EmailConfirmado, BloqueioAtivado }` | Retorna dados básicos do usuário autenticado. |

---

## Usuários (`/api/users`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| POST | `/api/users` | None | Body: `{ Nome, Email, NomeUsuario?, SenhaHash?, ... }` | `{ Id, NomeUsuario, Email, EmailConfirmado, BloqueioAtivado, DataCadastro, DataAlteracao }` | Cria novo usuário. Envia token de verificação por email. |
| GET | `/api/users` | None (dev only) | Query: `limit`, `offset` | `[{ Id, NomeUsuario, Email, ... }]` | Lista usuários (bloqueado em produção). |
| GET | `/api/users/me` | X-Session-Token | Header: `X-Session-Token` | `{ Id, NomeUsuario, Email, EmailConfirmado, BloqueioAtivado, DataCadastro, DataAlteracao, TipoUsuario }` | Dados do usuário autenticado + flag `TipoUsuario` (admin/user). |
| GET | `/api/users/me/stats/daily` | X-Session-Token | Query: `days` (1-180, default 30) | `{ days, data: [{ date, started, finished, abandoned, timeout, lowProgress, purged, avgScorePercent, abandonRate, completionRate, purgeRate }] }` | Série diária de estatísticas de tentativas. |
| GET | `/api/users/me/stats/summary` | X-Session-Token | Query: `days` (1-180, default 30) | `{ periodDays, started, finished, abandoned, timeout, lowProgress, purged, avgScorePercent, abandonRate, completionRate, purgeRate }` | Resumo agregado do período. |

---

## Exames (`/api/exams`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/exams` | None | — | `[{ id, nome, numeroQuestoes, duracaoMinutos, ... }]` | Lista tipos de exame disponíveis. |
| GET | `/api/exams/types` | None | — | `[{ id, nome, numeroQuestoes, duracaoMinutos, ... }]` | Alias para UI de tipos de exame. |
| POST | `/api/exams/:id/start` | X-Session-Token | Path: `id` (exam type) | `{ sessionId, exam }` | Inicia sessão de exame (legacy, uso mínimo). |
| POST | `/api/exams/select` | X-Session-Token | Body: `{ count, examType?, dominios?, areas?, grupos?, categorias?, onlyCount? }` Header: `X-Exam-Mode?` (quiz/full) | `{ sessionId, total, attemptId, examMode, exam, questions }` | Seleciona questões e cria tentativa. Retorna sessão + questões inline. |
| POST | `/api/exams/start-on-demand` | X-Session-Token | Body: `{ count, examType?, dominios?, areas?, grupos?, categorias? }` Header: `X-Exam-Mode?` | `{ sessionId, total, attemptId, examMode, exam }` | Cria sessão persistindo ordem (fetch questões depois). |
| GET | `/api/exams/:sessionId/question/:index` | X-Session-Token | Path: `sessionId`, `index` | `{ index, total, examType, question: { id, type, descricao, options, ... } }` | Busca questão por índice da sessão. |
| POST | `/api/exams/:sessionId/pause/start` | X-Session-Token | Path: `sessionId` Body: `{ index }` | `{ ok, pauseUntil }` | Inicia pausa no checkpoint. |
| POST | `/api/exams/:sessionId/pause/skip` | X-Session-Token | Path: `sessionId` Body: `{ index }` | `{ ok }` | Pula pausa do checkpoint. |
| GET | `/api/exams/:sessionId/pause/status` | X-Session-Token | Path: `sessionId` | `{ pauses, policy, examType }` | Status de pausas configuradas. |
| POST | `/api/exams/submit` | X-Session-Token | Body: `{ sessionId, answers: [{ questionId, optionId?, optionIds?, response? }], partial? }` | `{ sessionId, totalQuestions, totalCorrect, totalScorableQuestions?, scorePercent, details: [{ questionId, isCorrect, isPretest? }] }` | Submete respostas (parcial ou final). Calcula score excluindo pré-teste. |
| POST | `/api/exams/resume` | X-Session-Token | Body: `{ sessionId?, attemptId? }` | `{ ok, sessionId, attemptId, total, examType }` | Reconstrói sessão em memória após restart. |
| GET | `/api/exams/last` | X-Session-Token | — | `{ correct, total, scorePercent, approved, finishedAt, examTypeId, examMode }` | Último exame finalizado (para gauge Home). |
| GET | `/api/exams/history` | X-Session-Token | Query: `limit` (1-10, default 3) | `[{ correct, total, scorePercent, approved, startedAt, finishedAt, examTypeId, durationSeconds, examMode }]` | Histórico últimas N tentativas. |

---

## Admin — Exames (`/api/admin/exams`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| POST | `/api/admin/exams/mark-abandoned` | Admin | Body: (vazio ou filtros opcionais) | `{ marked, details }` | Marca tentativas inativas como abandonadas. |
| POST | `/api/admin/exams/purge-abandoned` | Admin | Body: (vazio ou filtros opcionais) | `{ purged, details }` | Remove tentativas abandonadas antigas do banco. |
| POST | `/api/admin/exams/fixture-attempt` | Admin | Body: `{ userId, overallPct?, totalQuestions?, examTypeSlug?, peoplePct?, processPct?, businessPct? }` Query: `tolerance?` (default 2) | `{ attemptId, userId, totalQuestions, corretas, scorePercent, domainCounts, domainCorrects }` | Gera tentativa finalizada artificial (fixture) com distribuição por domínio. |

---

## Questões (`/api/questions`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| POST | `/api/questions` | Admin | Body: `{ descricao, tiposlug?, multiplaescolha?, examTypeSlug?, examTypeId?, iddominio?, codareaconhecimento?, codgrupoprocesso?, dica?, options?: [{ descricao, correta? }], explicacao?, imagem_url? }` | `{ questionId, message, optionsCreated }` | Cria questão unitária com alternativas. |
| GET | `/api/questions` | Admin | Query: `limit`, `offset` | `[{ Id, Descricao, TipoSlug, ExamTypeId, ... }]` | Lista questões (admin). |
| GET | `/api/questions/:id` | Admin | Path: `id` | `{ Id, Descricao, TipoSlug, ExamTypeId, Options: [...], ... }` | Busca questão por ID (admin). |
| GET | `/api/questions/view/:id` | X-Session-Token | Path: `id` | `{ Id, Descricao, TipoSlug, Options: [...], ... }` | Busca questão por ID (usuário autenticado, sem admin). |
| PUT | `/api/questions/:id` | Admin | Path: `id` Body: `{ descricao?, tiposlug?, examTypeId?, options?, explicacao?, imagem_url?, ... }` | `{ message, questionId, optionsCreated?, optionsUpdated?, optionsDeleted? }` | Atualiza questão e alternativas. |
| POST | `/api/questions/bulk` | Admin | Body (JSON): array ou `{ examTypeSlug?, questions: [...] }` ou Multipart: `file` (JSON/XML) | `{ inserted, skipped, errors: [...] }` | Carga em massa de questões (JSON/XML). |

---

## Meta (listas de filtros) (`/api/meta`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/meta/areas` | None | — | `[{ CodAreaConhecimento, Descricao }]` | Lista áreas de conhecimento. |
| GET | `/api/meta/grupos` | None | — | `[{ CodGrupoProcesso, Descricao }]` | Lista grupos de processos. |
| GET | `/api/meta/dominios` | None | — | `[{ IdDominio, Descricao }]` | Lista domínios (área técnica). |
| GET | `/api/meta/dominios-geral` | None | — | `[{ IdDominioGeral, Descricao }]` | Lista domínios gerais (Pessoas, Processos, Negócios). |
| GET | `/api/meta/principios` | None | — | `[{ IdPrincipio, Descricao }]` | Lista princípios. |
| GET | `/api/meta/categorias` | None | — | `[{ CodigoCategoria, Descricao }]` | Lista categorias/abordagens de questão. |
| GET | `/api/meta/niveis-dificuldade` | None | — | `[{ IdNivel, Descricao }]` | Lista níveis de dificuldade. |
| GET | `/api/meta/tasks` | None | — | `[{ IdTask, Descricao }]` | Lista tarefas. |
| GET | `/api/meta/config` | None | — | `{ ... }` | Configurações gerais da aplicação. |

---

## Indicadores (`/api/indicators`)

**Nota:** Todos os endpoints de indicadores requerem autenticação JWT via header `Authorization: Bearer <token>` (exceto `/IND10` que aceita `X-Session-Token`).

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/indicators/overview` | JWT | — | `{ last15: { you, others }, last30: { you, others }, meta }` | Visão geral agregada (placeholder). |
| GET | `/api/indicators/overview-detailed` | JWT | — | `{ ... }` | Visão detalhada (evolução). |
| GET | `/api/indicators/exams-completed` | JWT | Query: `days?`, `exam_mode?`, `idUsuario?` | `{ days, examMode, userId, total }` | Total de exames finalizados no período. |
| GET | `/api/indicators/approval-rate` | JWT | Query: `days?`, `exam_mode?`, `idUsuario?` | `{ days, examMode, userId, total, approved, ratePercent }` | Taxa de aprovação (≥75%). |
| GET | `/api/indicators/failure-rate` | JWT | Query: `days?`, `exam_mode?`, `idUsuario?` | `{ days, examMode, userId, total, failed, ratePercent }` | Taxa de reprovação (<75%). |
| GET | `/api/indicators/questions-count` | JWT | Query: `exam_type?` | `{ examTypeId, total }` | Quantidade de questões disponíveis (por tipo). |
| GET | `/api/indicators/answered-count` | JWT | Query: `exam_type` (obrigatório), `idUsuario?` | `{ examTypeId, userId, total }` | Questões distintas respondidas pelo usuário. |
| GET | `/api/indicators/total-hours` | JWT | Query: `exam_type` (obrigatório), `idUsuario?` | `{ examTypeId, userId, segundos, horas }` | Horas gastas no simulador pelo usuário. |
| GET | `/api/indicators/process-group-stats` | JWT | Query: `exam_mode?`, `idUsuario?`, `idExame?` | `{ userId, examMode, idExame, grupos: [{ grupo, acertos, erros, total, percentAcertos, percentErros }] }` | Acertos/erros por grupo de processos (último exame). |
| GET | `/api/indicators/area-knowledge-stats` | JWT | Query: `exam_mode?`, `idUsuario?`, `idExame?` | `{ userId, examMode, idExame, areas: [{ area, acertos, erros, total, percentAcertos, percentErros }] }` | Acertos/erros por área de conhecimento (último exame). |
| GET | `/api/indicators/approach-stats` | JWT | Query: `exam_mode?`, `idUsuario?`, `idExame?` | `{ userId, examMode, idExame, abordagens: [{ abordagem, acertos, erros, total, percentAcertos, percentErros }] }` | Acertos/erros por abordagem/categoria (último exame). |
| GET | `/api/indicators/details-last` | JWT | Query: `exam_mode?`, `idUsuario?` | `{ userId, examMode, attempt: { ... }, questions: [...] }` | Detalhes completos do último exame. |
| GET | `/api/indicators/IND10` | X-Session-Token | Query: `examMode` (`last`/`best`), `idUsuario?` Header: `X-Session-Token` | `{ userId, examMode, examAttemptId, examDate, domains: [{ id, name, corretas, total, percentage }] }` | Performance por domínio geral (último ou melhor exame). Usado pelo radar. |
| GET | `/api/indicators/avg-time-per-question` | JWT | Query: `exam_mode?`, `idUsuario?` | `{ userId, examMode, avgSeconds, avgMinutes }` | Tempo médio por questão. |
| GET | `/api/indicators/attempts-history-extended` | JWT | Query: `limit?`, `offset?`, `status?` | `{ total, attempts: [{ id, examTypeId, startedAt, finishedAt, total, corretas, scorePercent, status, ... }] }` | Histórico detalhado de tentativas com paginação e filtros. |

---

## Integridade (`/api/integrity`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| POST | `/api/integrity/verify` | None | Body: `{ token }` (Play Integrity token) | `{ valid, details }` | Verifica integridade da app via Play Integrity API (Android). |

---

## Pagamentos (`/api/payments`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| — | — | — | — | — | *Arquivo vazio; endpoints a implementar.* |

---

## Debug (`/api/debug`)

**Nota:** Endpoints de debug devem ser desabilitados em produção.

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/debug/db-user` | None (dev only) | — | `{ env_DB_USER, sequelize_username, postgres_current_user }` | Retorna usuário atual do Postgres e configurações. |
| POST | `/api/debug/send-test-email` | None (dev only) | Body/Query: `{ to }` | `{ ok, mailer, token, verifyUrl }` | Envia email de teste com token de verificação. |

---

## Páginas Admin (Protegidas)

**Nota:** Páginas HTML sob `/pages/admin` requerem middleware `requireAdmin` antes de serem servidas.

| Método | Endpoint | Auth | Descrição |
|--------|----------|------|-----------|
| GET | `/pages/admin/questionForm.html` | Admin | Formulário de cadastro unitário de questão. |
| GET | `/pages/admin/questionBulk.html` | Admin | Interface de importação em massa (JSON/XML). |
| GET | `/admin/questions/form` | Admin | Alias amigável para `questionForm.html`. |
| GET | `/admin/questions/bulk` | Admin | Alias amigável para `questionBulk.html`. |

---

## Observações Gerais

### Autenticação
- **`X-Session-Token`**: aceita ID numérico, `NomeUsuario` ou `Email` do usuário. Resolvido no backend via lookup em `Usuario`.
- **JWT**: gerado no login (`/api/auth/login`), usado por endpoints de indicadores via header `Authorization: Bearer <token>`.
- **Admin**: validado por middleware `requireAdmin` que verifica email na lista `ADMIN_EMAILS` (.env) ou nome de usuário começando com `admin`.

### Códigos de Status HTTP
- **200**: sucesso
- **201**: criado (POST de usuário/questão)
- **400**: payload inválido ou parâmetros faltando
- **401**: não autenticado ou credenciais inválidas
- **403**: sem permissão (email não confirmado, não admin, bloqueado)
- **404**: recurso não encontrado
- **409**: conflito (ex: email duplicado)
- **423**: bloqueado temporariamente (lockout)
- **500**: erro interno

### Filtros por `exam_mode`
Endpoints de indicadores aceitam `exam_mode=quiz|full`. Quando ausente, aplica-se fallback para lógica de exame completo (`exam_mode='full'` OU `quantidade_questoes = FULL_EXAM_QUESTION_COUNT`).

### Paginação
Endpoints de listagem (ex: `/api/questions`, `/api/indicators/attempts-history-extended`) suportam `limit` e `offset` (query params).

### Validações
- Parâmetros numéricos (dias, limites) são validados com clamp (ex: `days` entre 1–180).
- Percentuais de domínio em fixtures validam coerência: média não pode diferir de `overallPct` além da tolerância configurada.
- Questões `single` admitem somente 1 alternativa correta (normalizado no backend).

### Formatos de Bulk Upload
- **JSON (array)**: `[{ descricao, tiposlug, examTypeSlug, options, ... }]`
- **JSON (objeto com defaults)**: `{ examTypeSlug, iddominio, questions: [...] }`
- **XML (multipart)**: campo `file` com estrutura `<questions examType="..."><question>...</question></questions>`

### Metadados de Fixture
A partir da versão 1.1.0, fixtures incluem em `ExamAttempt.Meta`:
- `fixtureVersion`: versão da spec (ex: `1.1.0`)
- `answerStrategy`: estratégia de resposta (ex: `all-correct-options`)

---

## Referências
- Documentação detalhada: `docs/api-endpoints.md`
- Estatísticas diárias: `docs/estatisticas-tentativas.md`
- UI Components: `docs/ui-components.md`
- RBAC (planejado): `docs/rbac-reintro-plan.md`
- Reset de dados: `backend/docs/reset-guide.md`

---

**Última atualização:** 2025-11-24  
**Versão:** 1.1.0
