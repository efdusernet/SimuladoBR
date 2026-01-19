function _isPlainObject(v){
	return v != null && typeof v === 'object' && !Array.isArray(v);
}

function isMatchColumnsSlug(slug){
	try { return String(slug || '').trim().toLowerCase() === 'match_columns'; } catch(_) { return false; }
}

function normalizeMatchColumnsSpec(raw){
	// Accept JSON string payloads (e.g. DB stored as stringified JSON)
	// and Buffer values that may come from some drivers.
	try {
		if (typeof raw === 'string') {
			const s = raw.trim();
			if (s) {
				try { raw = JSON.parse(s); } catch(_){ /* keep as-is */ }
			}
		} else if (raw && typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(raw)) {
			try {
				const s = raw.toString('utf8').trim();
				if (s) {
					try { raw = JSON.parse(s); } catch(_){ /* keep as-is */ }
				}
			} catch(_){ /* ignore */ }
		}
	} catch(_){ /* ignore */ }

	// Accept either { kind:'match_columns', ... } or direct spec
	const spec = _isPlainObject(raw) ? raw : null;
	if (!spec) return null;
	const kind = spec.kind != null ? String(spec.kind).trim().toLowerCase() : null;
	if (kind && kind !== 'match_columns') return null;
	const left = Array.isArray(spec.left) ? spec.left : [];
	const right = Array.isArray(spec.right) ? spec.right : [];
	const shuffleRight = spec.shuffleRight != null ? Boolean(spec.shuffleRight) : true;
	const oneToOne = spec.oneToOne != null ? Boolean(spec.oneToOne) : true;
	const answerKey = _isPlainObject(spec.answerKey) ? spec.answerKey : {};

	function normItems(items, prefix){
		const out = [];
		for (let i = 0; i < items.length; i++){
			const it = items[i];
			if (it == null) continue;
			if (typeof it === 'string'){
				const text = it.trim();
				if (!text) continue;
				out.push({ id: prefix + String(out.length + 1), text });
				continue;
			}
			if (_isPlainObject(it)){
				const id = (it.id != null) ? String(it.id).trim() : '';
				const text = (it.text != null ? String(it.text) : (it.descricao != null ? String(it.descricao) : '')).trim();
				if (!text) continue;
				out.push({ id: id || (prefix + String(out.length + 1)), text });
			}
		}
		return out;
	}

	return {
		kind: 'match_columns',
		left: normItems(left, 'L'),
		right: normItems(right, 'R'),
		answerKey: answerKey,
		shuffleRight,
		oneToOne,
	};
}

function validateMatchColumnsSpec(raw){
	const spec = normalizeMatchColumnsSpec(raw);
	if (!spec) return { ok: false, message: 'invalid match_columns spec', code: 'MATCH_SPEC_INVALID' };

	if (!Array.isArray(spec.left) || spec.left.length < 2) {
		return { ok: false, message: 'left must have at least 2 items', code: 'MATCH_SPEC_LEFT_MIN' };
	}
	if (!Array.isArray(spec.right) || spec.right.length < 2) {
		return { ok: false, message: 'right must have at least 2 items', code: 'MATCH_SPEC_RIGHT_MIN' };
	}

	const leftIds = new Set();
	for (const it of spec.left){
		const id = String(it && it.id || '').trim();
		if (!id) return { ok: false, message: 'left item id required', code: 'MATCH_SPEC_LEFT_ID_REQUIRED' };
		if (leftIds.has(id)) return { ok: false, message: 'left item ids must be unique', code: 'MATCH_SPEC_LEFT_ID_DUP' };
		leftIds.add(id);
	}
	const rightIds = new Set();
	for (const it of spec.right){
		const id = String(it && it.id || '').trim();
		if (!id) return { ok: false, message: 'right item id required', code: 'MATCH_SPEC_RIGHT_ID_REQUIRED' };
		if (rightIds.has(id)) return { ok: false, message: 'right item ids must be unique', code: 'MATCH_SPEC_RIGHT_ID_DUP' };
		rightIds.add(id);
	}

	if (!_isPlainObject(spec.answerKey)) {
		return { ok: false, message: 'answerKey required', code: 'MATCH_SPEC_ANSWERKEY_REQUIRED' };
	}

	const usedRight = new Set();
	for (const leftId of leftIds){
		const rightId = spec.answerKey[leftId];
		if (rightId == null || String(rightId).trim() === '') {
			return { ok: false, message: 'answerKey must include mapping for every left item', code: 'MATCH_SPEC_ANSWERKEY_INCOMPLETE' };
		}
		const rid = String(rightId).trim();
		if (!rightIds.has(rid)) {
			return { ok: false, message: 'answerKey references unknown rightId', code: 'MATCH_SPEC_ANSWERKEY_UNKNOWN_RIGHT' };
		}
		if (spec.oneToOne) {
			if (usedRight.has(rid)) return { ok: false, message: 'answerKey must be one-to-one (rightId repeated)', code: 'MATCH_SPEC_ANSWERKEY_NOT_ONE_TO_ONE' };
			usedRight.add(rid);
		}
	}

	// Reject extra keys (helps detect typos)
	for (const k of Object.keys(spec.answerKey)){
		if (!leftIds.has(String(k))) {
			return { ok: false, message: 'answerKey has unknown leftId', code: 'MATCH_SPEC_ANSWERKEY_UNKNOWN_LEFT' };
		}
	}

	return { ok: true, spec };
}

