# Melhorias diversas — segurança/UX (branch chore/melhorias-diversas)

Data: 2026-01-02

Este documento descreve as melhorias implementadas na branch `chore/melhorias-diversas` (sem commit), cobrindo:

- Convites por email: reduzir vazamento de token no response.
- Reenvio de convite: rotacionar token e reenviar.
- Expiração de token de convite (7 dias) e “aceite” no primeiro login.
- Painel: renomear cliente sem `prompt()`.
- Painel: indicador discreto de status do realtime (WS vs polling).

## Roadmap (executado)

1. Não retornar token no JSON quando o email foi enviado.
2. Adicionar endpoint de reenviar convite e invalidar token anterior.
3. Adicionar expiração do token de convite e enforcement no login.
4. Trocar renomear cliente (prompt) por editor inline.
5. Exibir status de conexão realtime no header.

## Backend — Convites

### `POST /v1/admin/invites` (mudança de segurança)

- Mantém o fluxo: gera token, faz upsert por email e tenta enviar via SMTP.
- Nova regra: o campo `token` **só** é retornado quando:
  - SMTP não está configurado (`smtpEnabled=false`), ou
  - o envio falhou (`sent=false`).
- Quando o email é enviado com sucesso (`smtpEnabled=true` e `sent=true`), o response não inclui o token.
- Para auditoria operacional, o response inclui `tokenHint` (últimos 4 caracteres).

Exemplo (SMTP OK e enviado):

```json
{
  "ok": true,
  "smtpEnabled": true,
  "results": [
    {
      "ok": true,
      "email": "maria@empresa.com",
      "role": "attendant",
      "id": "...",
      "sent": true,
      "messageId": "...",
      "emailError": null,
      "tokenHint": "a1b2"
    }
  ]
}
```

Exemplo (fallback — sem SMTP ou falha de envio):

```json
{
  "ok": true,
  "smtpEnabled": false,
  "results": [
    {
      "ok": true,
      "email": "maria@empresa.com",
      "role": "attendant",
      "id": "...",
      "sent": false,
      "messageId": null,
      "emailError": "SMTP_NOT_CONFIGURED",
      "tokenHint": "a1b2",
      "token": "<token>"
    }
  ]
}
```

### `POST /v1/admin/invites/resend` (novo)

Objetivo: quando a pessoa perdeu o token ou não recebeu email.

- Gera um **novo** token (rotaciona/invalida o anterior).
- Atualiza o usuário pelo `email`.
- Define nova expiração de convite (7 dias).
- Envia email via SMTP, se configurado.
- Mesma regra de segurança: só retorna `token` quando não consegue enviar.

Body:

```json
{ "email": "maria@empresa.com", "apiBase": "http://localhost:4010" }
```

Response:

```json
{ "ok": true, "smtpEnabled": true, "result": { "ok": true, "email": "...", "sent": true, "tokenHint": "..." } }
```

## Segurança — Expiração do token de convite

### Migração

- `sql/009_admin_user_token_expires.sql`
  - adiciona `admin_users.token_expires_at TIMESTAMPTZ NULL`.

### Regras

- Tokens emitidos por convite expiram em **7 dias**.
- Ao tentar autenticar com token expirado, a API responde `401` com mensagem de expiração.
- No **primeiro login bem-sucedido** (token ainda válido), o servidor limpa `token_expires_at` (o token passa a ser permanente).

## Painel admin (UI)

### Renomear cliente (sem prompt)

- O botão **Renomear** abre um editor inline no topo da conversa:
  - input de nome
  - botões **Salvar** e **Cancelar**
  - atalhos: Enter salva / Esc cancela

### Status do realtime

No header, aparece um status discreto:

- **Ao vivo**: WS autenticado, polling desligado.
- **Reconectando…**: WS caiu, tentando reconectar (polling continua como fallback).
- **Atualização periódica**: WS indisponível, usando polling.

## Arquivos alterados

- Backend:
  - `src/routes/admin.js`
  - `src/middleware/adminAuth.js`
  - `src/store/adminUsersStore.js`
  - `sql/009_admin_user_token_expires.sql`
- Painel:
  - `admin/index.html`
  - `admin/panel.js`

---

## Widget — Assuntos (support_topics)

Após sincronização com `main`, a branch também passa a incluir a feature de **Assuntos** (opções rápidas) para o widget.

### Migração

- `sql/010_support_topics.sql` cria a tabela `support_topics` (assuntos pré-definidos) para exibição no widget.

### Endpoints

- Público:
  - `GET /v1/support-topics` lista assuntos ativos.

- Admin (root/admin):
  - `GET /v1/admin/support-topics`
  - `POST /v1/admin/support-topics`
  - `PUT /v1/admin/support-topics/:id`
  - `DELETE /v1/admin/support-topics/:id`

### Comportamento no widget

- Antes da primeira mensagem, o widget mostra botões com os assuntos ativos.
- Ao clicar, envia `message_text` como primeira mensagem da conversa.
