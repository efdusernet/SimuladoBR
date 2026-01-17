# SimuladosBR — Features (Catálogo)

Este arquivo lista as principais funcionalidades implementadas no SimuladosBR em formato de referência rápida.

> Observação: detalhes de APIs e payloads em `docs/api-endpoints.md` e `docs/endpoints-matrix.md`.

## App (Core)

- Simulados em modos **Quiz** e **Full** (por tipo de exame).
- Seleção de questões por **exam type** e filtros (domínios/áreas/grupos quando aplicável).
- Persistência de tentativas no banco (`exam_attempt`, `exam_attempt_question`, `exam_attempt_answer`).
- Retomada de sessão (`/api/exams/resume`) para reconstruir estado após restart do servidor.

## Questões e Tipos

- Tipos básicos: **single** (rádio) e **multi** (checkbox).
- Tipo avançado: **match_columns** (interação de pareamento) com suporte no runner e no review.
- Explicação por alternativa (quando disponível no schema) via `explicacaoguia`.

## Review de Tentativas

- Páginas de review:
  - `frontend/pages/examReviewFull.html`
  - `frontend/pages/examReviewQuiz.html`
- Renderização correta de:
  - múltipla escolha (checkbox) e single choice (rádio)
  - `match_columns` em modo review
- Navegação por grid/modal (componente de grid review).
- Exibição de detalhes quando disponíveis: explicação, referência e metadados (domínio/task/categoria).
- Endpoint para carregar o resultado de tentativa finalizada:
  - `GET /api/exams/result/:attemptId`

## Feedback de Questões

- Modal de “Reportar questão” nas páginas de review.
- Endpoints:
  - `GET /api/feedback/categories`
  - `POST /api/feedback`

## Admin (Exames)

- Probe leve de permissão admin:
  - `GET /api/admin/exams/probe` (204 quando permitido)
- Remoção (hard delete) do histórico de uma tentativa:
  - `DELETE /api/admin/exams/attempts/:attemptId`
- Geração de tentativa artificial (fixture) para testes/estatísticas:
  - `POST /api/admin/exams/fixture-attempt`
- Versionamento de conteúdo ECO (default e override por usuário):
  - `GET /api/admin/exams/content-versions`
  - `PUT /api/admin/exams/content-current`
  - `GET/PUT/DELETE /api/admin/exams/user-content-version`

## Indicadores e Insights

- Indicadores/statísticas (conforme documentação em `docs/estatisticas-tentativas.md` e `docs/api-endpoints.md`).
- Insights IA agregados (sem enviar texto de questões ao modelo):
  - `GET /api/ai/insights`

## IA (Admin)

- Web context (busca e fetch seguro) e auditoria de questões (admin):
  - `GET /api/ai/web/search`
  - `POST /api/ai/web/fetch`
  - `POST /api/ai/question-audit`
- Classificação de questões assistida por IA, orientada por masterdata do DB:
  - `GET /api/ai/masterdata/question-classification`
  - `POST /api/ai/question-classify`

## Chat-service Integrado

- Reverse-proxy do chat-service montado em `/chat/*`.
- Proxy de WebSocket admin do chat-service:
  - `WS /chat/v1/admin/ws`

## Segurança / Plataforma

- Autenticação por **JWT** com política de **sessão única por usuário** (re-login revoga sessão anterior).
- Rotas versionadas em `/api/v1/*` (e `/api/*` como legado).
- Proteção **CSRF** (Double Submit Cookie) para métodos state-changing em `/api/*`.
- Logging padronizado via logger (backend e frontend).

## PWA

- Service Worker e arquivos PWA (ver `frontend/sw.js` e docs relacionados em `docs/pwa-*`).
