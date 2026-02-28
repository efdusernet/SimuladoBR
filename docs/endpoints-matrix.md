# Matriz de Endpoints — SimuladosBR API

Este documento consolida **todos** os endpoints do backend em formato de referência rápida, incluindo método HTTP, autenticação, permissões (roles), parâmetros principais e tipo de resposta.

**Base paths:**
- Preferencial: `/api/v1` (rotas versionadas)
- Legado/compatibilidade: `/api` (mesmas rotas, porém **deprecated**)

**Legenda:**
- **Auth**: tipo de autenticação exigida
  - `JWT`: cookie httpOnly `sessionToken` (browser) **ou** header `Authorization: Bearer <token>`
  - `X-Session-Token (JWT)`: header legado aceito como alternativa ao `Authorization` (conteúdo é **JWT**, não e-mail/id)
  - `Admin`: requer papel admin (via JWT validado por middleware `requireAdmin`)
  - `None`: endpoint público
- **Params**: principais parâmetros (query, body, path)
- **Response**: formato de retorno simplificado

---

## Autenticação (`/api/auth`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| POST | `/api/auth/login` | None | Body: `{ Email, SenhaHash }` | `{ Id, NomeUsuario, Nome, Email, EmailConfirmado, BloqueioAtivado, token?, tokenType? }` | Login com email e senha (SHA256 client-side → bcrypt server). Emite JWT e define cookie httpOnly `sessionToken`. `token` pode ser omitido quando `HARDEN_AUTH_RESPONSES=true` (ou `AUTH_RETURN_TOKEN_IN_BODY=false`). |
| POST | `/api/auth/verify` | None | Body/Query: `{ token }` | `{ message, userId }` | Verifica token de email (6 chars). Marca email como confirmado. |
| GET | `/api/auth/me` | JWT | — | `{ Id, NomeUsuario, Nome, Email, EmailConfirmado, BloqueioAtivado }` | Retorna dados do usuário autenticado (cookie `sessionToken` ou `Authorization`). |

---

## Usuários (`/api/users`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| POST | `/api/users` | None | Body: `{ Nome, Email, NomeUsuario?, SenhaHash?, ... }` | `{ Id, NomeUsuario, Email, EmailConfirmado, BloqueioAtivado, DataCadastro, DataAlteracao }` | Cria novo usuário. Envia token de verificação por email. |
| GET | `/api/users` | None (dev only) | Query: `limit`, `offset` | `[{ Id, NomeUsuario, Email, ... }]` | Lista usuários (bloqueado em produção). |
| GET | `/api/users/me` | JWT | — | `{ Id, NomeUsuario, Email, EmailConfirmado, BloqueioAtivado, DataCadastro, DataAlteracao, DataExame?, TipoUsuario }` | Dados do usuário autenticado + `DataExame` (se preenchido) + flag `TipoUsuario` (admin/user). |
| GET | `/api/users/me/premium-remaining` | JWT | — | `{ isPremium, lifetime, PremiumExpiresAt, remainingDays, serverNow }` | Dias restantes de premium; `PremiumExpiresAt=null` + `BloqueioAtivado=false` => vitalício (`remainingDays=null`). |
| PUT | `/api/users/me/exam-date` | JWT + CSRF | Body: `{ data_exame: "dd/mm/yyyy" }` | `{ success, DataExame }` | Define/atualiza data prevista do exame real (campo `usuario.data_exame`). Valida formato e **bloqueia datas no passado**. |
| GET | `/api/users/me/stats/daily` | JWT | Query: `days` (1-180, default 30) | `{ days, data: [{ date, started, finished, abandoned, timeout, lowProgress, purged, avgScorePercent, abandonRate, completionRate, purgeRate }] }` | Série diária de estatísticas de tentativas. |
| GET | `/api/users/me/stats/summary` | JWT | Query: `days` (1-180, default 30) | `{ periodDays, started, finished, abandoned, timeout, lowProgress, purged, avgScorePercent, abandonRate, completionRate, purgeRate }` | Resumo agregado do período. |

---

## IA (`/api/ai`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/ai/insights` | JWT | Query: `days` (1-180, default 30) | `{ success, meta, kpis, timeseries, ai, indicators?, indicatorsSummary?, studyPlan? }` | Dashboard de insights para `frontend/pages/InsightsIA.html` (KPIs + série + recomendações). Inclui `ai.explainability` (rastreabilidade) e grava snapshot diário para pagantes (`BloqueioAtivado=false`). |
| GET | `/api/ai/insights/gemini-usage` | JWT | — | `{ success, provider, model, configured, premium, quota }` | Status/uso de quota para “Gemini · gemini-2.5-flash” (UI usa para bloquear `#btnCarregar`). |

