$ErrorActionPreference = 'Stop'

$p = Join-Path $PSScriptRoot '..\frontend\components\sidebar.html'
if (-not (Test-Path $p)) { throw "File not found: $p" }

$raw = Get-Content -Path $p -Raw -Encoding UTF8

$old = @"
  // Check if user is admin (UI visibility only)
  async function checkAdminAccess() {
    try {
      const adminAccordion = document.getElementById('sidebarAdminAccordion');
      if (adminAccordion) adminAccordion.style.display = 'none';

      // Force refresh when session identity changes; otherwise allow short cache.
      const ok = await ensureAdminAccess({ maxAgeMs: 15000 });
      if (!ok) return;

      if (adminAccordion) adminAccordion.style.display = 'block';
    } catch (_e) {
      // Not admin or error, keep menu hidden
    }
  }
"@

$new = @"
  // Check if user is admin (UI visibility only)
  async function checkAdminAccess() {
    try {
      const adminAccordion = document.getElementById('sidebarAdminAccordion');
      if (adminAccordion) adminAccordion.style.display = 'none';

      // Force refresh when session identity changes; otherwise allow short cache.
      let ok = false;
      try {
        ok = await ensureAdminAccess({ maxAgeMs: 15000 });
      } catch(_){ ok = false; }

      // Deterministic fallback: /api/users/me already returns TipoUsuario=admin based on RBAC.
      // This also works for cookie-only sessions (no localStorage identity).
      if (!ok) {
        try {
          const resp = await fetch('/api/users/me', { method: 'GET', credentials: 'include', cache: 'no-store' });
          if (resp && resp.ok) {
            const me = await resp.json().catch(() => null);
            ok = !!(me && (me.TipoUsuario === 'admin' || me.tipoUsuario === 'admin' || me.isAdmin === true));
          }
        } catch(_){ /* ignore */ }
      }

      if (!ok) return;

      if (adminAccordion) adminAccordion.style.display = 'block';
    } catch (_e) {
      // Not admin or error, keep menu hidden
    }
  }
"@

if ($raw.IndexOf($old) -lt 0) {
  throw "Target block not found in $p; aborting to avoid corrupting the file."
}

$updated = $raw.Replace($old, $new)
if ($updated -eq $raw) { throw 'Replace produced no changes; abort.' }

try {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $updated, $utf8NoBom)
} catch {
  # Fallback best-effort
  Set-Content -Path $p -Value $updated -Encoding UTF8
}

'patched sidebar.html ok'
(Select-String -Path $p -Pattern 'Deterministic fallback' -SimpleMatch -List | Select-Object -First 1 | ForEach-Object { 'fallbackLine=' + $_.LineNumber })
