# Changelog

All notable changes to this project will be documented in this file.

This project adheres to semantic versioning. Dates are in YYYY-MM-DD.

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