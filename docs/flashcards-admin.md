# Flashcards (Admin) — API, UI e mudanças de schema

Este documento descreve o CRUD de **Flashcards** para administradores.

- UI (admin): `/pages/admin/flashcards.html`
- API (admin): `/api/admin/flashcards/*` (legado) e `/api/v1/admin/flashcards/*` (preferencial)
- Auth: **Admin** (JWT + middleware `requireAdmin`)

## Mudança importante: remoção de `idabordagem`

O campo `public.flashcard.idabordagem` foi removido do fluxo e do schema.

- Backend não seleciona/insere/atualiza mais esse campo.
- Migração SQL idempotente para drop:
  - `backend/sql/057_drop_flashcard_idabordagem.sql`

Há também um SQL auxiliar de view:
- `backend/sql/056_flashcard_admin_view_no_abordagem.sql`

## Endpoints

### GET /api/admin/flashcards
Lista flashcards.

- Query:
  - `versionId?: number` — filtra por `id_versao_pmbok`
  - `q?: string` — busca em `pergunta` e `resposta` (ILIKE)
  - `limit?: number` (default 200, máx 1000)
  - `offset?: number` (default 0)
- Response:
  - `{ items: [...], meta: { versionId, q, limit, offset, count } }`

Campos retornados por item (principais):
- `id`, `pergunta`, `resposta`, `id_versao_pmbok`, `versao_code`
- `idprincipio`, `iddominio_desempenho`
- `basics` (default `false`), `active` (default `true`)
- `data_cadastro`, `data_alteracao`

### GET /api/admin/flashcards/versions
Lista versões disponíveis (tabela `exam_content_version`).

- Response: `{ items: [{ id, code }] }`

### POST /api/admin/flashcards
Cria flashcard.

- Body:
  - `pergunta: string` (obrigatório)
  - `resposta: string` (obrigatório)
  - `id_versao_pmbok?: number` (default 2)
  - `idprincipio?: number | null`
  - `iddominio_desempenho?: number | null`
  - `basics?: boolean` (default false)
  - `active?: boolean` (default true)
- Response: `201` com item criado.

### PUT /api/admin/flashcards/:id
Atualiza flashcard.

- Body: igual ao POST
- Observação: `active` é opcional; se não for enviado, o backend preserva o valor existente.

### DELETE /api/admin/flashcards/:id
Remove flashcard.

- Response: `{ ok: true, id }`

## UI (admin)

Página: `/pages/admin/flashcards.html`

- Paginação client-side configurada para 100 itens por página.
- Campo “Abordagem” não existe mais (alinhado ao drop de `idabordagem`).
