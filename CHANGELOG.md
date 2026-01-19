# Changelog

All notable changes to this project will be documented in this file.

This project adheres to semantic versioning. Dates are in YYYY-MM-DD.

## [1.2.0] - 2026-01-17

### Added
- Autenticação por JWT com **sessão única por usuário** (tabela `UserActiveSession`) e cookie httpOnly `sessionToken`.
- Versionamento de API: suporte a rotas `/api/v1/*` (mantendo `/api/*` como legado/compatibilidade).
- Chat-service integrado via reverse-proxy em `/chat/*` (HTTP + WebSocket admin).
- Review de tentativas finalizadas:
  - `GET /api/exams/result/:attemptId` para carregar questões/opções/seleções para páginas de review.
  - Páginas de review atualizadas com suporte a `match_columns` e renderização correta de múltipla escolha (checkbox).
- Admin (exames):
  - `GET /api/admin/exams/probe` (detecção rápida de permissão admin).
  - Hard delete de histórico: `DELETE /api/admin/exams/attempts/:attemptId`.
  - Versionamento de conteúdo ECO (default e override por usuário): `content-versions`, `content-current`, `user-content-version`.

### Changed
- PWA/service worker: ajustes para reduzir problemas de cache/stale assets em updates.
- Fluxos de front/back para CSRF mais resilientes (principalmente ações administrativas e envio de feedback).

### Fixed
- Review: correções de renderização (checkbox vs rádio) e paridade visual com o runner.
- Review: suporte a explicação/referência/meta e navegação por grid.

### Notes
- Tokens de sessão agora são JWT (via cookie `sessionToken`, header `Authorization: Bearer <token>` ou header `X-Session-Token: <token>`).

## [1.2.1] - 2026-01-18

### Added
- Submit de exame passa a retornar `attemptId`/`examAttemptId` em `POST /api/exams/submit` para navegação de review.

### Changed
- Quiz (`exam.html`): após submit final, redireciona para `examReviewQuiz.html` para revisão imediata do exame submetido.
- Admin: "Excluir histórico" agora executa **purge total** (remove tentativa e filhos, limpa `exam_attempt_purge_log` do attempt e recompõe/remover o agregado diário em `exam_attempt_user_stats`).

### Security
- Removido uso de `sessionToken` na querystring ao deletar histórico (ações usam headers/cookies).

## [1.1.3] - 2025-12-03

### Fixed
- Quiz mode UX and flow:
  - Última questão usa botão `Enviar` quando total=25.
  - Percentual de conclusão na confirmação final corrigido expondo `window.ANSWERS` e `window.QUESTIONS`.
  - Ao enviar no quiz (`exam.html`): mostra toast, limpa estado e redireciona para Home.

## [1.1.2] - 2025-11-30

### Added
- Feedback de questões (Exame Completo e Quiz): botão “Reportar questão” e modal com categoria + texto.
- Endpoints:
  - `GET /api/feedback/categories` (autenticado)
  - `POST /api/feedback` (autenticado)

### Notes
- Se o schema real não tiver colunas opcionais, o backend tenta fallback para não abortar o fluxo.

## [1.1.1] - 2025-11-30

### Changed
- Last Exam Results gauge: robustez de estilos e classes para faixas de performance (>85, 75–85, 70–74, <70).

## [1.1.0] - 2025-11-23

### Added
- Fixture attempts enhanced: realistic option selection now stored for generated fixture exams.
  - Correct questions: all correct options persisted as selected answers.
  - Incorrect questions: one incorrect option (fallback: single correct if none incorrect) persisted.
  - Ensures domain performance indicator (IND10 radar) matches target domain percentages.
- Metadata flags in `ExamAttempt.Meta` for fixtures:
  - `fixtureVersion` (`1.1.0`): versioned spec for fixture generation behavior.
  - `answerStrategy` (`all-correct-options`): documents how answers were simulated.
- Shared config module `backend/config/fixtureSpec.js` centralizes these constants.

### Changed
- Documentation (`README.md`, `docs/api-endpoints.md`) expanded with fixtureVersion / answerStrategy fields and explanation of improved domain fidelity.

### Notes
- Older fixture attempts (≤ 1.0.x) without real option selections will show zero domain performance under IND10; regenerate if analytical accuracy is required.
- Future strategies (e.g., partial selection for multi-select realism) can increment `fixtureVersion` without breaking existing indicators.


## [1.0.1] - 2025-11-12

### Notes
- Version alignment only: bump `frontend/package.json` to 1.0.0 to match backend and repo tag baseline.
- No functional changes; code and APIs remain identical to v1.0.0.

## [1.0.0] - 2025-11-12

### Highlights
- Frontend aligned to historical baseline c611637 (index, exam, examFull, examSetup, components).
- Backend endpoints for last exam widgets:
  - GET /api/exams/last
  - GET /api/exams/history
- Exam attempt persistence restored (ExamAttempt, ExamAttemptQuestion, ExamAttemptAnswer), including:
  - BlueprintSnapshot, PauseState, FiltrosUsados, Meta.
  - Pause checkpoints with validation and countdown.
- Compatibility: optional fallback to ignoreExamType when explicitly requested (body/header), default remains strict by exam_type.
- UX: gauge for “Último exame” styled by recent FULL attempts; premium/free gating applied consistently.
- Docs expanded (README / NOTES).

### Changes since previous merge (fb7c51a..da61682)
- Revert selected JS/CSS/HTML to exact versions from c611637; remove files absent in that commit (RBAC roles, sidebar, menu, home).
- feat(exams): restore ignoreExamType flag (body/header) for select and start-on-demand; apply only when true; record in attempt.Meta.FiltrosUsados.
- fix(exams): remove stray merge markers in startOnDemand; enforce exam_type consistently.
- examSetup: better defaults; availability count; premium cap; removed debug SQL UI hooks.
- Exam flow hard gates at indices 59/119 (labels 60/120); overlay and continue-button disablement improvements.
- Backend: always enforce exam_type_id by default; allow explicit bypass only when ignoreExamType is true.
- Session robustness: store sessionId in ExamAttempt.Meta and recover attemptId for partial submits after restarts.
- Admin and bulk uploads existed post-baseline but were intentionally removed to match c611637 for this release.

### Migration notes
- If you had RBAC routes and scripts after c611637, they are not part of v1.0.0. Plan to reintroduce as a separate minor release.
- Ensure DB migrations for exam_* and question_type tables are applied before using attempt persistence and last-exam endpoints.

[1.0.0]: https://github.com/efdusernet/SimuladoBR/releases/tag/v1.0.0
[1.0.1]: https://github.com/efdusernet/SimuladoBR/releases/tag/v1.0.1
[1.1.0]: https://github.com/efdusernet/SimuladoBR/releases/tag/v1.1.0