# chat-service

Serviço de chat de suporte (API + widget embeddable) com persistência em Postgres e um painel simples de atendente.

## Integração com SimuladosBR

Guia de handoff (para IA/engenharia): `docs/INTEGRACAO_SIMULADOSBR.md`.

## Deploy

- VPS (genérico): `docs/DEPLOY_VPS.md`
- Ubuntu (Nginx + systemd): `docs/DEPLOY_UBUNTU.md`
- Render (Web Service + Postgres): `docs/DEPLOY_RENDER.md`

## Stack

- Node.js + Express
- Postgres (`pg`)
- Migrações SQL em `sql/`
- Widget vanilla JS servido em `/widget/chat-widget.js`
- Painel atendente em `/admin/` consumindo `/v1/admin/*`

## Rodar local

Guia passo a passo: `docs/INSTALACAO.md`.

1) Crie `.env` a partir de `.env.example` e configure `DATABASE_URL`.

2) Instale dependências:

- `npm install`

3) Aplique migrações:

- `npm run migrate`

4) Suba o servidor:

- `npm run dev`

Por padrão ele roda em `http://localhost:4010`.

## Scripts úteis

- `npm run dev` / `npm run start`
- `npm run migrate`
- `npm run db:check` (inspeciona o banco configurado em `DATABASE_URL`)
- `npm run smoke:auth` (smoke test do fluxo básico)
- `npm run db:purge-conversations` (apaga conversas — ver seção abaixo)

## Widget (embed)

Inclua no seu site:

```html
<script
	src="http://localhost:4010/widget/chat-widget.js"
	data-chat-api="http://localhost:4010"
	data-chat-title="Suporte"
></script>
```

O widget salva `visitorId` e `conversationId` no `localStorage` e faz polling (a cada ~5s) quando está aberto.

### Assuntos (opções rápidas)

O widget pode exibir botões de “assuntos” (mensagens pré-definidas) **antes da primeira mensagem**.

- O widget busca em `GET /v1/support-topics`.
- Ao clicar em um assunto, o widget envia `message_text` como mensagem do usuário.
- Se o assunto tiver `auto_reply_text`, o widget também exibe essa frase como uma mensagem local de **Suporte** (não fica salva no backend).
- Depois que a conversa já tem mensagens, os assuntos não são exibidos.

### CORS

Se o widget estiver rodando em outro host/porta (ex.: `http://localhost:3010`), adicione essa origem em `CORS_ORIGINS`.

## Painel do atendente (admin)

- URL: `http://localhost:4010/admin/`
- Autenticação: `Authorization: Bearer <token>`

### Painel em outro domínio/porta

Se você hospedar o `/admin` em outro host/porta, configure no topo do painel:

- **API Base**: ex. `http://localhost:4010`

E inclua a origem do painel em `CORS_ORIGINS`.

### Token “root” (bootstrap)

Para acessar o painel e gerenciar atendentes, configure pelo menos um token bootstrap:

- `ADMIN_TOKEN` (um token)
- `ADMIN_TOKENS` (vários tokens com nome: `Nome=token,Outro=token2`)

Nota: se você subir o server com `$env:ADMIN_TOKEN=...` no PowerShell, o `.env` pode não sobrescrever esse valor. Prefira rodar via `.env` (ou limpe a variável do ambiente antes de subir).

### Tokens por atendente (no banco)

O painel permite criar tokens por atendente persistidos no Postgres (tabela `admin_users`).

- `POST /v1/admin/attendants` exige `email` (e `name` é opcional) e retorna `token` **uma única vez** (copie e entregue ao atendente)
- No banco, apenas o hash do token é armazenado (`token_hash`)

Erros comuns:

- `400`: `email inválido`
- `409`: `Email já cadastrado`

Opcionalmente defina `ADMIN_TOKEN_PEPPER` para reforçar o hash. Se mudar esse valor no futuro, tokens existentes deixam de funcionar.

#### Auditoria: armazenar token (criptografado)

Para permitir auditoria/recuperação, o serviço também guarda o token **criptografado** no Postgres (coluna `admin_users.token_encrypted`).

Config recomendada:

- `ADMIN_TOKEN_ENCRYPTION_KEY`: chave de 32 bytes (aceita **64 hex** ou **base64** de 32 bytes)

Sem esta env, o serviço tenta derivar uma chave de `ADMIN_TOKEN_PEPPER + ADMIN_TOKEN` (funciona, mas não é o ideal para produção).

### Roles (root/admin/attendant)

- `root`: tokens do `ADMIN_TOKEN`/`ADMIN_TOKENS` (bootstrap)
- `admin`: usuário do banco (`admin_users.role='admin'`)
- `attendant`: usuário do banco (`admin_users.role='attendant'`)

`root/admin` podem gerenciar atendentes. `attendant` atende conversas.