### IA + Web Context (Admin)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/ai/web/search` | Admin | Query: `q` (obrigatório), `k` (1-10, default 5) | `{ success, provider, query, results[] }` | Busca na web via provedor configurado (Bing/SerpAPI). |
| POST | `/api/ai/web/fetch` | Admin | Body: `{ url }` | `{ success, page }` | Faz fetch seguro de URL (com allowlist/SSRF guard) e retorna texto extraído. |
| POST | `/api/ai/question-audit` | Admin | Body: `{ question, web? }` | `{ success, audit, sources, meta }` | Audita coerência/correção de questão usando contexto retornado pelos endpoints web e gera JSON via LLM (Gemini). |
| GET | `/api/ai/masterdata/question-classification` | Admin | — | `{ success, masterdata }` | Retorna dicionários dinâmicos (DB) para orientar a IA a sugerir apenas valores válidos. |
| POST | `/api/ai/question-classify` | Admin | Body: `{ question, current, dicaMaxChars? }` | `{ success, result, disagreements, validationIssues, meta }` | Classifica uma questão e sugere valores para campos (somente IDs do dicionário). Indica divergências com valores atuais. |

---

## Exames (`/api/exams`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/exams` | None | — | `[{ id, nome, numeroQuestoes, duracaoMinutos, ... }]` | Lista tipos de exame disponíveis. |
| GET | `/api/exams/types` | None | — | `[{ id, nome, numeroQuestoes, duracaoMinutos, ... }]` | Alias para UI de tipos de exame. |
| POST | `/api/exams/:id/start` | JWT | Path: `id` (exam type) | `{ sessionId, exam }` | Inicia sessão de exame (legacy, uso mínimo). |
| POST | `/api/exams/select` | JWT | Body: `{ count, examType?, dominios?, areas?, grupos?, categorias?, onlyCount? }` Header: `X-Exam-Mode?` (quiz/full) | `{ sessionId, total, attemptId, examMode, exam, questions[] }` (inclui `questions[].is_math?`) | Seleciona questões e cria tentativa. Retorna sessão + questões inline. |
| POST | `/api/exams/start-on-demand` | JWT | Body: `{ count, examType?, dominios?, areas?, grupos?, categorias? }` Header: `X-Exam-Mode?` | `{ sessionId, total, attemptId, examMode, exam }` | Cria sessão persistindo ordem (fetch questões depois). |
| GET | `/api/exams/:sessionId/question/:index` | JWT | Path: `sessionId`, `index` | `{ index, total, examType, question: { id, type, descricao, options, ... } }` | Busca questão por índice da sessão. |
| POST | `/api/exams/:sessionId/pause/start` | JWT | Path: `sessionId` Body: `{ index }` | `{ ok, pauseUntil }` | Inicia pausa no checkpoint. |
| POST | `/api/exams/:sessionId/pause/skip` | JWT | Path: `sessionId` Body: `{ index }` | `{ ok }` | Pula pausa do checkpoint. |
| GET | `/api/exams/:sessionId/pause/status` | JWT | Path: `sessionId` | `{ pauses, policy, examType }` | Status de pausas configuradas. |
| POST | `/api/exams/submit` | JWT | Body: `{ sessionId, answers: [{ questionId, optionId?, optionIds?, response?, isMath?, is_math? }], partial? }` | `{ sessionId, attemptId, examAttemptId, totalQuestions, totalCorrect, totalScorableQuestions?, scorePercent, details: [{ questionId, isCorrect, isPretest? }] }` | Submete respostas (parcial ou final). Calcula score excluindo pré-teste. |
| POST | `/api/exams/resume` | JWT | Body: `{ sessionId?, attemptId? }` | `{ ok, sessionId, attemptId, total, examType }` | Reconstrói sessão em memória após restart. |
| GET | `/api/exams/last` | JWT | — | `{ correct, total, scorePercent, approved, finishedAt, examTypeId, examMode }` | Último exame finalizado (para gauge Home). |
| GET | `/api/exams/history` | JWT | Query: `limit` (1-10, default 3) | `[{ correct, total, scorePercent, approved, startedAt, finishedAt, examTypeId, durationSeconds, examMode }]` | Histórico últimas N tentativas. |
| GET | `/api/exams/result/:attemptId` | JWT | Path: `attemptId` | `{ total, questions: [...], answers: { q_<id>: { optionId? , optionIds?, response? } } }` | Retorna dados de uma tentativa **finalizada** para páginas de review (inclui alternativas com `iscorreta` + explicação por alternativa quando disponível). |

