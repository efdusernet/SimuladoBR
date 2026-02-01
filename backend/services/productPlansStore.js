const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'productPlans.json');
const BACKUP_DIR = path.join(__dirname, '..', 'backups', 'productPlans');

function safeIsoForFilename(d = new Date()) {
  try {
    return d.toISOString().replace(/[:.]/g, '-');
  } catch (_) {
    return String(Date.now());
  }
}

async function ensureBackupDir() {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
}

async function backupExistingFile(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
  } catch (_) {
    return null; // nothing to back up
  }

  try {
    await ensureBackupDir();
    const stamp = safeIsoForFilename(new Date());
    const base = path.basename(filePath);
    const backupPath = path.join(BACKUP_DIR, `${base}.${stamp}.bak.json`);
    await fs.promises.copyFile(filePath, backupPath);
    return backupPath;
  } catch (_) {
    return null;
  }
}

function toInt(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function normalizePlan(input) {
  const plan = input && typeof input === 'object' ? input : {};

  const id = String(plan.id || '').trim();
  if (!id) throw new Error('id is required');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new Error('id must match ^[a-z0-9][a-z0-9-]{1,40}$');

  const name = String(plan.name || '').trim();
  if (!name) throw new Error('name is required');

  const description = String(plan.description || '').trim();

  const is_free = !!plan.is_free;

  const price_cents = toInt(plan.price_cents, 0);
  if (!Number.isFinite(price_cents) || price_cents < 0) throw new Error('price_cents must be >= 0');

  const access_duration_days_raw = (plan.access_duration_days === null || plan.access_duration_days === undefined || plan.access_duration_days === '')
    ? null
    : toInt(plan.access_duration_days, null);
  const access_duration_days = access_duration_days_raw === null ? null : access_duration_days_raw;
  if (access_duration_days !== null && (!Number.isFinite(access_duration_days) || access_duration_days <= 0)) {
    throw new Error('access_duration_days must be null or > 0');
  }

  const is_active = plan.is_active === undefined ? true : !!plan.is_active;
  const is_featured = !!plan.is_featured;

  const sort_order = toInt(plan.sort_order, 1000);

  const tag = plan.tag && typeof plan.tag === 'object' ? plan.tag : {};
  const cta = plan.cta && typeof plan.cta === 'object' ? plan.cta : {};
  const badge = plan.badge && typeof plan.badge === 'object' ? plan.badge : {};

  const tagText = String(tag.text || '').trim();
  const tagVariant = String(tag.variant || '').trim();
  const ctaText = String(cta.text || '').trim();
  const ctaVariant = String(cta.variant || '').trim();
  const badgeText = String(badge.text || '').trim();

  const features = Array.isArray(plan.features)
    ? plan.features.map((f) => String(f || '').trim()).filter(Boolean).slice(0, 40)
    : [];

  return {
    id,
    name,
    description,
    price_cents,
    access_duration_days,
    is_free,
    is_active,
    is_featured,
    sort_order,
    tag: tagText || tagVariant ? { text: tagText, variant: tagVariant } : undefined,
    cta: ctaText || ctaVariant ? { text: ctaText, variant: ctaVariant } : undefined,
    badge: badgeText ? { text: badgeText } : undefined,
    features,
    updated_at: new Date().toISOString(),
  };
}

function normalizePlansArray(arr) {
  const input = Array.isArray(arr) ? arr : [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    const p = normalizePlan(raw);
    if (seen.has(p.id)) throw new Error(`duplicate id: ${p.id}`);
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

async function readJsonFileSafe(filePath) {
  const txt = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(txt);
}

async function ensureDataDir() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
}

async function writeJsonAtomic(filePath, data) {
  await ensureDataDir();
  // Best-effort backup before overwriting.
  await backupExistingFile(filePath);
  const tmp = filePath + '.tmp';
  const json = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmp, json, 'utf8');
  await fs.promises.rename(tmp, filePath);
}

async function loadPlans({ fallbackPlans = [] } = {}) {
  try {
    const raw = await readJsonFileSafe(FILE_PATH);
    const plans = normalizePlansArray(raw);
    return { ok: true, source: 'file', filePath: FILE_PATH, plans };
  } catch (err) {
    const code = err && err.code ? String(err.code) : '';
    const msg = err && err.message ? String(err.message) : String(err);
    const notFound = code === 'ENOENT';
    if (notFound) {
      const plans = normalizePlansArray(fallbackPlans);
      return { ok: true, source: 'default', filePath: FILE_PATH, plans };
    }
    // Any parse/validation error: fall back but report.
    const plans = normalizePlansArray(fallbackPlans);
    return { ok: false, source: 'fallback', filePath: FILE_PATH, plans, error: msg };
  }
}

async function savePlans(plans) {
  const normalized = normalizePlansArray(plans);
  await writeJsonAtomic(FILE_PATH, normalized);
  return { ok: true, filePath: FILE_PATH, plans: normalized };
}

async function upsertPlan(plan) {
  const next = normalizePlan(plan);
  const current = await loadPlans({ fallbackPlans: [] });
  const plans = Array.isArray(current.plans) ? [...current.plans] : [];
  const idx = plans.findIndex((p) => p.id === next.id);
  if (idx >= 0) plans[idx] = { ...plans[idx], ...next };
  else plans.push(next);
  await savePlans(plans);
  return { ok: true, plan: next };
}

async function deletePlan(id) {
  const planId = String(id || '').trim();
  if (!planId) throw new Error('id is required');
  const current = await loadPlans({ fallbackPlans: [] });
  const plans = Array.isArray(current.plans) ? [...current.plans] : [];
  const before = plans.length;
  const after = plans.filter((p) => p.id !== planId);
  if (after.length === before) return { ok: false, deleted: false, reason: 'not_found' };
  await savePlans(after);
  return { ok: true, deleted: true };
}

module.exports = {
  FILE_PATH,
  loadPlans,
  savePlans,
  upsertPlan,
  deletePlan,
  normalizePlan,
  normalizePlansArray,
};
