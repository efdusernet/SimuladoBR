(function () {
  var loginView = document.getElementById('loginView');
  var appView = document.getElementById('appView');
  var loginHint = document.getElementById('loginHint');
  var loginError = document.getElementById('loginError');

  var apiBaseInput = document.getElementById('apiBase');
  var apiBaseLabel = document.getElementById('apiBaseLabel');
  var tokenInput = document.getElementById('token');
  var nameInput = document.getElementById('name');
  var loadBtn = document.getElementById('load');
  var loginBtn = document.getElementById('login');
  var logoutBtn = document.getElementById('logout');
  var hint = document.getElementById('hint');
  var realtimeStatus = document.getElementById('realtimeStatus');
  var originEl = document.getElementById('origin');
  var convRoot = document.getElementById('conversations');
  var messagesRoot = document.getElementById('messages');
  var statusRoot = document.getElementById('status');
  var replyForm = document.getElementById('reply');
  var textInput = document.getElementById('text');

  var convBar = document.getElementById('convBar');
  var convInfo = document.getElementById('convInfo');
  var renameConvBtn = document.getElementById('renameConv');
  var renameInline = document.getElementById('renameInline');
  var renameInput = document.getElementById('renameInput');
  var renameSaveBtn = document.getElementById('renameSave');
  var renameCancelBtn = document.getElementById('renameCancel');
  var claimConvBtn = document.getElementById('claimConv');
  var releaseConvBtn = document.getElementById('releaseConv');
  var closeConvBtn = document.getElementById('closeConv');

  var refreshAttendantsBtn = document.getElementById('refreshAttendants');
  var attendantsRoot = document.getElementById('attendants');
  var newTokenRoot = document.getElementById('newToken');
  var attendantsSection = document.getElementById('attendantsSection');

  // Modals
  var modalBackdrop = document.getElementById('modalBackdrop');

  var usersModal = document.getElementById('usersModal');
  var usersModalClose = document.getElementById('usersModalClose');
  var modalUserEmail = document.getElementById('modalUserEmail');
  var modalUserName = document.getElementById('modalUserName');
  var modalUserRole = document.getElementById('modalUserRole');
  var modalUserSendEmail = document.getElementById('modalUserSendEmail');
  var modalCreateUserBtn = document.getElementById('modalCreateUser');
  var usersModalMsg = document.getElementById('usersModalMsg');
  var usersModalToken = document.getElementById('usersModalToken');

  var invitesModal = document.getElementById('invitesModal');
  var invitesModalClose = document.getElementById('invitesModalClose');
  var modalInviteRowsRoot = document.getElementById('modalInviteRows');
  var modalInviteAddBtn = document.getElementById('modalInviteAdd');
  var modalInviteSendBtn = document.getElementById('modalInviteSend');
  var modalInviteMsg = document.getElementById('modalInviteMsg');
  var modalInviteResults = document.getElementById('modalInviteResults');

  var topicsModal = document.getElementById('topicsModal');
  var topicsModalClose = document.getElementById('topicsModalClose');
  var topicsNewTitle = document.getElementById('topicsNewTitle');
  var topicsNewMessage = document.getElementById('topicsNewMessage');
  var topicsNewAutoReply = document.getElementById('topicsNewAutoReply');
  var topicsNewActive = document.getElementById('topicsNewActive');
  var topicsNewSortOrder = document.getElementById('topicsNewSortOrder');
  var topicsCreateBtn = document.getElementById('topicsCreate');
  var topicsRefreshBtn = document.getElementById('topicsRefresh');
  var topicsModalMsg = document.getElementById('topicsModalMsg');
  var topicsListRoot = document.getElementById('topicsList');

  var navUsersBtn = document.getElementById('navUsers');
  var navInvitesBtn = document.getElementById('navInvites');
  var navTopicsBtn = document.getElementById('navTopics');
  var navTokensBtn = document.getElementById('navTokens');
  var navSupportBtn = document.getElementById('navSupport');
  var refreshTokensBtn = document.getElementById('refreshTokens');
  var tokensAuditRoot = document.getElementById('tokensAudit');

  var tokenKey = 'chatService:adminToken:' + location.origin;
  var nameKey = 'chatService:adminName:' + location.origin;
  var apiBaseKey = 'chatService:apiBase:' + location.origin;
  var activeConversationId = '';
  var activeConversationCustomerName = '';
  var currentMe = { id: null, name: null, isRoot: false };
  var refreshTimer = null;

  // WebSocket-based refresh (admin panel only)
  var adminWs = null;
  var adminWsAuthed = false;
  var adminWsReconnectTimer = null;
  var adminWsReconnectDelayMs = 1000;
  var adminWsRefreshTimer = null;

  // Cache /me checks to avoid noisy validation calls on bursts of WS events.
  var meCache = { token: '', checkedAtMs: 0, ok: false };

  // Tracks what the attendant has already viewed (per conversation).
  // Used to show "AGUARDANDO" for new user messages.
  var lastSeenMessageMsByConversationId = Object.create(null);
  // Tracks last message timestamp coming from the conversations list.
  var lastKnownMessageMsByConversationId = Object.create(null);

  function normalizeBaseUrl(s) {
    var v = String(s || '').trim();
    if (!v) return '';
    v = v.replace(/\/+$/, '');
    return v;
  }

  function isUnderChatMount() {
    try {
      var p = String(location.pathname || '');
      return (p.indexOf('/chat/') === 0);
    } catch {}
    return false;
  }

  function getHostSessionToken() {
    if (!isUnderChatMount()) return '';
    try {
      var t = localStorage.getItem('sessionToken');
      return t ? String(t).trim() : '';
    } catch {
      return '';
    }
  }

  function getHostSessionHeaders() {
    var t = getHostSessionToken();
    return t ? { 'X-Session-Token': t } : {};
  }

  function coerceApiBaseForChatMount(v) {
    // If this panel is served under SimuladosBR's /chat reverse-proxy mount,
    // the browser CSP (default-src 'self') will block cross-origin fetch calls.
    // Force API base to the same origin (/chat) to avoid persistent CSP errors
    // when a user previously saved/typed http://localhost:4010.
    var raw = normalizeBaseUrl(v);
    if (!isUnderChatMount()) return raw;

    var def = getDefaultApiBase();
    if (!raw) return def;
    try {
      var u = new URL(raw, location.origin);
      if (u.origin !== location.origin) return def;
    } catch {}
    return raw;
  }

  function getDefaultApiBase() {
    // When this admin panel is served through SimuladosBR's reverse proxy under /chat,
    // the API endpoints are also mounted under /chat (e.g. /chat/v1/admin/me).
    // Default to that base automatically to avoid calling /v1/admin/* at the origin root.
    try {
      var p = String(location.pathname || '');
      if (p.indexOf('/chat/') === 0) return normalizeBaseUrl(location.origin + '/chat');
    } catch {}
    return normalizeBaseUrl(location.origin);
  }

  function getApiBase() {
    var v = apiBaseInput ? String(apiBaseInput.value || '').trim() : '';
    v = normalizeBaseUrl(v);
    return coerceApiBaseForChatMount(v);
  }

  function setApiBaseLabel() {
    if (!apiBaseLabel) return;
    apiBaseLabel.textContent = getApiBase();
  }

  function setUiEnabled(enabled) {
    var on = Boolean(enabled);
    if (refreshAttendantsBtn) refreshAttendantsBtn.disabled = !on;
    if (modalUserEmail) modalUserEmail.disabled = !on;
    if (modalUserName) modalUserName.disabled = !on;
    if (modalUserRole) modalUserRole.disabled = !on;
    if (modalUserSendEmail) modalUserSendEmail.disabled = !on;
    if (modalCreateUserBtn) modalCreateUserBtn.disabled = !on;
    if (modalInviteAddBtn) modalInviteAddBtn.disabled = !on;
    if (modalInviteSendBtn) modalInviteSendBtn.disabled = !on;
    if (textInput) textInput.disabled = !on;
    // reply form submit button
    try {
      var btn = replyForm ? replyForm.querySelector('button[type="submit"]') : null;
      if (btn) btn.disabled = !on;
    } catch {}
  }

  function setReplyEnabled(enabled) {
    var on = Boolean(enabled);
    if (textInput) textInput.disabled = !on;
    try {
      var btn = replyForm ? replyForm.querySelector('button[type="submit"]') : null;
      if (btn) btn.disabled = !on;
    } catch {}
  }

  function getToken() {
    var v = (tokenInput.value || '').trim();
    // Accept both raw tokens and values pasted as "Bearer <token>".
    if (/^Bearer\s+/i.test(v)) v = v.replace(/^Bearer\s+/i, '').trim();

    // If the user pasted a full line like "Name (role) — 4fcaf1e3...",
    // extract the 64-hex token substring.
    var m = v.match(/[0-9a-f]{64}/i);
    if (m && m[0]) v = m[0];

    // As a last safety net, remove any non-latin1 chars to avoid browser header errors.
    v = sanitizeHeaderValue(v);
    return v;
  }

  function getName() {
    return (nameInput.value || '').trim();
  }

  function sanitizeHeaderValue(v) {
    // Browsers validate RequestInit.headers values as ByteString (roughly ISO-8859-1).
    // Remove CR/LF and drop any code points > 255 to avoid: "String contains non ISO-8859-1 code point".
    var s = String(v || '').replace(/[\r\n]+/g, ' ').trim();
    if (!s) return '';
    var out = '';
    for (var i = 0; i < s.length; i += 1) {
      var code = s.charCodeAt(i);
      if (code <= 255) out += s[i];
    }
    return out.trim();
  }

  function authHeaders() {
    var t = getToken();
    var h = t ? { Authorization: 'Bearer ' + t } : {};
    var n = getName();
    if (n) h['X-Admin-Name'] = sanitizeHeaderValue(n);
    return h;
  }

  function setError(msg) {
    var m = msg || '';
    if (statusRoot) statusRoot.textContent = m;
    if (loginError) {
      loginError.textContent = m;
      loginError.style.display = m ? 'block' : 'none';
    }
  }

  function setLoginHint(text) {
    if (loginHint) loginHint.textContent = text || '';
  }

  function setHintEverywhere(text) {
    if (hint) hint.textContent = text || '';
    setLoginHint(text);
  }

  function setRealtimeStatus(text) {
    if (!realtimeStatus) return;
    realtimeStatus.textContent = String(text || '');
  }

  function setView(which) {
    var showApp = which === 'app';
    if (loginView) loginView.classList.toggle('hidden', showApp);
    if (appView) appView.classList.toggle('hidden', !showApp);
  }

  function setAdminNavEnabled(canManage) {
    var on = Boolean(canManage);
    [navUsersBtn, navInvitesBtn, navTopicsBtn, navTokensBtn].forEach(function (btn) {
      if (!btn) return;
      btn.disabled = !on;
      btn.style.opacity = on ? '1' : '0.45';
      btn.style.cursor = on ? 'pointer' : 'not-allowed';
      if (!on) btn.title = 'Apenas admin/root';
    });
  }

  function setUsersModalMsg(text) {
    if (!usersModalMsg) return;
    usersModalMsg.textContent = text || '';
  }
  function setInviteModalMsg(text) {
    if (!modalInviteMsg) return;
    modalInviteMsg.textContent = text || '';
  }

  function setTopicsModalMsg(text) {
    if (!topicsModalMsg) return;
    topicsModalMsg.textContent = text || '';
  }

  function openModal(which) {
    if (!modalBackdrop) return;
    modalBackdrop.classList.remove('hidden');
    if (which === 'users' && usersModal) {
      usersModal.classList.remove('hidden');
      if (invitesModal) invitesModal.classList.add('hidden');
      if (topicsModal) topicsModal.classList.add('hidden');
    }
    if (which === 'invites' && invitesModal) {
      invitesModal.classList.remove('hidden');
      if (usersModal) usersModal.classList.add('hidden');
      if (topicsModal) topicsModal.classList.add('hidden');
    }
    if (which === 'topics' && topicsModal) {
      topicsModal.classList.remove('hidden');
      if (usersModal) usersModal.classList.add('hidden');
      if (invitesModal) invitesModal.classList.add('hidden');
    }
  }

  function closeModals() {
    if (modalBackdrop) modalBackdrop.classList.add('hidden');
    if (usersModal) usersModal.classList.add('hidden');
    if (invitesModal) invitesModal.classList.add('hidden');
    if (topicsModal) topicsModal.classList.add('hidden');
  }

  function canManageTopics() {
    return currentMe && (currentMe.role === 'root' || currentMe.role === 'admin');
  }

  function normalizeInt(v, fallback) {
    var n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
  }

  function renderTopicsList(topics) {
    if (!topicsListRoot) return;
    topicsListRoot.innerHTML = '';

    if (!topics || !topics.length) {
      var empty = el('div', { text: 'Nenhum assunto cadastrado ainda.' });
      empty.className = 'small';
      topicsListRoot.appendChild(empty);
      return;
    }

    topics.forEach(function (t) {
      var wrap = el('div');
      wrap.style.border = '1px solid rgba(0,0,0,0.08)';
      wrap.style.borderRadius = '12px';
      wrap.style.padding = '10px';
      wrap.style.marginBottom = '8px';

      var topRow = el('div');
      topRow.className = 'row-inline';
      topRow.style.alignItems = 'center';

      var title = el('input');
      title.type = 'text';
      title.value = t && t.title != null ? String(t.title) : '';
      title.placeholder = 'Título';
      title.style.padding = '8px 10px';
      title.style.border = '1px solid #ccc';
      title.style.borderRadius = '8px';
      title.style.width = '220px';

      var sort = el('input');
      sort.type = 'number';
      sort.value = t && t.sort_order != null ? String(t.sort_order) : '0';
      sort.placeholder = 'Ordem';
      sort.style.padding = '8px 10px';
      sort.style.border = '1px solid #ccc';
      sort.style.borderRadius = '8px';
      sort.style.width = '120px';

      var activeLabel = el('label');
      activeLabel.className = 'small';
      activeLabel.style.display = 'flex';
      activeLabel.style.gap = '6px';
      activeLabel.style.alignItems = 'center';

      var active = el('input');
      active.type = 'checkbox';
      active.checked = Boolean(t && t.active);
      activeLabel.appendChild(active);
      activeLabel.appendChild(document.createTextNode('Ativo'));

      var saveBtn = el('button', { type: 'button' });
      saveBtn.textContent = 'Salvar';
      var delBtn = el('button', { type: 'button' });
      delBtn.textContent = 'Excluir';

      topRow.appendChild(title);
      topRow.appendChild(sort);
      topRow.appendChild(activeLabel);
      topRow.appendChild(saveBtn);
      topRow.appendChild(delBtn);

      var message = el('textarea');
      message.rows = 3;
      message.value = t && t.message_text != null ? String(t.message_text) : '';
      message.placeholder = 'Mensagem (enviada no widget ao clicar)';
      message.style.width = '100%';
      message.style.marginTop = '8px';
      message.style.padding = '8px 10px';
      message.style.border = '1px solid #ccc';
      message.style.borderRadius = '8px';
      message.style.boxSizing = 'border-box';
      message.style.resize = 'vertical';

      var autoReply = el('textarea');
      autoReply.rows = 2;
      autoReply.value = t && t.auto_reply_text != null ? String(t.auto_reply_text) : '';
      autoReply.placeholder = 'Auto-resposta do suporte (opcional)';
      autoReply.style.width = '100%';
      autoReply.style.marginTop = '8px';
      autoReply.style.padding = '8px 10px';
      autoReply.style.border = '1px solid #ccc';
      autoReply.style.borderRadius = '8px';
      autoReply.style.boxSizing = 'border-box';
      autoReply.style.resize = 'vertical';

      var meta = el('div');
      meta.className = 'small';
      meta.style.marginTop = '6px';
      meta.style.opacity = '0.9';
      meta.textContent = 'id: ' + String(t && t.id ? t.id : '');

      saveBtn.addEventListener('click', function () {
        updateSupportTopic(String(t.id), {
          title: String(title.value || '').trim(),
          messageText: String(message.value || '').trim(),
          autoReplyText: String(autoReply.value || '').trim(),
          active: Boolean(active.checked),
          sortOrder: normalizeInt(sort.value, 0),
        });
      });

      delBtn.addEventListener('click', function () {
        var ok = confirm('Excluir este assunto?');
        if (!ok) return;
        deleteSupportTopic(String(t.id));
      });

      wrap.appendChild(topRow);
      wrap.appendChild(message);
      wrap.appendChild(autoReply);
      wrap.appendChild(meta);
      topicsListRoot.appendChild(wrap);
    });
  }

  async function loadSupportTopicsAdmin() {
    setTopicsModalMsg('');
    if (!topicsListRoot) return;

    var ok = await ensureLoggedIn();
    if (!ok) return;
    if (!canManageTopics()) {
      setTopicsModalMsg('Apenas admin/root pode gerenciar assuntos.');
      topicsListRoot.textContent = '';
      return;
    }

    topicsListRoot.textContent = 'Carregando…';
    var r = await api('/v1/admin/support-topics', { method: 'GET', headers: authHeaders() });
    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && (r.json.error || r.json.message)) ? (r.json.error || r.json.message) : ('Falha ao carregar assuntos (HTTP ' + r.status + ')');
      topicsListRoot.textContent = '';
      setTopicsModalMsg(String(msg));
      return;
    }
    renderTopicsList(r.json.topics || []);
  }

  async function createSupportTopic() {
    setTopicsModalMsg('');
    var ok = await ensureLoggedIn();
    if (!ok) return;
    if (!canManageTopics()) {
      setTopicsModalMsg('Apenas admin/root pode criar assuntos.');
      return;
    }

    var title = topicsNewTitle ? String(topicsNewTitle.value || '').trim() : '';
    var messageText = topicsNewMessage ? String(topicsNewMessage.value || '').trim() : '';
    var autoReplyText = topicsNewAutoReply ? String(topicsNewAutoReply.value || '').trim() : '';
    var active = topicsNewActive ? Boolean(topicsNewActive.checked) : true;
    var sortOrder = topicsNewSortOrder ? normalizeInt(topicsNewSortOrder.value, 0) : 0;

    if (!title) {
      setTopicsModalMsg('Informe um título.');
      return;
    }
    if (!messageText) messageText = title;

    var r = await api('/v1/admin/support-topics', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ title: title, messageText: messageText, autoReplyText: autoReplyText || null, active: active, sortOrder: sortOrder }),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && (r.json.error || r.json.message)) ? (r.json.error || r.json.message) : ('Falha ao criar assunto (HTTP ' + r.status + ')');
      setTopicsModalMsg(String(msg));
      return;
    }

    if (topicsNewTitle) topicsNewTitle.value = '';
    if (topicsNewMessage) topicsNewMessage.value = '';
    if (topicsNewAutoReply) topicsNewAutoReply.value = '';
    if (topicsNewSortOrder) topicsNewSortOrder.value = '0';
    if (topicsNewActive) topicsNewActive.checked = true;
    setTopicsModalMsg('Assunto criado.');
    await loadSupportTopicsAdmin();
  }

  async function updateSupportTopic(id, patch) {
    setTopicsModalMsg('');
    var ok = await ensureLoggedIn();
    if (!ok) return;
    if (!canManageTopics()) {
      setTopicsModalMsg('Apenas admin/root pode editar assuntos.');
      return;
    }
    if (!id) {
      setTopicsModalMsg('id inválido');
      return;
    }

    var finalPatch = patch || {};
    if (finalPatch.title != null && !String(finalPatch.title || '').trim()) {
      setTopicsModalMsg('Título inválido.');
      return;
    }
    if (finalPatch.messageText != null && String(finalPatch.messageText || '').trim().length > 2000) {
      setTopicsModalMsg('Mensagem muito longa (máx 2000).');
      return;
    }
    if (finalPatch.autoReplyText != null && String(finalPatch.autoReplyText || '').trim().length > 2000) {
      setTopicsModalMsg('Auto-resposta muito longa (máx 2000).');
      return;
    }

    var r = await api('/v1/admin/support-topics/' + encodeURIComponent(String(id)), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({
        title: finalPatch.title,
        messageText: finalPatch.messageText,
        autoReplyText: finalPatch.autoReplyText,
        active: finalPatch.active,
        sortOrder: finalPatch.sortOrder,
      }),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && (r.json.error || r.json.message)) ? (r.json.error || r.json.message) : ('Falha ao salvar assunto (HTTP ' + r.status + ')');
      setTopicsModalMsg(String(msg));
      return;
    }

    setTopicsModalMsg('Alterações salvas.');
    await loadSupportTopicsAdmin();
  }

  async function deleteSupportTopic(id) {
    setTopicsModalMsg('');
    var ok = await ensureLoggedIn();
    if (!ok) return;
    if (!canManageTopics()) {
      setTopicsModalMsg('Apenas admin/root pode remover assuntos.');
      return;
    }
    if (!id) {
      setTopicsModalMsg('id inválido');
      return;
    }

    var r = await api('/v1/admin/support-topics/' + encodeURIComponent(String(id)), {
      method: 'DELETE',
      headers: authHeaders(),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && (r.json.error || r.json.message)) ? (r.json.error || r.json.message) : ('Falha ao excluir assunto (HTTP ' + r.status + ')');
      setTopicsModalMsg(String(msg));
      return;
    }

    setTopicsModalMsg('Assunto removido.');
    await loadSupportTopicsAdmin();
  }

  function clearDataViews() {
    convRoot.innerHTML = '';
    messagesRoot.textContent = '';
    attendantsRoot.textContent = '';
    newTokenRoot.textContent = '';
    if (tokensAuditRoot) tokensAuditRoot.textContent = '';
    activeConversationId = '';
    if (convBar) convBar.style.display = 'none';
    if (convInfo) convInfo.textContent = '';
    if (renameInline) renameInline.classList.add('hidden');
    if (renameConvBtn) renameConvBtn.classList.remove('hidden');
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      try { clearInterval(refreshTimer); } catch {}
      refreshTimer = null;
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(function () {
      refreshTick();
    }, 3500);
  }

  function safeJsonParse(text) {
    try {
      var v = JSON.parse(String(text || ''));
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  }

  function getAdminWsUrl() {
    var base = getApiBase();
    try {
      var u = new URL(String(base || ''), location.origin);
      var proto = (u.protocol === 'https:') ? 'wss:' : 'ws:';
      var pathBase = String(u.pathname || '').replace(/\/+$/, '');
      var wsUrl = proto + '//' + u.host + (pathBase || '') + '/v1/admin/ws';
      var st = getHostSessionToken();
      if (st) {
        try {
          var wu = new URL(wsUrl);
          wu.searchParams.set('sessionToken', st);
          wsUrl = wu.toString();
        } catch {}
      }
      return wsUrl;
    } catch {
      return '';
    }
  }

  function stopAdminWebSocket() {
    adminWsAuthed = false;

    // If WS is explicitly stopped (logout/navigation), clear any status.
    setRealtimeStatus('');

    if (adminWsReconnectTimer) {
      try { clearTimeout(adminWsReconnectTimer); } catch {}
      adminWsReconnectTimer = null;
    }
    if (adminWsRefreshTimer) {
      try { clearTimeout(adminWsRefreshTimer); } catch {}
      adminWsRefreshTimer = null;
    }

    if (adminWs) {
      try { adminWs.close(); } catch {}
      adminWs = null;
    }
  }

  function scheduleWsReconnect() {
    if (adminWsReconnectTimer) return;
    adminWsReconnectTimer = setTimeout(function () {
      adminWsReconnectTimer = null;
      // Only reconnect if the app view is visible.
      var showApp = appView && !appView.classList.contains('hidden');
      if (!showApp) return;

      // Token might have been cleared.
      if (!getToken()) return;

      startAdminWebSocket();

      // Exponential backoff (capped).
      adminWsReconnectDelayMs = Math.min(adminWsReconnectDelayMs * 2, 10000);
    }, adminWsReconnectDelayMs);
  }

  function scheduleRefreshTick() {
    // debounce refresh storms when multiple events arrive quickly
    if (adminWsRefreshTimer) {
      try { clearTimeout(adminWsRefreshTimer); } catch {}
      adminWsRefreshTimer = null;
    }
    adminWsRefreshTimer = setTimeout(function () {
      adminWsRefreshTimer = null;
      refreshTick();
    }, 120);
  }

  function startAdminWebSocket() {
    stopAdminWebSocket();

    var url = getAdminWsUrl();
    if (!url) {
      setRealtimeStatus('Atualização periódica');
      return;
    }

    var token = getToken();
    if (!token) {
      setRealtimeStatus('');
      return;
    }

    try {
      adminWs = new WebSocket(url);
    } catch {
      adminWs = null;
      setRealtimeStatus('Atualização periódica');
      return;
    }

    adminWsAuthed = false;
    setRealtimeStatus('Reconectando…');

    adminWs.addEventListener('open', function () {
      try {
        adminWs.send(JSON.stringify({ type: 'auth', token: getToken(), name: getName() }));
      } catch {}
    });

    adminWs.addEventListener('message', function (evt) {
      var msg = safeJsonParse(evt && evt.data);
      if (!msg || !msg.type) return;

      if (msg.type === 'auth_ok') {
        adminWsAuthed = true;
        adminWsReconnectDelayMs = 1000;
        // Stop polling while WS is healthy.
        stopAutoRefresh();
        setRealtimeStatus('Ao vivo');
        return;
      }

      if (msg.type === 'auth_error') {
        adminWsAuthed = false;
        setRealtimeStatus('Atualização periódica');
        try { adminWs.close(); } catch {}
        return;
      }

      if (msg.type === 'refresh') {
        scheduleRefreshTick();
      }
    });

    adminWs.addEventListener('close', function () {
      adminWsAuthed = false;
      adminWs = null;

      // If the app view is visible, fall back to polling and attempt reconnect.
      var showApp = appView && !appView.classList.contains('hidden');
      if (showApp) {
        startAutoRefresh();
        setRealtimeStatus('Reconectando…');
        scheduleWsReconnect();
      } else {
        setRealtimeStatus('');
      }
    });

    adminWs.addEventListener('error', function () {
      // close event will handle fallback/reconnect
    });
  }

  async function refreshTick() {
    // Avoid noisy errors while typing/login is invalid.
    var ok = await ensureLoggedIn();
    if (!ok) return;

    await loadConversations({ preserveActive: true, silent: true });

    if (activeConversationId) {
      var known = Number(lastKnownMessageMsByConversationId[activeConversationId] || 0);
      var seen = Number(lastSeenMessageMsByConversationId[activeConversationId] || 0);
      if (known > seen) {
        await loadMessages(activeConversationId);
      }
    }
  }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') n.textContent = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
    }
    return n;
  }

  function shortCode(id) {
    var s = String(id || '').trim();
    if (!s) return '';
    // Prefer compact and stable display for UUIDs and similar ids.
    // Using the suffix tends to be more distinctive when many ids share a prefix.
    var compact = s.replace(/[^0-9a-z]/gi, '');
    if (compact.length >= 8) return compact.slice(-8);
    return compact || s;
  }

  function displayConversationTitle(row) {
    // row is from /v1/admin/conversations (snake_case)
    var name = row && row.customer_name != null ? String(row.customer_name).trim() : '';
    if (name) return name;
    var whoId = row && (row.user_id ? row.user_id : row.visitor_id);
    return shortCode(whoId);
  }

  function userIconSpan() {
    var span = el('span');
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.justifyContent = 'center';
    span.style.width = '18px';
    span.style.height = '18px';
    span.style.marginRight = '6px';
    span.style.opacity = '0.75';
    // Inline SVG (static) to avoid external assets.
    span.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>';
    return span;
  }

  function who(role) {
    return role === 'agent' ? 'Suporte' : 'Usuário';
  }

  async function api(path, options) {
    var url = getApiBase() + String(path || '');
    try {
      var opts = options || {};
      try {
        var hs = getHostSessionHeaders();
        if (hs && Object.keys(hs).length) {
          var baseHeaders = (opts && opts.headers) ? opts.headers : {};
          opts = Object.assign({}, opts, { headers: Object.assign({}, baseHeaders, hs) });
        }
      } catch {}

      var res = await fetch(url, opts);
      var json = null;
      try { json = await res.json(); } catch (e) { json = null; }
      return { ok: res.ok, status: res.status, json: json, url: url };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        json: { ok: false, error: 'Falha de rede (API fora do ar) ou CORS ao acessar: ' + url },
        url: url,
        fetchError: String(err && err.message ? err.message : err),
      };
    }
  }

  async function loadMe() {
    var t = getToken();
    if (!t) {
      setHintEverywhere('Cole um token para entrar.');
      return { ok: false };
    }

    var r = await api('/v1/admin/me', { method: 'GET', headers: authHeaders() });
    if (r.ok && r.json && r.json.ok && r.json.name) {
      currentMe = {
        id: r.json.id != null ? String(r.json.id) : null,
        name: String(r.json.name),
        isRoot: Boolean(r.json.isRoot),
        role: r.json.role != null ? String(r.json.role) : (r.json.isRoot ? 'root' : 'attendant'),
      };

      var roleLabel = String(currentMe.role);
      if (roleLabel === 'attendant') roleLabel = 'agente';
      if (roleLabel === 'root') roleLabel = 'root (bootstrap)';
      setHintEverywhere('Logado como: ' + String(currentMe.name) + ' (' + roleLabel + ')');

      if (attendantsSection) {
        var canManage = currentMe && (currentMe.role === 'root' || currentMe.role === 'admin');
        attendantsSection.style.display = canManage ? 'block' : 'none';
      }

      setAdminNavEnabled(currentMe && (currentMe.role === 'root' || currentMe.role === 'admin'));
      return { ok: true, name: String(currentMe.name), id: currentMe.id, isRoot: currentMe.isRoot };
    }

    if (r.status === 401) {
      setHintEverywhere('Não autorizado. Verifique o token.');
      return { ok: false };
    }

    if (r.status === 0) {
      var baseMsg = (r.json && r.json.error) ? String(r.json.error) : ('Falha de rede (API fora do ar) ou CORS em ' + getApiBase());
      setHintEverywhere(baseMsg + (r.fetchError ? (' — ' + String(r.fetchError)) : ''));
      return { ok: false };
    }

    setHintEverywhere('Falha ao validar login (HTTP ' + r.status + ') em ' + getApiBase());
    return { ok: false };
  }

  async function ensureLoggedIn() {
    var t = getToken();
    var nowMs = Date.now();

    // Fast-path: recently validated and token unchanged.
    if (meCache.ok && meCache.token && meCache.token === t && currentMe && currentMe.name && (nowMs - Number(meCache.checkedAtMs || 0) < 30000)) {
      setError('');
      return true;
    }

    var me = await loadMe();
    meCache = { token: t, checkedAtMs: nowMs, ok: Boolean(me && me.ok) };

    if (!me.ok) {
      setError('Faça login (token) para continuar.');
      return false;
    }
    setError('');
    return true;
  }

  async function loginAndLoad() {
    clearDataViews();
    var ok = await ensureLoggedIn();
    if (!ok) return;
    setView('app');
    setUiEnabled(true);
    await loadConversations();
    if (currentMe && (currentMe.role === 'root' || currentMe.role === 'admin')) {
      await loadAttendants();
    }
    // Start WS first; polling stays as fallback until WS auth succeeds.
    setRealtimeStatus('Reconectando…');
    startAdminWebSocket();
    startAutoRefresh();
  }

  async function logout() {
    stopAutoRefresh();
    stopAdminWebSocket();
    setRealtimeStatus('');
    tokenInput.value = '';
    nameInput.value = '';
    try { localStorage.removeItem(tokenKey); } catch {}
    try { localStorage.removeItem(nameKey); } catch {}
    meCache = { token: '', checkedAtMs: 0, ok: false };
    setHintEverywhere('Sessão limpa. Cole um token para entrar.');
    setError('');
    clearDataViews();
    setUiEnabled(false);
    setAdminNavEnabled(false);
    setView('login');
  }

  function renderAttendants(list) {
    attendantsRoot.innerHTML = '';
    if (!list || !list.length) {
      attendantsRoot.textContent = 'Nenhum atendente cadastrado ainda.';
      return;
    }

    var table = el('div');
    list.forEach(function (a) {
      var row = el('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.style.padding = '6px 0';

      var roleTxt = a.role ? String(a.role) : 'attendant';
      if (roleTxt === 'attendant') roleTxt = 'agente';
      var label = el('div', { text: (a.active ? '✅ ' : '⛔ ') + String(a.name) + ' (' + roleTxt + ')' });
      label.style.flex = '1';

      var deactivate = el('button', { type: 'button' });
      deactivate.textContent = 'Desativar';
      deactivate.disabled = !a.active;
      deactivate.addEventListener('click', function () {
        deactivateAttendant(a.id);
      });

      var resetToken = el('button', { type: 'button' });
      resetToken.textContent = 'Resetar token';
      resetToken.disabled = !(currentMe && (currentMe.role === 'root' || currentMe.role === 'admin'));
      resetToken.addEventListener('click', function () {
        if (!confirm('Resetar token? O token antigo para de funcionar e um novo será gerado (mostrado uma única vez).')) return;
        resetAttendantToken(a.id);
      });

      var remove = el('button', { type: 'button' });
      remove.textContent = 'Excluir';
      remove.addEventListener('click', function () {
        if (!confirm('Excluir atendente?')) return;
        deleteAttendant(a.id);
      });

      row.appendChild(label);
      row.appendChild(resetToken);
      row.appendChild(deactivate);
      row.appendChild(remove);
      table.appendChild(row);
    });
    attendantsRoot.appendChild(table);
  }

  function renderTokensAudit(list) {
    if (!tokensAuditRoot) return;
    tokensAuditRoot.innerHTML = '';

    if (!list || !list.length) {
      tokensAuditRoot.textContent = 'Nenhum token armazenado ainda.';
      return;
    }

    var wrap = el('div');
    list.forEach(function (a) {
      var row = el('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.style.padding = '6px 0';
      row.style.borderBottom = '1px solid #f0f0f0';

      var left = el('div');
      left.style.flex = '1';
      var name = String(a.name || '');
      var role = String(a.role || 'attendant');
      if (role === 'attendant') role = 'agente';
      var active = Boolean(a.active);
      left.textContent = (active ? '✅ ' : '⛔ ') + name + ' (' + role + ')';

      var tokWrap = el('div');
      tokWrap.style.display = 'flex';
      tokWrap.style.flexDirection = 'column';
      tokWrap.style.gap = '4px';
      tokWrap.style.alignItems = 'flex-start';

      var tokHint = el('div');
      tokHint.style.fontSize = '12px';
      tokHint.style.color = '#555';
      tokHint.textContent = 'Envie o código abaixo para o atendente:';

      var tok = el('code');
      tok.style.userSelect = 'all';
      tok.style.display = 'block';
      tok.style.padding = '8px 10px';
      tok.style.borderRadius = '8px';
      tok.textContent = a.token ? String(a.token) : '(não armazenado)';

      var copyBtn = el('button', { type: 'button' });
      copyBtn.textContent = 'Copiar';
      copyBtn.disabled = !a.token;
      copyBtn.addEventListener('click', async function () {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(String(a.token || ''));
            setError('Token copiado.');
            return;
          }
        } catch {}
        setError('Selecione e copie o token (Ctrl+C).');
      });

      tokWrap.appendChild(tokHint);
      tokWrap.appendChild(tok);

      row.appendChild(left);
      row.appendChild(tokWrap);
      row.appendChild(copyBtn);
      wrap.appendChild(row);
    });

    tokensAuditRoot.appendChild(wrap);
  }

  async function loadAttendantTokens() {
    if (!(currentMe && (currentMe.role === 'root' || currentMe.role === 'admin'))) {
      if (tokensAuditRoot) tokensAuditRoot.textContent = '';
      return;
    }

    var ok = await ensureLoggedIn();
    if (!ok) return;

    var r = await api('/v1/admin/attendants/tokens', { method: 'GET', headers: authHeaders() });
    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao carregar tokens';
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }

    renderTokensAudit(r.json.attendants || []);
  }

  function renderTokenOnce(token, opts) {
    // Keep also a small area on the page (audit section), but prefer showing inside the Users modal.
    if (newTokenRoot) newTokenRoot.textContent = '';
    if (!usersModalToken) return;
    usersModalToken.innerHTML = '';

    var label = el('div');
    label.className = 'small';
    var whoTxt = (opts && opts.forName) ? (' para ' + String(opts.forName)) : '';
    label.textContent = 'Envie o código abaixo' + whoTxt + ' (copie agora; não será mostrado novamente):';

    var code = el('code');
    code.textContent = String(token || '');
    code.style.userSelect = 'all';

    var copyBtn = el('button', { type: 'button' });
    copyBtn.textContent = 'Copiar';
    copyBtn.addEventListener('click', async function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(String(token || ''));
          setUsersModalMsg('Token copiado.');
          return;
        }
      } catch {}
      setUsersModalMsg('Selecione e copie o token (Ctrl+C).');
    });

    var row = el('div');
    row.className = 'row-inline';
    row.style.marginTop = '6px';
    row.appendChild(code);
    row.appendChild(copyBtn);

    usersModalToken.appendChild(label);
    usersModalToken.appendChild(row);
  }

  async function loadAttendants() {
    newTokenRoot.textContent = '';
    var ok = await ensureLoggedIn();
    if (!ok) return;
    var r = await api('/v1/admin/attendants', { method: 'GET', headers: authHeaders() });
    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao carregar atendentes';
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }
    renderAttendants(r.json.attendants || []);
    // Keep token audit table in sync for admins.
    await loadAttendantTokens();
  }

  async function createUserFromModal() {
    var role = (modalUserRole && modalUserRole.value) ? String(modalUserRole.value) : 'attendant';
    role = (role === 'admin') ? 'admin' : 'attendant';

    var sendEmail = Boolean(modalUserSendEmail && modalUserSendEmail.checked);

    var email = (modalUserEmail && modalUserEmail.value ? String(modalUserEmail.value) : '').trim().toLowerCase();
    if (!email) {
      setError('Informe o email do usuário');
      return;
    }
    // Basic validation. Also triggers native browser validation when supported.
    if (modalUserEmail && modalUserEmail.checkValidity && !modalUserEmail.checkValidity()) {
      try { modalUserEmail.reportValidity(); } catch {}
      setError('Email inválido');
      return;
    }
    if (!email.includes('@') || email.length > 320) {
      setError('Email inválido');
      return;
    }

    var name = (modalUserName && modalUserName.value ? String(modalUserName.value) : '').trim();

    var ok = await ensureLoggedIn();
    if (!ok) return;

    setError('');
    newTokenRoot.textContent = '';

    if (sendEmail) {
      usersModalToken.innerHTML = '';

      var inviteName = name || email;
      var rInvite = await api('/v1/admin/invites', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ invites: [{ email: email, role: role, name: inviteName }], apiBase: getApiBase() }),
      });

      if (!rInvite.ok || !rInvite.json || !rInvite.json.ok) {
        var msgInvite = (rInvite.json && rInvite.json.error) ? rInvite.json.error : 'Falha ao enviar convite';
        setError(msgInvite + ' (HTTP ' + rInvite.status + ')');
        return;
      }

      var result = (rInvite.json.results && rInvite.json.results[0]) ? rInvite.json.results[0] : null;
      if (!result || !result.ok) {
        setError('Falha ao enviar convite');
        return;
      }

      if (modalUserEmail) modalUserEmail.value = '';
      if (modalUserName) modalUserName.value = '';

      if (result.token) {
        // SMTP não configurado ou envio falhou: mostrar token para envio manual.
        setUsersModalMsg(result.sent ? 'Convite processado. Token abaixo.' : 'Envio de email falhou. Use o token abaixo.' + (result.emailError ? (' (' + result.emailError + ')') : ''));
        renderTokenOnce(String(result.token || ''), { forName: inviteName });
      } else if (result.sent) {
        var hint = result.tokenHint ? (' (últimos 4: ' + String(result.tokenHint) + ')') : '';
        setUsersModalMsg('Convite enviado por email para ' + String(result.email) + hint + '.');
        // No token to display (security policy).
        usersModalToken.textContent = '';
      } else {
        setUsersModalMsg('Convite criado, mas email não foi enviado.');
        usersModalToken.textContent = '';
      }

      // Keep list in sync (invites upsert into admin_users)
      loadAttendants();
      return;
    }

    var endpoint = (role === 'admin') ? '/v1/admin/admins' : '/v1/admin/attendants';
    var failMsg = (role === 'admin') ? 'Falha ao criar admin' : 'Falha ao criar atendente';

    var r = await api(endpoint, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ email: email, name: name }),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : failMsg;
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }

    if (modalUserEmail) modalUserEmail.value = '';
    if (modalUserName) modalUserName.value = '';
    renderTokenOnce(String(r.json.token || ''), { forName: name || email });
    loadAttendants();
  }

  function ensureInviteRow() {
    if (!modalInviteRowsRoot) return;
    if (modalInviteRowsRoot.querySelectorAll('.inviteRow').length > 0) return;
    addInviteRow('', 'attendant');
  }

  function addInviteRow(email, role) {
    if (!modalInviteRowsRoot) return;

    var row = el('div');
    row.className = 'inviteRow';
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.flexWrap = 'wrap';
    row.style.marginTop = '6px';

    var emailInput = el('input', { type: 'text', placeholder: 'email@empresa.com' });
    emailInput.className = 'inviteEmail';
    emailInput.style.padding = '8px 10px';
    emailInput.style.border = '1px solid #ccc';
    emailInput.style.borderRadius = '8px';
    emailInput.style.width = '320px';
    emailInput.style.maxWidth = '55vw';
    emailInput.value = String(email || '');

    var roleSel = el('select');
    roleSel.className = 'inviteRole';
    roleSel.style.padding = '8px 10px';
    roleSel.style.border = '1px solid #ccc';
    roleSel.style.borderRadius = '8px';

    var optAtt = el('option');
    optAtt.value = 'attendant';
    optAtt.textContent = 'Agente';
    var optAdm = el('option');
    optAdm.value = 'admin';
    optAdm.textContent = 'Admin';
    roleSel.appendChild(optAtt);
    roleSel.appendChild(optAdm);
    roleSel.value = (role === 'admin') ? 'admin' : 'attendant';

    var removeBtn = el('button', { type: 'button' });
    removeBtn.textContent = 'Remover';
    removeBtn.addEventListener('click', function () {
      try { row.remove(); } catch {}
      ensureInviteRow();
    });

    row.appendChild(emailInput);
    row.appendChild(roleSel);
    row.appendChild(removeBtn);
    modalInviteRowsRoot.appendChild(row);
  }

  function collectInvites() {
    if (!modalInviteRowsRoot) return [];
    var rows = modalInviteRowsRoot.querySelectorAll('.inviteRow');
    var out = [];
    rows.forEach(function (row) {
      var email = row.querySelector('.inviteEmail');
      var role = row.querySelector('.inviteRole');
      var e = (email && email.value ? String(email.value) : '').trim();
      var r = (role && role.value ? String(role.value) : 'attendant').trim();
      if (!e) return;
      out.push({ email: e, role: r });
    });
    return out;
  }

  function renderInviteResults(results, smtpEnabled) {
    if (!modalInviteResults) return;
    modalInviteResults.innerHTML = '';

    if (!results || !results.length) {
      modalInviteResults.textContent = '';
      return;
    }

    var box = el('div');
    box.style.border = '1px solid #e5e5e5';
    box.style.borderRadius = '8px';
    box.style.padding = '8px 10px';
    box.style.background = '#fafafa';

    var head = el('div');
    head.className = 'small';
    head.textContent = smtpEnabled
      ? 'Emails enviados (quando possível). Se algum falhar, use o token como fallback.'
      : 'SMTP não configurado na API. Use os tokens abaixo e envie manualmente.';

    var pre = el('pre');
    pre.style.margin = '8px 0 0';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.fontSize = '12px';
    pre.style.userSelect = 'all';
    var lines = [];
    results.forEach(function (r) {
      if (r && r.ok) {
        var status = r.sent ? 'ENVIADO' : ('FALHOU' + (r.emailError ? (' (' + r.emailError + ')') : ''));
        var line = String(r.email) + ' [' + String(r.role) + '] — ' + status;
        if (r.token) {
          line += '\n' + 'token: ' + String(r.token);
        } else if (r.sent) {
          line += '\n' + 'token: (enviado por email)';
        } else {
          line += '\n' + 'token: (indisponível)';
        }
        if (r.tokenHint) {
          line += '\n' + 'token (últimos 4): ' + String(r.tokenHint);
        }
        lines.push(line);
      } else {
        lines.push(String((r && r.email) || '(sem email)') + ': ERRO ' + String((r && r.error) || 'UNKNOWN'));
      }
      lines.push('');
    });
    pre.textContent = lines.join('\n');

    box.appendChild(head);
    box.appendChild(pre);
    modalInviteResults.appendChild(box);
  }

  async function sendInvites() {
    var ok = await ensureLoggedIn();
    if (!ok) return;
    setError('');
    setInviteModalMsg('Enviando convites…');
    if (modalInviteResults) modalInviteResults.textContent = '';

    var invites = collectInvites();
    if (!invites.length) {
      setInviteModalMsg('Adicione ao menos um email.');
      return;
    }

    var r = await api('/v1/admin/invites', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ invites: invites, apiBase: getApiBase() }),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao enviar convites';
      setInviteModalMsg('');
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }

    setInviteModalMsg('Convites processados.');
    renderInviteResults(r.json.results || [], Boolean(r.json.smtpEnabled));
    // Keep list in sync (invites upsert into admin_users)
    loadAttendants();
  }

  async function resetAttendantToken(id) {
    var ok = await ensureLoggedIn();
    if (!ok) return;

    setError('');
    newTokenRoot.textContent = '';

    var r = await api('/v1/admin/attendants/' + encodeURIComponent(id) + '/reset-token', {
      method: 'POST',
      headers: authHeaders(),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao resetar token';
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }

    renderTokenOnce(String(r.json.token || ''));
    loadAttendants();
  }

  async function deactivateAttendant(id) {
    setError('');
    var r = await api('/v1/admin/attendants/' + encodeURIComponent(id) + '/deactivate', {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao desativar atendente';
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }
    loadAttendants();
  }

  async function deleteAttendant(id) {
    setError('');
    var r = await api('/v1/admin/attendants/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao excluir atendente';
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }
    loadAttendants();
  }

  function parseMs(dt) {
    if (!dt) return 0;
    var t = Date.parse(dt);
    return Number.isFinite(t) ? t : 0;
  }

  async function loadConversations(opts) {
    var options = opts || {};
    var preserveActive = Boolean(options.preserveActive);
    var silent = Boolean(options.silent);

    if (!silent) setError('');

    var prevActive = preserveActive ? activeConversationId : '';
    var prevScrollTop = 0;
    try { prevScrollTop = convRoot.scrollTop; } catch {}

    convRoot.innerHTML = '';

    if (!preserveActive) {
      messagesRoot.textContent = '';
      activeConversationId = '';
      activeConversationCustomerName = '';
      if (convBar) convBar.style.display = 'none';
      if (convInfo) convInfo.textContent = '';
    }

    var ok = await ensureLoggedIn();
    if (!ok) return;

    var r = await api('/v1/admin/conversations?status=open&limit=100', {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao carregar conversas';
      setError(msg + ' (HTTP ' + r.status + ') em ' + getApiBase());
      return;
    }

    var convs = r.json.conversations || [];

    // Update last-known timestamps from list
    lastKnownMessageMsByConversationId = Object.create(null);

    var waiting = 0;
    var hasAny = Boolean(convs.length);

    convs.forEach(function (c) {
      var lastMs = parseMs(c.last_message_at || c.created_at);
      lastKnownMessageMsByConversationId[String(c.id)] = lastMs;
    });

    if (!silent) {
      hint.textContent = hasAny ? (convs.length + ' conversa(s)') : 'Nenhuma conversa aberta';
    }

    var foundPrevActive = false;

    convs.forEach(function (c) {
      var item = el('div');
      item.className = 'conv';
      item.dataset.id = c.id;

      var convId = String(c.id);
      var titleRow = el('div');
      titleRow.style.display = 'flex';
      titleRow.style.alignItems = 'center';
      titleRow.style.gap = '0px';
      titleRow.appendChild(userIconSpan());
      titleRow.appendChild(el('div', { text: displayConversationTitle(c) }));
      item.appendChild(titleRow);

      var lastMs = Number(lastKnownMessageMsByConversationId[convId] || 0);
      var seenMs = Number(lastSeenMessageMsByConversationId[convId] || 0);
      var lastRole = c.last_message_role ? String(c.last_message_role) : '';
      var assignedToMe = (currentMe && currentMe.id && c.assigned_admin_user_id && String(c.assigned_admin_user_id) === String(currentMe.id));
      var isFree = !c.assigned_admin_user_id;

      if (assignedToMe) item.classList.add('assigned-me');
      if (isFree) item.classList.add('pending-assign');
      var isNewUserMsg = (lastRole === 'user') && (lastMs > seenMs);
      var isWaitingForMe = isNewUserMsg && (isFree || assignedToMe || (currentMe && currentMe.isRoot));
      if (isWaitingForMe) waiting++;

      var metaTxt = (c.last_message_at ? ('última: ' + new Date(c.last_message_at).toLocaleString()) : ('criada: ' + new Date(c.created_at).toLocaleString()));
      if (isWaitingForMe) metaTxt = 'AGUARDANDO RESPOSTA — ' + metaTxt;
      if (c.last_message_text) metaTxt += ' — ' + String(c.last_message_text).slice(0, 80);
      if (c.assigned_admin_user_id) {
        metaTxt += ' — atend.: ' + String(c.assigned_admin_name || String(c.assigned_admin_user_id).slice(0, 8));
      }
      item.appendChild(el('div', { text: metaTxt, class: 'meta' }));

      item.addEventListener('click', function () {
        selectConversation(String(c.id));
      });

      if (preserveActive && prevActive && String(c.id) === String(prevActive)) {
        foundPrevActive = true;
      }

      convRoot.appendChild(item);
    });

    if (preserveActive && prevActive && foundPrevActive) {
      activeConversationId = prevActive;
      markActive();
    } else if (preserveActive && prevActive && !foundPrevActive) {
      // Conversation disappeared (deleted or filtered). Clear selection.
      activeConversationId = '';
      activeConversationCustomerName = '';
      if (convBar) convBar.style.display = 'none';
      if (convInfo) convInfo.textContent = '';
      messagesRoot.textContent = '';
    }

    try { convRoot.scrollTop = prevScrollTop; } catch {}

    if (!silent) {
      if (hasAny) {
        hint.textContent = convs.length + ' conversa(s)' + (waiting ? (' — ' + waiting + ' aguardando') : '');
      } else {
        hint.textContent = 'Nenhuma conversa aberta';
      }
    }
  }

  function markActive() {
    var items = convRoot.querySelectorAll('.conv');
    items.forEach(function (n) {
      n.classList.toggle('active', n.dataset.id === activeConversationId);
    });
  }

  async function selectConversation(id) {
    activeConversationId = id;
    markActive();
    await loadMessages(id);
  }

  async function loadMessages(id) {
    setError('');
    messagesRoot.innerHTML = '';

    if (convBar) convBar.style.display = 'flex';
    if (convInfo) convInfo.textContent = 'Carregando conversa…';
    if (claimConvBtn) claimConvBtn.style.display = 'none';
    if (releaseConvBtn) releaseConvBtn.style.display = 'none';
    setReplyEnabled(true);

    var r = await api('/v1/admin/conversations/' + encodeURIComponent(id) + '/messages', {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao carregar mensagens';
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }

    var conv = r.json.conversation || null;
    var assignedId = conv && conv.assignedAdminUserId ? String(conv.assignedAdminUserId) : '';
    var assignedName = conv && conv.assignedAdmin && conv.assignedAdmin.name ? String(conv.assignedAdmin.name) : '';
    var assignedLabel = assignedId ? ('Atribuída: ' + (assignedName || assignedId.slice(0, 8))) : 'Atribuída: (livre)';

    activeConversationCustomerName = conv && conv.customerName != null ? String(conv.customerName).trim() : '';

    var canReply = true;
    if (assignedId) {
      if (currentMe && currentMe.isRoot) {
        canReply = true;
      } else if (currentMe && currentMe.id && String(currentMe.id) === assignedId) {
        canReply = true;
      } else {
        canReply = false;
      }
    }

    if (convInfo) {
      var label = activeConversationCustomerName || shortCode((conv && (conv.userId || conv.visitorId)) ? (conv.userId || conv.visitorId) : id);
      var head = 'Conversa: ' + label + ' — ' + assignedLabel;
      if (currentMe && currentMe.isRoot) head += ' (root pode responder)';
      convInfo.textContent = head;
    }

    if (claimConvBtn) {
      claimConvBtn.style.display = (!assignedId && currentMe && currentMe.id) ? 'inline-block' : 'none';
    }
    if (releaseConvBtn) {
      var canRelease = false;
      if (assignedId) {
        if (currentMe && currentMe.isRoot) canRelease = true;
        else if (currentMe && currentMe.id && String(currentMe.id) === assignedId) canRelease = true;
      }
      releaseConvBtn.style.display = canRelease ? 'inline-block' : 'none';
    }

    setReplyEnabled(canReply);
    if (!canReply) setError('Conversa atribuída a outro atendente. Você pode visualizar, mas não responder.');

    var msgs = r.json.messages || [];
    msgs.forEach(function (m) {
      var line = el('div');
      line.className = 'line';

      var head = el('div');
      head.innerHTML = '<span class="who">' + who(m.role) + '</span> — ' + new Date(m.created_at).toLocaleString();

      var body = el('div', { text: String(m.text || '') });

      line.appendChild(head);
      line.appendChild(body);
      messagesRoot.appendChild(line);
    });

    // Mark last seen for this conversation so the list can show what's still waiting.
    try {
      var last = msgs.length ? msgs[msgs.length - 1] : null;
      var ms = last && last.created_at ? parseMs(last.created_at) : 0;
      lastSeenMessageMsByConversationId[String(id)] = ms;
    } catch {}

    messagesRoot.scrollTop = messagesRoot.scrollHeight;
  }

  async function sendReply(text) {
    if (!activeConversationId) {
      setError('Selecione uma conversa');
      return;
    }

    setError('');
    var r = await api('/v1/admin/conversations/' + encodeURIComponent(activeConversationId) + '/messages', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ text: text }),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao enviar';
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }

    await loadMessages(activeConversationId);
    await loadConversations({ preserveActive: true, silent: true });
  }

  async function claimActiveConversation() {
    if (!activeConversationId) return;
    setError('');

    var r = await api('/v1/admin/conversations/' + encodeURIComponent(activeConversationId) + '/claim', {
      method: 'POST',
      headers: authHeaders(),
    });

    if (r.status === 409 && currentMe && (currentMe.role === 'admin' || currentMe.role === 'root')) {
      var assignedTo = (r.json && r.json.details && r.json.details.assignedTo && r.json.details.assignedTo.name)
        ? String(r.json.details.assignedTo.name)
        : (r.json && r.json.details && r.json.details.assignedTo && r.json.details.assignedTo.id)
          ? String(r.json.details.assignedTo.id).slice(0, 8)
          : 'outro atendente';

      if (currentMe.role === 'root') {
        setError('Conversa atribuída a ' + assignedTo + '. Root não pode assumir diretamente; use Liberar ou atribua via API.');
        await loadMessages(activeConversationId);
        return;
      }

      var ok = confirm('Conversa já atribuída a ' + assignedTo + '.\n\nDeseja FORÇAR a transferência para você?');
      if (ok) {
        r = await api('/v1/admin/conversations/' + encodeURIComponent(activeConversationId) + '/claim?force=1', {
          method: 'POST',
          headers: authHeaders(),
        });
      }
    }

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao assumir conversa';
      setError(msg + ' (HTTP ' + r.status + ')');
      await loadMessages(activeConversationId);
      return;
    }

    await loadMessages(activeConversationId);
  }

  async function releaseActiveConversation() {
    if (!activeConversationId) return;
    setError('');

    var r = await api('/v1/admin/conversations/' + encodeURIComponent(activeConversationId) + '/release', {
      method: 'POST',
      headers: authHeaders(),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao liberar conversa';
      setError(msg + ' (HTTP ' + r.status + ')');
      await loadMessages(activeConversationId);
      return;
    }

    await loadMessages(activeConversationId);
  }

  async function closeActiveConversation() {
    if (!activeConversationId) return;
    var ok = await ensureLoggedIn();
    if (!ok) return;

    if (!confirm('Encerrar esta conversa? Ela não aparecerá mais na lista.')) return;

    setError('');
    var id = String(activeConversationId);
    var r = await api('/v1/admin/conversations/' + encodeURIComponent(id) + '/close', {
      method: 'POST',
      headers: authHeaders(),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao encerrar conversa';
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }

    // Conversation is now closed; clear selection and refresh list (closed conversations are filtered out).
    activeConversationId = '';
    if (convBar) convBar.style.display = 'none';
    if (convInfo) convInfo.textContent = '';
    if (messagesRoot) messagesRoot.textContent = '';
    await loadConversations({ preserveActive: false, silent: true });
  }

  function hideRenameEditor() {
    if (renameInline) renameInline.classList.add('hidden');
    if (renameConvBtn) renameConvBtn.classList.remove('hidden');
    if (renameInput) renameInput.value = '';
  }

  function showRenameEditor() {
    if (!renameInline || !renameInput) return;
    if (renameConvBtn) renameConvBtn.classList.add('hidden');
    renameInline.classList.remove('hidden');
    renameInput.value = String(activeConversationCustomerName || '');
    try { renameInput.focus(); renameInput.select(); } catch {}
  }

  async function saveRenameFromEditor() {
    if (!activeConversationId) return;
    var ok = await ensureLoggedIn();
    if (!ok) return;

    var initial = String(activeConversationCustomerName || '').trim();
    var name = String(renameInput && renameInput.value != null ? renameInput.value : '').trim();

    if (!name && initial) {
      if (!confirm('Remover o nome salvo para esta conversa?')) return;
    }

    setError('');
    var r = await api('/v1/admin/conversations/' + encodeURIComponent(activeConversationId) + '/customer-name', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ name: name }),
    });

    if (!r.ok || !r.json || !r.json.ok) {
      var msg = (r.json && r.json.error) ? r.json.error : 'Falha ao renomear';
      setError(msg + ' (HTTP ' + r.status + ')');
      return;
    }

    activeConversationCustomerName = r.json.customerName != null ? String(r.json.customerName || '').trim() : '';
    hideRenameEditor();
    await loadConversations({ preserveActive: true, silent: true });
    await loadMessages(activeConversationId);
  }

  // restore token
  try {
    var saved = localStorage.getItem(tokenKey);
    if (saved) tokenInput.value = saved;
  } catch {}

  // restore api base
  try {
    var savedApiRaw = localStorage.getItem(apiBaseKey);
    var savedApi = normalizeBaseUrl(savedApiRaw);
    var defaultApi = getDefaultApiBase();
    if (apiBaseInput) {
      var underChat = isUnderChatMount();

      // Migration: if the panel moved under /chat but the saved apiBase still points to the
      // origin root, automatically flip it to the /chat base to avoid 301 to /admin and
      // wrong API/WS calls.
      var originNorm = normalizeBaseUrl(location.origin);
      if (underChat) {
        // If a previously saved API base points to another origin (e.g. :4010),
        // it will fail under CSP. Auto-reset to the /chat base.
        var coerced = coerceApiBaseForChatMount(savedApi);
        apiBaseInput.value = coerced || defaultApi;
        try { localStorage.setItem(apiBaseKey, apiBaseInput.value); } catch {}
      } else if (savedApi && savedApi === originNorm && defaultApi && defaultApi !== originNorm) {
        apiBaseInput.value = defaultApi;
        try { localStorage.setItem(apiBaseKey, defaultApi); } catch {}
      } else if (savedApi) {
        apiBaseInput.value = savedApi;
      } else if (!String(apiBaseInput.value || '').trim()) {
        apiBaseInput.value = defaultApi;
      }
    }
  } catch {}

  // restore name
  try {
    var savedName = localStorage.getItem(nameKey);
    if (savedName) nameInput.value = savedName;
  } catch {}

  tokenInput.addEventListener('change', function () {
    try { localStorage.setItem(tokenKey, getToken()); } catch {}
    meCache = { token: '', checkedAtMs: 0, ok: false };
    loadMe().then(function (me) {
      if (me && me.ok) {
        setUiEnabled(true);
        loadConversations();
        if (currentMe && (currentMe.role === 'root' || currentMe.role === 'admin')) {
          loadAttendants();
        }
        startAdminWebSocket();
        startAutoRefresh();
      } else {
        stopAutoRefresh();
        stopAdminWebSocket();
        setUiEnabled(false);
        clearDataViews();
      }
    });
  });

  if (apiBaseInput) {
    apiBaseInput.addEventListener('change', function () {
      try { localStorage.setItem(apiBaseKey, normalizeBaseUrl(apiBaseInput.value)); } catch {}
      setApiBaseLabel();
      // Re-validate login against the new API base and reload lists.
      loginAndLoad();
    });
  }

  tokenInput.addEventListener('keydown', function (evt) {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      loginAndLoad();
    }
  });

  nameInput.addEventListener('change', function () {
    try { localStorage.setItem(nameKey, getName()); } catch {}
    loadMe();
  });

  if (loginBtn) {
    loginBtn.addEventListener('click', function () {
      loginAndLoad();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      logout();
    });
  }

  if (loadBtn) {
    loadBtn.addEventListener('click', function () {
      loginAndLoad();
    });
  }

  if (modalCreateUserBtn) {
    modalCreateUserBtn.addEventListener('click', function () {
      setUsersModalMsg('');
      createUserFromModal();
    });
  }

  if (modalInviteAddBtn) {
    modalInviteAddBtn.addEventListener('click', function () {
      addInviteRow('', 'attendant');
    });
  }

  if (modalInviteSendBtn) {
    modalInviteSendBtn.addEventListener('click', function () {
      sendInvites();
    });
  }

  if (navUsersBtn) {
    navUsersBtn.addEventListener('click', function () {
      setUsersModalMsg('');
      if (usersModalToken) usersModalToken.textContent = '';
      openModal('users');
      try { if (modalUserName) modalUserName.focus(); } catch {}
    });
  }
  if (navInvitesBtn) {
    navInvitesBtn.addEventListener('click', function () {
      setInviteModalMsg('');
      if (modalInviteResults) modalInviteResults.textContent = '';
      ensureInviteRow();
      openModal('invites');
    });
  }
  if (navTopicsBtn) {
    navTopicsBtn.addEventListener('click', function () {
      setTopicsModalMsg('');
      openModal('topics');
      loadSupportTopicsAdmin();
      try { if (topicsNewTitle) topicsNewTitle.focus(); } catch {}
    });
  }
  if (navTokensBtn) {
    navTokensBtn.addEventListener('click', function () {
      try { if (tokensAuditRoot) tokensAuditRoot.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
    });
  }
  if (navSupportBtn) {
    navSupportBtn.addEventListener('click', function () {
      try { if (convRoot) convRoot.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
    });
  }

  if (usersModalClose) usersModalClose.addEventListener('click', closeModals);
  if (invitesModalClose) invitesModalClose.addEventListener('click', closeModals);
  if (topicsModalClose) topicsModalClose.addEventListener('click', closeModals);
  if (modalBackdrop) modalBackdrop.addEventListener('click', closeModals);
  document.addEventListener('keydown', function (evt) {
    if (evt.key === 'Escape') closeModals();
  });

  if (topicsCreateBtn) {
    topicsCreateBtn.addEventListener('click', function () {
      createSupportTopic();
    });
  }
  if (topicsRefreshBtn) {
    topicsRefreshBtn.addEventListener('click', function () {
      loadSupportTopicsAdmin();
    });
  }

  if (refreshAttendantsBtn) {
    refreshAttendantsBtn.addEventListener('click', function () {
      loadAttendants();
    });
  }

  if (refreshTokensBtn) {
    refreshTokensBtn.addEventListener('click', function () {
      loadAttendantTokens();
    });
  }

  if (claimConvBtn) {
    claimConvBtn.addEventListener('click', function () {
      claimActiveConversation();
    });
  }

  if (releaseConvBtn) {
    releaseConvBtn.addEventListener('click', function () {
      releaseActiveConversation();
    });
  }

  if (closeConvBtn) {
    closeConvBtn.addEventListener('click', function () {
      closeActiveConversation();
    });
  }

  if (renameConvBtn) {
    renameConvBtn.addEventListener('click', function () {
      showRenameEditor();
    });
  }

  if (renameCancelBtn) {
    renameCancelBtn.addEventListener('click', function () {
      hideRenameEditor();
    });
  }

  if (renameSaveBtn) {
    renameSaveBtn.addEventListener('click', function () {
      saveRenameFromEditor();
    });
  }

  if (renameInput) {
    renameInput.addEventListener('keydown', function (evt) {
      if (!evt) return;
      if (evt.key === 'Enter') {
        evt.preventDefault();
        saveRenameFromEditor();
      }
      if (evt.key === 'Escape') {
        evt.preventDefault();
        hideRenameEditor();
      }
    });
  }

  replyForm.addEventListener('submit', function (evt) {
    evt.preventDefault();
    var t = (textInput.value || '').trim();
    if (!t) return;
    textInput.value = '';
    sendReply(t);
  });

  // initial load
  if (originEl) originEl.textContent = location.origin;
  setApiBaseLabel();
  clearDataViews();
  setUiEnabled(false);

  // Start on the login screen and try auto-login if a token is present.
  setView('login');
  setAdminNavEnabled(false);
  (async function () {
    var t = '';
    try { t = localStorage.getItem(tokenKey) || ''; } catch {}
    t = String(t || '').trim();
    if (!t) {
      await loadMe();
      return;
    }
    // Attempt auto-login.
    await loginAndLoad();
  })();

  // Ensure invites UI starts with one row (when visible)
  ensureInviteRow();

  function adjustMainHeight() {
    try {
      var header = document.querySelector('header');
      var main = document.querySelector('main');
      if (!header || !main) return;
      var h = header.offsetHeight || 0;
      if (h < 56) h = 56;
      main.style.height = 'calc(100vh - ' + h + 'px)';
    } catch {}
  }

  adjustMainHeight();
  try { window.addEventListener('resize', adjustMainHeight); } catch {}
})();