---

## Admin — Exames (`/api/admin/exams`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/admin/exams/probe` | Admin | — | *(204 No Content)* | Probe leve para detectar permissão admin (útil para menu/admin UI). |
| POST | `/api/admin/exams/mark-abandoned` | Admin | Body: (vazio ou filtros opcionais) | `{ marked, details }` | Marca tentativas inativas como abandonadas. |
| POST | `/api/admin/exams/purge-abandoned` | Admin | Body: (vazio ou filtros opcionais) | `{ purged, details }` | Remove tentativas abandonadas antigas do banco. |
| POST | `/api/admin/exams/fixture-attempt` | Admin | Body: `{ userId, overallPct?, totalQuestions?, examTypeSlug?, peoplePct?, processPct?, businessPct? }` Query: `tolerance?` (default 2) | `{ attemptId, userId, totalQuestions, corretas, scorePercent, domainCounts, domainCorrects }` | Gera tentativa finalizada artificial (fixture) com distribuição por domínio. |
| DELETE | `/api/admin/exams/attempts/:attemptId` | Admin | Path: `attemptId` | `{ ok, attemptId, purgeTotal }` | Purge total: remove tentativa (attempt + questions + answers), limpa logs de purga da tentativa e recompõe/remover agregação diária (`exam_attempt_user_stats`) para não deixar rastros. |
| GET | `/api/admin/exams/content-versions` | Admin | Query: `examTypeId` | `{ examTypeId, currentVersionId, versions: [...] }` | Lista versões de conteúdo ECO conhecidas e o default atual do tipo de exame.
| PUT | `/api/admin/exams/content-current` | Admin | Body: `{ examTypeId, examContentVersionId }` | `{ ok, examTypeId, currentVersionId, version }` | Define a versão default (current) do conteúdo ECO para um exam type.
| GET | `/api/admin/exams/user-content-version` | Admin | Query: `userId`, `examTypeId` | `{ userId, examTypeId, override? }` | Consulta override ativo por usuário (janela de vigência opcional).
| PUT | `/api/admin/exams/user-content-version` | Admin | Body: `{ userId, examTypeId, examContentVersionId, ... }` | `{ ok, userId, examTypeId, override, version }` | Define/atualiza override de conteúdo ECO por usuário.
| DELETE | `/api/admin/exams/user-content-version` | Admin | Query: `userId`, `examTypeId` | `{ ok, userId, examTypeId }` | Desativa override ativo (fallback para versão default).

---

## Admin — Usuários (`/api/admin/users`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/admin/users` | Admin | Query: `limit`, `offset` | `[{ Id, Nome, NomeUsuario }]` | Lista usuários para seleção administrativa.
| GET | `/api/admin/users/search` | Admin | Query: `q` (obrigatório), `limit?` | `{ q, count, items: [{ Id, Nome, NomeUsuario, Email }] }` | Busca usuários por Nome/NomeUsuario/Email (e Id se numérico).
| GET | `/api/admin/users/:id` | Admin | Path: `id` | `{ Id, Nome, NomeUsuario, Email }` | Busca usuário único para UIs administrativas.
| GET | `/api/admin/users/:id/insights-snapshots` | Admin | Path: `id` Query: `days` (1-365, default 90), `includePayload` (0/1) | `{ userId, days, count, items }` | Lista snapshots diários gravados pelo `/api/ai/insights` (base para modelo temporal). |

---

## Dicas (`/api/dicas`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/dicas/today` | JWT | Query: `versionId?` (default 2), `anyVersion?` (`true` ignora versionId) | `{ item: { id, descricao, id_versao_pmbok, versao_code? } }` | Retorna uma dica aleatória (`public.dicas`). |

---

