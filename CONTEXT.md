# SimuladosBR — CONTEXT (Visão rápida do projeto)

Este arquivo é o “ponto de entrada” para entender rapidamente o SimuladosBR: o que ele faz, como está organizado, como rodar localmente e onde ficam os detalhes.

## O que é

SimuladosBR é um app web (frontend estático + backend Node/Express + Postgres) para execução de simulados (quiz/full), persistência de tentativas, indicadores/insights e páginas de revisão (review) com suporte a tipos avançados de questão.

## Estrutura do repositório

- `backend/`: API (Express), modelos (Sequelize), SQLs de migração, middlewares (CSRF/auth), rotas e serviços.
- `frontend/`: HTML/JS/CSS estático (runner de exames, páginas admin, review, service worker).
- `docs/`: documentação técnica (endpoints, CSRF, logging, IA, deploy, etc.).
- `chat-service/`: serviço separado de chat, integrado ao backend via proxy em `/chat/*`.

## Funcionalidades (alto nível)

- Ver catálogo completo em `FEATURES.md`.

## Como rodar local (rápido)

1) Backend:
- `cd backend`
- `npm install`
- `npm start`

2) Frontend:
- Recomendado: servir o frontend pelo próprio backend (mesma origem) para evitar problemas de cookies/CSRF.

## Autenticação e sessão

- Login emite um **JWT** e define cookie httpOnly `sessionToken`.
- Alternativas aceitas (principalmente para Postman/clients):
  - `Authorization: Bearer <token>` (recomendado)
  - `X-Session-Token: <token>` (legado; o conteúdo é JWT)
- Política de **sessão única**: novo login revoga a sessão anterior (controle via `UserActiveSession`).

## CSRF

- Métodos state-changing em `/api/*` exigem `X-CSRF-Token` compatível com cookie `csrfToken`.
- Endpoint para obter token: `GET /api/csrf-token` (ou `GET /api/v1/csrf-token`).
- Detalhes: `docs/csrf-implementation.md`.

## API (versionamento)

- Preferencial: `/api/v1/*`
- Legado/compatibilidade: `/api/*`

Referências:
- Matriz (visão completa): `docs/endpoints-matrix.md`
- Detalhes e payloads: `docs/api-endpoints.md`

## Fluxos principais

### 1) Executar simulado
- Seleção/início: `/api/exams/select` (ou v1)
- Submissão: `/api/exams/submit`
- Retomada após restart: `/api/exams/resume`

### 2) Review (revisão de tentativa)
- Carregamento de dados de tentativa finalizada:
  - `GET /api/exams/result/:attemptId`
- Páginas:
  - `frontend/pages/examReviewFull.html`
  - `frontend/pages/examReviewQuiz.html`

### 3) Feedback de questão
- `GET /api/feedback/categories`
- `POST /api/feedback`

### 4) Admin (exames)
- Probe admin: `GET /api/admin/exams/probe`
- Apagar histórico: `DELETE /api/admin/exams/attempts/:attemptId`
- ECO/content versioning: ver `docs/endpoints-matrix.md`.

## Chat-service

- Backend monta reverse-proxy em `/chat/*`.
- WebSocket admin: `WS /chat/v1/admin/ws`.
- Documentos do chat-service:
  - `chat-service/README.md`
  - `chat-service/CONTEXT.md`
  - `chat-service/docs/INTEGRACAO_SIMULADOSBR.md`

## Documentos que “explicam o projeto” (ordem sugerida)

1) `README.md`
2) `FEATURES.md`
3) `docs/endpoints-matrix.md`
4) `docs/api-endpoints.md`
5) `NOTES.md`
6) `docs/known-errors.md`
7) `docs/content-protection.md`

## Convenções úteis

- Quando algo falha em POST/PUT/DELETE, verifique primeiro: JWT (cookie/Authorization) + CSRF (`X-CSRF-Token` + cookie `csrfToken`).
- Preferir rodar frontend e backend na mesma origem para evitar fricção com cookies.

---

Última atualização: 2026-01-17
