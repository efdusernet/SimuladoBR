# Transaction Guidelines (Sequelize + Postgres)

## Pattern: Explicit Begin/Commit/Rollback
- Start a transaction: `const t = await sequelize.transaction();`
- Wrap all writes in `try/catch`:
  - On success: `await t.commit();`
  - On failure: `await t.rollback();` and rethrow for centralized handling.
- Avoid callback-style transactions for complex flows; explicit control improves clarity and rollback guarantees.

## Example (createQuestion)
- Inserts into `questao`, `respostaopcao`, and `explicacaoguia` occur within the same transaction.
- If any insert fails, rollback prevents partial commits and orphaned records.

## Timeouts
- Sequelize does not provide native transaction timeouts. Recommended:
  - Wrap work in `Promise.race([work, timeout])` and rollback if exceeded.
  - Choose conservative limits (e.g., 5–10 seconds) based on DB performance.

## Compensation Logic
- For multi-system workflows (e.g., external services) that occur after commit, plan compensating actions (delete/mark-excluded) if downstream fails.
- Prefer finalizing side-effects after DB commit to avoid inconsistencies.

## Tips
- Validate foreign keys before opening a transaction to fail fast.
- Use parameterized queries (`:replacements`) for all dynamic values to avoid injection and improve plan caching.
- Keep transactions short; avoid long-running user interactions inside.
