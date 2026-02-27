# CONTEXT — chat-service (SimuladosBR)

Data: 2026-01-02

Este arquivo existe para “reidratar” contexto em um novo chat/conversa.

## Objetivo

Criar um serviço **separado** de suporte via chat (API + widget embeddable) que pode ser usado por:

- usuários logados (opcionalmente autenticados via JWT)
- visitantes anônimos (ex.: tráfego vindo de parceiros)

Escopo de segurança: o chat **não** deve dar acesso a dados sensíveis do SimuladosBR; é um canal de suporte genérico.

## Handoff de integração

Para integrar no SimuladosBR (embed do widget, CORS, operação e próximos passos), veja:

- `docs/INTEGRACAO_SIMULADOSBR.md`

## Decisões principais

- Serviço isolado em `chat-service/` (Node.js/Express).
- Persistência em **Postgres** via `pg` (sem ORM), com migrações SQL simples.
- Autenticação JWT **opcional** (quando presente): `Authorization: Bearer <token>` validado com `jose` via chave pública.
- Widget embeddable (vanilla JS) servido pelo próprio serviço em `/widget/chat-widget.js`.
- CORS com allowlist (env `CORS_ORIGINS`) para o widget e (quando necessário) para o painel `/admin` rodando em outro domínio/porta.
- Rate limit aplicado globalmente (padrão 120 req/min por IP).

## Estrutura (arquivos relevantes)

- Servidor/app:
  - `src/index.js`
  - `src/app.js`
- Config/env:
  - `src/config/env.js`
  - `.env.example`
- DB e migrações:
  - `src/db/pool.js`
  - `src/db/migrate.js`
  - `sql/001_init.sql`
- Auth JWT:
  - `src/middleware/authOptional.js`
  - `src/services/jwt.js`
- Stores (DB access):
  - `src/store/visitorsStore.js`
  - `src/store/conversationsStore.js`
  - `src/store/messagesStore.js`
- Rotas:
  - `src/routes/health.js`
  - `src/routes/conversations.js`
  - `src/routes/admin.js`
- Widget:
  - `widget/chat-widget.js`

- Admin (auth e UI):
  - `src/middleware/adminAuth.js`
  - `src/services/adminTokens.js`
  - `src/store/adminUsersStore.js`
  - `admin/index.html`
  - `admin/panel.js`

- Scripts úteis:
  - `scripts/dbCheck.js`
  - `scripts/smokeAuth.js`
  - `scripts/purgeConversations.js`

## Variáveis de ambiente (essenciais)

- `PORT` (padrão 4010)
- `CORS_ORIGINS` (CSV: origins permitidos para chamadas browser ao serviço)
- `DATABASE_URL` (ex.: `postgres://user:pass@localhost:5432/chat_service`)
- `PGSSLMODE` (`disable` por padrão; `require`/`verify-full` em cloud)

### Admin (painel / endpoints /v1/admin/*)

- `ADMIN_TOKEN` (token “root” simples)
- `ADMIN_TOKENS` (opcional, multi-usuário): `Nome=token,Outro Nome=token2`
- `ADMIN_TOKEN_PEPPER` (opcional): usado no hash dos tokens do banco

Notas:
- Tokens do banco são armazenados como hash (não dá para “ver” depois). Para recuperar, use rotação/reset.
- Se você subir o server com `ADMIN_TOKEN` setado no ambiente (PowerShell `$env:ADMIN_TOKEN=...`), o `.env` pode não sobrescrever esse valor.

### JWT (opcional)

- `JWT_PUBLIC_KEY_PEM` (SPKI PEM)
- `JWT_ISSUER` (opcional)
- `JWT_AUDIENCE` (opcional)
- `JWT_ALGORITHMS` (CSV, padrão `RS256`)

## Endpoints

- `GET /health`
  - resposta: `{ ok: true, service: 'chat-service' }`

- `GET /widget/chat-widget.js`
  - entrega o JS do widget