## Admin — Dicas (`/api/admin/dicas`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/admin/dicas` | Admin | Query: `versionId?`, `q?`, `limit?`, `offset?` | `{ items, meta }` | Lista dicas (filtro por versão e busca em `descricao`). |
| GET | `/api/admin/dicas/versions` | Admin | — | `{ items: [{ id, code }] }` | Lista versões em `exam_content_version`. |
| POST | `/api/admin/dicas` | Admin | Body: `{ descricao, id_versao_pmbok? }` | *(201)* item | Cria dica. |
| PUT | `/api/admin/dicas/:id` | Admin | Body: `{ descricao, id_versao_pmbok? }` | item | Atualiza dica. |
| DELETE | `/api/admin/dicas/:id` | Admin | Path: `id` | `{ ok, id }` | Remove dica. |

---

## Admin — Data Explorer (`/api/admin/data-explorer`)

**Nota:** builder seguro (sem SQL livre). Bloqueia tabelas sensíveis por denylist.

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/admin/data-explorer/tables` | Admin | — | `{ tables: string[] }` | Lista tabelas `public` permitidas. |
| GET | `/api/admin/data-explorer/tables/:table/columns` | Admin | Path: `table` | `{ table, columns: [{ name, type }] }` | Lista colunas e tipos da tabela. |
| POST | `/api/admin/data-explorer/preview` | Admin | Body: builder JSON | `{ sqlPreview, sqlPreviewExpanded, bind, meta }` | Gera preview do SELECT (não executa). |
| POST | `/api/admin/data-explorer/query` | Admin | Body: builder JSON | `{ rows, hasMore, sqlPreview, sqlPreviewExpanded, bind, meta }` | Executa SELECT e retorna linhas. |

---

## Admin — Flashcards (`/api/admin/flashcards`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/admin/flashcards` | Admin | Query: `versionId?`, `q?`, `limit?`, `offset?` | `{ items, meta }` | Lista flashcards (filtro por versão + busca em `pergunta`/`resposta`). |
| GET | `/api/admin/flashcards/versions` | Admin | — | `{ items: [{ id, code }] }` | Lista versões em `exam_content_version`. |
| POST | `/api/admin/flashcards` | Admin | Body: `{ pergunta, resposta, id_versao_pmbok?, idprincipio?, iddominio_desempenho?, basics?, active? }` | *(201)* item | Cria flashcard. |
| PUT | `/api/admin/flashcards/:id` | Admin | Body: `{ pergunta, resposta, id_versao_pmbok?, idprincipio?, iddominio_desempenho?, basics?, active? }` | item | Atualiza flashcard. |
| DELETE | `/api/admin/flashcards/:id` | Admin | Path: `id` | `{ ok, id }` | Remove flashcard. |

---

## Admin — Product Plans (`/api/admin/product-plans`)

Planos exibidos na home do site-produto e usados para marketing/CTA. Persistidos em arquivo JSON no backend.

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/admin/product-plans` | Admin | — | `{ ok, source, count, items }` | Lista planos (source: `file`/`defaults`). |
| POST | `/api/admin/product-plans/seed-defaults?force=1` | Admin | Query: `force?` | `{ ok, written, count, filePath }` | Escreve defaults no arquivo (use `force=1` para sobrescrever). |
| POST | `/api/admin/product-plans` | Admin | Body: `plan` | *(201)* `{ ok, item }` | Cria plano (valida/normaliza). |
| PUT | `/api/admin/product-plans/:id` | Admin | Path: `id` + Body: `plan` | `{ ok, item }` | Atualiza plano (id é imposto pela URL). |
| DELETE | `/api/admin/product-plans/:id` | Admin | Path: `id` | `{ ok, deleted }` | Remove plano por id. |

---

## Feedback (`/api/feedback`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/feedback/categories` | JWT | — | `[{ id, descricao }]` | Lista categorias para o modal “Reportar questão”. |
| POST | `/api/feedback` | JWT | Body: `{ texto, idcategoria, idquestao, userId? }` | `{ id, idcategoria, idquestao, reportadopor? }` | Cria feedback para uma questão (valida categoria e idquestao). |

---

## Chat-service (`/chat` e `chat.localhost`)

O chat-service pode rodar de 2 formas:
- **Proxy externo**: backend encaminha `/chat/*` para outro processo (ex.: `:4010`) via `CHAT_SERVICE_BASE_URL`.
- **Embedded**: backend roda chat-service no mesmo processo/porta `:3000` (sem `:4010`).

