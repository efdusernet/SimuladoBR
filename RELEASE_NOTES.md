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