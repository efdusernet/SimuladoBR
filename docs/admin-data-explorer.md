# Admin Data Explorer

Este documento descreve o **Admin Data Explorer**: uma UI administrativa para explorar dados do Postgres com um **builder seguro** (sem input de SQL livre).

- UI (admin): `/pages/admin/dataExplorer.html`
- API (admin): `/api/admin/data-explorer/*` (legado) e `/api/v1/admin/data-explorer/*` (preferencial)
- Auth: **Admin** (JWT + middleware `requireAdmin`)

## Objetivo e modelo de segurança

O Data Explorer existe para facilitar auditorias e inspeção de dados sem abrir uma superfície de ataque de “SQL arbitrário”. Por isso:

- O cliente **não** envia SQL.
- O servidor constrói SQL apenas no formato `SELECT` com:
  - validação de tabela/coluna via `information_schema`
  - bind parameters (`$p1`, `$p2`, ...) para execução
  - denylist de tabelas sensíveis (por nome): `token`, `session`, `password`, `secret`, `credential`, `audit`
- O preview pode retornar um SQL “expandido” somente para exibição (`sqlPreviewExpanded`).

## Endpoints

### GET /api/admin/data-explorer/tables
Lista tabelas `public.*` permitidas.

- Auth: Admin
- Response:
  - `{ tables: string[] }`

### GET /api/admin/data-explorer/tables/:table/columns
Lista colunas e tipos de uma tabela.

- Auth: Admin
- Path:
  - `:table`: nome da tabela (schema sempre `public`)
- Response:
  - `{ table: string, columns: [{ name: string, type: string }] }`

Erros comuns:
- `400 ADMIN_DATAEXPLORER_TABLE_DENIED` — tabela bloqueada pelo denylist.
- `400 ADMIN_DATAEXPLORER_TABLE_NOT_FOUND` — não existe/sem colunas.

### POST /api/admin/data-explorer/preview
Gera o preview do `SELECT` (sem executar).

- Auth: Admin
- Body: mesmo payload do `/query` (abaixo)
- Response:
  - `sqlPreview`: SQL com placeholders (`$p1`, `$p2`, ...)
  - `sqlPreviewExpanded`: SQL com valores interpolados (apenas display)
  - `bind`: objeto de binds `{ p1, p2, ... }`
  - `meta`: `{ table, limit, offset }`

### POST /api/admin/data-explorer/query
Executa a query e retorna as linhas.

- Auth: Admin
- Body: mesmo payload do `/preview`
- Response:
  - `rows`: `object[]`
  - `hasMore`: `boolean` (server executa `LIMIT + 1` para detectar paginação)
  - `sqlPreview`, `sqlPreviewExpanded`, `bind`
  - `meta`: `{ table, limit, offset, count }`

## Payload do Builder

### Campos básicos

- `table: string` (obrigatório) — tabela em `public`.
- `columns?: string[]` — lista de colunas (padrão: `['*']` quando sem `groupBy`).
- `limit?: number` — padrão 100, máximo 500.
- `offset?: number` — padrão 0, máximo 200000.
- `orderBy?: { column: string, dir?: 'asc'|'desc' }`
- `distinct?: boolean`

### Filters (WHERE)

- `filters?: Array<{ column: string, op: string, value?: any }>`

Operadores suportados:
- Comparações: `=`, `!=`, `<`, `<=`, `>`, `>=`
- Texto: `like`, `ilike`
- Nullability: `is_null`, `not_null`
- Lista: `in`, `not_in` (valor como string `a,b,c`)
- Intervalo: `between` (valor como `a..b` ou `a,b`)

### Grouping/Aggregation

- `groupBy?: string[]`
- `aggregates?: Array<{ fn: 'count'|'count_distinct'|'sum'|'avg'|'min'|'max', column?: string, as?: string }>`
- `having?: Array<{ alias: string, op: string, value: any }>`

Regras importantes:
- `distinct: true` é **bloqueado** quando há `groupBy` e/ou `aggregates`.
- `having.alias` precisa referenciar um `as` de agregação conhecido.

## SQL Preview (com valores)

O backend retorna dois previews:

- `sqlPreview`: SQL real executado (com binds).
- `sqlPreviewExpanded`: SQL apenas para exibição com valores interpolados.

Observação: `sqlPreviewExpanded` não deve ser reutilizado para execução.

## UI: Preview ao vivo

A página `/pages/admin/dataExplorer.html` possui um campo “Preview do SQL (ao vivo)” que atualiza automaticamente quando o usuário muda tabela/colunas/filtros.

Detalhes de UX:
- Debounce no frontend para evitar spam de requests.
- Cancelamento de requests antigos via `AbortController`.
- Ao selecionar `LIKE`/`ILIKE`, o input é auto-preenchido com `%%` para facilitar o padrão.
