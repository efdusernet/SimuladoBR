/**
 * Auth helpers (frontend)
 *
 * Centralizes how we build request identity/headers.
 *
 * Rule: prefer the real `sessionToken` for `X-Session-Token`.
 * Fallback to `nomeUsuario` only when `sessionToken` is absent.
 */
(function initAuthHelpers(){
  function shouldKeepExistingAuth(){
    try {
      const existing = window.Auth;
      if (!existing) return false;
      if (typeof existing.getAuthHeaders !== 'function') return false;
      if (typeof existing.getSessionIdentity !== 'function') return false;

      // Sanity check: when a real sessionToken exists, it MUST be preferred.
      const sessionToken = safeTrim(localStorage.getItem('sessionToken'));
      const nomeUsuario = safeTrim(localStorage.getItem('nomeUsuario'));
      const identity = safeTrim(existing.getSessionIdentity());
      if (sessionToken && identity !== sessionToken) return false;
      if (!sessionToken && nomeUsuario && identity !== nomeUsuario) return false;

      return true;
    } catch(_){
      return false;
    }
  }

  // Keep an existing implementation only if it matches the precedence rules.
  if (shouldKeepExistingAuth()) return;

  function safeTrim(v){
    try { return String(v == null ? '' : v).trim(); } catch(_){ return ''; }
  }

  function getSessionToken(){
    try { return safeTrim(localStorage.getItem('sessionToken')); } catch(_){ return ''; }
  }

  function getNomeUsuario(){
    try { return safeTrim(localStorage.getItem('nomeUsuario')); } catch(_){ return ''; }
  }

  function getSessionIdentity(){
    const token = getSessionToken();
    const nomeUsuario = getNomeUsuario();
    return token || nomeUsuario;
  }

  function getJwt(){
    try {
      const jwtTok = safeTrim(localStorage.getItem('jwtToken')) || safeTrim(localStorage.getItem('jwt'));
      const jwtType = safeTrim(localStorage.getItem('jwtTokenType')) || safeTrim(localStorage.getItem('jwt_type')) || 'Bearer';
      return jwtTok ? { token: jwtTok, type: jwtType } : null;
    } catch(_){
      return null;
    }
  }

  /**
   * Build headers for API calls.
   * @param {object} opts
   * @param {boolean} [opts.acceptJson]
   * @param {string}  [opts.contentType]
   * @param {object}  [opts.extra]
   */
  function getAuthHeaders(opts){
    const options = opts || {};
    const headers = {};

    if (options.acceptJson) headers['Accept'] = 'application/json';
    if (options.contentType) headers['Content-Type'] = options.contentType;

    const identity = getSessionIdentity();
    if (identity) headers['X-Session-Token'] = identity;

    const jwt = getJwt();
    if (jwt && jwt.token) headers['Authorization'] = jwt.type + ' ' + jwt.token;

    if (options.extra && typeof options.extra === 'object') {
      for (const [key, value] of Object.entries(options.extra)) {
        if (value === undefined || value === null) continue;
        headers[key] = value;
      }
    }

    return headers;
  }

  window.Auth = {
    getSessionToken,
    getNomeUsuario,
    getSessionIdentity,
    getJwt,
    getAuthHeaders,
  };
})();
