# Error Handling & Runtime Stability

## Global Process Handlers
- `backend/index.js` registers handlers for `unhandledRejection` and `uncaughtException`.
- Errors are logged via the structured `logger` including message and stack.
- Behavior:
  - Development: process exits on unhandled rejections/exceptions to surface issues early.
  - Production: 
    - Unhandled rejections: logged; process kept alive (monitor for recurring issues).
    - Uncaught exceptions: logged; graceful shutdown via `server.close()` and `sequelize.close()`.

## Graceful Shutdown
- Signals `SIGTERM` and `SIGINT` are handled.
- HTTP server is closed with `server.close()`; DB connection closed via `sequelize.close()`.
- Ensures pending requests finish where possible and connections are released.

## API Error Pipeline
- Request ID middleware sets `X-Request-Id` used across logs.
- `requestLogger` and `errorLogger` capture inbound/outbound along with errors.
- `errorHandler` returns standardized payloads for operational errors; unexpected errors yield HTTP 500.

## Recommendations
- Prefer `async/await` with `try/catch` over mixing patterns.
- Always return or `await` promises to avoid floating rejections.
- Consider adding ESLint rules:
  - `promise/always-return`
  - `no-unsafe-finally`
  - `no-floating-promises` (via TypeScript or eslint-plugin-promise alternatives)
- Use `AppError` for operational errors with explicit `statusCode` and `code`.
