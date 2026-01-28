# Dicas ("Dica do dia") — API, Admin e UI

Este documento descreve o recurso de **Dicas**:

- Endpoint de usuário autenticado para obter uma dica aleatória
- CRUD admin para manter a tabela `public.dicas`
- Comportamento da UI na Home (“Dica do dia” em modal)

## Modelo de dados

- Tabela: `public.dicas`
- Campos usados:
  - `id` (PK)
  - `descricao` (texto)
  - `id_versao_pmbok` (FK lógica para `public.exam_content_version.id`)

O backend faz `LEFT JOIN exam_content_version` para expor `versao_code`.

## Endpoint (usuário)

### GET /api/dicas/today
Retorna uma dica aleatória (random) a partir de `public.dicas`.

- Auth: JWT (via middleware `requireUserSession`)
- Query:
  - `versionId?: number` (default `2`)
  - `anyVersion?: boolean` (quando `true`, ignora `versionId` e busca em todas as versões)
- Response (sucesso):
  - `{ item: { id, descricao, id_versao_pmbok, versao_code? } }`
- Erros:
  - `404 DICAS_EMPTY` — nenhuma dica encontrada.
  - `500 DICAS_TABLE_MISSING` — tabela `public.dicas` não existe.

## Endpoints (admin)

Base: `/api/admin/dicas` (e também `/api/v1/admin/dicas`).

### GET /api/admin/dicas
Lista dicas.

- Auth: Admin
- Query:
  - `versionId?: number` — filtra por versão
  - `q?: string` — busca em `descricao` (ILIKE)
  - `limit?: number` (default 200, máx 1000)
  - `offset?: number` (default 0)
- Response:
  - `{ items: [...], meta: { versionId, q, limit, offset, count } }`

### GET /api/admin/dicas/versions
Lista versões disponíveis (tabela `exam_content_version`).

- Auth: Admin
- Response: `{ items: [{ id, code }] }`

### POST /api/admin/dicas
Cria uma dica.

- Auth: Admin
- Body:
  - `descricao: string` (obrigatório)
  - `id_versao_pmbok?: number` (default 2)
- Response: `201` com o item criado (inclui `versao_code`).

### PUT /api/admin/dicas/:id
Atualiza uma dica.

- Auth: Admin
- Body: igual ao POST
- Response: item atualizado.

### DELETE /api/admin/dicas/:id
Remove uma dica.

- Auth: Admin
- Response: `{ ok: true, id }`

## UI (admin)

Página: `/pages/admin/dicas.html`

- Usa `/api/admin/dicas/versions` para preencher o badge da versão.
- Lista/filtra por versão e busca (campo `q`).
- Editor inclui helper para inserir link no formato Markdown.

## UI (usuário): modal “Dica do dia”

O comportamento principal fica em `/utils/dicaDoDiaHello.js`:

- Mostra a dica automaticamente ao iniciar o app (apenas na Home: `/` ou `/index.html`).
- Exibe **no máximo 1 vez por dia** (por device) via `localStorage`:
  - chave: `dicaDoDiaShownDate`
  - valor: data local no formato `YYYY-MM-DD`
- Permite:
  - “Outra dica” (nova chamada ao endpoint)
  - “Copiar” (clipboard)

### Renderização de links

A descrição suporta somente links no padrão Markdown:

- `[texto](https://exemplo.com)`

Regras de segurança:
- O texto é escapado (sem HTML arbitrário).
- Apenas URLs `http(s)://` viram link clicável.