**Auth do admin do chat:** é do próprio chat-service (token admin), não é o `requireAdmin` do SimuladosBR.

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/chat/` | None | — | `{ ok, proxy, mountedAt }` | Health/probe do reverse-proxy do chat-service. |
| GET | `/chat/widget/chat-widget.js` | None | — | *(JS)* | Script do widget (público; precisa retornar JS). |
| GET | `/chat/v1/support-topics` | None | — | `[...]` | Lista tópicos para o widget (público). |
| POST | `/chat/v1/conversations` | None | Body | `{ ... }` | Cria conversa (fluxo visitante; público). |
| GET | `/chat/admin/` | Chat admin token | — | *(HTML)* | Painel admin do chat-service sob o mount `/chat`.
| WS | `/chat/v1/admin/ws` | Chat admin token | — | *(upgrade websocket)* | Realtime do painel admin sob o mount `/chat`.

---

## Questões (`/api/questions`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| POST | `/api/questions` | Admin | Body: `{ descricao, tiposlug?, multiplaescolha?, examTypeSlug?, examTypeId?, iddominio_desempenho?, codareaconhecimento?, codgrupoprocesso?, dica?, options?: [{ descricao, correta?, explicacao? }], explicacao?, imagem_url? }` | `{ questionId, message, optionsCreated }` | Cria questão unitária com alternativas (explicação por alternativa via `options[].explicacao`; `explicacao` é legado/fallback). |
| GET | `/api/questions` | Admin | Query: `limit`, `offset` | `[{ Id, Descricao, TipoSlug, ExamTypeId, ... }]` | Lista questões (admin). |
| GET | `/api/questions/:id` | Admin | Path: `id` | `{ Id, Descricao, TipoSlug, ExamTypeId, Options: [...], ... }` | Busca questão por ID (admin). |
| GET | `/api/questions/view/:id` | JWT | Path: `id` | `{ Id, Descricao, TipoSlug, Options: [...], ... }` | Busca questão por ID (usuário autenticado, sem admin). |
| PUT | `/api/questions/:id` | Admin | Path: `id` Body: `{ descricao?, tiposlug?, examTypeId?, options?: [{ descricao, correta?, explicacao? }], explicacao?, imagem_url?, ... }` | `{ message, questionId, optionsCreated?, optionsUpdated?, optionsDeleted? }` | Atualiza questão e alternativas (explicação por alternativa via `options[].explicacao`; `explicacao` é legado/fallback). |
| POST | `/api/questions/bulk` | Admin | Body (JSON): array ou `{ examTypeSlug?, questions: [...] }` ou Multipart: `file` (JSON/XML) | `{ inserted, skipped, errors: [...] }` | Carga em massa de questões (JSON/XML). |

---

## Meta (listas de filtros) (`/api/meta`)

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/meta/areas` | None | — | `[{ CodAreaConhecimento, Descricao }]` | Lista áreas de conhecimento. |
| GET | `/api/meta/grupos` | None | — | `[{ CodGrupoProcesso, Descricao }]` | Lista grupos de processos. |
| GET | `/api/meta/ddesempenho` | None | — | `[{ id, descricao }]` | Lista domínios de desempenho. |
| GET | `/api/meta/dominios-geral` | None | — | `[{ IdDominioGeral, Descricao }]` | Lista domínios gerais (Pessoas, Processos, Negócios). |
| GET | `/api/meta/principios` | None | — | `[{ IdPrincipio, Descricao }]` | Lista princípios. |
| GET | `/api/meta/abordagens` | None | — | `[{ id, descricao }]` | Lista abordagens de questão (alias legado: `/api/meta/categorias`). |
| GET | `/api/meta/niveis-dificuldade` | None | — | `[{ IdNivel, Descricao }]` | Lista níveis de dificuldade. |
| GET | `/api/meta/tasks` | None | — | `[{ IdTask, Descricao }]` | Lista tarefas. |
| GET | `/api/meta/config` | None | — | `{ ... }` | Configurações gerais da aplicação. |
| GET | `/api/meta/user-params` | None | — | `{ ok, params }` | Parâmetros “seguros” para o frontend fazer gating (limites e flags premium-only). |

---

## Indicadores (`/api/indicators`)

**Nota:** Endpoints de indicadores exigem autenticação JWT (cookie `sessionToken` ou `Authorization: Bearer <token>`). Alguns endpoints aceitam também o header legado `X-Session-Token`.

