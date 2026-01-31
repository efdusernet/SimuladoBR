# Implementação: chat-service + Parâmetro Usuários (Admin) + regras Free vs Premium

Data: 2026-01-30

Este documento resume a implementação (backend + frontend) para:

- Integrar o **chat-service** ao SimuladosBR via `/chat/*`.
- Parametrizar regras **free vs premium** (limites e features) com **UI gating + enforcement no backend**.
- Criar a página Admin **Parâmetro Usuários** para controlar essas regras.
- Corrigir problemas de UX relacionados a modal/overlay e navegação/admin.

> Segurança: este documento **não** inclui valores de secrets (tokens/senhas). Use `.env` local para configurar.

---

## 1) Componentes e responsabilidades

### chat-service (projeto `chat-service/`)
Serviço separado (Node/Express + Postgres) com:

- Widget embeddable em `/widget/chat-widget.js`.
- API pública do widget em `/v1/*` (conversas, mensagens, support-topics).
- Painel atendente em `/admin/` usando `/v1/admin/*`.
- Autenticação do painel por `Authorization: Bearer <token>`.

Referência: [chat-service/README.md](../chat-service/README.md)

### SimuladosBR backend (projeto `backend/`)
- Centraliza autenticação do app (`sessionToken` cookie / `X-Session-Token` / JWT) e RBAC.
- Expõe endpoints "meta" para o frontend buscar configurações seguras e parâmetros de gating.
- Faz reverse-proxy/embedding do chat-service sob `/chat/*`.
- Enforce (server-side) regras de premium/free em endpoints sensíveis.

### SimuladosBR frontend (projeto `frontend/`)
- UI gating (mostrar/ocultar/bloquear) com base em `/api/meta/user-params`.
- Admin UI para editar parâmetros (com rotas admin protegidas por RBAC).

---

## 2) Integração do chat-service em `/chat/*`

Arquivo principal: [backend/routes/chatProxy.js](../backend/routes/chatProxy.js)

### Modo 1: proxy (chat-service separado)
- O backend encaminha chamadas `/chat/*` para o chat-service via `CHAT_SERVICE_BASE_URL`.
- Remove headers hop-by-hop e **não** repassa `X-Session-Token`/cookies do SimuladosBR para o upstream.

### Modo 2: embed (chat-service dentro do processo do backend)
- Ativado por `CHAT_SERVICE_EMBED=true`.
- O backend carrega `chat-service/src/app` e monta a app no mesmo processo.
- Carrega `chat-service/.env` (best-effort) para que o embed use as configurações corretas.

### Regras de acesso em `/chat/*`
`requireChatAccess()` aplica as regras:

- **Sempre público**:
  - `/chat/widget/*` (assets do widget)
  - `GET /chat/v1/support-topics`
  - `/chat/v1/conversations*` (fluxo visitor-based do widget)

- **Nunca bloquear o painel do chat-service com RBAC do SimuladosBR**:
  - `/chat/admin*` e `/chat/v1/admin*`

- Demais rotas `/chat/*`:
  - Default **premium-only**, controlado por `premiumOnly.chatProxyDefault`.
  - Se `premiumOnly.chatProxyDefault=false`:
    - Se `chat.allowFreeAuthenticatedAccess=true`, permite free autenticado via sessão.
    - Caso contrário, mantém premium-only.

---

## 3) Parâmetros Free vs Premium (fonte única)

### Persistência e defaults
Arquivo: [backend/services/userParamsStore.js](../backend/services/userParamsStore.js)

- Persistência em `backend/data/userParams.json` (write atômico).
- Defaults internos (fallback quando arquivo não existe).
- Normalização e limites de segurança (ex.: limites 1..500).

Campos principais (shape resumido):

- `fullExamQuestionCount` (ex.: 180)
- `freeExamQuestionLimit` (ex.: 25)
- `freeOnlySeedQuestions` (true/false)
- `premiumOnly.*`:
  - `onlyNewQuestions`
  - `insightsIA`
  - `indicatorsTabs[]`
  - `chatWidgetDesktop`
  - `chatProxyDefault`
  - `aiDailySnapshot`
- `chat.allowFreeAuthenticatedAccess`

### Cache
`getCachedParams()` usa cache in-process (padrão ~10s) para evitar IO constante.

---

## 4) Endpoints do backend

### Meta (público/seguro)
Arquivo: [backend/controllers/metaController.js](../backend/controllers/metaController.js)

- `GET /api/meta/config`
  - Retorna contagens (full/free) e flags de config relevantes.

- `GET /api/meta/user-params`
  - Retorna **apenas parâmetros seguros** para gating no frontend (`toPublicParams`).
  - Não expõe knobs internos (ex.: `chatProxyDefault`, `allowFreeAuthenticatedAccess`) se não forem necessários para UI.

### Admin (RBAC)
Arquivo: [backend/routes/admin_user_params.js](../backend/routes/admin_user_params.js)

- `GET /api/admin/user-params`
- `PUT /api/admin/user-params`
- `POST /api/admin/user-params/seed-defaults?force=0|1`

Todos protegidos por `requireAdmin`.

