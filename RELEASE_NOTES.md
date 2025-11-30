# v1.0.0

Date: 2025-11-12

## Highlights
- Frontend aligned to baseline c611637 (index, exam, examFull, examSetup, components).
- Backend endpoints for last exam widgets: GET /api/exams/last and GET /api/exams/history.
- Exam attempt persistence restored (ExamAttempt, ExamAttemptQuestion, ExamAttemptAnswer) with BlueprintSnapshot, PauseState, FiltrosUsados, Meta.
- Pause checkpoints with validation and countdown; session resume after restart.
- Compatibility: optional ignoreExamType fallback when explicitly requested; default strict by exam_type.
- UX: “Último exame” gauge with styling by last 3 FULL attempts; consistent premium/free gating.

## Breaking/Removals
- RBAC routes/scripts added after the baseline were removed to match c611637 state for this release; plan reintroduction in a minor release.

## Migration
- Apply DB migrations (exam_* and question_type) before using persistence and last-exam endpoints.

## Links
- Tag: v1.0.0
- Compare: fb7c51a..da61682

---

# v1.0.1

Date: 2025-11-12

Patch release for repository version alignment.

## Changes
- Bump `frontend/package.json` from 0.1.0 to 1.0.0 so both backend and frontend share a unified 1.0.0 base.
- No code or behavioral changes from v1.0.0.

## Links
- Tag: v1.0.1
- Compare: v1.0.0..v1.0.1

---

# v1.1.0

Date: 2025-11-23

## Highlights
- Fixture exam generation now produces realistic answer option selections: correct questions include all correct options, incorrect questions include one incorrect option (fallback to single correct if none incorrect). This makes domain performance (IND10 radar) align with intended fixture domain percentages.
- Added `fixtureVersion` (1.1.0) and `answerStrategy` (`all-correct-options`) to `ExamAttempt.Meta` for traceability and evolution.
- Central configuration in `backend/config/fixtureSpec.js` for version/strategy constants.

## Developer Notes
- Older fixtures (pre-1.1.0) lacked option-level answers; regenerate to use indicators dependent on option comparison.
- Future refinements (e.g., simulated partial multi-select accuracy) should bump `fixtureVersion` and set a new `answerStrategy` value.

## Docs
- Updated `README.md` and `docs/api-endpoints.md` with new Meta fields and behavior description.

## Links
- Tag: v1.1.0
- Compare: v1.0.1..v1.1.0

---

# v1.1.1

Date: 2025-11-30

## Highlights
- Last Exam Results gauge: robust background styling across performance ranges.
	- Strong >85% lock via component CSS and head-injected rule (high specificity + `!important`).
	- Component fallback applies `.perf-gt85` and `.dark-perf` when gauge ≥85%.
	- Added CSS classes with gradients for `perf-75-85`, `perf-70-74`, `perf-lt70` to cover remaining ranges.
	- Ensured `background-clip` and `background-color` to prevent overlay bleed and style resets.
- Preserved simulator simplicity while mirroring visual ranges.

## Developer Notes
- The component now self-applies classes based on computed gauge percent. History-based styling remains, but the component-level fallback guarantees visuals.
- If extending ranges (e.g., 50–69), add `.perf-50-69` CSS and class assignment parallel to others.

## Links
- Tag: v1.1.1
- Compare: v1.1.0..v1.1.1

---

# v1.1.2

Date: 2025-11-30

## Highlights
- Feedback de questões (Exame Completo & Quiz): Botão "Reportar questão" adicionado em `examReviewFull.html` e `examReviewQuiz.html`.
- Modal permite selecionar categoria (tabela `CategoriaFeedback`) e enviar texto descritivo.
- Endpoints backend:
	- `GET /api/feedback/categories` (autenticado) retorna lista de categorias.
	- `POST /api/feedback` registra feedback (`texto`, `idcategoria`, `questionId` opcional).
- Modelos Sequelize adicionados: `CategoriaFeedback`, `Feedback` (com campo opcional `questionId` – fallback caso coluna não exista ainda no schema real).

## Considerações Técnicas
- Caso o banco ainda não tenha a coluna `questionId` em `Feedback`, a rota faz fallback automático removendo o campo antes da inserção.
- Recomenda-se criar uma migration para adicionar `questionId` e FK para `Question` para melhor rastreabilidade.
- Proteção: uso de `requireUserSession` garante somente usuários autenticados.

## Próximos Passos Sugeridos
- Adicionar endpoint de listagem de feedbacks para moderação/admin.
- Criar migration formal para `questionId` e índices em `Feedback`.
- Internacionalizar rótulos do modal (i18n) e adicionar limite de tamanho em `texto`.

## Links
- Tag: v1.1.2 (pending tagging)
- Compare: v1.1.1..v1.1.2