**Premium gating:** quando o usuário é gratuito (`BloqueioAtivado=true`) e a aba está marcada como premium-only em `/api/meta/user-params` (`premiumOnly.indicatorsTabs`), o backend retorna `403` com `code=PREMIUM_REQUIRED`.

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
| GET | `/api/indicators/details-prev` | JWT | Query: `exam_mode?`, `exam_type?`, `idUsuario?` | `{ userId, examMode, examTypeId, idExame, itens: [{ id, descricao, corretas, total, percentCorretas, ranking }] }` | Detalhes por **grupo de processos** da penúltima tentativa concluída (dense rank). |
| GET | `/api/indicators/dominiogeral-details-last2` | JWT | Query: `exam_mode?`, `exam_type?`, `idUsuario?` | `{ userId, examMode, examTypeId, last, previous }` | Detalhes por **domínio geral** (última e penúltima tentativa concluída). |
| GET | `/api/indicators/IND10` | JWT | Query: `examMode` (`last`/`best`), `idUsuario?` | `{ userId, examMode, examAttemptId, examDate, domains: [{ id, name, corretas, total, percentage }] }` | Performance por domínio geral (último ou melhor exame). Usado pelo radar. |
| GET | `/api/indicators/avg-time-per-question` | JWT | Query: `exam_mode?`, `idUsuario?` | `{ userId, examMode, avgSeconds, avgMinutes }` | Tempo médio por questão. |
| GET | `/api/indicators/attempts-history-extended` | JWT | Query: `limit?`, `offset?`, `status?` | `{ total, attempts: [{ id, examTypeId, startedAt, finishedAt, total, corretas, scorePercent, status, ... }] }` | Histórico detalhado de tentativas com paginação e filtros. |
| GET | `/api/indicators/IND12` | JWT (X-Session-Token ok) | Query: `exam_type?` | `{ dominios: [{ descricao, total, acertos, percent, ... }], ... }` | Média ponderada por domínio (agregado). Usado como base para a Probabilidade de Sucesso. |
| GET | `/api/indicators/probability` | JWT (X-Session-Token ok) | Query: `exam_type?` | `{ dominios: [{ descricao, total, acertos, percent, ... }], ... }` | Mesmo payload do `IND12`, mas endpoint dedicado para permitir gating independente da aba `dominios` (tab `prob`). |

---

## Admin — Parâmetros de Usuário (`/api/admin/user-params`)

Controla o arquivo `backend/data/userParams.json` (store JSON) que parametriza limites e flags premium-only.

| Método | Endpoint | Auth | Params | Response | Descrição |
|--------|----------|------|--------|----------|-----------|
| GET | `/api/admin/user-params` | Admin | — | `{ ok, source, params, error? }` | Lê parâmetros atuais (source: `file`/`default`/`fallback`). |
| PUT | `/api/admin/user-params` | Admin | Body: `{ ...params }` | `{ ok, params }` | Salva (overwrite) os parâmetros normalizados. |
| POST | `/api/admin/user-params/seed-defaults?force=0|1` | Admin | Query: `force` | `{ ok, written, filePath, params }` | Grava defaults no arquivo JSON (use `force=1` para sobrescrever). |

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
| GET | `/pages/admin/dataExplorer.html` | Admin | Admin Data Explorer (builder seguro + preview ao vivo). |
| GET | `/pages/admin/flashcards.html` | Admin | CRUD de flashcards (admin). |
| GET | `/pages/admin/dicas.html` | Admin | CRUD de dicas (admin). |
| GET | `/pages/admin/questionForm.html` | Admin | Formulário de cadastro unitário de questão. |
| GET | `/pages/admin/questionBulk.html` | Admin | Interface de importação em massa (JSON/XML). |
| GET | `/admin/questions/form` | Admin | Alias amigável para `questionForm.html`. |
| GET | `/admin/questions/bulk` | Admin | Alias amigável para `questionBulk.html`. |

---

## Observações Gerais

### Autenticação
- **JWT**: gerado no login (`/api/auth/login`), armazenado em cookie httpOnly `sessionToken` (browser) e pode ser enviado em `Authorization: Bearer <token>`.
- **`X-Session-Token` (legado)**: quando usado, o valor deve ser um **JWT**.
- **Sessão única**: o JWT contém um `sid` e o backend compara com `UserActiveSession.SessionId`; novo login revoga o anterior.
- **Admin**: validado por middleware `requireAdmin` usando JWT válido + política de admin do projeto.

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
- **JSON (objeto com defaults)**: `{ examTypeSlug, iddominio_desempenho, questions: [...] }`
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

**Última atualização:** 2026-01-18  
**Versão:** 1.2.0