- `GET /v1/support-topics`
  - lista assuntos (mensagens pré-definidas) ativos para o widget

### Assuntos (support_topics) e auto-resposta

- `sql/010_support_topics.sql` cria a tabela `support_topics`.
- `sql/011_support_topics_auto_reply.sql` adiciona `support_topics.auto_reply_text`.

Semântica:

- `message_text`: texto que o widget envia como mensagem do usuário ao clicar no assunto.
- `auto_reply_text` (opcional): texto exibido como mensagem local de **Suporte** no widget (não é salvo no backend).

## Painel de atendente (somente armazenamento)

Existe um painel simples servido pelo próprio serviço:

- `GET /admin/` (estático)

O painel consome endpoints administrativos (protegidos por token):

- env: `ADMIN_TOKEN`
- env (opcional): `ADMIN_TOKENS` no formato `Nome=token,Outro Nome=token2`
- env (opcional): `ADMIN_TOKEN_PEPPER` (misturado no hash dos tokens do banco; mudar invalida tokens existentes)
- env (opcional): `ADMIN_TOKEN_ENCRYPTION_KEY` (chave p/ criptografar tokens armazenados para auditoria)
- header: `Authorization: Bearer <ADMIN_TOKEN>`

Se `ADMIN_TOKENS` estiver configurado, o nome do atendente é inferido pelo token.
Se estiver usando apenas `ADMIN_TOKEN`, o painel pode enviar `X-Admin-Name` para definir o nome exibido.

Além disso, o serviço suporta **tokens por atendente gerenciados no banco** (tabela `admin_users`).
Nesse modo, você ainda precisa de pelo menos um token “root” via `ADMIN_TOKEN`/`ADMIN_TOKENS` para entrar no painel e criar atendentes.
O token do atendente é retornado apenas uma vez (na criação) e é armazenado como hash no banco.

### Roles (admin vs attendant vs root)

- `root`: tokens vindos de `ADMIN_TOKEN`/`ADMIN_TOKENS` (bootstrap)
- `admin`: usuário do banco (`admin_users.role='admin'`)
- `attendant`: usuário do banco (`admin_users.role='attendant'`)

Regras de permissão:
- `root/admin` podem gerenciar atendentes (criar, listar, desativar, resetar token, excluir)
- `attendant` só atende conversas (ler tudo, responder apenas se atribuída a ele)

### Assumir conversas (exclusividade)

O modelo do painel é **1 atendente por conversa**:
- todos podem **ler** as mensagens
- só o atendente **atribuído** pode **responder** (root tem exceção e pode responder)

Fluxo:
- Atendente pode clicar em **Assumir** (claim)
- Ou o sistema faz **auto-claim** no primeiro envio de resposta do atendente
- Existe também **Liberar** (release)

Transferência (admin):
- Se a conversa já estiver atribuída, `admin` pode forçar a transferência via `POST /v1/admin/conversations/:conversationId/claim?force=1`.
- `attendant` não consegue.
- `root` não assume diretamente (não tem `admin_user_id`), mas pode liberar.

### Observação importante (painel em outro host)

Se você abrir o painel `/admin` em um domínio/porta diferente do servidor da API, configure no painel:
- campo **API Base** (ex.: `http://localhost:4010`)

E adicione a origem do painel em `CORS_ORIGINS`.

O painel também faz auto-atualização e marca conversas como **AGUARDANDO RESPOSTA** quando entra mensagem nova do usuário.

### Endpoints admin

- `GET /v1/admin/me`
  - response: `{ ok: true, id, name, isRoot, role }`

- `POST /v1/admin/invites`
  - root/admin apenas
  - body: `{ "invites": [{ "email": "nome@empresa.com", "role": "admin|attendant" }], "apiBase": "http://localhost:4010" }`
  - response: `{ ok: true, smtpEnabled, results: [{ ok, email, role, id, sent, emailError, tokenHint, token? }] }`
  - se SMTP estiver configurado e o email for enviado, o response **não** retorna o token (reduz risco de vazamento)
  - se SMTP não estiver configurado ou o envio falhar, o response retorna `token` como fallback

