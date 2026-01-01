function stripCodeFences(text) {
  const s = String(text || '').trim();
  return s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractFirstJsonValue(text) {
  const s = String(text || '');
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const start = (firstObj === -1)
    ? firstArr
    : (firstArr === -1 ? firstObj : Math.min(firstObj, firstArr));
  if (start === -1) return null;

  const stack = [];
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const last = stack[stack.length - 1];
      const matches = (last === '{' && ch === '}') || (last === '[' && ch === ']');
      if (matches) stack.pop();
      if (stack.length === 0) {
        return s.slice(start, i + 1);
      }
    }
  }

  return null;
}

function tryParseJsonLenient(text) {
  const cleaned = stripCodeFences(text)
    .replace(/^\uFEFF/, '')
    // Normalize common “smart quotes” that break JSON
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  const candidates = [];
  if (cleaned) candidates.push(cleaned);

  const extracted = extractFirstJsonValue(cleaned);
  if (extracted) candidates.push(extracted);

  for (const cand of candidates) {
    try {
      return JSON.parse(cand);
    } catch {}

    try {
      const noTrailingCommas = cand.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(noTrailingCommas);
    } catch {}

    // Last resort: repair "almost JSON" (e.g., single quotes, unquoted keys)
    try {
      // Lazy-require so this util still works even if dependency isn't installed.
      // eslint-disable-next-line global-require
      const { jsonrepair } = require('jsonrepair');
      const repaired = jsonrepair(cand);
      if (repaired) return JSON.parse(repaired);
    } catch {}
  }

  return null;
}

module.exports = {
  stripCodeFences,
  extractFirstJsonValue,
  tryParseJsonLenient,
};