### RBAC / Admin
Arquivo: [backend/middleware/requireAdmin.js](../backend/middleware/requireAdmin.js)

- Resolve usuário via `sessionToken`/`X-Session-Token`/JWT.
- Exige membership no role `admin` via tabelas `user_role` + `role (slug='admin')`.
- Se as tabelas RBAC não existirem, o middleware **nega** (403 `ADMIN_REQUIRED`).

---

## 5) Mudanças no frontend

### Auth helpers
Arquivo: [frontend/utils/auth.js](../frontend/utils/auth.js)

- Centraliza construção de headers: `X-Session-Token` (preferindo `sessionToken` real) + `Authorization` (JWT).

### Sidebar: item “Parâmetro Usuários”
Arquivo: [frontend/components/sidebar.html](../frontend/components/sidebar.html)

- Item no Accordion Admin: `data-admin-action="user-params"`.
- Ação roteia para `/pages/admin/userParams.html`.

### Admin Modal do index: link “Parâmetro Usuários”
Arquivo: [frontend/index.html](../frontend/index.html)

- O menu lateral do **Admin Modal** agora inclui link para `/pages/admin/userParams.html`.

### Página Admin: Parâmetro Usuários
Arquivo: [frontend/pages/admin/userParams.html](../frontend/pages/admin/userParams.html)

- UI para editar e salvar `userParams.json` via `/api/admin/user-params`.
- **Correção importante**: páginas admin dedicadas não carregam `frontend/script.js`, então:
  - Implementado fallback local para `ensureAdmin()` (probe admin + `/api/users/me`).
  - Requests incluem headers de autenticação (`Auth.getAuthHeaders`) + cookies (`credentials: 'include'`).

### Gating no Exam Setup
Arquivo: [frontend/pages/examSetup.html](../frontend/pages/examSetup.html)

- Busca `/api/meta/config` e `/api/meta/user-params` para:
  - Ajustar `FULL_Q` e `FREE_LIMIT`.
  - Controlar “Somente questões inéditas” (`premiumOnly.onlyNewQuestions`).

### Gating do Chat Widget (desktop)
Arquivo: [frontend/utils/chatWidgetGate.js](../frontend/utils/chatWidgetGate.js)

- O widget só é injetado no layout desktop.
- Por padrão é premium-only, configurável por `premiumOnly.chatWidgetDesktop`.

---

## 6) Correções de UX: tela escura travada pós-login (overlay/inert)

Sintoma: após login e redirect para home, a tela ficava escura e bloqueava cliques (como backdrop de modal preso).

Causa provável: uso indevido de `inert` no `body` (pode tornar toda a UI não-interativa em alguns browsers).

Correção aplicada no [frontend/index.html](../frontend/index.html):

- Evitar `inert` no `body`; aplicar `inert` apenas ao container de conteúdo (ex.: `main.content`) quando o modal está aberto.
- Cleanup defensivo após retorno/login para remover estados residuais (`inert`/overlays/spinner) quando necessário.

---

## 7) Como operar (admin)

### 7.1 Abrir a UI
- `http://app.localhost:3000/pages/admin/userParams.html`

### 7.2 Salvar alterações
- Botão **Salvar** faz `PUT /api/admin/user-params`.
- Requer:
  - Sessão válida (cookie `sessionToken` e/ou `X-Session-Token`/JWT)
  - RBAC com role `admin`.

### 7.3 Gerar defaults
- Botão **Gerar arquivo com defaults** chama:
  - `POST /api/admin/user-params/seed-defaults?force=0|1`

---

## 8) Troubleshooting

### “Acesso restrito: somente admin” em `userParams.html`
Checklist:

1) Verifique se você realmente está autenticado (cookie/sessionToken e/ou localStorage).
2) Verifique se seu usuário tem role `admin` (tabelas RBAC).
3) No `index.html`, rode o **Health check** do Admin Modal (mostra status de `/api/users/me` e do probe admin).

### Link não aparece no Admin Modal
- O link está no menu do Admin Modal do `index.html`. Se não aparecer, suspeite de cache/PWA.
- Tente hard reload (`Ctrl+F5`) ou abrir `index.html?v=1`.

### Chat não abre / widget não aparece
- Se estiver no mobile/layout não-desktop: o widget é removido.
- Se `premiumOnly.chatWidgetDesktop=true`: só aparece para premium.
- Verifique também `CHAT_SERVICE_BASE_URL` (modo proxy) ou `CHAT_SERVICE_EMBED=true` (modo embed).

---

## 9) Variáveis de ambiente (sem valores)

### SimuladosBR backend
- `CHAT_SERVICE_BASE_URL` (modo proxy)
- `CHAT_SERVICE_EMBED` (modo embed)
- `FULL_EXAM_QUESTION_COUNT` (fallback)
- `FREE_EXAM_QUESTION_LIMIT` (fallback)

### chat-service
- `PORT`
- `DATABASE_URL`
- `CORS_ORIGINS`
- `ADMIN_TOKEN` / `ADMIN_TOKENS`
- (opcionais) `ADMIN_TOKEN_PEPPER`, `ADMIN_TOKEN_ENCRYPTION_KEY`

Nunca commitar tokens/senhas no repositório.
