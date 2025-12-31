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

document.addEventListener('DOMContentLoaded', () => {
    // Initialize SafeRedirect utility
    const safeRedirect = new SafeRedirect();

    // Status banner removido do app — helpers mantidos como no-op para compatibilidade
    const setStatus = () => {};
    const clearStatus = () => {};
    const modal = document.getElementById('emailModal');
    const emailInput = document.getElementById('emailInput');
    const nameInput = document.getElementById('nameInput');
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
            modal.removeAttribute('aria-hidden');
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
    // Example (optional): window.SIMULADOS_CONFIG = { BACKEND_BASE: 'http://localhost:3000', EXAM_PATH: '/pages/exam.html' };
    const SIMULADOS_CONFIG = window.SIMULADOS_CONFIG || {
        BACKEND_BASE: 'http://localhost:3000',
        EXAM_PATH: '/pages/exam.html'
    };

    // Force login modal rendering when on login page, regardless of session state
    try {
        if (onLoginPage && modal) {
            setModalMode('login');
            ModalA11y.open(modal);
            // Clean cache-buster or other query params from URL for aesthetics
            try {
                const loc = window.location;
                if (loc.search && /([?&])_ts=/.test(loc.search)) {
                    const url = loc.origin + (loc.pathname || '/login');
                    window.history.replaceState(null, '', url);
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

    // Wire admin modal open/close if present to enforce a11y rules
    const adminModal = document.getElementById('adminModal');
    const adminModalOpen = document.getElementById('adminModalOpen');
    const adminModalClose = document.getElementById('adminModalClose');
    if (adminModal && adminModalOpen) {
        adminModalOpen.addEventListener('click', (e) => {
            e.preventDefault();
            ModalA11y.open(adminModal);
        });
    }
    if (adminModal && adminModalClose) {
        adminModalClose.addEventListener('click', (e) => {
            e.preventDefault();
            ModalA11y.close(adminModal);
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

    // Helper to read/store JWT for protected APIs (e.g., indicators)
    function saveJwtFromResponse(obj){
        try {
            const tok = obj && obj.token ? String(obj.token) : '';
            const typ = obj && obj.tokenType ? String(obj.tokenType) : 'Bearer';
            if (tok) {
                localStorage.setItem('jwtToken', tok);
                localStorage.setItem('jwtTokenType', typ);
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

    // Normalize: if token looks like a guest (ends with '#') but we have a real identity stored, switch to it
    try {
        if (sessionToken && sessionToken.endsWith('#') && (hasUserId || hasNomeUsuario || hasNome)) {
            const alt = localStorage.getItem('nomeUsuario') || localStorage.getItem('nome') || '';
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

    // Sync session token into a cookie so the server can authorize HTML GETs for admin pages
    try {
        if (sessionToken) {
            // Write cookie for whole site; avoid Secure flag in http; SameSite=Lax for basic CSRF hardening
            document.cookie = `sessionToken=${encodeURIComponent(sessionToken)}; Path=/; SameSite=Lax`;
        }
    } catch (e) { /* ignore cookie errors */ }

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
            if (verifyTokenInput) verifyTokenInput.style.display = 'none';
            if (newPasswordInput) newPasswordInput.style.display = 'none';
            if (confirmPasswordInput) confirmPasswordInput.style.display = 'none';
            if (passwordInput) passwordInput.style.display = '';
            if (forgotPasswordLink) forgotPasswordLink.style.display = 'block';
            if (titleEl) titleEl.textContent = 'Entrar';
            if (descEl) descEl.textContent = 'Informe seu e-mail e senha para entrar.';
            if (submitBtn) submitBtn.textContent = 'Entrar';
            if (toggleModeBtn) toggleModeBtn.textContent = 'Criar conta';
            if (modalError) { modalError.style.display = 'none'; modalError.style.color = ''; }
            if (passwordInput) passwordInput.focus();
        } else if (mode === 'forgot-password') {
            // Modo: solicitar reset de senha
            if (nameInput) nameInput.style.display = 'none';
            if (passwordInput) passwordInput.style.display = 'none';
            if (verifyTokenInput) verifyTokenInput.style.display = 'none';
            if (newPasswordInput) newPasswordInput.style.display = 'none';
            if (confirmPasswordInput) confirmPasswordInput.style.display = 'none';
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
            if (passwordInput) passwordInput.style.display = 'none';
            if (verifyTokenInput) verifyTokenInput.style.display = '';
            if (newPasswordInput) newPasswordInput.style.display = '';
            if (confirmPasswordInput) confirmPasswordInput.style.display = '';
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
            if (passwordInput) passwordInput.style.display = '';
            if (verifyTokenInput) verifyTokenInput.style.display = 'none';
            if (newPasswordInput) newPasswordInput.style.display = 'none';
            if (confirmPasswordInput) confirmPasswordInput.style.display = 'none';
            if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
            if (titleEl) titleEl.textContent = 'Registro obrigatório';
            if (descEl) descEl.textContent = 'Por favor, informe seu nome, e-mail e senha para registrar o aplicativo.';
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
        if (verifyTokenInput) verifyTokenInput.style.display = '';
        if (titleEl) titleEl.textContent = 'Verificação de e-mail';
        if (descEl) descEl.textContent = 'Informe o código enviado para seu e-mail e clique em Validar.';
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
        // simples validação
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function validateName(name) {
        return typeof name === 'string' && name.trim().length >= 2;
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

    async function registerUser(email, nome, senhaHash = null) {
        // Build payload exactly as requested
        const now = new Date().toISOString();
        const payload = {
            AccessFailedCount: 0,
            Email: email,
            EmailConfirmado: false,
            BloqueioAtivado: true,
            FimBloqueio: null,
            NomeUsuario: email,    // token da sessão que será o email
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
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Token': sessionToken || ''
                },
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
            const res = await fetch(url, { headers: { 'X-Session-Token': token }, credentials: 'include' });
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

    // apply BloqueioAtivado state to the exam setup modal
    // Semantics: BloqueioAtivado === 'true' means the premium options are BLOCKED/disabled
    function applyBloqueioToModal() {
        try {
            const blocked = localStorage.getItem('BloqueioAtivado') === 'true';
            const premiumValues = ['100','150','180'];
            const pills = document.querySelectorAll('#questionCountPills .option-pill');
            if (pills && pills.length) {
                pills.forEach(p => {
                    const isPremium = premiumValues.includes(p.getAttribute('data-value'));
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
                premiumValues.forEach(v => {
                    const opt = selectEl.querySelector(`option[value="${v}"]`);
                    if (opt) opt.disabled = blocked;
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
                applyBloqueioToModal();
                const now = localStorage.getItem('BloqueioAtivado');
                    if (prev !== now) {
                        // now === 'true' means blocked
                        if (now === 'true') {
                            try { showTemporaryNotification('Opções premium bloqueadas.'); } catch(e){}
                        } else {
                            try { showTemporaryNotification('Opções 100/150/180 liberadas.'); } catch(e){}
                        }
                    }
            })();

            if (_bloqueioPollId) clearInterval(_bloqueioPollId);
            _bloqueioPollId = setInterval(async () => {
                const prev = localStorage.getItem('BloqueioAtivado');
                const data = await syncBloqueioFromServer(token);
                applyBloqueioToModal();
                const now = localStorage.getItem('BloqueioAtivado');
                if (prev !== now) {
                    if (now === 'true') {
                        showTemporaryNotification('Opções premium bloqueadas.');
                    } else {
                        showTemporaryNotification('Opções 100/150/180 liberadas.');
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
    function startLockoutCountdown(secondsLeft) {
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
                    const untilIso = localStorage.getItem('lockoutUntil');
                    const infoEl = ensureLockoutReleaseInfo(untilIso);
                    // no-op if not on login modal
                } catch(_){ }
            }

            // Clear any previous timer
            if (_lockoutTimerId) { try { clearInterval(_lockoutTimerId); } catch(_){ } _lockoutTimerId = null; }

            let remaining = Number(secondsLeft || 300);
            // ensure we have a consistent lockoutUntil to display
            try {
                let untilIso = localStorage.getItem('lockoutUntil');
                if (!untilIso) {
                    untilIso = new Date(Date.now() + remaining * 1000).toISOString();
                    localStorage.setItem('lockoutUntil', untilIso);
                }
                ensureLockoutReleaseInfo(untilIso);
            } catch(_){ }
            update(remaining);
            _lockoutTimerId = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    try { clearInterval(_lockoutTimerId); } catch(_){}
                    _lockoutTimerId = null;
                    try { el.remove(); } catch(_){ }
                    try { localStorage.removeItem('lockoutUntil'); } catch(_){ }
                    try { const inf = document.getElementById('lockoutReleaseTime'); if (inf) inf.remove(); } catch(_){ }
                    if (modalError) {
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
            const untilStr = localStorage.getItem('lockoutUntil');
            if (!untilStr) return;
            const until = new Date(untilStr).getTime();
            if (!Number.isFinite(until)) { localStorage.removeItem('lockoutUntil'); return; }
            const now = Date.now();
            if (until > now) {
                const secLeft = Math.max(1, Math.floor((until - now) / 1000));
                if (submitBtn) submitBtn.disabled = true;
                startLockoutCountdown(secLeft);
            } else {
                localStorage.removeItem('lockoutUntil');
            }
        } catch(e) { console.warn('resumeLockoutIfAny error', e); }
    }

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
            const currentMode = modal.getAttribute('data-mode') || 'register';
            if (currentMode === 'forgot-password' || currentMode === 'reset-password') {
                setModalMode('login');
            } else if (currentMode === 'login') {
                setModalMode('register');
            } else {
                setModalMode('login');
            }
        });
    }

    if (modal && submitBtn && emailInput) submitBtn.addEventListener('click', async () => {
        const email = emailInput.value && emailInput.value.trim();
        const nome = nameInput.value && nameInput.value.trim();
        const password = passwordInput ? (passwordInput.value || '') : '';

        const mode = modal.getAttribute('data-mode') || 'register'; // 'register', 'login', 'forgot-password', 'reset-password'

        // Basic validations
        if (!email || !validateEmail(email)) {
            modalError.textContent = 'Informe um e-mail válido.';
            modalError.style.display = 'block';
            return;
        }

        if (mode === 'register') {
            if (!nome || !validateName(nome)) {
                modalError.textContent = 'Informe seu nome completo (mínimo 2 caracteres).';
                modalError.style.display = 'block';
                return;
            }
            if (!password || password.length < 6) {
                modalError.textContent = 'Informe uma senha com pelo menos 6 caracteres.';
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
        } else {
            if (!password || password.length < 6) {
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
                const created = await registerUser(email, nome, senhaHashClient);

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
                    body: JSON.stringify({ Email: email, SenhaHash: senhaHashClient })
                });
                const text = await res.text();
                let data;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
                if (!res.ok) {
                    const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : `${res.status} ${res.statusText}`);
                    // If email not confirmed, server returns 403 — switch modal to verify mode and inform user
                    if (res.status === 403) {
                        setModalVerifyMode();
                        modalError.style.color = 'crimson';
                        modalError.textContent = msg || 'E-mail não confirmado. Verifique seu e-mail para o código.';
                        modalError.style.display = 'block';
                        // keep email filled and show verify token input
                        if (verifyTokenInput) verifyTokenInput.value = '';
                        submitBtn.disabled = false;
                        return; // stop login flow here
                    }
                    // Lockout policy: show toast with live countdown and disable login until expiry
                    if (res.status === 423 || res.status === 429) {
                        try {
                            const secLeft = (data && typeof data.lockoutSecondsLeft === 'number') ? Math.max(1, Math.floor(data.lockoutSecondsLeft)) : 300;
                            if (submitBtn) submitBtn.disabled = true;
                            // persist lockout until to survive reloads
                            try {
                                const untilIso = (data && data.lockoutUntil) ? String(data.lockoutUntil) : new Date(Date.now() + secLeft * 1000).toISOString();
                                localStorage.setItem('lockoutUntil', untilIso);
                                ensureLockoutReleaseInfo(untilIso);
                            } catch(_){ }
                            startLockoutCountdown(secLeft);
                        } catch(_){}
                        return;
                    }
                    throw new Error(msg);
                }

                const user = data;
                // persist JWT if provided
                saveJwtFromResponse(user);
                const nomeUsuarioStored = user.NomeUsuario || email;
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
                if (!token) {
                    modalError.textContent = 'Informe o código de verificação recebido por e-mail.';
                    modalError.style.display = 'block';
                    submitBtn.disabled = false;
                    return;
                }
                const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
                const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/auth/verify`;
                const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
                const text = await res.text();
                let data;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
                if (!res.ok) {
                    const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : `${res.status} ${res.statusText}`);
                    throw new Error(msg);
                }

                // verified successfully. Attempt auto-login if password is present, otherwise switch to login mode
                modalError.style.color = 'green';
                modalError.textContent = 'E-mail confirmado com sucesso.';
                modalError.style.display = 'block';
                // try auto-login if we have password in the field
                if (password && password.length >= 6) {
                    const senhaHashClient = await hashPasswordSHA256(password);
                    const loginUrl = `${SIMULADOS_CONFIG.BACKEND_BASE.replace(/\/$/, '')}/api/auth/login`;
                    const r2 = await fetch(loginUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Email: email, SenhaHash: senhaHashClient }) });
                    const txt2 = await r2.text();
                    let data2;
                    try { data2 = txt2 ? JSON.parse(txt2) : null; } catch (e) { data2 = txt2; }
                    if (!r2.ok) {
                        const msg = (data2 && data2.message) ? data2.message : (typeof data2 === 'string' ? data2 : `${r2.status} ${r2.statusText}`);
                        throw new Error(msg);
                    }
                    // behave as successful login
                    const user = data2;
                    // persist JWT if provided
                    saveJwtFromResponse(user);
                    const nomeUsuarioStored = user.NomeUsuario || email;
                    const userId = user.Id || user.id || null;
                    const nomeReal = user.Nome || user.NomeUsuario || nomeUsuarioStored;

                    localStorage.setItem('sessionToken', nomeUsuarioStored);
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
    if (passwordInput && submitBtn) passwordInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') submitBtn.click(); });
    if (nameInput && submitBtn) nameInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') submitBtn.click(); });

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