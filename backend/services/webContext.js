const dns = require('dns').promises;
const net = require('net');

function getEnv(name, fallback = '') {
  const v = process.env[name];
  return (v == null || String(v).trim() === '') ? fallback : String(v).trim();
}

function getEnvBool(name, fallback = false) {
  const v = getEnv(name, fallback ? 'true' : 'false').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

function getEnvInt(name, fallback, { min = undefined, max = undefined } = {}) {
  const raw = getEnv(name, String(fallback));
  const n = Number(raw);
  if (!Number.isFinite(n)) return Number(fallback);
  if (Number.isFinite(min) && n < min) return Number(fallback);
  if (Number.isFinite(max) && n > max) return Number(fallback);
  return Math.floor(n);
}

function parseAllowlist(raw) {
  const list = String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase());
  return list;
}

function hostAllowed(hostname, allowlist) {
  if (!hostname) return false;
  const host = String(hostname).toLowerCase();
  if (!allowlist || !allowlist.length) return false;

  for (const entry of allowlist) {
    if (!entry) continue;
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(2);
      if (host === suffix) return true;
      if (host.endsWith('.' + suffix)) return true;
      continue;
    }
    if (host === entry) return true;
  }
  return false;
}

function isPrivateIp(ip) {
  const kind = net.isIP(ip);
  if (!kind) return true;

  if (kind === 4) {
    const parts = ip.split('.').map(n => Number(n));
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;

    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  // IPv6 (heurística suficiente para SSRF guard)
  const s = ip.toLowerCase();
  if (s === '::1') return true;
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // fc00::/7 unique local
  if (s.startsWith('fe80:')) return true; // link-local
  return false;
}

async function assertPublicHost(hostname) {
  const host = String(hostname || '').trim();
  if (!host) throw new Error('Host inválido');

  // Obvious local names
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    throw new Error('Host local não permitido');
  }

  // If hostname is already an IP, validate it
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('IP privado/local não permitido');
    return;
  }

  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs || !addrs.length) throw new Error('Falha ao resolver DNS');
  for (const a of addrs) {
    const ip = a && a.address ? String(a.address) : '';
    if (!ip || isPrivateIp(ip)) {
      throw new Error('Host resolve para IP privado/local (bloqueado)');
    }
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    const name = err && err.name ? String(err.name) : '';
    if (name === 'AbortError' || /aborted/i.test(msg)) {
      const e = new Error(`Timeout após ${timeoutMs}ms`);
      e.cause = err;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyAsTextLimited(res, maxBytes) {
  const limit = Number(maxBytes);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('maxBytes inválido');

  if (!res.body || typeof res.body.getReader !== 'function') {
    // Fallback (Node/undici deve suportar streams, mas garantimos)
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > limit) throw new Error(`Resposta excede limite (${buf.length} > ${limit} bytes)`);
    return buf.toString('utf8');
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) throw new Error(`Resposta excede limite (${total} > ${limit} bytes)`);
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  const buf = Buffer.concat(chunks.map(u8 => Buffer.from(u8)));
  return buf.toString('utf8');
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = parseInt(hex, 16);
      if (!Number.isFinite(cp)) return '';
      try { return String.fromCodePoint(cp); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const cp = parseInt(num, 10);
      if (!Number.isFinite(cp)) return '';
      try { return String.fromCodePoint(cp); } catch { return ''; }
    });
}

function extractTitleFromHtml(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const raw = decodeHtmlEntities(m[1]);
  const t = raw.replace(/\s+/g, ' ').trim();
  return t || null;
}