- `POST /v1/admin/invites/resend`
  - root/admin apenas
  - body: `{ "email": "nome@empresa.com", "apiBase": "http://localhost:4010" }`
  - rotaciona o token (invalida o anterior), define expiração e tenta reenviar via SMTP
  - aplica a mesma política de retorno do token (só retorna `token` quando não dá para enviar)

- `GET /v1/admin/conversations`
  - query:
    - `status=open|all|*` (default: `open`)
    - `limit` (default: 50)
  - response: `{ ok: true, conversations: [...] }`
  - cada conversa inclui (além dos campos básicos):
    - `last_message_at`, `last_message_text`, `last_message_role`
    - `assigned_admin_user_id`, `assigned_at`, `assigned_admin_name`

- `GET /v1/admin/conversations/:conversationId/messages`
  - response: `{ ok: true, conversationId, conversation: {...}, messages: [...] }`

- `POST /v1/admin/conversations/:conversationId/messages`
  - body: `{ "text": "..." }`
  - cria mensagem com `role=agent`
  - regra: só responde se a conversa estiver livre (auto-claim) ou atribuída ao mesmo atendente (root pode responder)

- `POST /v1/admin/conversations/:conversationId/claim`
  - atribui a conversa ao atendente logado

- `POST /v1/admin/conversations/:conversationId/release`
  - libera a conversa (somente root ou o próprio atendente atribuído)

### Endpoints de atendentes (tokens no banco)

- `GET /v1/admin/attendants`
  - response: `{ ok: true, attendants: [...] }`

- `GET /v1/admin/attendants/tokens`
  - root/admin apenas
  - response: `{ ok: true, attendants: [{ id, name, role, active, createdAt, token, hasToken }] }`

- `POST /v1/admin/attendants`
  - body: `{ "email": "maria@empresa.com", "name": "Maria" }` (`name` opcional)
  - response: `{ ok: true, attendant, token }` (o `token` só aparece aqui)
  - erros comuns:
    - `400`: `email inválido`
    - `409`: `Email já cadastrado`

- `POST /v1/admin/attendants/:id/deactivate`
  - desativa o token do atendente

- `POST /v1/admin/attendants/:id/reset-token`
  - root/admin apenas
  - gera novo token e retorna uma única vez

- `DELETE /v1/admin/attendants/:id`
  - remove o atendente

### Endpoints para criar admins no banco

- `POST /v1/admin/admins`
  - root/admin apenas
  - body: `{ "email": "admin@empresa.com", "name": "..." }` (`name` opcional)
  - response: `{ ok: true, admin, token }` (token aparece uma única vez)
  - erros comuns:
    - `400`: `email inválido`
    - `409`: `Email já cadastrado`

## Migrações

- `sql/002_add_sender_name.sql` adiciona `messages.sender_name` para exibir o nome do atendente no widget.
- `sql/003_admin_users.sql` cria `admin_users` para tokens por atendente no banco.

- `sql/004_conversation_assignment.sql` adiciona atribuição de conversa:
  - `conversations.assigned_admin_user_id`, `conversations.assigned_at`

- `sql/005_admin_user_roles.sql` adiciona roles em `admin_users`:
  - `admin_users.role IN ('admin','attendant')`

- `sql/006_admin_user_token_storage.sql` adiciona armazenamento de token criptografado:
  - `admin_users.token_encrypted`

- `sql/007_admin_user_email.sql` adiciona email para convites:
  - `admin_users.email` (único quando presente)

- `sql/008_conversation_customer_name.sql` adiciona nome do cliente por conversa:
  - `conversations.customer_name`

- `sql/009_admin_user_token_expires.sql` adiciona expiração para tokens de convite:
  - `admin_users.token_expires_at`