function toPublicMatchColumnsSpec(spec){
	const normalized = normalizeMatchColumnsSpec(spec);
	if (!normalized) return null;
	return {
		kind: 'match_columns',
		left: normalized.left,
		right: normalized.right,
		shuffleRight: normalized.shuffleRight,
		oneToOne: normalized.oneToOne,
	};
}

function normalizeMatchColumnsResponse(raw){
	// Accept JSON string payloads (some clients/DB paths may stringify JSON)
	// and Buffer values that may come from some drivers.
	try {
		if (typeof raw === 'string') {
			const s = raw.trim();
			if (s) {
				try { raw = JSON.parse(s); } catch(_){ /* keep as-is */ }
			}
		} else if (raw && typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(raw)) {
			try {
				const s = raw.toString('utf8').trim();
				if (s) {
					try { raw = JSON.parse(s); } catch(_){ /* keep as-is */ }
				}
			} catch(_){ /* ignore */ }
		}
	} catch(_){ /* ignore */ }

	if (raw == null) return { pairs: {} };
	if (_isPlainObject(raw) && _isPlainObject(raw.pairs)) return { pairs: raw.pairs };
	if (_isPlainObject(raw) && Array.isArray(raw.pairs)) {
		const pairs = {};
		for (const p of raw.pairs){
			if (!_isPlainObject(p)) continue;
			const l = p.leftId != null ? String(p.leftId).trim() : '';
			const r = p.rightId != null ? String(p.rightId).trim() : '';
			if (!l || !r) continue;
			pairs[l] = r;
		}
		return { pairs };
	}
	if (_isPlainObject(raw)) {
		// Accept direct mapping object
		if (raw.leftId && raw.rightId) return { pairs: { [String(raw.leftId).trim()]: String(raw.rightId).trim() } };
		return { pairs: raw };
	}
	return { pairs: {} };
}

function gradeMatchColumns(specRaw, responseRaw){
	const v = validateMatchColumnsSpec(specRaw);
	if (!v.ok) return { ok: false, isCorrect: false, code: v.code, message: v.message };
	const spec = v.spec;
	const resp = normalizeMatchColumnsResponse(responseRaw);
	const leftIds = new Set(spec.left.map(i => String(i.id)));
	const rightIds = new Set(spec.right.map(i => String(i.id)));

	const pairs = _isPlainObject(resp.pairs) ? resp.pairs : {};

	// Strict: no unknown ids
	for (const [l, r] of Object.entries(pairs)){
		const lid = String(l).trim();
		const rid = (r == null) ? '' : String(r).trim();
		if (!leftIds.has(lid)) return { ok: true, isCorrect: false, reason: 'unknown_left' };
		if (!rightIds.has(rid)) return { ok: true, isCorrect: false, reason: 'unknown_right' };
	}

	// Must answer all left items
	for (const lid of leftIds){
		const chosen = pairs[lid];
		if (chosen == null || String(chosen).trim() === '') return { ok: true, isCorrect: false, reason: 'incomplete' };
		if (String(chosen).trim() !== String(spec.answerKey[lid]).trim()) return { ok: true, isCorrect: false, reason: 'mismatch' };
	}

	if (spec.oneToOne) {
		const seen = new Set();
		for (const lid of leftIds){
			const rid = String(pairs[lid]).trim();
			if (seen.has(rid)) return { ok: true, isCorrect: false, reason: 'not_one_to_one' };
			seen.add(rid);
		}
	}

	return { ok: true, isCorrect: true };
}

module.exports = {
	isMatchColumnsSlug,
	normalizeMatchColumnsSpec,
	validateMatchColumnsSpec,
	toPublicMatchColumnsSpec,
	normalizeMatchColumnsResponse,
	gradeMatchColumns,
};