function extractTextFromHtml(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeHtmlEntities(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function truncateText(s, maxChars) {
  const limit = Number(maxChars);
  const str = String(s || '');
  if (!Number.isFinite(limit) || limit <= 0) return '';
  if (str.length <= limit) return str;
  return str.slice(0, limit) + '…';
}

function getWebConfig() {
  return {
    enabled: getEnvBool('AI_WEB_ENABLED', false),
    allowAll: getEnvBool('AI_WEB_ALLOW_ALL', false),
    allowlist: parseAllowlist(getEnv('AI_WEB_ALLOWLIST', '')),
    maxFetchBytes: getEnvInt('AI_WEB_MAX_FETCH_BYTES', 350_000, { min: 10_000, max: 5_000_000 }),
    maxExtractChars: getEnvInt('AI_WEB_MAX_EXTRACT_CHARS', 12_000, { min: 1_000, max: 100_000 }),
    fetchTimeoutMs: getEnvInt('AI_WEB_FETCH_TIMEOUT_MS', 12_000, { min: 2_000, max: 120_000 }),
    searchTimeoutMs: getEnvInt('AI_WEB_SEARCH_TIMEOUT_MS', 10_000, { min: 2_000, max: 120_000 }),
    allowAnyPort: getEnvBool('AI_WEB_ALLOW_ANY_PORT', false),
  };
}

function validateUrlOrThrow(rawUrl, cfg) {
  let u;
  try {
    u = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('URL inválida');
  }

  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Somente http/https é permitido');
  if (!u.hostname) throw new Error('Host inválido');
  if (!cfg.allowAnyPort) {
    const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
    if (port !== 80 && port !== 443) throw new Error('Porta não permitida (apenas 80/443)');
  }

  if (!(cfg.allowAll || hostAllowed(u.hostname, cfg.allowlist))) {
    throw new Error('Host não permitido (use AI_WEB_ALLOWLIST ou AI_WEB_ALLOW_ALL)');
  }

  return u;
}

async function webFetchText(url, { cfg, headers = undefined } = {}) {
  const finalCfg = cfg || getWebConfig();
  if (!finalCfg.enabled) throw new Error('AI web desabilitado (AI_WEB_ENABLED=false)');

  const u = validateUrlOrThrow(url, finalCfg);
  await assertPublicHost(u.hostname);

  const res = await fetchWithTimeout(u.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'Accept': 'text/html, text/plain, application/json;q=0.8, */*;q=0.2',
      'User-Agent': 'SimuladosBR/1.0 (web-context-fetch)',
      ...(headers || {}),
    }
  }, finalCfg.fetchTimeoutMs);

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok) {
    const body = await readBodyAsTextLimited(res, Math.min(finalCfg.maxFetchBytes, 50_000)).catch(() => '');
    throw new Error(`Fetch HTTP ${res.status}: ${body || res.statusText}`);
  }

  const raw = await readBodyAsTextLimited(res, finalCfg.maxFetchBytes);
  const title = contentType.includes('text/html') ? (extractTitleFromHtml(raw) || null) : null;
  const text = contentType.includes('text/html') ? extractTextFromHtml(raw) : String(raw || '').replace(/\s+/g, ' ').trim();

  return {
    url: u.toString(),
    status: res.status,
    contentType: contentType || null,
    title,
    text: truncateText(text, finalCfg.maxExtractChars),
  };
}

async function webSearch(query, { cfg, count = 5 } = {}) {
  const finalCfg = cfg || getWebConfig();
  if (!finalCfg.enabled) throw new Error('AI web desabilitado (AI_WEB_ENABLED=false)');

  const q = String(query || '').trim();
  if (!q) throw new Error('Query vazia');

  const k = Math.min(Math.max(Number(count) || 5, 1), 10);

  const bingKey = getEnv('BING_SEARCH_KEY', '');
  const bingEndpoint = getEnv('BING_SEARCH_ENDPOINT', 'https://api.bing.microsoft.com/v7.0/search');
  if (bingKey) {
    const u = new URL(bingEndpoint);
    u.searchParams.set('q', q);
    u.searchParams.set('count', String(k));
    u.searchParams.set('mkt', 'pt-BR');
    u.searchParams.set('safeSearch', 'Moderate');

    const res = await fetchWithTimeout(u.toString(), {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': bingKey,
        'User-Agent': 'SimuladosBR/1.0 (web-search)',
      }
    }, finalCfg.searchTimeoutMs);

    if (!res.ok) {
      const body = await readBodyAsTextLimited(res, Math.min(80_000, finalCfg.maxFetchBytes)).catch(() => '');
      throw new Error(`Bing HTTP ${res.status}: ${body || res.statusText}`);
    }

    const json = await res.json();
    const values = (json && json.webPages && Array.isArray(json.webPages.value)) ? json.webPages.value : [];
    return {
      provider: 'bing',
      query: q,
      results: values.slice(0, k).map(v => ({
        title: v.name || null,
        url: v.url || null,
        snippet: v.snippet || null,
      })).filter(r => r.url),
    };
  }

  const serpKey = getEnv('SERPAPI_KEY', '');
  if (serpKey) {
    const u = new URL('https://serpapi.com/search.json');
    u.searchParams.set('engine', 'google');
    u.searchParams.set('q', q);
    u.searchParams.set('num', String(k));
    u.searchParams.set('hl', 'pt');
    u.searchParams.set('gl', 'br');
    u.searchParams.set('api_key', serpKey);

    const res = await fetchWithTimeout(u.toString(), {
      method: 'GET',
      headers: { 'User-Agent': 'SimuladosBR/1.0 (web-search)' }
    }, finalCfg.searchTimeoutMs);

    if (!res.ok) {
      const body = await readBodyAsTextLimited(res, Math.min(80_000, finalCfg.maxFetchBytes)).catch(() => '');
      throw new Error(`SerpAPI HTTP ${res.status}: ${body || res.statusText}`);
    }

    const json = await res.json();
    const items = Array.isArray(json && json.organic_results) ? json.organic_results : [];
    return {
      provider: 'serpapi',
      query: q,
      results: items.slice(0, k).map(v => ({
        title: v.title || null,
        url: v.link || null,
        snippet: v.snippet || null,
      })).filter(r => r.url),
    };
  }

  const err = new Error('Web search não configurado (defina BING_SEARCH_KEY ou SERPAPI_KEY)');
  err.code = 'WEB_SEARCH_NOT_CONFIGURED';
  throw err;
}

module.exports = {
  getWebConfig,
  webSearch,
  webFetchText,
  extractTextFromHtml,
  truncateText,
};
