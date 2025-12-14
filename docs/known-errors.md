# Erros Conhecidos

Este documento lista problemas recorrentes e suas causas/soluções confirmadas no projeto SimuladosBR.

## 1. 403 ao selecionar questões (POST /api/exams/select)
- Sintomas: No console, mensagens como `Failed to fetch questions 403`. Nenhuma questão carregada, primeira renderização mostra `id undefined` e imagem não resolvida.
- Causa raiz:
  - Em fluxos locais (file:// ou diferentes origens), o cabeçalho `X-CSRF-Token` não era garantido em todas as chamadas, apesar do wrapper; o backend (Double Submit Cookie) exige que o `X-CSRF-Token` corresponda ao cookie `csrfToken`.
- Evidências:
  - Network mostrava POST 403 sem `X-CSRF-Token`; cookie `csrfToken` presente.
  - Logs do middleware de CSRF indicam falha por token ausente/mismatch.
- Correção aplicada:
  - `frontend/utils/csrf.js`: já buscava token em `/api/csrf-token` com `credentials: 'include'` e injeta token em requests `/api/*` de mesma origem ou origem de backend confiável.
  - `frontend/script_exam.js`: reforçado para incluir explicitamente `X-CSRF-Token` obtido via `window.csrfManager.token` no POST `/api/exams/select`.
  - Backend (previamente): Cookie `SameSite=lax` em desenvolvimento e relaxo de origem para localhost/file://.
- Como verificar:
  - Network → POST /api/exams/select deve conter os cabeçalhos `X-CSRF-Token`, `X-Session-Token`, `X-Exam-Type`; cookie `csrfToken` enviado.
  - Resposta 200 deve trazer `questions` com `id`, `descricao`, `options`, `imagem_url`.
- Workaround (se persistir):
  - Atualizar/forçar `SIMULADOS_CONFIG.BACKEND_BASE` para mesma origem do backend.
  - Garantir carregamento de `utils/csrf.js` antes de `script_exam.js`.

## 2. Placeholder de questões sem `id`
- Sintomas: Logs `renderQuestion idx 0 id undefined ...` e imagem não resolvida.
- Causa raiz: Fallback de UI executado quando seleção falha (403/400), criando questão de amostra sem `id`.
- Correção:
  - Endereçar a causa (403). Com POST resolvido, as questões retornam com `id` e imagens enriquecidas pelo backend.
- Como detectar: Ver `resp.ok` e logs `Failed to fetch questions <status>`.

## 3. Imagens não exibidas inicialmente
- Sintomas: `hasRaw? false srcResolved? false origin null`.
- Causa: Campo `imagem_url` ausente no primeiro SELECT.
- Correção: Backend enriquece `imagem_url` após seleção para todas as IDs; cliente mescla e persiste.
- Verificação: Network → Resposta inclui imagens; logs mostram contagem de questões com imagem.

## Referências de arquivos
- Frontend: `frontend/utils/csrf.js`, `frontend/script_exam.js`, `frontend/pages/examFull.html`.
- Backend: `backend/middleware/csrfProtection.js`, `backend/controllers/examController.js`.
