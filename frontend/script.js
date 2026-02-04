// Import controlled logging system
// <script src="/utils/logger.js"></script> must be loaded first in HTML

// SafeRedirect: Security utility to prevent open redirect vulnerabilities
class SafeRedirect {
    constructor() {
        // Whitelist of allowed internal paths (relative URLs only)
            this.allowedPaths = [
                '/',
                '/index.html',
                '/login',
                '/login.html',
                '/pages/exam.html',
                '/pages/examFull.html',
                '/pages/examSetup.html',
                '/pages/indicadores.html',
                '/pages/admin/users.html',
                '/pages/admin/questions.html',
                '/pages/admin/examTypes.html'
            ];
    }

    /**
     * Validates and sanitizes a redirect URL
     * @param {string} url - The URL to validate
     * @param {string} fallback - Fallback URL if validation fails (default: '/')
     * @returns {string} - Safe URL to redirect to
     */
    validateRedirect(url, fallback = '/') {
        if (!url || typeof url !== 'string') { 
            return fallback;
        }

        try { 
            // If it's a relative URL (starts with / but not //), validate against whitelist 
            if (url.startsWith('/') && !url.startsWith('//')) { 
                // Extract path without query string and hash 
                const path = url.split('?')[0].split('#')[0]; 
                
                // Check if path or its parent directories are in whitelist 
                const isAllowed = this.allowedPaths.some(allowedPath => { 
                    // Exact match 
                    if (path === allowedPath) return true; 
                    // Allow paths under /pages/ 
                    if (path.startsWith('/pages/') && allowedPath.startsWith('/pages/')) return true; 
                    // Allow paths under /components/ 
                    if (path.startsWith('/components/')) return true; 
                    return false; 
                });

                if (isAllowed) { 
                    return url; 
                } 
                
                window.logger?.warn('[SafeRedirect] Rejected non-whitelisted path:', path) || console.warn('[SafeRedirect] Rejected non-whitelisted path:', path); 
                return fallback; 
            } 

            // For absolute URLs, parse and validate origin 
            const parsedUrl = new URL(url, window.location.origin); 
            
            // Only allow same-origin redirects 
            if (parsedUrl.origin !== window.location.origin) { 
                window.logger?.warn('[SafeRedirect] Rejected external redirect:', parsedUrl.href) || console.warn('[SafeRedirect] Rejected external redirect:', parsedUrl.href); 
                return fallback; 
            } 
            
            // Validate the pathname against whitelist 
            const path = parsedUrl.pathname; 
            const isAllowed = this.allowedPaths.some(allowedPath => { 
                if (path === allowedPath) return true; 
                if (path.startsWith('/pages/') && allowedPath.startsWith('/pages/')) return true; 
                if (path.startsWith('/components/')) return true; 
                return false; 
            }); 

            if (isAllowed) {
                return parsedUrl.href;
            }

            window.logger?.warn('[SafeRedirect] Rejected non-whitelisted URL:', parsedUrl.href) || console.warn('[SafeRedirect] Rejected non-whitelisted URL:', parsedUrl.href);
            return fallback;

        } catch (e) {
            window.logger?.error('[SafeRedirect] Error validating redirect:', e) || console.error('[SafeRedirect] Error validating redirect:', e);
            return fallback;
        }
    }

    /**
     * Safely redirects to a URL after validation
     * @param {string} url - The URL to redirect to
     * @param {string} fallback - Fallback URL if validation fails
     */
    safeRedirect(url, fallback = '/') {
        const safeUrl = this.validateRedirect(url, fallback);
        window.location.assign(safeUrl);
    }
}

// Centralized admin access check used across the app (sidebar, modals, etc.)
// Keeps a single source of truth for headers + caching.
(() => {
    if (typeof window.ensureAdminAccess === 'function') return;

    function getSessionKeyFromStorage() {
        try {
            const jwtTok = (localStorage.getItem('jwtToken') || localStorage.getItem('jwt') || '').trim();
            const jwtType = (localStorage.getItem('jwtTokenType') || localStorage.getItem('jwt_type') || 'Bearer').trim() || 'Bearer';
            const token = (localStorage.getItem('sessionToken') || '').trim();
            const nomeUsuario = (localStorage.getItem('nomeUsuario') || '').trim();
            const xSession = (token || nomeUsuario).trim();
            const parts = [];
            if (jwtTok) parts.push(`jwt:${jwtType}:${jwtTok.slice(0, 24)}`);
            if (xSession) parts.push(`xs:${xSession}`);
            return parts.join('|') || '';
        } catch(_){
            return '';
        }
    }

    function buildAuthHeaders() {
        try {
            if (window.Auth && typeof window.Auth.getAuthHeaders === 'function') {
                return window.Auth.getAuthHeaders({ acceptJson: true });
            }
        } catch(_){ }

        const h = { 'Accept': 'application/json' };
        try {
            const token = (localStorage.getItem('sessionToken') || '').trim();
            const nomeUsuario = (localStorage.getItem('nomeUsuario') || '').trim();
            const sessionForHeader = (token || nomeUsuario).trim();
            const jwtTok = (localStorage.getItem('jwtToken') || localStorage.getItem('jwt') || '').trim();
            const jwtType = (localStorage.getItem('jwtTokenType') || localStorage.getItem('jwt_type') || 'Bearer').trim() || 'Bearer';
            if (sessionForHeader) h['X-Session-Token'] = sessionForHeader;
            if (jwtTok) h['Authorization'] = `${jwtType} ${jwtTok}`;
        } catch(_){ }
        return h;
    }

    async function computeAdminNow(headers) {
        const base = String((window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.BACKEND_BASE) || '').trim() || '';
        const baseUrl = base ? base.replace(/\/$/, '') : '';

        const cookieOnlyHeaders = { 'Accept': 'application/json' };
        const hasAuthHeaders = !!(headers && (headers.Authorization || headers['X-Session-Token']));

        // 1) Preferred: probe admin-only endpoint (aligns with backend RBAC, avoids false positives).
        try {
            const probeUrl = (baseUrl || '') + '/api/admin/data-explorer/tables';
            let probeResp = await fetch(probeUrl, { headers, method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'follow' });

            // Retry once with cookie-only auth to avoid false negatives when a stale Bearer token exists.
            if ((probeResp.status === 401 || probeResp.status === 403) && hasAuthHeaders) {
                probeResp = await fetch(probeUrl, { headers: cookieOnlyHeaders, method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'follow' });
            }

            // Defensive: treat redirects to /login (or HTML) as inconclusive and fall through.
            try {
                if (probeResp.redirected && /\/login(\?|$)/i.test(String(probeResp.url || ''))) throw new Error('probe redirected to login');
                const ct = String(probeResp.headers && probeResp.headers.get && probeResp.headers.get('content-type') || '');
                if (ct && ct.includes('text/html')) throw new Error('probe returned html');
            } catch(_){ }

            // NOTE: Some setups may return 304 (ETag) for allowed resources.
            // Treat it as success for the admin-only probe.
            if (probeResp.ok || probeResp.status === 204 || probeResp.status === 304) return true;
        } catch(_){ }

        // 2) Fallback: /api/users/me legacy role field.
        try {
            const url = (baseUrl || '') + '/api/users/me';
            let resp = await fetch(url, { headers, credentials: 'include', cache: 'no-store' });

            // Retry once with cookie-only auth if denied.
            if ((resp.status === 401 || resp.status === 403) && hasAuthHeaders) {
                resp = await fetch(url, { headers: cookieOnlyHeaders, credentials: 'include', cache: 'no-store' });
            }

            if (!resp.ok) throw new Error('users/me not ok');
            const user = await resp.json().catch(() => null);
            return !!(user && (user.TipoUsuario === 'admin' || user.tipoUsuario === 'admin' || user.isAdmin === true));
        } catch(_){
            // 3) Final fallback: same-origin cookie-based /api/users/me.
            // This avoids false negatives when BACKEND_BASE points elsewhere or custom headers are stale.
            try {
                const resp = await fetch('/api/users/me', { method: 'GET', headers: cookieOnlyHeaders, credentials: 'include', cache: 'no-store', redirect: 'follow' });
                if (!resp.ok) return false;
                const me = await resp.json().catch(() => null);
                return !!(me && (me.TipoUsuario === 'admin' || me.tipoUsuario === 'admin' || me.isAdmin === true));
            } catch(_2){
                return false;
            }
        }
    }

    window.ensureAdminAccess = async function ensureAdminAccess(opts) {
        const options = (opts && typeof opts === 'object') ? opts : {};
        const force = options.force === true;
        const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Number(options.maxAgeMs) : 30_000;

        // If localStorage identity is missing, we still allow cookie-based auth probing.
        const key = getSessionKeyFromStorage() || '__cookie__';

        const cache = (() => { try { return window.__adminAccessCache; } catch(_){ return null; } })();
        const now = Date.now();
        if (!force && cache && cache.key === key && typeof cache.isAdmin === 'boolean' && Number.isFinite(cache.checkedAt)) {
            if ((now - cache.checkedAt) <= maxAgeMs) {
                try { window.__isAdmin = cache.isAdmin; } catch(_){ }
                return cache.isAdmin;
            }
        }

        const headers = buildAuthHeaders();
        const isAdmin = await computeAdminNow(headers);
        try { window.__adminAccessCache = { key, isAdmin, checkedAt: now }; } catch(_){ }
        try { window.__isAdmin = isAdmin; } catch(_){ }
        return isAdmin;
    };

    // Invalidate cache when tokens change in another tab/window.
    try {
        window.addEventListener('storage', (ev) => {
            const k = String(ev && ev.key || '');
            if (!k) return;
            if (k === 'jwtToken' || k === 'jwtTokenType' || k === 'jwt' || k === 'jwt_type' || k === 'sessionToken' || k === 'nomeUsuario') {
                try { window.__adminAccessCache = null; } catch(_){ }
                try { window.__isAdmin = false; } catch(_){ }
            }
        });
    } catch(_){ }
})();

