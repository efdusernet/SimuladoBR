# Instalação — chat-service (passo a passo)

Este documento descreve como instalar e rodar o `chat-service` localmente e o mínimo necessário para subir em produção.

> Segurança: não cole tokens/senhas em docs. Use variáveis de ambiente/secret manager.

## 1) Pré-requisitos

- Node.js (LTS recomendado)
- Postgres 13+ (local ou remoto)
- Git (opcional, se você vai clonar)

Verifique:

- `node -v`
- `psql --version`

## 2) Obter o código

- Clonar o repositório e entrar na pasta do projeto.

## 3) Configurar banco (Postgres)

Você precisa de:

- um banco (database) para o serviço
- um usuário com permissão no banco

Exemplo via `psql` (ajuste nomes conforme preferir):

```sql
CREATE DATABASE chat_service;
CREATE USER chat_user WITH PASSWORD 'SENHA_FORTE_AQUI';
GRANT ALL PRIVILEGES ON DATABASE chat_service TO chat_user;
```

Se você usa Postgres gerenciado (cloud), normalmente ele já te entrega um `DATABASE_URL` pronto.

## 4) Configurar `.env`

1. Copie `.env.example` para `.env`.
2. Preencha ao menos:

- `DATABASE_URL`
- `CORS_ORIGINS`
- `ADMIN_TOKEN` (token bootstrap do painel)

Exemplo de `DATABASE_URL`:

- `postgres://chat_user:SENHA@localhost:5432/chat_service`

`CORS_ORIGINS` precisa incluir o host que vai embedar o widget no browser. Em dev:

- `http://app.localhost:3000`

> Dica: o `.env` é ignorado pelo git (não versionar).

## 5) Instalar dependências

```bash
npm install
```

## 6) Rodar migrações (criar tabelas)

```bash
npm run migrate
```

Se falhar, verifique `DATABASE_URL` e se o Postgres está acessível.

## 7) Subir o servidor

Dev (recarrega com nodemon):

```bash
npm run dev
```

Produção/local simples:

```bash
npm run start
```

Por padrão: `http://localhost:4010`.

## 8) Testar rapidamente

- Health:
  - `GET /health`
- Widget JS:
  - `GET /widget/chat-widget.js`
- Assuntos:
  - `GET /v1/support-topics`

## 9) Instalar o widget no seu site/app

Inclua no HTML (ajuste URLs):

```html
<script
  src="http://localhost:4010/widget/chat-widget.js"
  data-chat-api="http://localhost:4010"
  data-chat-title="Suporte"
></script>
```

Se o seu site estiver em outro domínio/porta, adicione o origin dele em `CORS_ORIGINS`.

## 10) Painel admin/atendente

- URL: `http://localhost:4010/admin/`
- Token: use o valor de `ADMIN_TOKEN` (ou algum token de `ADMIN_TOKENS`)
- Header usado pela API: `Authorization: Bearer <token>`

Fluxo típico em dev:

1. Entrar no painel com token bootstrap (root)
2. Criar atendentes/admins no banco (tokens por usuário)
3. Usar o token do atendente para atender conversas

## 11) SMTP (opcional)

Para convites por email (`/v1/admin/invites`), configure:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`

Sem isso, os endpoints continuam funcionando, mas o envio de email pode cair no fallback (token retornado na resposta quando não dá para enviar).

## 12) Produção (mínimo necessário)

O projeto é deployável em qualquer servidor que rode Node.js e tenha acesso a um Postgres.

Você ainda precisa prover:

- processo supervisor (systemd/PM2/Docker) para manter o Node vivo
- HTTPS/TLS (normalmente via reverse proxy como Nginx/Traefik)
- suporte a WebSocket no proxy (para `/v1/admin/ws`)
- `PGSSLMODE` adequado se o Postgres for em cloud (`require`/`verify-full` conforme provedor)

## 13) Reset de dados (DEV)

Scripts SQL destrutivos:

- `sql/Limpar Dados de Conversas.sql`
- `sql/Reset Completo DEV.sql`

Após truncar tabelas, pode ser necessário limpar `localStorage` do navegador (o widget guarda `visitorId`/`conversationId`).