### Assumir conversa (exclusividade)

Modelo: **todos leem**, mas **só o atendente atribuído responde**.

- Manual: botão **Assumir** (claim)
- Automático: ao responder pela primeira vez (auto-claim)
- **Liberar**: devolve a conversa para “livre”

#### Transferir (forçar) como admin

Se uma conversa já estiver atribuída a outro atendente:

- `attendant`: não consegue assumir
- `admin`: pode **forçar transferência** (no painel aparece uma confirmação)

Na API isso é: `POST /v1/admin/conversations/:conversationId/claim?force=1` (admin/root). Root continua sem “assumir diretamente” porque não tem `admin_user_id`.

## Endpoints

- `GET /health`
- `POST /v1/conversations`
- `POST /v1/conversations/:conversationId/messages`
- `GET /v1/conversations/:conversationId/messages`
- `GET /v1/support-topics`

Admin:

- `GET /v1/admin/me`
- `POST /v1/admin/invites` (root/admin)
- `POST /v1/admin/invites/resend` (root/admin)
- `GET /v1/admin/conversations`
- `GET /v1/admin/conversations/:conversationId/messages`
- `POST /v1/admin/conversations/:conversationId/messages`
- `POST /v1/admin/conversations/:conversationId/claim`
- `POST /v1/admin/conversations/:conversationId/release`
- `GET /v1/admin/attendants`
- `GET /v1/admin/attendants/tokens` (root/admin)
- `POST /v1/admin/attendants`
- `POST /v1/admin/attendants/:id/deactivate`
- `POST /v1/admin/attendants/:id/reset-token`
- `DELETE /v1/admin/attendants/:id`

Assuntos (admin/root):

- `GET /v1/admin/support-topics`
- `POST /v1/admin/support-topics`
- `PUT /v1/admin/support-topics/:id`
- `DELETE /v1/admin/support-topics/:id`

Admins no banco:

- `POST /v1/admin/admins` (root/admin) — exige `email` (e `name` é opcional)

## Apagar conversas (manutenção)

Script: `scripts/purgeConversations.js`.

- Dry-run: `npm run db:purge-conversations -- --dry-run`
- Apagar tudo (pede confirmação): `npm run db:purge-conversations`
- Apagar tudo sem prompt: `npm run db:purge-conversations -- --yes`
- Filtrar: `--status open` e/ou `--origin widget`

Observação: apaga `conversations` e as `messages` caem em cascata; `visitors` não é apagado.

## Limpar dados via SQL (DEV)

Há dois scripts SQL (destrutivos) em `sql/`:

- `sql/Limpar Dados de Conversas.sql`: limpa somente dados de conversas/histórico (e inclui um bloco opcional para corrigir tópicos legados).
- `sql/Reset Completo DEV.sql`: limpa conversas/histórico + `admin_users` + `support_topics`.

Execução (exemplos):

- `psql "$DATABASE_URL" -f "sql/Limpar Dados de Conversas.sql"`
- `psql "$DATABASE_URL" -f "sql/Reset Completo DEV.sql"`

Nota importante (widget): o widget guarda `visitorId` e `conversationId` no `localStorage`. Após truncar as tabelas, pode ser necessário limpar o `localStorage` do navegador (ou abrir em aba anônima) para evitar tentar carregar uma conversa que não existe mais.

## Segurança (notas rápidas)

- Este serviço é um canal de suporte genérico, sem acesso a dados sensíveis.
- Tokens de admin/atendente devem ser tratados como segredo (equivalente a senha).

## Convites por email (SMTP)

O endpoint `POST /v1/admin/invites` gera tokens e (se SMTP estiver configurado) envia emails para cada destinatário.

### Política de retorno do token (segurança)

Para reduzir risco de vazamento em logs/proxy/console:

- Se o email for enviado com sucesso (`sent=true`), o response **não** retorna o token.
- Se o SMTP não estiver configurado ou o envio falhar, o response retorna o `token` como fallback (para envio manual).
- O response inclui `tokenHint` (últimos 4 caracteres) para ajudar na conferência.

### Reenviar convite (rotaciona token)

Quando a pessoa não recebeu o email ou perdeu o token:

- `POST /v1/admin/invites/resend` (root/admin)
	- body: `{ "email": "nome@empresa.com", "apiBase": "http://localhost:4010" }`
	- gera um novo token (invalida o anterior), define expiração e tenta reenviar o email
	- aplica a mesma política de retorno do token

### Expiração do token de convite

Tokens emitidos por convite expiram em **7 dias** (até o primeiro login bem-sucedido). Após o primeiro uso, o servidor limpa a expiração e o token passa a funcionar normalmente.

Variáveis no `.env`:

- `SMTP_HOST`
- `SMTP_PORT` (ex.: 465 para SSL)
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`
- `SMTP_ALLOW_SELF_SIGNED=true` (opcional)