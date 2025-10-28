document.addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('status');
    const modal = document.getElementById('emailModal');
    const emailInput = document.getElementById('emailInput');
    const nameInput = document.getElementById('nameInput');
    const passwordInput = document.getElementById('passwordInput');
    const verifyTokenInput = document.getElementById('verifyTokenInput');
    const submitBtn = document.getElementById('submitEmail');
    const modalError = document.getElementById('modalError');
    const toggleModeBtn = document.getElementById('toggleModeBtn');

    // Configuration: allow overriding from the page by setting window.SIMULADOS_CONFIG
    // Example (optional): window.SIMULADOS_CONFIG = { BACKEND_BASE: 'http://localhost:3000', EXAM_PATH: '/pages/exam.html' };
    const SIMULADOS_CONFIG = window.SIMULADOS_CONFIG || {
        BACKEND_BASE: 'http://localhost:3000',
        EXAM_PATH: '/pages/exam.html'
    };

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
            s.innerHTML = `<div style="background:#fff;padding:18px 22px;border-radius:8px;display:flex;align-items:center;gap:12px;font-family:system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,0.2)">
                    <svg width=32 height=32 viewBox="0 0 50 50" style="animation:spin 1s linear infinite"><circle cx="25" cy="25" r="20" fill="none" stroke="#2b6cb0" stroke-width="5" stroke-linecap="round" stroke-dasharray="31.4 31.4"/></svg>
                    <div>${message}</div>
                </div>`;
            document.body.appendChild(s);

            const style = document.createElement('style');
            style.id = 'redirectSpinnerStyle';
            style.innerHTML = `@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`;
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
            container.innerHTML = html;
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
                        const premiumValues = ['100','150','200'];

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
                        alert('Selecione a quantidade de questões para iniciar o exame.');
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
                    // show spinner and redirect
                    hideEmailModal(); // ensure email modal hidden
                    hideRedirectSpinner();
                    showRedirectSpinner('Iniciando o simulado...');
                    setTimeout(() => { window.location.href = examUrl; }, 300);
                });
            }

            return document.getElementById('examSetupModal');
        } catch (e) {
            console.warn('Não foi possível carregar examSetup modal:', e);
            return null;
        }
    }

    async function showExamSetupAndRedirect(examUrl) {
        // load modal (if not yet) and show it; store target url on modal
        const modalEl = await loadExamSetupModal();
        if (!modalEl) {
            // fallback to direct redirect if modal can't be loaded
            showRedirectSpinner('Entrando no simulado...');
            setTimeout(()=>{ window.location.href = examUrl; }, 300);
            return;
        }
        modalEl.setAttribute('data-exam-url', examUrl);
        modalEl.style.display = 'flex';
        modalEl.setAttribute('aria-hidden', 'false');
    }

    // Helper: generate token that ends with '#'
    function generateGuestToken() {
        const rnd = Math.random().toString(36).substring(2, 10);
        return `guest_${rnd}#`;
    }

    // Read session token (if absent, create a guest token).
    // However, if user is clearly registered (we have userId/nomeUsuario/nome) prefer that state.
    let sessionToken = localStorage.getItem('sessionToken');
    const hasUserId = !!localStorage.getItem('userId');
    const hasNomeUsuario = !!localStorage.getItem('nomeUsuario');
    const hasNome = !!localStorage.getItem('nome');

    // If user appears logged-in and is visiting the site root, redirect to the exam page.
    try {
        const pathNow = window.location.pathname || '';
        // consider root when pathname is exactly '/', '' or '/index.html' or ends without a folder (no /pages/)
        const isRoot = pathNow === '/' || pathNow === '' || pathNow.endsWith('/index.html') || (!pathNow.includes('/pages/') && pathNow.indexOf('.') === -1);
        const loggedIn = Boolean(hasUserId || hasNomeUsuario || hasNome);
        // treat guest tokens (ending with '#') as not-logged-in
        const isGuest = !!(sessionToken && sessionToken.endsWith('#'));

        // Diagnostics to help debugging when redirect does not occur
        console.debug('[redirect-check] pathNow=', pathNow, 'isRoot=', isRoot, 'loggedIn=', loggedIn, 'isGuest=', isGuest, 'sessionToken=', sessionToken, 'hasUserId=', hasUserId, 'hasNomeUsuario=', hasNomeUsuario, 'hasNome=', hasNome);

        if (isRoot && loggedIn && !isGuest) {
            // Redirect to standalone setup page instead of going straight to the exam
            const setupUrl = './pages/examSetup.html';
            let absoluteUrl;
            try {
                absoluteUrl = new URL(setupUrl, window.location.href).href;
            } catch (e) {
                absoluteUrl = setupUrl;
            }
            console.info('[redirect] user looks logged in — redirecting to', absoluteUrl);
            window.location.replace(absoluteUrl);
            return; // stop further initialization on index
        }
    } catch (e) { console.warn('redirect check failed', e); }

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

    // Try to sync BloqueioAtivado early (best-effort). This will populate localStorage for UI that reads it.
    if (sessionToken && !(sessionToken && sessionToken.endsWith('#'))) {
        syncBloqueioFromServer(sessionToken).catch(e => console.warn('early syncBloqueio failed', e));
        // start polling so purchases update while the user is on the site
        try { startBloqueioPolling(sessionToken); } catch(e) { console.warn('start polling failed', e); }
    }

    // Determine whether to force registration modal.
    // Old behavior: show modal when token endsWith('#').
    // New: only show modal when token endsWith('#') AND we have no other registration hints (userId/nomeUsuario/nome).
    if ((sessionToken && sessionToken.endsWith('#')) && !hasUserId && !hasNomeUsuario && !hasNome) {
        status.style.display = '';
        status.textContent = 'Usuário não registrado — registro obrigatório.';
        showEmailModal();
    } else {
        status.style.display = '';
        const displayedName = localStorage.getItem('nome') || localStorage.getItem('nomeUsuario') || sessionToken || '';
        status.textContent = displayedName ? `Usuário: ${displayedName}` : '';
        try { showUserHeader(displayedName); } catch(e) { /* showUserHeader may be defined later */ }
    }

    function showEmailModal() {
        // default to register mode when opening modal
        if (!modal.getAttribute('data-mode')) modal.setAttribute('data-mode', 'register');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
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
            if (titleEl) titleEl.textContent = 'Entrar';
            if (descEl) descEl.textContent = 'Informe seu e-mail e senha para entrar.';
            if (submitBtn) submitBtn.textContent = 'Entrar';
            if (toggleModeBtn) toggleModeBtn.textContent = 'Criar conta';
            if (modalError) { modalError.style.display = 'none'; modalError.style.color = ''; }
            if (passwordInput) passwordInput.focus();
        } else {
            // register
            if (nameInput) nameInput.style.display = '';
            if (verifyTokenInput) verifyTokenInput.style.display = 'none';
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
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        modalError.style.display = 'none';
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
            const res = await fetch(url, { headers: { 'X-Session-Token': token } });
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
            const premiumValues = ['100','150','200'];
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
    let _bloqueioPollId = null;
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
                            try { showTemporaryNotification('Opções 100/150/200 liberadas.'); } catch(e){}
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
                        showTemporaryNotification('Opções 100/150/200 liberadas.');
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

    submitBtn.addEventListener('click', async () => {
        const email = emailInput.value && emailInput.value.trim();
        const nome = nameInput.value && nameInput.value.trim();
        const password = passwordInput ? (passwordInput.value || '') : '';

        const mode = modal.getAttribute('data-mode') || 'register'; // 'register' or 'login'

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
            } else if (mode === 'login') {
                // login flow: send Email + SenhaHash (SHA-256 hex client-side)
                const senhaHashClient = await hashPasswordSHA256(password);
                const BACKEND_BASE = SIMULADOS_CONFIG.BACKEND_BASE || 'http://localhost:3000';
                const url = `${BACKEND_BASE.replace(/\/$/, '')}/api/auth/login`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
                    throw new Error(msg);
                }

                const user = data;
                const nomeUsuarioStored = user.NomeUsuario || email;
                const userId = user.Id || user.id || null;
                const nomeReal = user.Nome || user.NomeUsuario || nomeUsuarioStored;

                localStorage.setItem('sessionToken', nomeUsuarioStored);
                if (userId) localStorage.setItem('userId', String(userId));
                localStorage.setItem('nomeUsuario', nomeUsuarioStored);
                if (nomeReal) localStorage.setItem('nome', nomeReal);

                // synchronize BloqueioAtivado from server and store in localStorage
                try { await syncBloqueioFromServer(nomeUsuarioStored); } catch(e) { console.warn('syncBloqueio error', e); }

                status.textContent = `Logado como ${nomeReal}`;
                showUserHeader(nomeReal);
                hideEmailModal();

                // redirect to standalone exam setup page
                try {
                    const path = window.location.pathname || '';
                    const onSetupPage = path.includes('/pages/examSetup.html') || path.endsWith('/examSetup.html');
                    if (!onSetupPage) window.location.href = './pages/examSetup.html';
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
                    const nomeUsuarioStored = user.NomeUsuario || email;
                    const userId = user.Id || user.id || null;
                    const nomeReal = user.Nome || user.NomeUsuario || nomeUsuarioStored;

                    localStorage.setItem('sessionToken', nomeUsuarioStored);
                    if (userId) localStorage.setItem('userId', String(userId));
                    localStorage.setItem('nomeUsuario', nomeUsuarioStored);
                    if (nomeReal) localStorage.setItem('nome', nomeReal);

                    // synchronize BloqueioAtivado from server and store in localStorage
                    try { await syncBloqueioFromServer(nomeUsuarioStored); } catch(e) { console.warn('syncBloqueio error', e); }

                    status.textContent = `Logado como ${nomeReal}`;
                    showUserHeader(nomeReal);
                    hideEmailModal();

                    // redirect to standalone exam setup page
                    try {
                        const path = window.location.pathname || '';
                        const onSetupPage = path.includes('/pages/examSetup.html') || path.endsWith('/examSetup.html');
                        if (!onSetupPage) window.location.href = './pages/examSetup.html';
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
    emailInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') submitBtn.click(); });
    if (passwordInput) passwordInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') submitBtn.click(); });
    if (nameInput) nameInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') submitBtn.click(); });

    // toggle mode button (register <-> login)
    if (toggleModeBtn){
        toggleModeBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            const current = modal.getAttribute('data-mode') || 'register';
            const next = current === 'register' ? 'login' : 'register';
            setModalMode(next);
        });
    }
});