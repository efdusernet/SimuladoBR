/* Minimal embeddable widget (vanilla JS)
   Usage:
   <script src="https://chat.example.com/widget/chat-widget.js" data-chat-api="https://chat.example.com"></script>
*/
(function () {
  // Diagnostics: allows host pages to confirm the script loaded and executed.
  try { window.__chatServiceWidgetLoaded = true; } catch (e) {}

  function findScriptEl() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i];
      if (s && s.getAttribute && s.getAttribute('data-chat-api')) return s;
    }
    return null;
  }

  var script = findScriptEl();
  if (!script) return;

  var apiBase = (script.getAttribute('data-chat-api') || '').replace(/\/+$/, '');
  if (!apiBase) return;

  function getHostSessionToken() {
    try {
      var tok = localStorage.getItem('sessionToken') || '';
      tok = String(tok || '').trim();
      return tok;
    } catch (e) {
      return '';
    }
  }

  function shouldAttachHostSessionToken() {
    // Only attach when the widget is configured to use the SimuladosBR reverse proxy.
    // This prevents leaking the host app session token to a third-party chat-service.
    try {
      if (!apiBase) return false;
      if (String(apiBase).indexOf('/chat') === 0) return true;
      var u = new URL(String(apiBase), window.location.href);
      return u.origin === window.location.origin && String(u.pathname || '').indexOf('/chat') === 0;
    } catch (e) {
      return false;
    }
  }

  var attachHostSessionToken = shouldAttachHostSessionToken();
  var hostSessionToken = attachHostSessionToken ? getHostSessionToken() : '';

  function withHostSessionToken(url) {
    if (!attachHostSessionToken || !hostSessionToken) return url;
    try {
      var u = new URL(String(url), window.location.href);
      if (!u.searchParams.get('sessionToken')) u.searchParams.set('sessionToken', hostSessionToken);
      return u.toString();
    } catch (e) {
      // Best-effort fallback for relative URLs.
      try {
        var s = String(url);
        if (s.indexOf('sessionToken=') !== -1) return s;
        return s + (s.indexOf('?') === -1 ? '?' : '&') + 'sessionToken=' + encodeURIComponent(hostSessionToken);
      } catch (e2) {
        return url;
      }
    }
  }

  var title = script.getAttribute('data-chat-title') || 'Suporte';

  // Inject minimal CSS (keeps widget self-contained).
  (function injectStyles() {
    try {
      var css = [
        // Keep a bit more distance from OS/task bars.
        // (Some environments overlay system UI over the browser viewport.)
        '.csw-root{position:fixed;right:16px;bottom:72px;z-index:2147483647;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}',
        '.csw-launcher{position:relative;display:flex;align-items:flex-end;gap:10px;justify-content:flex-end;background:#0f4c5c;padding:10px 12px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,0.10)}',
        '.csw-btn{padding:10px 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.35);background:transparent;color:#fff;cursor:pointer;font-weight:600;box-shadow:none}',
        '.csw-btn:active{transform:translateY(1px)}',
        // Panel uses flex so messages area can shrink/grow safely.
        '.csw-panel{display:none;width:340px;height:460px;max-height:calc(100vh - 140px);margin-top:10px;border:1px solid #d7d7d7;border-radius:14px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,0.14);overflow:hidden;flex-direction:column}',
        '.csw-header{padding:10px 12px;border-bottom:1px solid #eee;font-weight:700;display:flex;align-items:center;justify-content:space-between;gap:10px}',
        '.csw-header-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.csw-close{border:0;background:transparent;color:#666;cursor:pointer;font-weight:700;padding:6px 8px;border-radius:10px}',
        '.csw-close:hover{background:#f3f3f3}',
        '.csw-messages{padding:10px 12px;flex:1;min-height:0;overflow-y:auto;white-space:pre-wrap;line-height:1.35}',
        '.csw-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #eee}',
        '.csw-input{flex:1;padding:9px 10px;border-radius:10px;border:1px solid #d7d7d7;outline:none}',
        '.csw-input:focus{border-color:#b9b9b9}',
        '.csw-send{padding:9px 12px;border-radius:10px;border:1px solid #d7d7d7;background:#f6f6f6;cursor:pointer;font-weight:600}',
        '.csw-send:active{transform:translateY(1px)}',
        '.csw-mascot{width:54px;height:54px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 8px 14px rgba(0,0,0,0.18))}',
        '.csw-mascot svg{width:54px;height:54px;display:block}',
        '.csw-mascot{transform-origin:50% 100%;animation:csw-bounce 2.2s ease-in-out infinite}',
        '.csw-mascot .csw-eye{animation:csw-blink 5.5s infinite}',
        '@keyframes csw-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}',
        '@keyframes csw-blink{0%,2%,100%{transform:scaleY(1)}1%{transform:scaleY(0.1)}}',
      ].join('');
      var style = document.createElement('style');
      style.setAttribute('data-chat-service', 'widget');
      style.textContent = css;
      document.head && document.head.appendChild(style);
    } catch (e) {}
  })();

  var storagePrefix = 'chatService:' + apiBase + ':';
  var visitorIdKey = storagePrefix + 'visitorId';
  var conversationIdKey = storagePrefix + 'conversationId';

  function removeStored(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function getStored(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function setStored(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function usedTopicsKey(conversationId) {
    return storagePrefix + 'supportTopicsUsed:' + String(conversationId || '');
  }

  function autoRepliesKey(conversationId) {
    return storagePrefix + 'supportTopicsAutoReplies:' + String(conversationId || '');
  }

  function getAutoReplies(conversationId) {
    var raw = getStored(autoRepliesKey(conversationId));
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(function (x) { return x && typeof x === 'object'; })
        .map(function (x) {
          return {
            id: x.id != null ? String(x.id) : '',
            text: x.text != null ? String(x.text) : '',
            at: Number(x.at || 0),
            afterMessageId: x.afterMessageId != null ? String(x.afterMessageId) : '',
          };
        })
        .filter(function (x) { return x.text; });
    } catch (e) {
      return [];
    }
  }

  function addAutoReply(conversationId, topicId, text, opts) {
    if (!conversationId || !text) return;
    var id = topicId != null ? String(topicId) : '';
    var cur = getAutoReplies(conversationId);
    if (id && cur.some(function (x) { return x && x.id === id; })) return;
    var afterMessageId = '';
    try {
      if (opts && typeof opts === 'object' && opts.afterMessageId != null) afterMessageId = String(opts.afterMessageId);
      else if (typeof opts === 'string') afterMessageId = String(opts);
    } catch (e) { afterMessageId = ''; }
    cur.push({ id: id, text: String(text), at: Date.now(), afterMessageId: afterMessageId });
    if (cur.length > 50) cur = cur.slice(-50);
    setStored(autoRepliesKey(conversationId), JSON.stringify(cur));
  }

  function clearAutoReplies(conversationId) {
    if (!conversationId) return;
    removeStored(autoRepliesKey(conversationId));
  }

  function getUsedTopicIds(conversationId) {
    var key = usedTopicsKey(conversationId);
    var raw = getStored(key);
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(function (x) { return String(x); }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function markTopicUsed(conversationId, topicId) {
    if (!conversationId || !topicId) return;
    var key = usedTopicsKey(conversationId);
    var cur = getUsedTopicIds(conversationId);
    var id = String(topicId);
    if (cur.indexOf(id) >= 0) return;
    cur.push(id);
    // Keep it bounded to avoid unbounded growth.
    if (cur.length > 200) cur = cur.slice(-200);
    setStored(key, JSON.stringify(cur));
  }

  function clearUsedTopics(conversationId) {
    if (!conversationId) return;
    removeStored(usedTopicsKey(conversationId));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  var root = el('div');
  root.className = 'csw-root';

  var launcher = el('div');
  launcher.className = 'csw-launcher';

  var button = el('button', { type: 'button', 'aria-label': 'Abrir chat' });
  button.className = 'csw-btn';
  button.textContent = title;

  // Animated mascot next to the button.
  var mascot = el('div');
  mascot.className = 'csw-mascot';
  mascot.setAttribute('aria-hidden', 'true');
  mascot.innerHTML = '' +
    '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img">' +
    '  <defs>' +
    '    <linearGradient id="cswG" x1="0" y1="0" x2="0" y2="1">' +
    '      <stop offset="0" stop-color="#ffffff"/>' +
    '      <stop offset="1" stop-color="#f1f1f1"/>' +
    '    </linearGradient>' +
    '  </defs>' +
    '  <circle cx="32" cy="32" r="28" fill="url(#cswG)" stroke="#d7d7d7" stroke-width="2"/>' +
    '  <circle cx="22" cy="30" r="6" fill="#fff" stroke="#d7d7d7" stroke-width="2"/>' +
    '  <circle cx="42" cy="30" r="6" fill="#fff" stroke="#d7d7d7" stroke-width="2"/>' +
    '  <g class="csw-eye">' +
    '    <circle cx="22" cy="30" r="2.2" fill="#111"/>' +
    '    <circle cx="42" cy="30" r="2.2" fill="#111"/>' +
    '  </g>' +
    '  <path d="M22 44c3 3 6 4.5 10 4.5S39 47 42 44" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"/>' +
    '  <path d="M12 18c6-7 14-11 20-11s14 4 20 11" fill="none" stroke="#d7d7d7" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';

  var panel = el('div');
  panel.className = 'csw-panel';

  var header = el('div');
  header.className = 'csw-header';
  var headerTitle = el('div', { text: title });
  headerTitle.className = 'csw-header-title';
  var closeBtn = el('button', { type: 'button' });
  closeBtn.className = 'csw-close';
  closeBtn.textContent = 'Encerrar';
  header.appendChild(headerTitle);
  header.appendChild(closeBtn);

  var messages = el('div');
  messages.className = 'csw-messages';

  var topicsRoot = el('div');
  topicsRoot.className = 'csw-topics';
  topicsRoot.style.display = 'none';

  var form = el('form');
  form.className = 'csw-form';

  var input = el('input', { type: 'text', placeholder: 'Digite sua mensagem…' });
  input.className = 'csw-input';

  var send = el('button', { type: 'submit' });
  send.className = 'csw-send';
  send.textContent = 'Enviar';

  form.appendChild(input);
  form.appendChild(send);

  panel.appendChild(header);
  panel.appendChild(topicsRoot);
  panel.appendChild(messages);
  panel.appendChild(form);

  launcher.appendChild(mascot);
  launcher.appendChild(button);
  root.appendChild(launcher);
  root.appendChild(panel);

  function mount() {
    if (!document.body) return false;
    document.body.appendChild(root);
    return true;
  }

  if (!mount()) {
    document.addEventListener('DOMContentLoaded', function () {
      mount();
    });
  }

  function renderMessage(m) {
    var line = el('div');
    var agentName = (m && (m.sender_name || m.senderName)) ? String(m.sender_name || m.senderName) : 'Suporte';
    var who = (m.role === 'agent') ? agentName : 'Você';
    line.textContent = who + ': ' + (m.text || '');
    line.style.marginBottom = '8px';
    return line;
  }

  function buildAutoRepliesInsertionPlan(conversationId) {
    var out = { byAfterMessageId: {}, legacy: [] };
    var replies = getAutoReplies(conversationId);
    if (!replies || !replies.length) return out;
    replies
      .slice()
      .sort(function (a, b) { return Number(a.at || 0) - Number(b.at || 0); })
      .forEach(function (r) {
        var key = (r && r.afterMessageId) ? String(r.afterMessageId) : '';
        if (key) {
          if (!out.byAfterMessageId[key]) out.byAfterMessageId[key] = [];
          out.byAfterMessageId[key].push(r);
        } else {
          out.legacy.push(r);
        }
      });
    return out;
  }

  var topicsCache = null;

  function renderTopics(topics, ids, usedTopicIds) {
    try { topicsRoot.innerHTML = ''; } catch (e) {}
    if (!topics || !topics.length) {
      topicsRoot.style.display = 'none';
      return;
    }

    topicsRoot.style.display = 'block';

    var label = el('div', { text: 'Assuntos:' });
    label.style.fontSize = '12px';
    label.style.color = '#444';
    label.style.marginBottom = '8px';

    var wrap = el('div');
    wrap.style.display = 'flex';
    wrap.style.gap = '8px';
    wrap.style.flexWrap = 'wrap';

    topics.forEach(function (t) {
      var title = (t && t.title != null) ? String(t.title) : '';
      var messageText = (t && (t.message_text != null || t.messageText != null)) ? String(t.message_text != null ? t.message_text : t.messageText) : title;
      if (!title) return;

      var id = (t && t.id != null) ? String(t.id) : '';
      var used = id && usedTopicIds && usedTopicIds.indexOf(id) >= 0;

      var b = el('button', { type: 'button' });
      b.textContent = title;
      b.style.padding = '8px 10px';
      b.style.borderRadius = '999px';
      b.style.border = '1px solid rgba(15,76,92,0.35)';
      b.style.background = 'rgba(15,76,92,0.08)';
      b.style.color = '#0f4c5c';
      b.style.cursor = used ? 'not-allowed' : 'pointer';
      b.style.fontWeight = '600';
      if (used) {
        b.disabled = true;
        b.style.opacity = '0.55';
        b.title = 'Já enviado';
      }
      b.addEventListener('click', async function () {
        if (b.disabled) return;
        // Prevent double-clicking while request is in-flight.
        b.disabled = true;
        b.style.cursor = 'not-allowed';
        b.style.opacity = '0.55';
        try {
          // Start the conversation with a predefined message.
          var payload = messageText || title;
          var userText = payload;

          // Preferred: explicit auto reply configured by admin.
          var autoReply = '';
          if (t && (t.auto_reply_text != null || t.autoReplyText != null)) {
            autoReply = String(t.auto_reply_text != null ? t.auto_reply_text : t.autoReplyText).trim();
          }

          // If the topic is configured so that the user message equals the auto-reply,
          // avoid sending that text as a user message (it would render as "Você").
          // This is not a heuristic: we only de-duplicate based on the explicit fields.
          if (autoReply && String(userText || '').trim() === autoReply) {
            userText = title ? ('Tenho dúvida sobre ' + title) : 'Preciso de ajuda.';
          }

          var sent = await sendMessage(userText);
          if (ids && ids.conversationId && id) {
            markTopicUsed(ids.conversationId, id);
            if (autoReply) addAutoReply(ids.conversationId, id, autoReply, { afterMessageId: sent && sent.id != null ? String(sent.id) : '' });
          }
          await loadMessages();
        } catch (e) {
          // Re-enable if it failed.
          b.disabled = false;
          b.style.cursor = 'pointer';
          b.style.opacity = '1';
          messages.appendChild(el('div', { text: 'Erro: ' + (e && e.message ? e.message : 'Falha') }));
        }
      });
      wrap.appendChild(b);
    });

    topicsRoot.appendChild(label);
    topicsRoot.appendChild(wrap);
  }

  async function loadTopics() {
    if (topicsCache) return topicsCache;
    var res = await fetch(withHostSessionToken(apiBase + '/v1/support-topics'), { method: 'GET' });
    var json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!res.ok || !json || !json.ok) return [];
    topicsCache = Array.isArray(json.topics) ? json.topics : [];
    return topicsCache;
  }

  async function ensureConversation() {
    var visitorId = getStored(visitorIdKey);
    var conversationId = getStored(conversationIdKey);
    if (visitorId && conversationId) return { visitorId, conversationId };

    var res = await fetch(withHostSessionToken(apiBase + '/v1/conversations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chat-Visitor-Id': visitorId || '' },
      body: JSON.stringify({ visitorId: visitorId || undefined }),
    });
    var json = await res.json();
    if (!res.ok || !json || !json.ok) throw new Error((json && json.error) || 'Falha ao criar conversa');

    visitorId = json.visitorId;
    conversationId = json.conversationId;
    setStored(visitorIdKey, visitorId);
    setStored(conversationIdKey, conversationId);

    return { visitorId, conversationId };
  }

  function updateHeaderWithIds(ids) {
    try {
      headerTitle.textContent = title;
      window.__chatServiceWidgetIds = { visitorId: ids.visitorId, conversationId: ids.conversationId, apiBase: apiBase };
    } catch (e) {}
  }

  function setChatClosedState() {
    try {
      input.disabled = true;
      send.disabled = true;
    } catch (e) {}
  }

  function setChatOpenState() {
    try {
      input.disabled = false;
      send.disabled = false;
    } catch (e) {}
  }

  function handleRemoteClosed(messageText) {
    // Treat as: conversation ended by support; "forget" it locally.
    var oldConversationId = getStored(conversationIdKey);
    try { setStored(conversationIdKey, ''); } catch (e) {}
    try { clearUsedTopics(oldConversationId); } catch (e) {}
    try { clearAutoReplies(oldConversationId); } catch (e) {}
    try { stopPolling(); } catch (e) {}
    try { messages.innerHTML = ''; } catch (e) {}

    messages.appendChild(el('div', {
      text: messageText || 'Conversa encerrada pelo suporte. Se quiser, envie uma nova mensagem para iniciar outra.'
    }));
    setChatClosedState();
  }

  async function closeConversation() {
    var visitorId = getStored(visitorIdKey);
    var conversationId = getStored(conversationIdKey);
    if (!visitorId || !conversationId) return;

    var res = await fetch(withHostSessionToken(apiBase + '/v1/conversations/' + encodeURIComponent(conversationId) + '/close'), {
      method: 'POST',
      headers: { 'X-Chat-Visitor-Id': visitorId },
    });
    var json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!res.ok || !json || !json.ok) throw new Error((json && json.error) || 'Falha ao encerrar');

    // End current session so a new chat can be started later.
    setStored(conversationIdKey, '');
    clearUsedTopics(conversationId);
    clearAutoReplies(conversationId);
    stopPolling();
    messages.innerHTML = '';
    messages.appendChild(el('div', { text: 'Conversa encerrada. Se quiser, envie uma nova mensagem para iniciar outra.' }));
    setChatClosedState();
  }

  async function loadMessages() {
    var ids = await ensureConversation();
    updateHeaderWithIds(ids);
    var res = await fetch(withHostSessionToken(apiBase + '/v1/conversations/' + encodeURIComponent(ids.conversationId) + '/messages'), {
      method: 'GET',
      headers: { 'X-Chat-Visitor-Id': ids.visitorId },
    });
    var json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!res.ok || !json || !json.ok) {
      var errMsg = (json && json.error) ? String(json.error) : ('Falha ao carregar mensagens (HTTP ' + res.status + ')');
      if (res.status === 409 || errMsg.toLowerCase().includes('encerrada')) {
        handleRemoteClosed('Conversa encerrada pelo suporte. Se quiser, envie uma nova mensagem para iniciar outra.');
        return;
      }
      throw new Error(errMsg);
    }

    messages.innerHTML = '';
    var msgs = (json.messages || []);
    // Show quick topics (and keep used ones disabled).
    try {
      var topics = await loadTopics();
      var usedTopicIds = getUsedTopicIds(ids.conversationId);
      renderTopics(topics, ids, usedTopicIds);
    } catch (e) {
      // Fail silently (topics are optional)
      topicsRoot.style.display = 'none';
    }

    var autoPlan = buildAutoRepliesInsertionPlan(ids.conversationId);
    var legacyInserted = false;

    function renderAutoReply(r) {
      messages.appendChild(renderMessage({ role: 'agent', text: String(r.text), sender_name: 'Suporte' }));
    }

    msgs.forEach(function (m, idx) {
      messages.appendChild(renderMessage(m));

      // Insert auto-reply right after the triggering user message.
      var mid = (m && m.id != null) ? String(m.id) : '';
      if (mid && autoPlan.byAfterMessageId[mid] && autoPlan.byAfterMessageId[mid].length) {
        autoPlan.byAfterMessageId[mid].forEach(renderAutoReply);
        autoPlan.byAfterMessageId[mid] = [];
      }

      // Backward-compat: older stored auto-replies had no afterMessageId.
      // Keep them near the start of the conversation (after the first user message)
      // so agent messages stay below the auto-reply.
      if (!legacyInserted && autoPlan.legacy && autoPlan.legacy.length) {
        if (m && m.role === 'user') {
          autoPlan.legacy.forEach(renderAutoReply);
          autoPlan.legacy = [];
          legacyInserted = true;
        }
      }
    });

    // If legacy auto-replies exist but there were no user messages yet, show them at the top.
    if (!legacyInserted && autoPlan.legacy && autoPlan.legacy.length) {
      var frag = document.createDocumentFragment();
      autoPlan.legacy.forEach(function (r) {
        frag.appendChild(renderMessage({ role: 'agent', text: String(r.text), sender_name: 'Suporte' }));
      });
      messages.insertBefore(frag, messages.firstChild || null);
      autoPlan.legacy = [];
      legacyInserted = true;
    }
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendMessage(text) {
    var ids = await ensureConversation();
    setChatOpenState();
    var res = await fetch(withHostSessionToken(apiBase + '/v1/conversations/' + encodeURIComponent(ids.conversationId) + '/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chat-Visitor-Id': ids.visitorId,
      },
      body: JSON.stringify({ role: 'user', text: text }),
    });
    var json = await res.json();
    if (!res.ok || !json || !json.ok) {
      var msg = (json && json.error) ? String(json.error) : 'Falha ao enviar';
      if (res.status === 409 || msg.toLowerCase().includes('encerrada')) {
        handleRemoteClosed('Conversa encerrada pelo suporte. Se quiser, envie uma nova mensagem para iniciar outra.');
      }
      throw new Error(msg);
    }

    return json.message;
  }

  var pollId = null;
  var lastPollError = '';
  function stopPolling() {
    if (pollId) {
      clearInterval(pollId);
      pollId = null;
    }
  }
  function startPolling() {
    stopPolling();
    pollId = setInterval(function () {
      loadMessages().then(function () {
        lastPollError = '';
      }).catch(function (e) {
        var msg = (e && e.message) ? String(e.message) : 'Falha ao atualizar';
        if (msg !== lastPollError) {
          lastPollError = msg;
          messages.appendChild(el('div', { text: 'Erro ao atualizar: ' + msg }));
        }
      });
    }, 5000);
  }

  button.addEventListener('click', async function () {
    var open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'flex';
    // When chat is open, make mascot less distracting.
    try { mascot.style.opacity = open ? '1' : '0.65'; } catch (e) {}
    if (!open) {
      try {
        await loadMessages();
        startPolling();
      } catch (e) {
        messages.textContent = 'Erro: ' + (e && e.message ? e.message : 'Falha');
      }
    } else {
      stopPolling();
    }
  });

  closeBtn.addEventListener('click', function () {
    if (!confirm('Encerrar esta conversa?')) return;
    closeConversation().catch(function (e) {
      messages.appendChild(el('div', { text: 'Erro: ' + (e && e.message ? e.message : 'Falha') }));
    });
  });

  form.addEventListener('submit', async function (evt) {
    evt.preventDefault();
    var text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    try {
      await sendMessage(text);
      await loadMessages();
    } catch (e) {
      messages.appendChild(el('div', { text: 'Erro: ' + (e && e.message ? e.message : 'Falha') }));
    }
  });
})();
