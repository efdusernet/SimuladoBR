const TARGET_PROVIDER = 'gemini';
const TARGET_MODEL = 'gemini-2.5-flash';

function normalizeProvider(p) {
  return String(p || '').trim().toLowerCase();
}

function normalizeModelName(model) {
  const s = String(model || '').trim();
  if (!s) return '';
  return s.startsWith('models/') ? s.slice('models/'.length) : s;
}

function isGeminiFlashConfigured() {
  const model = normalizeModelName(process.env.GEMINI_MODEL || '');
  return normalizeModelName(model) === TARGET_MODEL;
}

function maxClicksForRemainingDays({ remainingDays, lifetime }) {
  if (lifetime) return null; // unlimited
  const d = remainingDays == null ? null : Number(remainingDays);
  if (!Number.isFinite(d) || d <= 0) return 0;

  if (d >= 1 && d <= 30) return 5;
  if (d >= 31 && d <= 60) return 20;
  if (d >= 61 && d <= 90) return 30;
  if (d >= 91 && d <= 180) return 40;
  if (d > 180) return 40;
  return 0;
}

module.exports = {
  TARGET_PROVIDER,
  TARGET_MODEL,
  normalizeProvider,
  normalizeModelName,
  isGeminiFlashConfigured,
  maxClicksForRemainingDays,
};
