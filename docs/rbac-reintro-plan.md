# RBAC Reintroduction Plan (v1.1.0)

Date: 2025-11-12
Target branch: rbac-reintro

## Goals
- Reintroduce RBAC (roles, permissions) with minimal, safe surface.
- Protect admin endpoints and admin UI without changing public APIs.
- Provide idempotent migrations + seeds and clear migration notes.

## Scope
- Data model: Role, Permission, RolePermission, UserRole (reuse existing SQL files 013–016).
- Middleware: `requireAdmin` + optional `requirePermission(permission)`.
- Routes: enforce admin on sensitive endpoints (bulk question ops, debug, integrity tools where appropriate).
- Seeds: Admin role and initial permissions with idempotent upserts.
- Docs: Update README/NOTES and add short admin enablement guide.

## Deliverables
- SQL: verify and, if needed, add new numbered migrations to avoid duplicate "013/014" numbering.
- Backend:
  - `middleware/requireAdmin.js` (reuse existing) and new `requirePermission.js` helper.
  - Wire guards in `routes/` for admin-only actions.
  - Minimal controller utilities to check current user roles/permissions.
- Scripts: `scripts/seed_roles_permissions.js` for safe seeding in non-prod, and instructions to run in prod.
- Tests (lightweight): manual scripts or Postman collection folder for RBAC checks (200 vs 403).
- Docs: `docs/rbac.md` with setup, seeds, and endpoint guard matrix.

## Non-goals (defer)
- Fine-grained UI role management screens.
- Complex permission hierarchies or org scopes.

## Work Plan
1) Migrations & Seeds
- Audit `backend/sql` for 013–016; add new numbered files if renumbering is required (e.g., 017+), ensuring safe IF NOT EXISTS and upserts.
- Create seeding script using parameterized queries.

2) Backend Middleware & Wiring
- Confirm `middleware/requireAdmin.js` is present and correct; add `requirePermission.js`.
- Apply guards to:
  - `routes/questions.js`: bulk import/export, destructive ops.
  - `routes/debug.js`: protect or remove in prod.
  - `routes/integrity.js`: protect sensitive tools.

3) Postman & Verification
- Add Postman folder RBAC checks (admin vs non-admin) with pre-req scripts to set tokens.
- Update `postman/README.md` with quick steps.

4) Docs
- Add `docs/rbac.md` and update `README.md` and `NOTES.md` with migration & seeding steps.

## Acceptance Criteria
- Non-admin receives 403 on admin routes; admin gets 200.
- Migrations apply cleanly on fresh DB and upgrade path from v1.0.x.
- No breaking changes to public user flows.
- Docs clearly outline enabling admin and running seeds.