- `sql/010_support_topics.sql` adiciona a tabela de assuntos (opções rápidas do widget):
  - `support_topics(id, title, message_text, active, sort_order, created_at, updated_at)`
  - index para ordenação/consulta em tópicos ativos

### Convites: expiração do token

Tokens emitidos por convite expiram em **7 dias**. No primeiro login bem-sucedido (antes de expirar), o servidor limpa `token_expires_at` e o token passa a funcionar normalmente.

### SMTP (para convites)

O serviço usa as variáveis do `.env` para enviar email:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- opcional: `SMTP_ALLOW_SELF_SIGNED=true`

- `POST /v1/conversations`
  - cria conversa
  - headers:
    - `X-Chat-Visitor-Id` (opcional)
    - `Authorization: Bearer ...` (opcional)
  - body:
    - `{ "visitorId": "..." }` (opcional)
  - response:
    - `{ ok: true, conversationId, visitorId }`

- `POST /v1/conversations/:conversationId/messages`
  - envia mensagem
  - headers:
    - `X-Chat-Visitor-Id` (obrigatório)
    - `Authorization: Bearer ...` (opcional)
  - body:
    - `{ "role": "user", "text": "..." }`
  - regra de acesso:
    - permitido se `visitorId` corresponder à conversa, ou se `sub` do JWT corresponder ao `user_id` da conversa

- `GET /v1/conversations/:conversationId/messages`
  - lista mensagens
  - headers:
    - `X-Chat-Visitor-Id` (obrigatório)
    - `Authorization: Bearer ...` (opcional)
  - response:
    - `{ ok: true, conversationId, messages: [...] }`

## Como rodar local

1) Copie `.env.example` para `.env` e configure `DATABASE_URL`.
2) Instale deps:

- `npm install`

3) Rode migrações:

- `npm run migrate`

4) Suba:

- `npm run dev`

## Scripts úteis

- Verificar banco e tabelas: `npm run db:check`
- Smoke test de auth/fluxo básico: `npm run smoke:auth`

## Limpar dados via SQL (DEV)

Há dois scripts SQL (destrutivos) em `sql/`:

- `sql/Limpar Dados de Conversas.sql`: limpa somente dados de conversas/histórico (e inclui um bloco opcional para corrigir tópicos legados).
- `sql/Reset Completo DEV.sql`: limpa conversas/histórico + `admin_users` + `support_topics`.

Nota (widget): o widget guarda `visitorId` e `conversationId` no `localStorage`. Após truncar as tabelas, pode ser necessário limpar o `localStorage` do navegador (ou abrir em aba anônima).

### Apagar conversas (manutenção)

Script: `scripts/purgeConversations.js`

Comandos:
- Dry-run: `npm run db:purge-conversations -- --dry-run`
- Apagar tudo (com confirmação): `npm run db:purge-conversations`
- Apagar tudo sem prompt: `npm run db:purge-conversations -- --yes`
- Filtrar por status: `npm run db:purge-conversations -- --status open --yes`
- Filtrar por origin: `npm run db:purge-conversations -- --origin widget --yes`

Observações:
- O script apaga linhas de `conversations` e as `messages` são apagadas via `ON DELETE CASCADE`.
- `visitors` não é apagado (por segurança).

## Como embutir o widget

Exemplo:

```html
<script
  src="http://localhost:4010/widget/chat-widget.js"
  data-chat-api="http://localhost:4010"
  data-chat-title="Suporte"
></script>
```

O widget salva `visitorId` e `conversationId` no `localStorage` e chama os endpoints do serviço.

Quando aberto, o widget faz polling (a cada ~5s) para atualizar mensagens.

## Observação (LLM provider layer)

Existe um `src/services/llmClient.js` como camada fina para chamadas ao Gemini (via `GEMINI_*`), mas o chat inicial não depende de LLM para funcionar.
