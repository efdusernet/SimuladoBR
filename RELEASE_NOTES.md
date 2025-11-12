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