# Pendências (documentação, rollout e validações)

Este arquivo lista itens pendentes e checklist de rollout para features recentes.

## Checklist de rollout

- Aplicar migrações SQL do backend:
  - `backend/sql/056_flashcard_admin_view_no_abordagem.sql` (auxiliar)
  - `backend/sql/057_drop_flashcard_idabordagem.sql` (schema)
- Verificar se a tabela `public.dicas` existe no banco (CRUD admin depende dela).
- Validar permissões admin:
  - Confirmar que `requireAdmin` protege `/api/admin/*` e `/pages/admin/*`.

## Checklist de smoke-test (manual)

- Data Explorer:
  - Abrir `/pages/admin/dataExplorer.html`
  - Carregar tabelas/colunas
  - Confirmar preview ao vivo (`/api/admin/data-explorer/preview`) e execução (`/query`)
  - Confirmar que tabelas denylist (token/session/password/secret/credential/audit) não aparecem.

- Dicas:
  - Abrir Home e validar que o modal aparece no máximo 1x/dia (chave `localStorage.dicaDoDiaShownDate`).
  - Abrir `/pages/admin/dicas.html` e validar CRUD.
  - Validar `GET /api/dicas/today` com `anyVersion=true`.

- Flashcards:
  - Abrir `/pages/admin/flashcards.html`
  - Confirmar CRUD e paginação (100 por página).
  - Confirmar que não há referências a `idabordagem` após migração.

## Pendências de documentação

- Atualizar matriz de endpoints para incluir:
  - Admin Data Explorer (`/api/admin/data-explorer/*`)
  - Dicas (user + admin)
  - Flashcards admin
  - Páginas admin novas (`/pages/admin/dataExplorer.html`, `/pages/admin/dicas.html`, `/pages/admin/flashcards.html`)

## Pendências opcionais (qualidade)

- Atualizar coleção do Postman em `postman/SimuladosBR.postman_collection.json` com os novos endpoints admin (Data Explorer, Dicas, Flashcards).
- Adicionar referências rápidas no README para as novas páginas admin e docs.
