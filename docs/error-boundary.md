# Frontend Error Boundary (Fallback UI)

This app includes a lightweight, global error boundary implemented in `frontend/script.js`. It captures uncaught JavaScript errors and unhandled promise rejections, logs them via the app logger, and displays a user-friendly overlay with actions to reload or go back to home.

## What It Does
- Captures `window.error` and `window.unhandledrejection` events
- Logs details using `logger.error` (falls back to console if logger unavailable)
- Shows a full-page overlay with:
  - Error details (message, source, stack)
  - "Recarregar" button
  - "Ir para Início" button (validated via SafeRedirect when available)

## Public API
Pages that have custom error flows can integrate or override behavior via the `ErrorBoundary` object.

```js
// Available on window after DOMContentLoaded
ErrorBoundary.enable();       // re-enable overlay display
ErrorBoundary.disable();      // suppress overlay (delegates may still run)
ErrorBoundary.setHandler(fn); // register delegate (info, eventType)
ErrorBoundary.clearHandler(); // remove delegate
```

- `fn(info, eventType)`: called before the overlay.
  - `info`: formatted error info string (message, stack, etc.)
  - `eventType`: one of `"error"` or `"unhandledrejection"`
- If the delegate runs successfully, the global overlay is skipped.
- If `ErrorBoundary.disable()` is called, no overlay is shown.

## Usage Examples

### 1) Custom toast on exam page (keep overlay as fallback)
```js
// In exam page script
document.addEventListener('DOMContentLoaded', () => {
  ErrorBoundary.setHandler((info, type) => {
    // Show a non-blocking toast; do not throw here
    window.examUI?.showErrorToast(info);
    // Returning normally keeps overlay suppressed; remove handler to show overlay
  });
});
```

### 2) Fully suppress overlay and route to a page-specific recovery view
```js
document.addEventListener('DOMContentLoaded', () => {
  ErrorBoundary.disable();
  ErrorBoundary.setHandler((info, type) => {
    // Navigate to a dedicated recovery route or open a modal
    window.recoveryUI?.open({ details: info, source: type });
  });
});
```

### 3) Temporarily disable during a sensitive flow, then re-enable
```js
ErrorBoundary.disable();
try {
  await runRiskyStep();
} finally {
  ErrorBoundary.enable();
}
```

## Notes & Best Practices
- Avoid throwing inside your delegate; if it throws, the overlay is used as a safety net.
- Keep error messages user-friendly; sensitive details should be limited in production builds.
- Pair with existing logging to ensure operational visibility.
- For known recoverable errors, prefer local handling (try/catch) over relying on the boundary.

## File References
- Implementation: `frontend/script.js` (DOMContentLoaded section)
- Safe redirects: `SafeRedirect` class in `frontend/script.js`
- Logger shim: `frontend/utils/logger.js` (and safe fallback in `script.js`)
