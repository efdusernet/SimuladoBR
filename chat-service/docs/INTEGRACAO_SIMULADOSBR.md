# Integração — chat-service no SimuladosBR (handoff para IA)

Data: 2026-01-02

Este documento é um “handoff” para uma IA/engenheiro integrar e operar o **chat-service** dentro do app **SimuladosBR**.

> Importante: **não** copie valores de `.env` para docs/repos. Tokens, senhas e chaves devem ficar apenas em segredo/infra (env vars, secret manager, etc).

## 1) O que é este projeto

O **chat-service** é um serviço separado (Node.js/Express + Postgres) que oferece:

- API pública para o widget:
  - criar conversas
  - enviar/listar mensagens
  - encerrar conversas
  - listar “Assuntos” (support topics) para atalhos no widget
- Widget embeddable (vanilla JS) servido pelo próprio serviço em `GET /widget/chat-widget.js`
- Painel admin/atendente (HTML/JS estático) servido em `GET /admin/`
- API administrativa em `/v1/admin/*` com controle de atendentes, convites, atribuição de conversas, e CRUD de “Assuntos”.

Objetivo de segurança: o chat é um canal de suporte **genérico** e não deve expor dados sensíveis do SimuladosBR.

## 2) Rodar local (dev)

Pré-requisitos:

- Node.js
- Postgres

Passo a passo:

1. Criar `.env` a partir de `.env.example`.
2. Instalar deps: `npm install`
3. Rodar migrações: `npm run migrate`
4. Subir: `npm run dev`

Por padrão: `http://localhost:4010`.

## 3) Variáveis de ambiente (visão de integração)

Veja a lista completa em `src/config/env.js`.

Essenciais:

- `PORT`
- `DATABASE_URL`
- `CORS_ORIGINS` (CSV) — precisa incluir o(s) domínio(s) do SimuladosBR que vão embedar o widget.

Admin:

- `ADMIN_TOKEN` (bootstrap/root) **ou** `ADMIN_TOKENS` (bootstrap multi-usuário: `Nome=token,...`)
- Opcional recomendado: `ADMIN_TOKEN_PEPPER`
- Opcional recomendado: `ADMIN_TOKEN_ENCRYPTION_KEY` (32 bytes: 64 hex ou base64)

SMTP (opcional, para convites por email):

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- `SMTP_ALLOW_SELF_SIGNED=true` (opcional)

JWT (opcional, para integrar identidade do SimuladosBR):

- `JWT_PUBLIC_KEY_PEM`
- `JWT_ISSUER`, `JWT_AUDIENCE` (opcionais)
- `JWT_ALGORITHMS` (default `RS256`)

Observação: hoje o widget **não envia Authorization automaticamente**. A API pública aceita JWT quando fornecido, então existem 2 caminhos:

1) manter o widget anônimo (visitorId no localStorage) — integração mais simples
2) estender o widget para incluir `Authorization: Bearer <jwt>` nas chamadas (ver seção 7)

## 4) Integração do widget no SimuladosBR

### 4.1 Embed básico (recomendado para começar)

No HTML base do SimuladosBR (layout global), inclua:

```html
<script
  src="https://www.simuladorbr.com.br/chat/widget/chat-widget.js"
  data-chat-api="https://www.simuladorbr.com.br/chat"
  data-chat-title="Suporte"
></script>
```

- `data-chat-api` é o base URL do serviço (sem barra no final).
- O widget salva `visitorId` e `conversationId` no `localStorage` e usa polling quando aberto.

### 4.2 CORS (obrigatório)

O browser só vai conseguir chamar o chat-service se `CORS_ORIGINS` incluir a origem do SimuladosBR.

Exemplos de origins comuns:

- `https://www.simuladorbr.com.br`
- `http://app.localhost:3000` (dev)

Ajuste `CORS_ORIGINS` para o seu caso.

### 4.3 Onde colocar o script no SimuladosBR

- Apps SSR/SPA: carregar no layout base (para estar disponível em todas as páginas).
- Evitar múltiplas injeções (garanta que o script seja incluído apenas uma vez).

## 5) API pública (usada pelo widget)

Base: `/v1`.

- `POST /v1/conversations`
  - Cria conversa.
  - Pode receber `visitorId` via body ou header `X-Chat-Visitor-Id`.
  - Resposta: `{ ok: true, conversationId, visitorId }`

- `POST /v1/conversations/:conversationId/messages`
  - Header obrigatório: `X-Chat-Visitor-Id`
  - Body: `{ "role": "user", "text": "..." }`
  - Regras:
    - só permite se `visitorId` bater com a conversa
    - ou se existir JWT e `sub` bater com `conversation.user_id`
  - Se conversa estiver encerrada: `409`

