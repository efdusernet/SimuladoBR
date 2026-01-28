/*
  056_flashcard_admin_view_no_abordagem.sql

  Purpose:
  - Provide an admin-friendly projection of flashcards that does NOT include the abordagem field.
  - This supports simplifying the Admin Flashcards UI and its API payloads without forcing a destructive schema change.

  Notes:
  - This does NOT drop any columns.
  - If in the future you decide to remove idabordagem from the database entirely, we should do that in a separate migration
    after updating all dependent controllers/services (attempts, score, insights, AI, indicators).
*/

CREATE OR REPLACE VIEW public.flashcard_admin_no_abordagem AS
SELECT
  f.id,
  f.pergunta,
  f.resposta,
  f.id_versao_pmbok,
  f.data_cadastro,
  f.data_alteracao,
  f.idprincipio,
  f.iddominio_desempenho,
  COALESCE(f.basics, FALSE) AS basics,
  COALESCE(f.active, TRUE) AS active
FROM public.flashcard f;
