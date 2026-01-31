const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'userParams.json');

function toInt(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function toBool(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
}

function normalizeStringArray(value, { maxItems = 50 } = {}) {
  const arr = Array.isArray(value) ? value : [];
  return arr.map((v) => String(v || '').trim()).filter(Boolean).slice(0, maxItems);
}

function getDefaultParams() {
  return {
    version: 1,
    updated_at: new Date().toISOString(),

    // Exam limits
    fullExamQuestionCount: 180,
    freeExamQuestionLimit: 25,

    // Free users content restrictions
    freeOnlySeedQuestions: true,

    // Feature gating (UI + API). If a flag is true, it means that feature is premium-only.
    premiumOnly: {
      onlyNewQuestions: true,
      insightsIA: true,
      indicatorsTabs: ['dist', 'detalhes', 'dashboard', 'dominios', 'prob'],
      chatWidgetDesktop: true,
      chatProxyDefault: true,
      aiDailySnapshot: true,
    },

    // Behavior knobs
    chat: {
      // When premiumOnly.chatProxyDefault=true, anything beyond public widget flow is premium-only.
      // If set to false, non-public endpoints become "authenticated" (still not admin) instead of premium.
      allowFreeAuthenticatedAccess: false,
    },
  };
}

function normalizeParams(input, { env = process.env } = {}) {
  const base = getDefaultParams();
  const p = input && typeof input === 'object' ? input : {};

  // Allow .env defaults to still apply when file is absent
  const envFull = toInt(env.FULL_EXAM_QUESTION_COUNT, base.fullExamQuestionCount);
  const envFree = toInt(env.FREE_EXAM_QUESTION_LIMIT, base.freeExamQuestionLimit);

  const fullExamQuestionCount = toInt(p.fullExamQuestionCount, envFull);
  const freeExamQuestionLimit = toInt(p.freeExamQuestionLimit, envFree);

  // Hard safety bounds (avoid invalid configs bringing server down)
  const safeFull = Math.max(1, Math.min(500, fullExamQuestionCount));
  const safeFree = Math.max(1, Math.min(500, freeExamQuestionLimit));

  const freeOnlySeedQuestions = toBool(p.freeOnlySeedQuestions, base.freeOnlySeedQuestions);

  const premiumOnly = p.premiumOnly && typeof p.premiumOnly === 'object' ? p.premiumOnly : {};
  const premiumOnlyNormalized = {
    onlyNewQuestions: toBool(premiumOnly.onlyNewQuestions, base.premiumOnly.onlyNewQuestions),
    insightsIA: toBool(premiumOnly.insightsIA, base.premiumOnly.insightsIA),
    indicatorsTabs: normalizeStringArray(premiumOnly.indicatorsTabs, { maxItems: 20 }),
    chatWidgetDesktop: toBool(premiumOnly.chatWidgetDesktop, base.premiumOnly.chatWidgetDesktop),
    chatProxyDefault: toBool(premiumOnly.chatProxyDefault, base.premiumOnly.chatProxyDefault),
    aiDailySnapshot: toBool(premiumOnly.aiDailySnapshot, base.premiumOnly.aiDailySnapshot),
  };
  if (!premiumOnlyNormalized.indicatorsTabs.length) {
    premiumOnlyNormalized.indicatorsTabs = [...base.premiumOnly.indicatorsTabs];
  }

  const chat = p.chat && typeof p.chat === 'object' ? p.chat : {};
  const chatNormalized = {
    allowFreeAuthenticatedAccess: toBool(chat.allowFreeAuthenticatedAccess, base.chat.allowFreeAuthenticatedAccess),
  };

  return {
    version: toInt(p.version, base.version) || 1,
    updated_at: new Date().toISOString(),
    fullExamQuestionCount: safeFull,
    freeExamQuestionLimit: safeFree,
    freeOnlySeedQuestions,
    premiumOnly: premiumOnlyNormalized,
    chat: chatNormalized,
  };
}

async function ensureDataDir() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFileSafe(filePath) {
  const txt = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(txt);
}

async function writeJsonAtomic(filePath, data) {
  await ensureDataDir();
  const tmp = filePath + '.tmp';
  const json = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmp, json, 'utf8');
  await fs.promises.rename(tmp, filePath);
}

async function loadParams() {
  try {
    const raw = await readJsonFileSafe(FILE_PATH);
    const params = normalizeParams(raw);
    return { ok: true, source: 'file', filePath: FILE_PATH, params };
  } catch (err) {
    const code = err && err.code ? String(err.code) : '';
    const msg = err && err.message ? String(err.message) : String(err);
    const notFound = code === 'ENOENT';
    if (notFound) {
      const params = normalizeParams(getDefaultParams());
      return { ok: true, source: 'default', filePath: FILE_PATH, params };
    }
    const params = normalizeParams(getDefaultParams());
    return { ok: false, source: 'fallback', filePath: FILE_PATH, params, error: msg };
  }
}

async function saveParams(input) {
  const params = normalizeParams(input);
  await writeJsonAtomic(FILE_PATH, params);
  return { ok: true, filePath: FILE_PATH, params };
}

function toPublicParams(params) {
  const p = normalizeParams(params);
  return {
    fullExamQuestionCount: p.fullExamQuestionCount,
    freeExamQuestionLimit: p.freeExamQuestionLimit,
    freeOnlySeedQuestions: p.freeOnlySeedQuestions,
    premiumOnly: {
      onlyNewQuestions: !!(p.premiumOnly && p.premiumOnly.onlyNewQuestions),
      insightsIA: !!(p.premiumOnly && p.premiumOnly.insightsIA),
      indicatorsTabs: Array.isArray(p.premiumOnly && p.premiumOnly.indicatorsTabs) ? p.premiumOnly.indicatorsTabs : [],
      chatWidgetDesktop: !!(p.premiumOnly && p.premiumOnly.chatWidgetDesktop),
    },
  };
}

// Lightweight in-process cache (avoid fs reads for every request)
let _cache = null;
let _cacheExpiresAt = 0;
async function getCachedParams({ maxAgeMs = 10_000 } = {}) {
  const now = Date.now();
  if (_cache && _cacheExpiresAt > now) return _cache;
  const result = await loadParams();
  _cache = result.params;
  _cacheExpiresAt = now + Math.max(500, Number(maxAgeMs) || 10_000);
  return _cache;
}

function clearCache() {
  _cache = null;
  _cacheExpiresAt = 0;
}

module.exports = {
  FILE_PATH,
  getDefaultParams,
  normalizeParams,
  loadParams,
  saveParams,
  toPublicParams,
  getCachedParams,
  clearCache,
};