- `GET /v1/conversations/:conversationId/messages`
  - Header obrigatório: `X-Chat-Visitor-Id`
  - Resposta: `{ ok: true, conversationId, messages: [...] }`
  - Se conversa estiver encerrada: `409`

- `POST /v1/conversations/:conversationId/close`
  - Header obrigatório: `X-Chat-Visitor-Id`
  - Encerra conversa.

- `GET /v1/support-topics`
  - Lista assuntos ativos para o widget.
  - Resposta: `{ ok: true, topics: [{ id, title, message_text, auto_reply_text, ... }] }`

## 6) Assuntos (support topics) e auto-resposta

Tabela: `support_topics`.

Conceito:

- `message_text`: texto enviado como **mensagem do usuário** quando o botão do assunto é clicado
- `auto_reply_text` (opcional): texto exibido como **mensagem local de Suporte** (role agent)

Observações importantes:

- `auto_reply_text` **não** é salvo no backend como message; é apenas um feedback imediato no widget.
- O widget mantém os assuntos visíveis mas desabilitados após uso (persistido por conversa no `localStorage`).
- Se `message_text` estiver igual a `auto_reply_text`, o widget evita enviar duplicado como mensagem do usuário.

Migração relacionada:

- `sql/011_support_topics_auto_reply.sql` adiciona a coluna `auto_reply_text`.

## 7) Integração opcional com identidade do SimuladosBR (JWT)

A API pública suporta `Authorization: Bearer <jwt>` (middleware `authOptional`).

Hoje o widget não injeta JWT por padrão. Para integrar identidade do usuário logado do SimuladosBR, a evolução típica é:

- adicionar um atributo no script, por exemplo `data-chat-jwt="..."` (ou `data-chat-jwt-provider="..."`)
- enviar o header `Authorization` nas chamadas `fetch` do widget

Critério no backend: o `sub` do JWT vira `req.auth.userId` e pode ser gravado em `visitors.user_id`/`conversations.user_id`. Depois disso, o usuário consegue acessar a conversa também pelo JWT (além de visitorId).

Pontos de atenção:

- Não colocar JWT de longa duração no HTML estático.
- Preferir token curto, ou estratégia de refresh no app host.

## 8) Painel admin/atendente

- UI: `GET /admin/`
- API: `/v1/admin/*`
- Auth: `Authorization: Bearer <token>`

Modelo operacional:

- `root` (bootstrap via env) ou `admin` (no banco) gerenciam atendentes e convites.
- Atendentes assumem conversas (claim) e só o atendente atribuído responde.
- Há WebSocket de atualização para o painel com fallback para polling.

Se o painel estiver hospedado em outro domínio/porta, configure:

- o “API Base” no topo do painel
- e inclua o origin do painel em `CORS_ORIGINS`

## 9) Deploy/infra (produção)

Checklist operacional mínima:

- Rodar `npm run migrate` a cada deploy.
- Configurar `DATABASE_URL` com SSL conforme seu provedor (`PGSSLMODE=require`/`verify-full` em cloud).
- Definir `CORS_ORIGINS` com os domínios reais do SimuladosBR e (se necessário) do painel.
- Definir tokens fortes para admin (bootstrap) e usar atendentes via banco.

Health check:

- `GET /health` retorna `{ ok: true, service: 'chat-service' }`.

## 10) Manutenção e reset (DEV)

Scripts SQL destrutivos:

- `sql/Limpar Dados de Conversas.sql` — limpa dados de conversas/histórico.
- `sql/Reset Completo DEV.sql` — limpa conversas/histórico + `admin_users` + `support_topics`.

Observação: o widget persiste `visitorId`/`conversationId` no `localStorage`. Após truncar tabelas, pode ser necessário limpar `localStorage` (ou usar aba anônima).

## 11) Arquivos “de referência” para a IA

- `CONTEXT.md` — visão geral do projeto
- `README.md` — como rodar e principais features
- `src/routes/conversations.js` — API pública
- `src/routes/admin.js` — API admin
- `widget/chat-widget.js` — comportamento do widget
- `admin/panel.js` — painel admin/atendente

## 12) Segurança (nota rápida)

Se valores reais de `.env` foram compartilhados fora do seu ambiente (chat, print, etc.), trate como vazamento e **rotacione**:

- `ADMIN_TOKEN` / tokens de atendentes
- credenciais do Postgres (`DATABASE_URL`/senha)
- `SMTP_PASS` (senha de app do provedor)