document.addEventListener('DOMContentLoaded', () => {
    // Hard no-cache mode: remove any existing Service Worker + Cache Storage.
    // This prevents stale JS/HTML from being served even if a SW was registered in the past.
    (async () => {
        let wasControlled = false;
        try { wasControlled = !!(navigator.serviceWorker && navigator.serviceWorker.controller); } catch (_) {}

        try {
            if ('serviceWorker' in navigator && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all((regs || []).map(r => {
                    try { return r.unregister(); } catch (_) { return Promise.resolve(false); }
                }));
            }
        } catch (_) {}

        try {
            if (window.caches && caches.keys) {
                const names = await caches.keys();
                await Promise.all((names || []).map(n => {
                    try { return caches.delete(n); } catch (_) { return Promise.resolve(false); }
                }));
            }
        } catch (_) {}

        // If an old SW was controlling this page, it may keep intercepting fetches until a reload.
        // Do a one-time reload to ensure we are running truly SW-free.
        try {
            if (wasControlled) {
                const k = '__swKillReloadAt';
                const last = localStorage.getItem(k);
                const now = Date.now();
                const lastMs = last ? Date.parse(last) : NaN;
                const recently = Number.isFinite(lastMs) && (now - lastMs) < (10 * 60 * 1000);
                if (!recently) {
                    localStorage.setItem(k, new Date(now).toISOString());
                    setTimeout(() => {
                        try { window.location.reload(); } catch (_) {}
                    }, 60);
                }
            }
        } catch (_) {}
    })();

    // Initialize SafeRedirect utility
    const safeRedirect = new SafeRedirect();

    // Status banner removido do app — helpers mantidos como no-op para compatibilidade
    const setStatus = () => {};
    const clearStatus = () => {};
    const modal = document.getElementById('emailModal');
    const emailInput = document.getElementById('emailInput');
    const nameInput = document.getElementById('nameInput');
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const verifyTokenInput = document.getElementById('verifyTokenInput');
    const newPasswordInput = document.getElementById('newPasswordInput');
    const confirmPasswordInput = document.getElementById('confirmPasswordInput');
    const submitBtn = document.getElementById('submitEmail');
    const modalError = document.getElementById('modalError');
    const toggleModeBtn = document.getElementById('toggleModeBtn');
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const pathNow = window.location.pathname || '';
    const onLoginPage = pathNow.replace(/\/+$/, '') === '/login' || pathNow.replace(/\/+$/, '') === '/login.html';

    // Ensure login/register UI remains usable even if later init fails.
    try {
        if (onLoginPage && modal && !modal.getAttribute('data-mode')) {
            modal.setAttribute('data-mode', 'login');
        }
    } catch(_) {}

    try {
        // Event listener para "Esqueci minha senha"
        if (forgotPasswordLink) {
            forgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                setModalMode('forgot-password');
            });
        }

        // Event listener para toggle mode (agora inclui reset de senha)
        if (toggleModeBtn) {
            toggleModeBtn.addEventListener('click', () => {
                const currentMode = (modal && modal.getAttribute('data-mode')) || 'register';
                if (currentMode === 'forgot-password' || currentMode === 'reset-password' || currentMode === 'expired-password') {
                    setModalMode('login');
                } else if (currentMode === 'login') {
                    setModalMode('register');
                } else {
                    setModalMode('login');
                }
            });
        }
    } catch (e) {
        console.warn('login modal basic bindings failed', e);
    }

    function authReasonToUi(reasonRaw) {
        const r = String(reasonRaw || '').trim().toUpperCase();
        if (!r) return { message: '', color: '' };

        if (r === 'SESSION_REVOKED') {
            return {
                message: 'Sua sessão foi encerrada porque houve um novo login em outro dispositivo/navegador.',
                color: '#f59e0b'
            };
        }

        if (
            r === 'SESSION_NOT_FOUND' ||
            r === 'SESSION_SID_MISSING' ||
            r === 'JWT_REQUIRED' ||
            r === 'SESSION_TOKEN_REQUIRED' ||
            r === 'SESSION_TOKEN_OR_AUTH_REQUIRED' ||
            r === 'TOKEN_EXPIRED' ||
            r === 'INVALID_TOKEN' ||
            r === 'INVALID_TOKEN_PAYLOAD' ||
            r === 'USER_NOT_FOUND' ||
            r === 'UNAUTHORIZED' ||
            r === 'FORBIDDEN'
        ) {
            return { message: 'Sua sessão expirou. Faça login novamente.', color: '' };
        }

        return { message: 'Faça login novamente para continuar.', color: '' };
    }

    // If we arrived here due to a forced logout redirect, allow future redirects again.
    try {
        if (onLoginPage) sessionStorage.removeItem('forceLogoutInProgress');
    } catch(_){ }

    // Accessible modal helpers to avoid aria-hidden focus issues
    const ModalA11y = (() => {
        let lastTrigger = null;
        const focusFirst = (modal) => {
            const focusable = modal && modal.querySelector(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (focusable) focusable.focus();
        };
        const open = (modal) => {
            if (!modal) return;
            if (document.activeElement && !modal.contains(document.activeElement)) {
                lastTrigger = document.activeElement;
            }
            modal.setAttribute('aria-hidden', 'false');
            modal.removeAttribute('inert');
            if (getComputedStyle(modal).display === 'none') {
                modal.style.display = 'flex';
            }
            setTimeout(() => focusFirst(modal), 0);
        };
        const close = (modal) => {
            if (!modal) return;
            if (modal.contains(document.activeElement) && lastTrigger) {
                lastTrigger.focus();
            }
            modal.setAttribute('aria-hidden', 'true');
            modal.setAttribute('inert', '');
            modal.style.display = 'none';
        };
        return { open, close };
    })();

    // Configuration: allow overriding from the page by setting window.SIMULADOS_CONFIG
    // Example (optional): window.SIMULADOS_CONFIG = { BACKEND_BASE: window.location.origin, EXAM_PATH: '/pages/exam.html' };
    // Default to same-origin (works for app.localhost:3000 and production subdomains).
    const DEFAULT_BACKEND_BASE = (() => {
        try {
            const o = String(window.location && window.location.origin || '');
            if (/^https?:/i.test(o)) return o;
        } catch(_){ }
        return 'http://app.localhost:3000';
    })();
    window.SIMULADOS_CONFIG = window.SIMULADOS_CONFIG || {
        BACKEND_BASE: DEFAULT_BACKEND_BASE,
        EXAM_PATH: '/pages/exam.html'
    };
    const SIMULADOS_CONFIG = window.SIMULADOS_CONFIG;

    // Force login modal rendering when on login page, regardless of session state
    try {
        if (onLoginPage && modal) {
            setModalMode('login');
            ModalA11y.open(modal);

            // Show a friendly message when redirected to login (e.g., after session revoke)
            try {
                const params = new URLSearchParams(window.location.search || '');
                const reason = (params.get('reason') || '').trim();
                if (reason && modalError) {
                    const ui = authReasonToUi(reason);
                    if (ui && ui.message) {
                        modalError.textContent = ui.message;
                        modalError.style.display = 'block';
                        modalError.style.color = ui.color || '';
                    }
                }
            } catch(_){ }

            // Clean cache-buster (and the one-time reason) from URL for aesthetics
            try {
                const loc = window.location;
                if (loc.search) {
                    const params = new URLSearchParams(loc.search);
                    const hadTs = params.has('_ts');
                    const hadReason = params.has('reason');
                    if (hadTs || hadReason) {
                        params.delete('_ts');
                        // reason is only used to show a one-time message
                        params.delete('reason');
                        const qs = params.toString();
                        const url = (loc.pathname || '/login') + (qs ? ('?' + qs) : '') + (loc.hash || '');
                        window.history.replaceState(null, '', url);
                    }
                }
            } catch(_){ }
        }
    } catch(_) { /* ensure no crash blocks rendering */ }

    // Spinner overlay used while redirecting to exam page
    function showRedirectSpinner(message = 'Entrando no simulado...'){
        let s = document.getElementById('redirectSpinner');
        if (!s){
            s = document.createElement('div');
            s.id = 'redirectSpinner';
            s.style.position = 'fixed';
            s.style.inset = '0';
            s.style.display = 'flex';
            s.style.alignItems = 'center';
            s.style.justifyContent = 'center';
            s.style.background = 'rgba(0,0,0,0.45)';
            s.style.zIndex = '9999';
            s.innerHTML = sanitizeHTML(`<div style="background:#fff;padding:18px 22px;border-radius:8px;display:flex;align-items:center;gap:12px;font-family:system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,0.2)">
                    <svg width=32 height=32 viewBox="0 0 50 50" style="animation:spin 1s linear infinite"><circle cx="25" cy="25" r="20" fill="none" stroke="#2b6cb0" stroke-width="5" stroke-linecap="round" stroke-dasharray="31.4 31.4"/></svg>
                    <div>${sanitizeText(message)}</div>
                </div>`, { ALLOWED_TAGS: ['div', 'svg', 'circle'], ALLOWED_ATTR: ['style', 'width', 'height', 'viewBox', 'cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-dasharray'] });
            document.body.appendChild(s);

            const style = document.createElement('style');
            style.id = 'redirectSpinnerStyle';
            style.textContent = `@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`;
            document.head.appendChild(style);
        } else {
            s.style.display = 'flex';
            s.querySelector('div').lastChild.textContent = message;
        }
    }
    function hideRedirectSpinner(){
        const s = document.getElementById('redirectSpinner');
        if (s) s.style.display = 'none';
    }

    // Admin UI moved to a dedicated page (no modal).
    const adminModalOpen = document.getElementById('adminModalOpen');
    if (adminModalOpen) {
        adminModalOpen.addEventListener('click', (e) => {
            e.preventDefault();
            // Keep the same admin check behavior as before.
            window.ensureAdminAccess().then((ok) => {
                if (!ok) {
                    try { if (window.showToast) { window.showToast('Acesso restrito: somente admin.'); return; } } catch(_){ }
                    alert('Acesso restrito: somente admin.');
                    return;
                }
                window.location.assign('/pages/admin/administracao.html');
            });
        });
    }

    // Load and show the exam setup modal (fragment at ./pages/examSetup.html)
    async function loadExamSetupModal() {
        // If already present, resolve immediately
        let existing = document.getElementById('examSetupModal');
        if (existing) return existing;

        // Try to fetch the fragment from the server relative to current location
        const path = (SIMULADOS_CONFIG.EXAM_SETUP_PATH) ? SIMULADOS_CONFIG.EXAM_SETUP_PATH : './pages/examSetup.html';
        try {
            const resp = await fetch(path, { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed to load exam setup');
            const html = await resp.text();
            const container = document.createElement('div');
            container.innerHTML = sanitizeHTML(html);
            // append children to body
            while (container.firstChild) document.body.appendChild(container.firstChild);
            existing = document.getElementById('examSetupModal');

            // attach handler for start button
            const startBtn = document.getElementById('startExamBtn');
            if (startBtn) {
                // wire up pill selection behavior
                const pills = document.querySelectorAll('#questionCountPills .option-pill');
                if (pills && pills.length) {
                    // If BloqueioAtivado is true, premium options must be disabled (blocking active).
                        const bloqueioActive = localStorage.getItem('BloqueioAtivado') === 'true';
                        const premiumValues = ['100','150','180'];

                        pills.forEach(p => {
                            // disable premium options when bloqueio is active
                            if (bloqueioActive && premiumValues.includes(p.getAttribute('data-value'))) {
                                p.classList.add('disabled');
                                p.setAttribute('aria-disabled', 'true');
                                p.removeAttribute('tabindex');
                            } else {
                                p.classList.remove('disabled');
                                p.removeAttribute('aria-disabled');
                                p.setAttribute('tabindex', '0');
                            }

                            p.addEventListener('click', (ev) => {
                                if (p.getAttribute('aria-disabled') === 'true') return;
                                pills.forEach(x => x.classList.remove('selected'));
                                p.classList.add('selected');
                            });

                            p.addEventListener('keyup', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && p.getAttribute('aria-disabled') !== 'true') p.click(); });
                        });
                    // also disable fallback select options when bloqueio active
                    const selectEl = document.getElementById('questionCountSelect');
                    if (selectEl) {
                        premiumValues.forEach(v => {
                            const opt = selectEl.querySelector(`option[value="${v}"]`);
                            if (opt) opt.disabled = bloqueioActive;
                        });
                    }
                }

                startBtn.addEventListener('click', () => {
                    // prefer pill selection; fallback to select
                    const selectedPill = document.querySelector('#questionCountPills .option-pill.selected');
                    const selected = selectedPill ? { value: selectedPill.getAttribute('data-value') } : document.getElementById('questionCountSelect');
                    if (!selected || !selected.value) {
                        try { sessionStorage.setItem('wentToExamSetup', 'true'); } catch(e){}
                        const target = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.EXAM_SETUP_PATH) || '/pages/examSetup.html';
                        window.location.assign(target);
                        return;
                    }
                    const count = selected.value;
                    // persist choice for exam page
                    try { localStorage.setItem('examQuestionCount', String(count)); } catch(e){}
                    // mark that user started the exam so exam page can auto-start the timer
                    try { sessionStorage.setItem('startExam', 'true'); } catch(e) {}
                    // read examUrl stored on modal (data-exam-url) or use config fallback
                    const modalEl = document.getElementById('examSetupModal');
                    const to = modalEl && modalEl.getAttribute('data-exam-url');
                    const examUrl = to || (SIMULADOS_CONFIG.EXAM_URL || './pages/exam.html');
                    // show spinner and redirect (with validation)
                    hideEmailModal(); // ensure email modal hidden
                    hideRedirectSpinner();
                    showRedirectSpinner('Iniciando o simulado...');
                    const safeExamUrl = safeRedirect.validateRedirect(examUrl, '/pages/exam.html');
                    setTimeout(() => { window.location.href = safeExamUrl; }, 300);
                });
            }

            return document.getElementById('examSetupModal');
        } catch (e) {
            console.warn('Não foi possível carregar examSetup modal:', e);
            return null;
        }
    }

    async function showExamSetupAndRedirect(examUrl) {
        // Verificar se o usuário acabou de voltar do examSetup usando botão voltar do navegador
        // Usamos sessionStorage para rastrear se o usuário saiu para examSetup
        try {
            const justReturned = sessionStorage.getItem('justReturnedFromExamSetup') === 'true';
            if (justReturned) {
                console.log('[showExamSetupAndRedirect] Usuário voltou do examSetup, ignorando modal');
                sessionStorage.removeItem('justReturnedFromExamSetup');
                return;
            }
        } catch(e) {
            console.warn('[showExamSetupAndRedirect] Erro ao verificar retorno:', e);
        }

        // Marcar que estamos indo para o examSetup
        try {
            sessionStorage.setItem('wentToExamSetup', 'true');
        } catch(e) {}

        // No modo desktop, carregar examSetup dentro do index.html
        const layout = document.body.getAttribute('data-layout');
        if (layout === 'desktop' && typeof window.loadExamSetupIntoSection === 'function') {
            console.log('[showExamSetupAndRedirect] Desktop mode - loading inline');
            window.loadExamSetupIntoSection();
            return;
        }

        // load modal (if not yet) and show it; store target url on modal
        const modalEl = await loadExamSetupModal();
        if (!modalEl) {
            // fallback revisado: se não conseguiu carregar o modal, vá para a página de configuração
            const setupPath = (window.SIMULADOS_CONFIG && window.SIMULADOS_CONFIG.EXAM_SETUP_PATH) || '/pages/examSetup.html';
            showRedirectSpinner('Abrindo configuração do simulado...');
            const safeSetupPath = safeRedirect.validateRedirect(setupPath, '/pages/examSetup.html');
            setTimeout(()=>{ window.location.href = safeSetupPath; }, 100);
            return;
        }
        modalEl.setAttribute('data-exam-url', examUrl);
        modalEl.style.display = 'flex';
        modalEl.setAttribute('aria-hidden', 'false');
    }

    // Sidebar: inject if placeholder exists
    (async function initSidebar(){
        try {
            const mount = document.getElementById('appSidebar');
            if (!mount) return; // only load when explicitly requested by the page
            const resp = await fetch('/components/sidebar.html', { cache: 'no-store' });
            if (!resp.ok) return;
            const html = await resp.text();
            mount.innerHTML = sanitizeHTML(html);
            // apply layout shift only for legacy sidebar; mcd-menu handles its own width
            if (!/\bmcd-menu\b/.test(html)) {
                document.body.classList.add('has-sidebar');
            }
        } catch(e) { console.warn('sidebar load failed', e); }
    })();

    // Helper: generate token that ends with '#'
    function generateGuestToken() {
        const rnd = Math.random().toString(36).substring(2, 10);
        return `guest_${rnd}#`;
    }

    // Fast single-session logout handling
    // If the user logs in elsewhere, the backend will start returning 401 with codes like SESSION_REVOKED.
    // Many pages are mostly static, so we also do a quick /api/auth/me ping on page load.
    (function installSingleSessionGuard(){
        try {
            if (window.__singleSessionGuardInstalled) return;
            window.__singleSessionGuardInstalled = true;

            function safeClearAuthStorage(){
                try { sessionStorage.clear(); } catch(_) {}
                try {
                    // Keep non-auth preferences as-is; clear only auth-ish keys.
                    const keys = ['sessionToken','jwtToken','jwtTokenType','jwt','authToken','accessToken','refreshToken','token'];
                    keys.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
                } catch(_) {}
            }

            function forceLoginRedirect(reason){
                // If we're already on the login page, do NOT redirect again.
                // Redirecting to /login?_ts=... causes a reload loop and can trigger rate-limits.
                try {
                    const path = (window.location.pathname || '').replace(/\/+$/, '');
                    const isLogin = (path === '/login' || path === '/login.html');
                    if (isLogin) {
                        try { safeClearAuthStorage(); } catch(_) {}

                        // Ensure the reason is reflected in the UI/URL without reloading.
                        try {
                            if (reason && modalError) {
                                const ui = authReasonToUi(reason);
                                if (ui && ui.message) {
                                    modalError.textContent = ui.message;
                                    modalError.style.display = 'block';
                                    modalError.style.color = ui.color || '';
                                }
                            }
                        } catch(_) {}

                        try {
                            const loc = window.location;
                            const params = new URLSearchParams(loc.search || '');
                            if (reason) params.set('reason', String(reason));
                            // No cache-buster needed if we aren't navigating
                            params.delete('_ts');
                            const qs = params.toString();
                            const url = (loc.pathname || '/login') + (qs ? ('?' + qs) : '') + (loc.hash || '');
                            window.history.replaceState(null, '', url);
                        } catch(_) {}

                        // Allow future redirects (but without looping)
                        try { sessionStorage.removeItem('forceLogoutInProgress'); } catch(_) {}
                        return;
                    }
                } catch(_) {}

                try {
                    if (sessionStorage.getItem('forceLogoutInProgress') === '1') return;
                    sessionStorage.setItem('forceLogoutInProgress', '1');
                } catch(_) {}

                try { safeClearAuthStorage(); } catch(_) {}
                try {
                    // Best-effort server logout (clears httpOnly cookie)
                    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
                } catch(_) {}

                try {
                    const url = '/login?_ts=' + Date.now() + (reason ? ('&reason=' + encodeURIComponent(reason)) : '');
                    (window.top || window).location.replace(url);
                } catch(_) {
                    try { window.location.href = '/login'; } catch(__) {}
                }
            }

            async function handleAuthFailureForResponse(resp, url){
                try {
                    // Never trigger forced-logout redirects while already on the login page.
                    const path = (window.location.pathname || '').replace(/\/+$/, '');
                    if (path === '/login' || path === '/login.html') return;

                    const isApi = typeof url === 'string' ? url.includes('/api/') : false;
                    if (!isApi) return;
                    if (!(resp && (resp.status === 401 || resp.status === 403))) return;

                    // Skip auth endpoints to avoid loops
                    if (typeof url === 'string' && /\/api\/auth\/(login|verify|register|forgot-password|reset-password)/i.test(url)) return;

                    // Try parse JSON error code without consuming original body
                    let code = '';
                    let msg = '';
                    try {
                        const cloned = resp.clone();
                        const ct = String(cloned.headers.get('content-type') || '');
                        if (ct.includes('application/json')) {
                            const data = await cloned.json();
                            code = String((data && (data.code || data.errorCode)) || '');
                            msg = String((data && (data.message || data.error)) || '');
                        }
                    } catch(_) {}

                    const believedLoggedIn = (function(){
                        try {
                            return !!(localStorage.getItem('userId') || localStorage.getItem('nomeUsuario') || localStorage.getItem('nome'));
                        } catch(_) { return true; }
                    })();

                    const normalized = String(code || '').trim().toUpperCase();
                    const logoutCodes = new Set([
                        'SESSION_REVOKED',
                        'SESSION_NOT_FOUND',
                        'SESSION_SID_MISSING',
                        'JWT_REQUIRED',
                        'SESSION_TOKEN_REQUIRED',
                        'SESSION_TOKEN_OR_AUTH_REQUIRED',
                        'INVALID_TOKEN',
                        'INVALID_TOKEN_PAYLOAD',
                        'USER_NOT_FOUND'
                    ]);

                    const shouldLogout = (
                        (normalized && logoutCodes.has(normalized)) ||
                        // Treat generic 401 on API as auth loss when we believed we were logged-in.
                        // Do NOT treat generic 403 as auth loss (it can be RBAC / email-not-verified / feature gating).
                        (believedLoggedIn && (resp.status === 401))
                    );

                    if (shouldLogout) {
                        const reason = normalized || (resp.status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED');
                        forceLoginRedirect(reason);
                    }
                } catch(_) {}
            }

            // Patch fetch once to detect revoked sessions immediately
            try {
                const originalFetch = window.fetch.bind(window);
                window.fetch = function(input, init){
                    const url = (typeof input === 'string') ? input : (input && input.url ? String(input.url) : '');
                    return originalFetch(input, init).then((resp) => {
                        // Fire-and-forget; do not block the caller
                        handleAuthFailureForResponse(resp, url).catch(() => {});
                        return resp;
                    });
                };
            } catch(_) {}

            // Page-load ping to catch logout even when navigating static pages
            try {
                const path = (window.location.pathname || '').replace(/\/+$/, '');
                const isLogin = (path === '/login' || path === '/login.html');
                if (!isLogin && (navigator.onLine !== false)) {
                    // Only ping when we have some identity stored
                    const hasIdentity = !!(localStorage.getItem('userId') || localStorage.getItem('nomeUsuario') || localStorage.getItem('nome'));
                    const tok = (localStorage.getItem('sessionToken') || localStorage.getItem('jwtToken') || '').trim();
                    const isGuest = !!(tok && tok.endsWith && tok.endsWith('#'));
                    if (hasIdentity && tok && !isGuest) {
                        const ac = new AbortController();
                        const t = setTimeout(() => { try { ac.abort(); } catch(_) {} }, 2500);
                        fetch('/api/auth/me', {
                            method: 'GET',
                            credentials: 'include',
                            headers: (() => {
                                try {
                                    if (window.Auth && typeof window.Auth.getAuthHeaders === 'function') {
                                        return window.Auth.getAuthHeaders({ acceptJson: true });
                                    }
                                } catch(_) {}
                                return { 'X-Session-Token': tok };
                            })(),
                            signal: ac.signal,
                            cache: 'no-store'
                        }).then((resp) => handleAuthFailureForResponse(resp, '/api/auth/me')).catch(() => {}).finally(() => clearTimeout(t));
                    }
                }
            } catch(_) {}
        } catch(_) {}
    })();

    // Helper to read/store JWT for protected APIs (e.g., indicators)
    function saveJwtFromResponse(obj){
        try {
            const tok = obj && obj.token ? String(obj.token) : '';
            const typ = obj && obj.tokenType ? String(obj.tokenType) : 'Bearer';
            if (tok) {
                localStorage.setItem('jwtToken', tok);
                localStorage.setItem('jwtTokenType', typ);
                // Keep backward compatibility with legacy code paths that still read `sessionToken`
                // for API calls: store the JWT there as well.
                localStorage.setItem('sessionToken', tok);
            }
        } catch(_){}
    }
    function getAuthHeaders(){
        try {
            const tok = localStorage.getItem('jwtToken');
            const typ = localStorage.getItem('jwtTokenType') || 'Bearer';
            return tok ? { Authorization: `${typ} ${tok}` } : {};
        } catch(_) { return {}; }
    }
    try { window.getAuthHeaders = getAuthHeaders; } catch(_){}

    // Read session token (if absent, create a guest token).
    // However, if user is clearly registered (we have userId/nomeUsuario/nome) prefer that state.
    let sessionToken = localStorage.getItem('sessionToken');
    // If we have a JWT stored, prefer it for authenticated requests.
    try {
        const jwtTok = (localStorage.getItem('jwtToken') || '').trim();
        if (jwtTok && (!sessionToken || !/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(String(sessionToken || '').trim()))) {
            sessionToken = jwtTok;
            localStorage.setItem('sessionToken', jwtTok);
        }
    } catch(_){ }
    const hasUserId = !!localStorage.getItem('userId');
    const hasNomeUsuario = !!localStorage.getItem('nomeUsuario');
    const hasNome = !!localStorage.getItem('nome');

    // If user appears logged-in and is visiting the site root, redirect to the exam page.
    try {
        // Consider only true landing as root: '/', '' or '/index.html' (avoid matching '/login')
        const isLanding = pathNow === '/' || pathNow === '' || pathNow.endsWith('/index.html');
        const loggedIn = Boolean(hasUserId || hasNomeUsuario || hasNome);
        // treat guest tokens (ending with '#') as not-logged-in
        const isGuest = !!(sessionToken && sessionToken.endsWith('#'));
        const hasSidebar = !!document.getElementById('appSidebar');

        // Diagnostics to help debugging when redirect does not occur
        console.debug('[redirect-check] pathNow=', pathNow, 'isLanding=', isLanding, 'loggedIn=', loggedIn, 'isGuest=', isGuest, 'hasSidebar=', hasSidebar);

        if (isLanding) {
            // Não redirecionar mais a partir da index (home). Mantém usuário na página inicial.
            // Importante: não sair da função para permitir que o restante da inicialização ocorra
            // (ex.: exposição de funções globais para o card Simulador).
        }
    } catch (e) { console.warn('redirect check failed', e); }

    // Normalize: if token looks like a guest (ends with '#') but we have a real identity stored, switch to JWT if available
    try {
        if (sessionToken && sessionToken.endsWith('#') && (hasUserId || hasNomeUsuario || hasNome)) {
            const jwtTok = (localStorage.getItem('jwtToken') || '').trim();
            const alt = jwtTok || (localStorage.getItem('nomeUsuario') || localStorage.getItem('nome') || '');
            if (alt) { sessionToken = alt; localStorage.setItem('sessionToken', alt); }
        }
    } catch(e) { /* ignore */ }

    if (!sessionToken) {
        // create guest token only if we don't already have registration info
        if (!hasUserId && !hasNomeUsuario && !hasNome) {
            sessionToken = generateGuestToken();
            localStorage.setItem('sessionToken', sessionToken);
            console.log('Criado token de sessão:', sessionToken);
        } else {
            // if we have registration info but sessionToken is missing, prefer nomeUsuario
            sessionToken = localStorage.getItem('nomeUsuario') || localStorage.getItem('nome') || '';
            if (sessionToken) localStorage.setItem('sessionToken', sessionToken);
        }
    }

    // Do NOT mirror session tokens into a JS-managed cookie.
    // The backend issues an httpOnly `sessionToken` cookie on login; writing it from JS can create
    // duplicate cookies and break authentication.

    // Try to sync BloqueioAtivado early (best-effort). This will populate localStorage for UI that reads it.
    if (sessionToken && !(sessionToken && sessionToken.endsWith('#'))) {
        syncBloqueioFromServer(sessionToken).catch(e => console.warn('early syncBloqueio failed', e));
        // start polling so purchases update while the user is on the site
        try { startBloqueioPolling(sessionToken); } catch(e) { console.warn('start polling failed', e); }
    }

    // Determine whether to force registration modal.
    // Old behavior: show modal when token endsWith('#').
    // New: on home (index.html) with sidebar, DO NOT redirect to /login and do not force modal; show as visitante.
    (function(){
        // Early auth guard: redirect any unauthenticated/guest session to login
        try {
            const path = (window.location.pathname || '').replace(/\/+$/, '');
            const isLogin = (path === '/login' || path === '/login.html');
            if (!isLogin) {
                const token = (function(){
                    try { return (localStorage.getItem('sessionToken') || localStorage.getItem('jwtToken') || '').trim(); } catch(_) { return (localStorage.getItem('sessionToken') || '').trim(); }
                })();
                const hasIdentity = (function(){
                    try {
                        const uId = localStorage.getItem('userId');
                        const nome = localStorage.getItem('nomeUsuario') || localStorage.getItem('nome');
                        return !!(uId || nome);
                    } catch(_) { return false; }
                })();
                const isGuest = !!(token && token.endsWith('#'));
                const isEmpty = !token;
                if (isEmpty || isGuest || !hasIdentity) {
                    try { sessionStorage.clear(); } catch(_){}
                    const url = '/login?_ts=' + Date.now();
                    try { (window.top || window).location.replace(url); } catch(_) { window.location.replace(url); }
                    return; // stop further script execution
                }
            }
        } catch(_) { /* ignore */ }
        const guestUnregistered = (sessionToken && sessionToken.endsWith('#')) && !hasUserId && !hasNomeUsuario && !hasNome;
        const pathNow = window.location.pathname || '';
        const isLanding = pathNow === '/' || pathNow === '' || pathNow.endsWith('/index.html');
        const hasSidebar = !!document.getElementById('appSidebar');

        if (guestUnregistered) {
            if (isLanding) {
                // Na index, não força modal e não redireciona mais
                setStatus('Visitante');
                try { showUserHeader('Visitante'); } catch(_){}
                return;
            }
            // Fora da index, manter comportamento anterior (mostrar modal ou redirecionar)
            setStatus('Usuário não registrado — registro obrigatório.');
            if (modal) {
                showEmailModal();
            } else {
                try { sessionStorage.setItem('postLoginRedirect', window.location.href); } catch(_){ }
                const currentUrl = safeRedirect.validateRedirect(window.location.href, '/');
                window.location.assign('/login?redirect=' + encodeURIComponent(currentUrl));
                return;
            }
        } else {
            const displayedName = localStorage.getItem('nome') || localStorage.getItem('nomeUsuario') || sessionToken || '';
            setStatus(displayedName ? `Usuário: ${displayedName}` : '');
            try { showUserHeader(displayedName); } catch(e) { /* showUserHeader may be defined later */ }
        }
    })();

    function showEmailModal() {
        if (!modal) return;
        // default to register mode when opening modal
        if (!modal.getAttribute('data-mode')) modal.setAttribute('data-mode', 'register');
        // Ensure the modal is interactive even if it was previously closed with `inert`
        try { modal.removeAttribute('inert'); } catch(_){ }
        try { modal.setAttribute('aria-hidden', 'false'); } catch(_){ }
        // Prefer centralized a11y open handler (restores focusability)
        try {
            if (typeof ModalA11y !== 'undefined' && ModalA11y && typeof ModalA11y.open === 'function') {
                ModalA11y.open(modal);
            } else {
                modal.style.display = 'flex';
            }
        } catch(_){
            modal.style.display = 'flex';
        }
        // ensure UI matches mode
        setModalMode(modal.getAttribute('data-mode') || 'register');
    }

    function setModalMode(mode){
        if (!modal) return;
        modal.setAttribute('data-mode', mode);
        const titleEl = modal.querySelector('h2');
        const descEl = modal.querySelector('p');
        if (mode === 'login'){
            // hide name field
            if (nameInput) nameInput.style.display = 'none';
            if (usernameInput) {
                usernameInput.style.display = '';
                usernameInput.placeholder = 'Usuário ou e-mail';
            }
            if (emailInput) emailInput.style.display = 'none';
            if (verifyTokenInput) verifyTokenInput.style.display = 'none';
            if (newPasswordInput) newPasswordInput.style.display = 'none';
            if (confirmPasswordInput) confirmPasswordInput.style.display = 'none';
            if (passwordInput) passwordInput.style.display = '';
            if (confirmPasswordInput) confirmPasswordInput.value = '';
            if (forgotPasswordLink) forgotPasswordLink.style.display = 'block';
            if (titleEl) titleEl.textContent = 'Entrar';
            if (descEl) descEl.textContent = 'Informe seu usuário (NomeUsuario) ou e-mail e sua senha para entrar.';
            if (submitBtn) submitBtn.textContent = 'Entrar';
            if (toggleModeBtn) toggleModeBtn.textContent = 'Criar conta';
            if (modalError) { modalError.style.display = 'none'; modalError.style.color = ''; }
            if (usernameInput) usernameInput.focus();
        } else if (mode === 'expired-password') {
            if (nameInput) nameInput.style.display = 'none';
            if (usernameInput) {
                usernameInput.style.display = '';
                usernameInput.placeholder = 'Usuário ou e-mail';
            }
            if (emailInput) emailInput.style.display = 'none';
            if (verifyTokenInput) verifyTokenInput.style.display = 'none';
            if (passwordInput) passwordInput.style.display = '';
            if (newPasswordInput) newPasswordInput.style.display = '';
            if (confirmPasswordInput) confirmPasswordInput.style.display = '';
            if (confirmPasswordInput) confirmPasswordInput.placeholder = 'Confirmar nova senha';
            if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
            if (titleEl) titleEl.textContent = 'Senha expirada';
            if (descEl) descEl.textContent = 'Sua senha expirou. Defina uma nova senha para continuar.';
            if (submitBtn) submitBtn.textContent = 'Alterar senha';
            if (toggleModeBtn) toggleModeBtn.textContent = 'Voltar ao login';
            if (modalError) { modalError.style.display = 'none'; modalError.style.color = ''; }
            try { if (newPasswordInput) newPasswordInput.value = ''; } catch(_){ }
            try { if (confirmPasswordInput) confirmPasswordInput.value = ''; } catch(_){ }
            if (newPasswordInput) newPasswordInput.focus();
        } else if (mode === 'forgot-password') {
            // Modo: solicitar reset de senha
            if (nameInput) nameInput.style.display = 'none';
            if (usernameInput) usernameInput.style.display = 'none';
            if (emailInput) emailInput.style.display = '';
            if (passwordInput) passwordInput.style.display = 'none';
            if (verifyTokenInput) verifyTokenInput.style.display = 'none';
            if (newPasswordInput) newPasswordInput.style.display = 'none';
            if (confirmPasswordInput) confirmPasswordInput.style.display = 'none';
            if (confirmPasswordInput) confirmPasswordInput.value = '';
            if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
            if (titleEl) titleEl.textContent = 'Recuperar Senha';
            if (descEl) descEl.textContent = 'Informe seu e-mail para receber o código de recuperação.';
            if (submitBtn) submitBtn.textContent = 'Enviar Código';
            if (toggleModeBtn) toggleModeBtn.textContent = 'Voltar ao login';
            if (modalError) { modalError.style.display = 'none'; modalError.style.color = ''; }
            if (emailInput) emailInput.focus();
        } else if (mode === 'reset-password') {
            // Modo: informar código e nova senha
            if (nameInput) nameInput.style.display = 'none';
            if (usernameInput) usernameInput.style.display = 'none';
            if (emailInput) emailInput.style.display = '';
            if (passwordInput) passwordInput.style.display = 'none';
            if (verifyTokenInput) verifyTokenInput.style.display = '';
            if (newPasswordInput) newPasswordInput.style.display = '';
            if (confirmPasswordInput) confirmPasswordInput.style.display = '';
            if (confirmPasswordInput) confirmPasswordInput.placeholder = 'Confirmar nova senha';
            if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
            if (titleEl) titleEl.textContent = 'Redefinir Senha';
            if (descEl) descEl.textContent = 'Informe o código recebido por e-mail e sua nova senha.';
            if (submitBtn) submitBtn.textContent = 'Redefinir Senha';
            if (toggleModeBtn) toggleModeBtn.textContent = 'Voltar ao login';
            if (modalError) { modalError.style.display = 'none'; modalError.style.color = ''; }
            if (verifyTokenInput) verifyTokenInput.focus();
        } else {
            // register
            if (nameInput) nameInput.style.display = '';
            if (usernameInput) {
                usernameInput.style.display = '';
                usernameInput.placeholder = 'Usuário (ex.: joao)';
            }
            if (emailInput) emailInput.style.display = '';
            if (passwordInput) passwordInput.style.display = '';
            if (verifyTokenInput) verifyTokenInput.style.display = 'none';
            if (newPasswordInput) newPasswordInput.style.display = 'none';
            if (confirmPasswordInput) confirmPasswordInput.style.display = '';
            if (confirmPasswordInput) confirmPasswordInput.placeholder = 'Confirmar senha';
            if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
            if (titleEl) titleEl.textContent = 'Registro obrigatório';
            if (descEl) descEl.textContent = 'Por favor, informe seu nome, usuário, e-mail e senha para registrar o aplicativo.';
            if (submitBtn) submitBtn.textContent = 'Registrar';
            if (toggleModeBtn) toggleModeBtn.textContent = 'Já tenho conta';
            if (modalError) { modalError.style.display = 'none'; modalError.style.color = ''; }
            if (nameInput) nameInput.focus();
        }
    }

    function setModalVerifyMode(){
        if (!modal) return;
        modal.setAttribute('data-mode', 'verify');
        const titleEl = modal.querySelector('h2');
        const descEl = modal.querySelector('p');
        if (nameInput) nameInput.style.display = 'none';
        if (emailInput) emailInput.style.display = 'none';
        if (usernameInput) {
            usernameInput.style.display = '';
            usernameInput.placeholder = 'Usuário ou e-mail';
        }
        if (passwordInput) passwordInput.style.display = '';
        if (verifyTokenInput) verifyTokenInput.style.display = '';
        if (newPasswordInput) newPasswordInput.style.display = 'none';
        if (confirmPasswordInput) confirmPasswordInput.style.display = 'none';
        if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
        if (titleEl) titleEl.textContent = 'Verificação de e-mail';
        if (descEl) descEl.textContent = 'Informe seu usuário (NomeUsuario) ou e-mail e o código enviado, e clique em Validar.';
        if (submitBtn) submitBtn.textContent = 'Validar';
        if (toggleModeBtn) toggleModeBtn.textContent = 'Já tenho conta';
        if (verifyTokenInput) verifyTokenInput.focus();
    }

    // Header UI for logged-in user
    const userHeader = document.getElementById('userHeader');
    const userNameHeader = document.getElementById('userNameHeader');

    function showUserHeader(name) {
        if (!name) return hideUserHeader();
        if (userNameHeader) userNameHeader.textContent = name;
        if (userHeader) userHeader.style.display = 'block';
    }

    function hideUserHeader() {
        if (userNameHeader) userNameHeader.textContent = '';
        if (userHeader) userHeader.style.display = 'none';
    }

    function hideEmailModal() {
        if (!modal) return;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        if (modalError) modalError.style.display = 'none';
    }

    function validateEmail(email) {
        // Validação simples + bloqueio de domínios reservados (RFC 2606)
        const v = String(email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return false;
        const parts = v.split('@');
        const domain = (parts[1] || '').trim().toLowerCase();
        if (!domain) return false;
        const forbidden = new Set(['example.com', 'example.net', 'example.org']);
        if (forbidden.has(domain)) return false;
        return true;
    }

    function validateName(name) {
        return typeof name === 'string' && name.trim().length >= 2;
    }

    function validateUsername(username) {
        const u = String(username || '').trim().toLowerCase();
        if (u.length < 3 || u.length > 50) return false;
        return /^[a-z0-9_.-]+$/.test(u);
    }

    function looksLikeEmail(s) {
        const v = String(s || '').trim();
        return v.includes('@');
    }

    function validateLoginIdentifier(identifier) {
        const v = String(identifier || '').trim();
        if (!v) return false;
        if (looksLikeEmail(v)) return validateEmail(v);
        return validateUsername(v);
    }

    function mapVerifyErrorMessage(code, fallbackMessage) {
        const c = String(code || '').trim().toUpperCase();
        const fallback = (fallbackMessage && String(fallbackMessage).trim()) ? String(fallbackMessage).trim() : '';

        // Prefer consistent, user-friendly messages (and avoid leaking whether a user exists).
        if (c === 'USER_NOT_FOUND' || c === 'INVALID_TOKEN') {
            return 'Código ou usuário/e-mail inválido. Confira e tente novamente.';
        }
        if (c === 'TOKEN_EXPIRED') {
            return 'Este código expirou. Solicite um novo código e tente novamente.';
        }
        if (c === 'TOKEN_FORCED_EXPIRED') {
            return 'Este código foi invalidado porque você solicitou um novo. Use o código mais recente.';
        }
        if (c === 'BAD_REQUEST' || c === 'UNPROCESSABLE_ENTITY') {
            return fallback || 'Dados inválidos. Confira e tente novamente.';
        }
        return fallback || 'Não foi possível validar o código. Tente novamente.';
    }

    function mapLoginErrorMessage(code, fallbackMessage) {
        const c = String(code || '').trim().toUpperCase();
        const fallback = (fallbackMessage && String(fallbackMessage).trim()) ? String(fallbackMessage).trim() : '';

        // Avoid account enumeration in common auth failures.
        if (c === 'INVALID_CREDENTIALS') {
            return 'Usuário/e-mail ou senha inválidos.';
        }
        if (c === 'USER_WITHOUT_PASSWORD') {
            return 'Esta conta não possui senha cadastrada. Use "Esqueci minha senha" para definir uma senha.';
        }
        if (c === 'EMAIL_NOT_CONFIRMED') {
            return fallback || 'E-mail não confirmado. Digite o código enviado para seu e-mail.';
        }
        if (c === 'ACCOUNT_LOCKED') {
            return fallback || 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
        }
        if (c === 'PASSWORD_EXPIRED') {
            return fallback || 'Sua senha expirou. Use "Esqueci minha senha" para definir uma nova senha.';
        }
        if (c === 'PASSWORD_EXPIRED_ACCOUNT_RESTRICTED') {
            return fallback || 'Sua senha expirou, mas sua conta está restrita (bloqueada/não confirmada/excluída). Contate o suporte.';
        }
        if (c === 'NEW_PASSWORD_SAME_AS_CURRENT') {
            return fallback || 'A nova senha deve ser diferente da senha atual.';
        }
        if (c === 'TOO_MANY_REQUESTS') {
            return fallback || 'Muitas tentativas. Aguarde e tente novamente.';
        }
        if (c === 'IDENTIFIER_REQUIRED') {
            return 'Informe seu usuário (NomeUsuario) ou e-mail.';
        }
        if (c === 'PASSWORD_REQUIRED') {
            return 'Informe sua senha.';
        }
        return fallback || 'Não foi possível fazer login. Tente novamente.';
    }

    // Hash password with SHA-256 and return hex string
    async function hashPasswordSHA256(password) {
        const enc = new TextEncoder();
        const data = enc.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    async function registerUser(email, nome, nomeUsuario, senhaHash = null) {
        // Build payload exactly as requested
        const now = new Date().toISOString();
        const payload = {
            AccessFailedCount: 0,
            Email: email,
            EmailConfirmado: false,
            BloqueioAtivado: true,
            FimBloqueio: null,
            NomeUsuario: nomeUsuario,
            SenhaHash: senhaHash,
            NumeroTelefone: null,
            Nome: nome,
            ForcarLogin: null,
            DataCadastro: now,
            DataAlteracao: now,
            Excluido: null
        };

        try {
            // Use BACKEND_BASE from config (allows overriding per-environment)
            const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
            const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/users`;
            const res = await fetch(url, {
                method: 'POST',
                headers: (() => {
                    try {
                        if (window.Auth && typeof window.Auth.getAuthHeaders === 'function') {
                            return window.Auth.getAuthHeaders({ contentType: 'application/json', acceptJson: true });
                        }
                    } catch(_) {}
                    return {
                        'Content-Type': 'application/json',
                        'X-Session-Token': sessionToken || ''
                    };
                })(),
                body: JSON.stringify(payload),
            });

            const text = await res.text();
            let data;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }

            if (!res.ok) {
                const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : `${res.status} ${res.statusText}`);
                throw new Error(msg);
            }

            return data;
        } catch (err) {
            throw err;
        }
    }

    // Sync BloqueioAtivado from server (reads /api/auth/me using X-Session-Token)
    async function syncBloqueioFromServer(token) {
        try {
            if (!token) return null;
            const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
            const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/auth/me`;
            const res = await fetch(url, {
                headers: (() => {
                    try {
                        if (window.Auth && typeof window.Auth.getAuthHeaders === 'function') {
                            return window.Auth.getAuthHeaders({ acceptJson: true, extra: { 'X-Session-Token': token } });
                        }
                    } catch(_) {}
                    return { 'X-Session-Token': token };
                })(),
                credentials: 'include'
            });
            if (!res.ok) {
                console.warn('[syncBloqueio] /api/auth/me returned', res.status);
                return null;
            }
            const data = await res.json();
            if (data && typeof data.BloqueioAtivado !== 'undefined') {
                try { localStorage.setItem('BloqueioAtivado', String(Boolean(data.BloqueioAtivado))); } catch(e){}
            }
            return data;
        } catch (e) {
            console.warn('syncBloqueioFromServer error', e);
            return null;
        }
    }

    // Sync meta config limits (freeExamQuestionLimit / fullExamQuestionCount) from server (public endpoint)
    let __metaConfigPromise = null;
    let __freeExamQuestionLimit = 25;
    async function syncMetaConfigLimits() {
        try {
            const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
            const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/meta/config`;
            __metaConfigPromise = __metaConfigPromise || fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            }).then(r => r.ok ? r.json() : null).catch(() => null);
            const cfg = await __metaConfigPromise;
            if (cfg && typeof cfg.freeExamQuestionLimit === 'number' && Number.isFinite(cfg.freeExamQuestionLimit)) {
                __freeExamQuestionLimit = Math.max(1, Math.floor(cfg.freeExamQuestionLimit));
            }
            return cfg;
        } catch (e) {
            return null;
        }
    }

    // apply BloqueioAtivado state to the exam setup modal
    // Semantics: BloqueioAtivado === 'true' means the premium options are BLOCKED/disabled
    function applyBloqueioToModal() {
        try {
            const blocked = localStorage.getItem('BloqueioAtivado') === 'true';
            const pills = document.querySelectorAll('#questionCountPills .option-pill');
            if (pills && pills.length) {
                pills.forEach(p => {
                    const raw = p.getAttribute('data-value');
                    const n = Number(raw);
                    const isPremium = Number.isFinite(n) ? (n > __freeExamQuestionLimit) : false;
                    if (isPremium && blocked) {
                        p.classList.add('disabled');
                        p.setAttribute('aria-disabled', 'true');
                        p.removeAttribute('tabindex');
                        p.classList.remove('selected');
                    } else {
                        p.classList.remove('disabled');
                        p.removeAttribute('aria-disabled');
                        p.setAttribute('tabindex', '0');
                    }
                });
            }
            const selectEl = document.getElementById('questionCountSelect');
            if (selectEl) {
                const opts = Array.from(selectEl.querySelectorAll('option'));
                opts.forEach(opt => {
                    const n = Number(opt.value);
                    const isPremium = Number.isFinite(n) ? (n > __freeExamQuestionLimit) : false;
                    opt.disabled = blocked && isPremium;
                });
            }
        } catch (e) { console.warn('applyBloqueioToModal error', e); }
    }

    // Start polling /api/auth/me periodically to detect purchase state changes
    // Usar var para evitar TDZ quando startBloqueioPolling é chamado antes da declaração
    var _bloqueioPollId = null;
    function startBloqueioPolling(token, intervalMs = 20000) {
        try {
            if (!token || token.endsWith('#')) return;
            // run immediate check then schedule
            (async () => {
                const prev = localStorage.getItem('BloqueioAtivado');
                const data = await syncBloqueioFromServer(token);
                await syncMetaConfigLimits();
                applyBloqueioToModal();
                const now = localStorage.getItem('BloqueioAtivado');
                    if (prev !== now) {
                        // now === 'true' means blocked
                        if (now === 'true') {
                            try { showTemporaryNotification('Opções premium bloqueadas.'); } catch(e){}
                        } else {
                            try { showTemporaryNotification('Opções premium liberadas.'); } catch(e){}
                        }
                    }
            })();

            if (_bloqueioPollId) clearInterval(_bloqueioPollId);
            _bloqueioPollId = setInterval(async () => {
                const prev = localStorage.getItem('BloqueioAtivado');
                const data = await syncBloqueioFromServer(token);
                await syncMetaConfigLimits();
                applyBloqueioToModal();
                const now = localStorage.getItem('BloqueioAtivado');
                if (prev !== now) {
                    if (now === 'true') {
                        showTemporaryNotification('Opções premium bloqueadas.');
                    } else {
                        showTemporaryNotification('Opções premium liberadas.');
                    }
                }
            }, intervalMs);
        } catch (e) { console.warn('startBloqueioPolling error', e); }
    }

    function stopBloqueioPolling(){ if (_bloqueioPollId) clearInterval(_bloqueioPollId); _bloqueioPollId = null; }

    // small helper to show an ephemeral notification at top-right
    function showTemporaryNotification(msg, ms = 4000) {
        try {
            const id = 'simNotification';
            let el = document.getElementById(id);
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.style.position = 'fixed';
                el.style.top = '16px';
                el.style.right = '16px';
                el.style.zIndex = 99999;
                document.body.appendChild(el);
            }
            const n = document.createElement('div');
            n.textContent = msg;
            n.style.background = '#2b6cb0';
            n.style.color = '#fff';
            n.style.padding = '10px 14px';
            n.style.borderRadius = '8px';
            n.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
            n.style.marginTop = '8px';
            el.appendChild(n);
            setTimeout(()=>{ try { n.remove(); } catch(e){} }, ms);
        } catch (e) { console.warn('showTemporaryNotification error', e); }
    }

    // Persistent toast with countdown for lockout
    let _lockoutTimerId = null;
    let _lockoutScope = null; // normalized identifier or 'global'

    function normalizeIdentifierScope(identifier){
        const v = String(identifier || '').trim().toLowerCase();
        return v || null;
    }

    function getLockoutKey(scope){
        const s = String(scope || '').trim().toLowerCase();
        return `lockoutUntil:${s || 'global'}`;
    }

    function clearLockoutUntil(scope){
        try { localStorage.removeItem(getLockoutKey(scope)); } catch(_){ }
    }

    function getLockoutUntil(scope){
        try { return localStorage.getItem(getLockoutKey(scope)); } catch(_){ return null; }
    }

    function setLockoutUntil(scope, untilIso){
        try {
            // Remove legacy global key from older builds
            try { localStorage.removeItem('lockoutUntil'); } catch(_){ }
            localStorage.setItem(getLockoutKey(scope), String(untilIso));
        } catch(_){ }
    }

    function clearLockoutUi(){
        try { if (_lockoutTimerId) clearInterval(_lockoutTimerId); } catch(_){ }
        _lockoutTimerId = null;
        _lockoutScope = null;
        try { const el = document.getElementById('simLockoutToast'); if (el) el.remove(); } catch(_){ }
        try { const inf = document.getElementById('lockoutReleaseTime'); if (inf) inf.remove(); } catch(_){ }
        try { if (submitBtn) submitBtn.disabled = false; } catch(_){ }
    }

    function applyLockoutForScope(scope){
        try {
            const normalizedScope = (scope === 'global') ? 'global' : normalizeIdentifierScope(scope);

            // Prefer per-identifier lockout if we have one.
            const untilStr = normalizedScope ? getLockoutUntil(normalizedScope) : null;
            if (untilStr) {
                const until = new Date(untilStr).getTime();
                if (!Number.isFinite(until)) { clearLockoutUntil(normalizedScope); clearLockoutUi(); return; }
                const now = Date.now();
                if (until > now) {
                    const secLeft = Math.max(1, Math.floor((until - now) / 1000));
                    if (submitBtn) submitBtn.disabled = true;
                    startLockoutCountdown(secLeft, normalizedScope);
                    return;
                }
                clearLockoutUntil(normalizedScope);
            }

            // Fallback to global lockout (rate limit) if present.
            const globalUntilStr = getLockoutUntil('global');
            if (globalUntilStr) {
                const untilG = new Date(globalUntilStr).getTime();
                if (!Number.isFinite(untilG)) { clearLockoutUntil('global'); clearLockoutUi(); return; }
                const nowG = Date.now();
                if (untilG > nowG) {
                    const secLeftG = Math.max(1, Math.floor((untilG - nowG) / 1000));
                    if (submitBtn) submitBtn.disabled = true;
                    startLockoutCountdown(secLeftG, 'global');
                    return;
                }
                clearLockoutUntil('global');
            }

            clearLockoutUi();
        } catch(e) { console.warn('applyLockoutForScope error', e); }
    }

    function startLockoutCountdown(secondsLeft, scope = 'global') {
        try {
            const id = 'simLockoutToast';
            let el = document.getElementById(id);
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.style.position = 'fixed';
                el.style.top = '16px';
                el.style.right = '16px';
                el.style.zIndex = 99999;
                el.style.background = '#c53030';
                el.style.color = '#fff';
                el.style.padding = '12px 16px';
                el.style.borderRadius = '8px';
                el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.18)';
                el.style.display = 'inline-block';
                document.body.appendChild(el);
            }

            function fmt(sec){
                const s = Math.max(0, Math.floor(sec));
                const m = Math.floor(s / 60);
                const r = s % 60;
                return `${m}:${String(r).padStart(2,'0')}`;
            }

            function update(sec){
                const txt = `Conta bloqueada por muitas tentativas. Aguarde ${fmt(sec)} para tentar novamente.`;
                el.textContent = txt;
                if (modalError) {
                    modalError.style.color = 'crimson';
                    modalError.textContent = txt;
                    modalError.style.display = 'block';
                }
                // also show exact release time under the form
                try {
                    const untilIso = getLockoutUntil(scope) || getLockoutUntil('global');
                    const infoEl = ensureLockoutReleaseInfo(untilIso);
                    // no-op if not on login modal
                } catch(_){ }
            }

            // Clear any previous timer
            if (_lockoutTimerId) { try { clearInterval(_lockoutTimerId); } catch(_){ } _lockoutTimerId = null; }

            _lockoutScope = String(scope || 'global').trim().toLowerCase();

            let remaining = Number(secondsLeft || 300);
            // ensure we have a consistent scoped lockoutUntil to display
            try {
                let untilIso = getLockoutUntil(scope);
                if (!untilIso) {
                    untilIso = new Date(Date.now() + remaining * 1000).toISOString();
                    setLockoutUntil(scope, untilIso);
                }
                ensureLockoutReleaseInfo(untilIso);
            } catch(_){ }
            update(remaining);
            _lockoutTimerId = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    try { clearInterval(_lockoutTimerId); } catch(_){}
                    _lockoutTimerId = null;
                    const endedScope = _lockoutScope;
                    _lockoutScope = null;
                    try { el.remove(); } catch(_){ }
                    try { if (endedScope) clearLockoutUntil(endedScope); } catch(_){ }
                    try { const inf = document.getElementById('lockoutReleaseTime'); if (inf) inf.remove(); } catch(_){ }
                    // Only show expiration message if we're still on the same scope.
                    const currentId = normalizeIdentifierScope(usernameInput ? usernameInput.value : '');
                    const currentScope = currentId || 'global';
                    if (modalError && (endedScope === 'global' || endedScope === currentScope)) {
                        modalError.style.color = '#2f855a';
                        modalError.textContent = 'O bloqueio expirou. Você já pode tentar novamente.';
                        modalError.style.display = 'block';
                    }
                    if (submitBtn) submitBtn.disabled = false;
                } else {
                    update(remaining);
                }
            }, 1000);
        } catch (e) { console.warn('startLockoutCountdown error', e); }
    }

    function ensureLockoutReleaseInfo(untilIso){
        try {
            if (!modal) return null;
            const until = untilIso ? new Date(untilIso) : null;
            if (!until || isNaN(until.getTime())) return null;
            // Format local time HH:mm (or locale 24h where applicable)
            const timeStr = until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let info = document.getElementById('lockoutReleaseTime');
            if (!info) {
                info = document.createElement('div');
                info.id = 'lockoutReleaseTime';
                info.style.marginTop = '8px';
                info.style.fontSize = '0.95em';
                info.style.color = '#4a5568';
                // place below modal actions or below modalError if present
                const actions = modal.querySelector('.modal-actions');
                if (actions && actions.parentNode) actions.parentNode.insertBefore(info, actions.nextSibling);
                else if (modalError && modalError.parentNode) modalError.parentNode.insertBefore(info, modalError.nextSibling);
                else modal.appendChild(info);
            }
            info.textContent = `Liberação às ${timeStr}`;
            return info;
        } catch(e) { console.warn('ensureLockoutReleaseInfo error', e); return null; }
    }

    // On load, resume lockout countdown if persisted in localStorage
    function resumeLockoutIfAny(){
        try {
            // Cleanup legacy key from older builds
            try { localStorage.removeItem('lockoutUntil'); } catch(_){ }

            const currentId = normalizeIdentifierScope(usernameInput ? usernameInput.value : '');
            applyLockoutForScope(currentId);
        } catch(e) { console.warn('resumeLockoutIfAny error', e); }
    }

    if (modal && submitBtn && emailInput) submitBtn.addEventListener('click', async () => {
        const email = emailInput ? (emailInput.value && emailInput.value.trim()) : '';
        const nome = nameInput ? (nameInput.value && nameInput.value.trim()) : '';
        const nomeUsuario = usernameInput ? (usernameInput.value && usernameInput.value.trim()) : '';
        const password = passwordInput ? (passwordInput.value || '') : '';

        const confirmPasswordRegister = (confirmPasswordInput && (confirmPasswordInput.value || '')) || '';

        const mode = modal.getAttribute('data-mode') || 'register'; // 'register', 'login', 'forgot-password', 'reset-password', 'expired-password'

        // Basic validations depend on mode
        if (mode === 'login' || mode === 'verify' || mode === 'expired-password') {
            const identifier = nomeUsuario;
            if (!identifier || !validateLoginIdentifier(identifier)) {
                modalError.textContent = 'Informe seu usuário (NomeUsuario) ou e-mail.';
                modalError.style.display = 'block';
                return;
            }
        } else {
            if (!email || !validateEmail(email)) {
                modalError.textContent = 'Informe um e-mail válido (não use domínios de exemplo como example.com).';
                modalError.style.display = 'block';
                return;
            }
        }

        if (mode === 'register') {
            if (!nome || !validateName(nome)) {
                modalError.textContent = 'Informe seu nome completo (mínimo 2 caracteres).';
                modalError.style.display = 'block';
                return;
            }
            if (!nomeUsuario || !validateUsername(nomeUsuario)) {
                modalError.textContent = 'Informe um usuário válido (3–50 chars, a-z, 0-9, _, . ou -).';
                modalError.style.display = 'block';
                return;
            }
            if (!password || password.length < 6) {
                modalError.textContent = 'Informe uma senha com pelo menos 6 caracteres.';
                modalError.style.display = 'block';
                return;
            }
            if (!confirmPasswordRegister || confirmPasswordRegister.length < 6) {
                modalError.textContent = 'Confirme sua senha.';
                modalError.style.display = 'block';
                return;
            }
            if (password !== confirmPasswordRegister) {
                modalError.textContent = 'As senhas não coincidem.';
                modalError.style.display = 'block';
                return;
            }
        } else if (mode === 'forgot-password') {
            // Apenas email necessário
        } else if (mode === 'reset-password') {
            const token = verifyTokenInput ? (verifyTokenInput.value || '').trim() : '';
            const newPassword = newPasswordInput ? (newPasswordInput.value || '') : '';
            const confirmPassword = confirmPasswordInput ? (confirmPasswordInput.value || '') : '';
            
            if (!token || token.length < 6) {
                modalError.textContent = 'Informe o código de verificação recebido por e-mail.';
                modalError.style.display = 'block';
                return;
            }
            if (!newPassword || newPassword.length < 6) {
                modalError.textContent = 'Informe uma nova senha com pelo menos 6 caracteres.';
                modalError.style.display = 'block';
                return;
            }
            if (newPassword !== confirmPassword) {
                modalError.textContent = 'As senhas não coincidem.';
                modalError.style.display = 'block';
                return;
            }
        } else if (mode === 'expired-password') {
            const newPassword = newPasswordInput ? (newPasswordInput.value || '') : '';
            const confirmPassword = confirmPasswordInput ? (confirmPasswordInput.value || '') : '';
            const identifier = nomeUsuario;

            if (!identifier || !validateLoginIdentifier(identifier)) {
                modalError.textContent = 'Informe seu usuário (NomeUsuario) ou e-mail.';
                modalError.style.display = 'block';
                return;
            }
            if (!password) {
                modalError.textContent = 'Informe sua senha atual.';
                modalError.style.display = 'block';
                return;
            }
            if (!newPassword || newPassword.length < 6) {
                modalError.textContent = 'Informe uma nova senha com pelo menos 6 caracteres.';
                modalError.style.display = 'block';
                return;
            }
            if (newPassword !== confirmPassword) {
                modalError.textContent = 'As senhas não coincidem.';
                modalError.style.display = 'block';
                return;
            }
        } else if (mode === 'login') {
            // For login, only require a non-empty password.
            // (Do not block short passwords client-side; let the server respond with INVALID_CREDENTIALS.)
            if (!password) {
                modalError.textContent = 'Informe sua senha.';
                modalError.style.display = 'block';
                return;
            }
        } else if (mode === 'verify') {
            // Password is optional in verify mode (only used for auto-login).
        } else {
            // Fallback for other modes
            if (!password) {
                modalError.textContent = 'Informe sua senha.';
                modalError.style.display = 'block';
                return;
            }
        }

        submitBtn.disabled = true;
        modalError.style.display = 'none';

        try {
            if (mode === 'register') {
                // hash password client-side (SHA-256 hex)
                const senhaHashClient = await hashPasswordSHA256(password);
                // call register with SenhaHash
                const created = await registerUser(email, nome, String(nomeUsuario || '').trim().toLowerCase(), senhaHashClient);

                // After creating account, switch to login mode and ask user to login
                modal.setAttribute('data-mode', 'login');
                submitBtn.textContent = 'Entrar';
                modalError.style.color = 'green';
                modalError.textContent = 'Conta criada. Agora faça login com sua senha.';
                modalError.style.display = 'block';
                if (passwordInput) passwordInput.value = '';
            } else if (mode === 'forgot-password') {
                // Solicitar código de reset de senha
                const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
                const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/auth/forgot-password`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const text = await res.text();
                let data;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
                
                if (!res.ok) {
                    const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : `${res.status} ${res.statusText}`);
                    throw new Error(msg);
                }
                
                // Mudar para modo reset-password
                setModalMode('reset-password');
                modalError.style.color = 'green';
                modalError.textContent = 'Código enviado para seu e-mail. Verifique sua caixa de entrada.';
                modalError.style.display = 'block';
            } else if (mode === 'reset-password') {
                // Resetar senha com código
                const token = verifyTokenInput.value.trim();
                const newPassword = newPasswordInput.value;
                const senhaHashClient = await hashPasswordSHA256(newPassword);
                
                const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
                const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/auth/reset-password`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, token, senhaHash: senhaHashClient })
                });
                const text = await res.text();
                let data;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
                
                if (!res.ok) {
                    const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : `${res.status} ${res.statusText}`);
                    throw new Error(msg);
                }
                
                // Senha resetada com sucesso, voltar para login
                setModalMode('login');
                modalError.style.color = 'green';
                modalError.textContent = 'Senha alterada com sucesso! Agora faça login.';
                modalError.style.display = 'block';
                if (passwordInput) passwordInput.value = '';
            } else if (mode === 'login') {
                // login flow: send Email + SenhaHash (SHA-256 hex client-side)
                const senhaHashClient = await hashPasswordSHA256(password);
                const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
                const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/auth/login`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', // Important: send/receive cookies
                    body: JSON.stringify({ Email: String(nomeUsuario || '').trim().toLowerCase(), SenhaHash: senhaHashClient })
                });
                const text = await res.text();
                let data;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
                if (!res.ok) {
                    const code = (data && typeof data === 'object') ? data.code : null;
                    const msgRaw = (data && data.message) ? data.message : (typeof data === 'string' ? data : `${res.status} ${res.statusText}`);
                    const msg = mapLoginErrorMessage(code, msgRaw);
                    // 403 is used for different auth states (email verify / password expired)
                    // NOTE: backend does NOT expose `details` for 403 in production, so do not rely on canChangeExpiredPassword.
                    if (res.status === 403) {
                        const c = String(code || '').trim().toUpperCase();
                        if (c === 'EMAIL_NOT_CONFIRMED') {
                            setModalVerifyMode();
                            modalError.style.color = 'crimson';
                            modalError.textContent = msg || 'E-mail não confirmado. Verifique seu e-mail para o código.';
                            modalError.style.display = 'block';
                            if (verifyTokenInput) verifyTokenInput.value = '';
                            submitBtn.disabled = false;
                            return;
                        }

                        if (c === 'PASSWORD_EXPIRED') {
                            // Always switch to the expired-password form.
                            setModalMode('expired-password');
                            modalError.style.color = 'crimson';
                            modalError.textContent = msg || 'Sua senha expirou. Defina uma nova senha para continuar.';
                            modalError.style.display = 'block';
                            submitBtn.disabled = false;
                            return;
                        }

                        if (c === 'PASSWORD_EXPIRED_ACCOUNT_RESTRICTED') {
                            // Cannot change via login; ensure we are NOT stuck in verify UI.
                            setModalMode('login');
                            modalError.style.color = 'crimson';
                            modalError.textContent = msg || 'Sua senha expirou, mas sua conta está restrita e não pode alterar a senha no login.';
                            modalError.style.display = 'block';
                            submitBtn.disabled = false;
                            return;
                        }

                        // Fallback for other 403 codes: ensure mode is sane (not stuck in verify).
                        setModalMode('login');
                        modalError.style.color = 'crimson';
                        modalError.textContent = msg || 'Acesso negado.';
                        modalError.style.display = 'block';
                        submitBtn.disabled = false;
                        return;
                    }
                    // Lockout policy: show toast with live countdown and disable login until expiry
                    if (res.status === 423 || res.status === 429) {
                        try {
                            const secLeft = (data && typeof data.lockoutSecondsLeft === 'number') ? Math.max(1, Math.floor(data.lockoutSecondsLeft)) : 300;
                            if (submitBtn) submitBtn.disabled = true;
                            // persist lockout until to survive reloads
                            try {
                                const untilIso = (data && data.lockoutUntil) ? String(data.lockoutUntil) : new Date(Date.now() + secLeft * 1000).toISOString();
                                const scope = (res.status === 423) ? normalizeIdentifierScope(nomeUsuario) : 'global';
                                setLockoutUntil(scope || 'global', untilIso);
                                ensureLockoutReleaseInfo(untilIso);
                            } catch(_){ }
                            const scope2 = (res.status === 423) ? (normalizeIdentifierScope(nomeUsuario) || 'global') : 'global';
                            startLockoutCountdown(secLeft, scope2);
                        } catch(_){}
                        return;
                    }
                    throw new Error(msg);
                }

                const user = data;
                // persist JWT if provided
                saveJwtFromResponse(user);
                const nomeUsuarioStored = user.NomeUsuario || user.Email || String(nomeUsuario || '').trim().toLowerCase() || email;
                const userId = user.Id || user.id || null;
                const nomeReal = user.Nome || user.NomeUsuario || nomeUsuarioStored;

                // Token is now stored in httpOnly cookie by the server
                // We only store non-sensitive user info in sessionStorage for UI purposes
                sessionStorage.setItem('userId', userId);
                sessionStorage.setItem('userName', nomeUsuarioStored);
                sessionStorage.setItem('userEmail', user.Email || email);
                sessionStorage.setItem('userRealName', nomeReal);
                
                // Keep backward compatibility: store username in localStorage for non-sensitive features
                // But NEVER store tokens here anymore
                localStorage.setItem('nomeUsuario', nomeUsuarioStored);
                if (userId) localStorage.setItem('userId', String(userId));
                localStorage.setItem('nomeUsuario', nomeUsuarioStored);
                if (nomeReal) localStorage.setItem('nome', nomeReal);

                // synchronize BloqueioAtivado from server and store in localStorage
                try { await syncBloqueioFromServer(nomeUsuarioStored); } catch(e) { console.warn('syncBloqueio error', e); }

                setStatus(`Logado como ${nomeReal}`);
                showUserHeader(nomeReal);
                hideEmailModal();

                // redirect to pre-login destination or default (with validation)
                try {
                    const params = new URLSearchParams(window.location.search || '');
                    const redirectParam = params.get('redirect');
                    let target = null;
                    if (redirectParam) {
                        // Validate redirect parameter
                        target = safeRedirect.validateRedirect(decodeURIComponent(redirectParam), null);
                    }
                    if (!target) {
                        try {
                            const sessionRedirect = sessionStorage.getItem('postLoginRedirect');
                            if (sessionRedirect) {
                                target = safeRedirect.validateRedirect(sessionRedirect, null);
                            }
                        } catch(_){ }
                    }
                    // If target points to examSetup without explicit intent, prefer home
                    try {
                        const hasStartFlag = sessionStorage.getItem('startExam') === 'true';
                        if (target && !hasStartFlag) {
                            try {
                                const u = new URL(target, window.location.origin);
                                if (u.pathname === '/pages/examSetup.html') target = '/';
                            } catch(_){
                                if (typeof target === 'string' && target.split('?')[0] === '/pages/examSetup.html') target = '/';
                            }
                        }
                    } catch(_){ }
                    if (!target) target = '/';
                    try { sessionStorage.removeItem('postLoginRedirect'); } catch(_){ }
                    safeRedirect.safeRedirect(target, '/');
                } catch (e) { console.warn('Erro redirect login:', e); }
            }
            else if (mode === 'verify') {
                // verify token flow
                const token = verifyTokenInput && verifyTokenInput.value && verifyTokenInput.value.trim();
                if (!token || token.length < 6) {
                    modalError.textContent = 'Informe o código de verificação recebido por e-mail.';
                    modalError.style.display = 'block';
                    submitBtn.disabled = false;
                    return;
                }
                const identifier = String(nomeUsuario || '').trim().toLowerCase();
                const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
                const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/auth/verify`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, identifier })
                });
                const text = await res.text();
                let data;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
                if (!res.ok) {
                    const code = (data && typeof data === 'object') ? data.code : null;
                    const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : `${res.status} ${res.statusText}`);
                    throw new Error(mapVerifyErrorMessage(code, msg));
                }

                // verified successfully. Attempt auto-login if password is present, otherwise switch to login mode
                modalError.style.color = 'green';
                modalError.textContent = 'E-mail confirmado com sucesso.';
                modalError.style.display = 'block';
                // try auto-login if we have password in the field
                if (password && password.length >= 6) {
                    const senhaHashClient = await hashPasswordSHA256(password);
                    const loginUrl = `${SIMULADOS_CONFIG.BACKEND_BASE.replace(/\/$/, '')}/api/auth/login`;
                    const r2 = await fetch(loginUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ Email: identifier, SenhaHash: senhaHashClient })
                    });
                    const txt2 = await r2.text();
                    let data2;
                    try { data2 = txt2 ? JSON.parse(txt2) : null; } catch (e) { data2 = txt2; }
                    if (!r2.ok) {
                        const code2 = (data2 && typeof data2 === 'object') ? data2.code : null;
                        const msgRaw2 = (data2 && data2.message) ? data2.message : (typeof data2 === 'string' ? data2 : `${r2.status} ${r2.statusText}`);

                        // Respect lockout/rate-limit signals even on auto-login.
                        if (r2.status === 423 || r2.status === 429) {
                            try {
                                const secLeft = (data2 && typeof data2.lockoutSecondsLeft === 'number') ? Math.max(1, Math.floor(data2.lockoutSecondsLeft)) : 300;
                                if (submitBtn) submitBtn.disabled = true;
                                try {
                                    const untilIso = (data2 && data2.lockoutUntil) ? String(data2.lockoutUntil) : new Date(Date.now() + secLeft * 1000).toISOString();
                                    const scope = (r2.status === 423) ? (normalizeIdentifierScope(identifier) || 'global') : 'global';
                                    setLockoutUntil(scope, untilIso);
                                    ensureLockoutReleaseInfo(untilIso);
                                } catch(_){ }
                                const scope2 = (r2.status === 423) ? (normalizeIdentifierScope(identifier) || 'global') : 'global';
                                startLockoutCountdown(secLeft, scope2);
                                modalError.style.color = 'crimson';
                                modalError.textContent = mapLoginErrorMessage(code2, msgRaw2);
                                modalError.style.display = 'block';
                                return;
                            } catch(_){
                                throw new Error(mapLoginErrorMessage(code2, msgRaw2));
                            }
                        }

                        throw new Error(mapLoginErrorMessage(code2, msgRaw2));
                    }
                    // behave as successful login
                    const user = data2;
                    // persist JWT if provided
                    saveJwtFromResponse(user);
                    const nomeUsuarioStored = user.NomeUsuario || user.Email || nomeUsuario || email;
                    const userId = user.Id || user.id || null;
                    const nomeReal = user.Nome || user.NomeUsuario || nomeUsuarioStored;

                    if (userId) localStorage.setItem('userId', String(userId));
                    localStorage.setItem('nomeUsuario', nomeUsuarioStored);
                    if (nomeReal) localStorage.setItem('nome', nomeReal);

                    // synchronize BloqueioAtivado from server and store in localStorage
                    try { await syncBloqueioFromServer(nomeUsuarioStored); } catch(e) { console.warn('syncBloqueio error', e); }

                    setStatus(`Logado como ${nomeReal}`);
                    showUserHeader(nomeReal);
                    hideEmailModal();

                    // redirect to pre-login destination or default (with validation)
                    try {
                        const params = new URLSearchParams(window.location.search || '');
                        const redirectParam = params.get('redirect');
                        let target = null;
                        if (redirectParam) {
                            // Validate redirect parameter
                            target = safeRedirect.validateRedirect(decodeURIComponent(redirectParam), null);
                        }
                        if (!target) {
                            try {
                                const sessionRedirect = sessionStorage.getItem('postLoginRedirect');
                                if (sessionRedirect) {
                                    target = safeRedirect.validateRedirect(sessionRedirect, null);
                                }
                            } catch(_){ }
                        }
                        // If target points to examSetup without explicit intent, prefer home
                        try {
                            const hasStartFlag = sessionStorage.getItem('startExam') === 'true';
                            if (target && !hasStartFlag) {
                                try {
                                    const u = new URL(target, window.location.origin);
                                    if (u.pathname === '/pages/examSetup.html') target = '/';
                                } catch(_){
                                    if (typeof target === 'string' && target.split('?')[0] === '/pages/examSetup.html') target = '/';
                                }
                            }
                        } catch(_){ }
                        if (!target) target = '/';
                        try { sessionStorage.removeItem('postLoginRedirect'); } catch(_){ }
                        safeRedirect.safeRedirect(target, '/');
                    } catch (e) { console.warn('Erro redirect login:', e); }
                } else {
                    // switch to login mode so user can enter password
                    setModalMode('login');
                    submitBtn.disabled = false;
                }
            } else if (mode === 'expired-password') {
                const identifier = String(nomeUsuario || '').trim().toLowerCase();
                const newPassword = newPasswordInput ? (newPasswordInput.value || '') : '';

                const currentHash = await hashPasswordSHA256(password);
                const newHash = await hashPasswordSHA256(newPassword);

                const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
                const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/auth/change-expired-password`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ identifier, currentPasswordHash: currentHash, newPasswordHash: newHash })
                });

                const text = await res.text();
                let data;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
                if (!res.ok) {
                    const code = (data && typeof data === 'object') ? data.code : null;
                    const msgRaw = (data && data.message) ? data.message : (typeof data === 'string' ? data : `${res.status} ${res.statusText}`);
                    const msg = mapLoginErrorMessage(code, msgRaw);
                    throw new Error(msg || msgRaw || 'Falha ao alterar senha.');
                }

                setModalMode('login');
                modalError.style.color = 'green';
                modalError.textContent = 'Senha alterada com sucesso! Agora faça login.';
                modalError.style.display = 'block';
                try { if (passwordInput) passwordInput.value = ''; } catch(_){ }
                try { if (newPasswordInput) newPasswordInput.value = ''; } catch(_){ }
                try { if (confirmPasswordInput) confirmPasswordInput.value = ''; } catch(_){ }
            }
        } catch (err) {
            console.error('Erro no fluxo:', err);
            modalError.style.color = 'crimson';
            modalError.textContent = err.message || 'Erro. Tente novamente.';
            modalError.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
        }
    });

    // Optionally allow Enter key inside input
    if (emailInput && submitBtn) emailInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') submitBtn.click(); });
    if (usernameInput && submitBtn) usernameInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') submitBtn.click(); });
    if (passwordInput && submitBtn) passwordInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') submitBtn.click(); });
    if (nameInput && submitBtn) nameInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') submitBtn.click(); });

    // When user changes identifier, lockout must be re-evaluated per account.
    if (usernameInput) {
        usernameInput.addEventListener('input', () => {
            try {
                if (modalError && modalError.style && modalError.style.display === 'block') {
                    // If we were showing a lockout message, clear it; new identifier may be different.
                    const t = String(modalError.textContent || '');
                    if (t.includes('Conta bloqueada') || t.includes('bloqueio')) {
                        modalError.style.display = 'none';
                    }
                }
            } catch(_){ }
            applyLockoutForScope(normalizeIdentifierScope(usernameInput.value));
        });
    }

    // toggle mode button já configurado anteriormente (linha ~731)
    // Expor funções para uso externo (index.html - card Simulador)
    try {
        window.loadExamSetupModal = loadExamSetupModal;
        window.showExamSetupAndRedirect = showExamSetupAndRedirect;
    } catch (_) { /* ignore */ }

    // Resume any existing lockout on page load (login page)
    try {
        const onLoginPage = ((window.location.pathname || '').replace(/\/+$/, '') === '/login' || (window.location.pathname || '').replace(/\/+$/, '') === '/login.html');
        if (onLoginPage && modal) {
            resumeLockoutIfAny();
        }
    } catch(_){ }
});