# Deploy no Render (Web Service + Postgres)

Este guia descreve como subir o chat-service no Render.

## 1) Criar o Postgres no Render

- Crie um banco Postgres.
- Pegue a connection string (Render geralmente fornece algo equivalente a `DATABASE_URL`).

Importante:

- Em Postgres gerenciado, SSL costuma ser obrigatório.
- Ajuste `PGSSLMODE` conforme a recomendação do Render (comum: `require`).

## 2) Criar o Web Service

- Crie um Web Service apontando para o repositório do chat-service.
- Runtime: Node.

Configurações típicas:

- Build Command: `npm ci` (ou `npm install`)
- Start Command (recomendado):

```bash
npm run migrate && npm run start
```

Isso garante que migrações sejam aplicadas antes de iniciar o servidor.

## 3) Variáveis de ambiente

Defina no Render (não no repo):

Essenciais:

- `NODE_ENV=production`
- `DATABASE_URL=...` (do Postgres do Render)
- `PGSSLMODE=require` (ou conforme recomendado)
- `CORS_ORIGINS=https://www.simuladorbr.com.br`

Admin:

- `ADMIN_TOKEN=...` (token bootstrap)
- (opcional) `ADMIN_TOKEN_PEPPER=...`
- (opcional) `ADMIN_TOKEN_ENCRYPTION_KEY=...`

SMTP (se usar convites):

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`

## 4) Porta

O chat-service usa `PORT` via env.

- Se o Render injeta `PORT` automaticamente, não precisa setar.
- Se precisar setar manualmente, use `PORT=4010` (ou o valor exigido pelo Render).

## 5) Domínio e HTTPS

- Use o domínio do Render ou configure um domínio custom.
- HTTPS é fornecido pelo Render.

## 6) WebSocket do painel

O painel admin usa WebSocket em `/v1/admin/ws`.

No Render, WebSocket costuma funcionar no domínio do serviço sem configuração extra. Se houver proxy/edge na frente, garanta suporte a upgrade.

## 7) Validação

- `GET /health` responde ok
- `GET /widget/chat-widget.js` carrega
- `/admin/` abre
- widget embutido no SimuladosBR funciona (verifique `CORS_ORIGINS`)

## 8) Observações

- Se você mudar `ADMIN_TOKEN_PEPPER`, tokens de atendentes do banco deixam de funcionar.
- Trate tokens e senhas como segredo; rotacione em caso de vazamento.
