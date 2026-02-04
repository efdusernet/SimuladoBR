(function(){
  const btn = document.getElementById('btnCarregar');
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const meEmailEl = document.getElementById('meEmail');
  const lastUpdatedEl = document.getElementById('lastUpdated');

  const defaultLoadingText = loadingEl ? loadingEl.textContent : 'Carregando insights...';

  const kpiReadiness = document.getElementById('kpiReadiness');
  const kpiConsistency = document.getElementById('kpiConsistency');
  const kpiAvgScore = document.getElementById('kpiAvgScore');
  const kpiCompletion = document.getElementById('kpiCompletion');

  const headlineEl = document.getElementById('aiHeadline');
  const insightsListEl = document.getElementById('aiInsights');
  const risksListEl = document.getElementById('aiRisks');
  const actionsListEl = document.getElementById('aiActions');

  const aiExplainBoxEl = document.getElementById('aiExplainBox');

  const studyPlanBoxEl = document.getElementById('studyPlanBox');

  const chartScoreEl = document.getElementById('chartScore');
  const chartRatesEl = document.getElementById('chartRates');
  const indicatorsBoxEl = document.getElementById('indicatorsBox');
  const indicatorsErrorsEl = document.getElementById('indicatorsErrors');

  const flashcardsBoxEl = document.getElementById('flashcardsBox');

  const filterDomainEl = document.getElementById('filterDomain');
  const filterMinTotalEl = document.getElementById('filterMinTotal');

  const CACHE_KEY = 'aiInsightsCache_v2';
  const FILTERS_KEY = 'aiInsightsFilters_v1';

  function flashAnchorTarget(hash){
    const raw = String(hash || '').trim();
    if (!raw || raw === '#') return false;
    const id = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!id) return false;
    const el = document.getElementById(id);
    if (!el) return false;

    // Reinicia animação se o usuário clicar várias vezes
    try {
      el.classList.remove('flash-target');
      void el.offsetWidth;
      el.classList.add('flash-target');
      window.setTimeout(() => el.classList.remove('flash-target'), 1400);
    } catch(_){ }
    return true;
  }

  // Highlight ao clicar em links de âncora dentro da explicabilidade
  document.addEventListener('click', (ev) => {
    try {
      if (!aiExplainBoxEl) return;
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
      if (!a) return;
      if (!aiExplainBoxEl.contains(a)) return;
      const href = a.getAttribute('href');
      window.setTimeout(() => flashAnchorTarget(href), 60);
    } catch(_){ }
  });

  // Também funciona quando o hash muda por outros meios
  window.addEventListener('hashchange', () => {
    window.setTimeout(() => flashAnchorTarget(window.location.hash), 20);
  });

  // Caso a página abra já com hash
  window.setTimeout(() => flashAnchorTarget(window.location.hash), 120);

  function buildAuthHeaders(){
    try {
      if (window.Auth && typeof window.Auth.getAuthHeaders === 'function') {
        return window.Auth.getAuthHeaders({ acceptJson: true });
      }
    } catch(_){ }
    const headers = { 'Accept': 'application/json' };
    try {
      const jwtTok = ((localStorage.getItem('jwtToken') || localStorage.getItem('jwt') || '')).trim();
      const jwtType = ((localStorage.getItem('jwtTokenType') || localStorage.getItem('jwt_type') || 'Bearer')).trim() || 'Bearer';
      const sessionToken = (localStorage.getItem('sessionToken') || '').trim();
      const identity = sessionToken || (localStorage.getItem('nomeUsuario') || '').trim();
      if (jwtTok) headers['Authorization'] = `${jwtType} ${jwtTok}`;
      if (identity) headers['X-Session-Token'] = identity;
    } catch(_){ }
    return headers;
  }

  function setLoading(on){
    if (!loadingEl) return;
    if (on) loadingEl.textContent = defaultLoadingText;
    loadingEl.style.display = on ? 'block' : 'none';
  }
  function setError(on, msg){
    if (!errorEl) return;
    if (typeof msg !== 'undefined' && msg !== null) {
      try { errorEl.textContent = String(msg); } catch(_){ }
    }
    errorEl.style.display = on ? 'block' : 'none';
  }

  function setHint(msg){
    if (!loadingEl) return;
    loadingEl.textContent = String(msg || '');
    loadingEl.style.display = 'block';
  }

  function fmtDateTime(ts){
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString('pt-BR');
    } catch(_){
      return '—';
    }
  }

  function setLastUpdated(ts){
    if (!lastUpdatedEl) return;
    if (!ts) {
      lastUpdatedEl.textContent = 'Última atualização: —';
      return;
    }
    lastUpdatedEl.textContent = `Última atualização: ${fmtDateTime(ts)}`;
  }

  function loadCached(){
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.data || typeof parsed.data !== 'object') return null;
      return parsed;
    } catch(_){
      return null;
    }
  }

  function loadSavedFilters(){
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch(_){
      return null;
    }
  }

  function saveFilters(filters){
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters || {}));
    } catch(_){ }
  }

  function getFiltersFromUi(){
    const domainId = filterDomainEl ? String(filterDomainEl.value || '').trim() : '';
    const minTotalRaw = filterMinTotalEl ? String(filterMinTotalEl.value || '').trim() : '';
    const minTotal = minTotalRaw ? Number(minTotalRaw) : 5;
    const minTotalClamped = Number.isFinite(minTotal) ? Math.min(Math.max(Math.floor(minTotal), 1), 200) : 5;
    return {
      ind13_dominio_id: domainId || '',
      ind13_min_total: String(minTotalClamped),
    };
  }

  function applyFiltersToUi(filters){
    const f = filters && typeof filters === 'object' ? filters : {};
    if (filterMinTotalEl && f.ind13_min_total != null) {
      const n = Number(f.ind13_min_total);
      if (Number.isFinite(n)) filterMinTotalEl.value = String(Math.min(Math.max(Math.floor(n), 1), 200));
    }
    if (filterDomainEl && f.ind13_dominio_id != null) {
      filterDomainEl.value = String(f.ind13_dominio_id || '');
    }
  }

  async function loadDomainsGeral(){
    if (!filterDomainEl) return;
    try {
      const resp = await fetch('/api/meta/dominios-geral', {
        headers: buildAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
      });
      if (!resp.ok) throw new Error('DOMINIOS_GERAL_NOT_OK');
      const rows = await resp.json();

      const items = Array.isArray(rows) ? rows : [];
      const current = String(filterDomainEl.value || '');
      const fixedFirst = '<option value="">Todos os domínios</option>';
      const opts = items
        .filter(r => r && (r.id != null || r.ID != null))
        .map(r => {
          const id = r.id != null ? r.id : r.ID;
          const desc = (r.descricao != null ? r.descricao : (r.Descricao != null ? r.Descricao : id));
          return `<option value="${escapeHtml(String(id))}">${escapeHtml(String(desc))}</option>`;
        })
        .join('');
      filterDomainEl.innerHTML = fixedFirst + opts;
      if (current) filterDomainEl.value = current;
    } catch(e){
      // Keep the default "Todos" option if load fails
      logger.warn(e);
    }
  }

  function saveCached(payload){
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch(_){ }
  }

  function pct(v){ if (v == null) return '—'; return (Number(v) * 100).toFixed(1) + '%'; }
  function score(v){ if (v == null) return '—'; return Number(v).toFixed(1) + '%'; }
  function int(v){ if (v == null) return '—'; return String(Math.round(Number(v))); }

  function cssVar(name, fallback){
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) ? v.trim() : fallback;
  }

  function renderList(el, arr, emptyText){
    if (!el) return;
    if (!arr || !arr.length) { el.innerHTML = `<li class="empty">${emptyText}</li>`; return; }
    el.innerHTML = arr.map(s => `<li>${escapeHtml(String(s))}</li>`).join('');
  }

  function renderExplainability(ai){
    if (!aiExplainBoxEl) return;
    const exp = ai && ai.explainability ? ai.explainability : null;
    const alerts = exp && Array.isArray(exp.alerts) ? exp.alerts : [];
    if (!exp || !alerts.length) {
      aiExplainBoxEl.innerHTML = '<div class="empty">Sem dados de explicabilidade para exibir.</div>';
      aiExplainBoxEl.classList.add('muted');
      return;
    }

    // Chips can be rendered over light backgrounds (#f8fafc). Force dark text for readability
    // even when the page theme uses light/white text.
    const chip = (txt) => `<span style="display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;border:1px solid rgba(15,23,42,0.10);background:#f8fafc;font-size:.72rem;font-weight:800;color:#0f172a;">${escapeHtml(String(txt))}</span>`;

    function anchorForBasedOn(b){
      const src = (b && b.source) ? String(b.source) : '';
      const metric = (b && b.metric) ? String(b.metric) : '';

      if (src === 'IND12') {
        if (/^passProbability/i.test(metric)) return '#ind12-prob';
        return '#ind12';
      }
      if (src === 'IND13') return '#ind13';
      if (/^IND\d+$/.test(src)) return '#' + src.toLowerCase();

      if (src === 'KPIs') {
        if (metric === 'completionRate') return '#kpiCompletion';
        if (metric === 'abandonRate') return '#ratesSection';
        if (metric === 'readinessScore') return '#kpisSection';
      }

      if (src === 'Timeseries') {
        if (metric === 'trendDeltaScore7d') return '#scoreSection';
      }

  	  if (src === 'usuario.data_exame') return '#aiHeadline';
      return null;
    }

    function linkify(anchor, innerHtml){
      if (!anchor) return innerHtml;
      return `<a href="${escapeHtml(String(anchor))}" style="color:inherit;text-decoration:none">${innerHtml}</a>`;
    }
    const sevLabel = (s) => {
      const v = String(s || '').toLowerCase();
      if (v === 'high') return chip('Risco alto');
      if (v === 'medium') return chip('Risco');
      if (v === 'info') return chip('Prazo crítico');
      return chip('Alerta');
    };

    const rows = alerts.map((a) => {
      const msg = a && a.message ? String(a.message) : '—';
      const based = a && Array.isArray(a.basedOn) ? a.basedOn : [];
      const basedList = based.length
        ? based.map(b => {
            const src = b && b.source ? String(b.source) : '—';
            const label = b && b.label ? String(b.label) : (b && b.metric ? String(b.metric) : '—');
            const val = (b && b.value != null) ? String(b.value) : '—';
            const unit = b && b.unit ? String(b.unit) : '';
            const thr = (b && b.threshold != null) ? String(b.threshold) : '';
            const details = (b && b.details) ? String(b.details) : '';
            const anchor = anchorForBasedOn(b);
            const thrTxt = thr ? ` <span style="color:#475569;font-weight:700">(limite: ${escapeHtml(thr)}${escapeHtml(unit)})</span>` : '';
            const detTxt = details ? `<div style="margin-top:4px;white-space:normal;color:#475569">${escapeHtml(details)}</div>` : '';
            return `
              <div style="padding:8px 10px;border:1px solid rgba(15,23,42,0.10);border-radius:8px;background:#fff;margin-top:8px;white-space:normal;color:#0f172a">
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline">
                  ${linkify(anchor, chip(src))}
                  ${linkify(anchor, `<span style="font-weight:800">${escapeHtml(label)}</span>`)}
                  <span>${escapeHtml(val)}${escapeHtml(unit)}</span>
                  ${thrTxt}
                </div>
                ${detTxt}
              </div>
            `;
          }).join('')
        : '<div class="empty">Sem métricas associadas.</div>';

      return `
        <div class="card" style="margin-top:8px;">
          <div style="display:flex;gap:8px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
            <div style="font-weight:800;white-space:normal">${escapeHtml(msg)}</div>
            <div>${sevLabel(a && a.severity)}</div>
          </div>
          <details style="margin-top:8px;">
            <summary style="cursor:pointer;font-weight:800;color:var(--subtext)">Por quê (baseado em)</summary>
            <div style="margin-top:8px;">
              ${basedList}
              <div class="muted" style="margin-top:10px;white-space:normal">Dica: veja também a seção <a href="#indicatorsSection" style="color:var(--primary);font-weight:800;text-decoration:none">Indicadores</a>.</div>
            </div>
          </details>
        </div>
      `;
    }).join('');

    const ruleNote = exp && exp.rules
      ? `<div class="muted" style="margin-bottom:8px;white-space:normal">Regras usadas (resumo): prazo crítico ≤ ${escapeHtml(String(exp.rules.examSoonDays))} dias; risco alto ≤ ${escapeHtml(String(exp.rules.riskHighDays))} dias; prob. alvo ${escapeHtml(String(exp.rules.passThresholdPercent))}%; conclusão baixa < ${escapeHtml(String(exp.rules.completionLowPercent))}%.</div>`
      : '';

    aiExplainBoxEl.classList.remove('muted');
    aiExplainBoxEl.innerHTML = ruleNote + rows;
  }

  function renderFlashcards(data){
    if (!flashcardsBoxEl) return;
    const fc = data && data.flashcards ? data.flashcards : null;
    if (!fc) {
      flashcardsBoxEl.innerHTML = '<div class="empty">Sem dados de flashcards para exibir.</div>';
      flashcardsBoxEl.classList.add('muted');
      return;
    }

    function fmtPctMaybe(p){
      if (p == null) return '—';
      const n = Number(p);
      return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
    }

    function fmtRateMaybe(r){
      if (r == null) return '—';
      const n = Number(r);
      return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
    }

    function perfRow(p){
      const obj = p || {};
      const label = obj.days == null ? 'All-time' : `${obj.days}d`;
      const total = obj.totalAnswers != null ? int(obj.totalAnswers) : '—';
      const distinct = obj.distinctCards != null ? int(obj.distinctCards) : '—';
      const acerto = fmtPctMaybe(obj.correctPct);
      const erro = fmtPctMaybe(obj.errorPct);
      return `<li><span class="k">${escapeHtml(label)}:</span> <span class="v">respondidas=${escapeHtml(total)}, distintas=${escapeHtml(distinct)}, acerto=${escapeHtml(acerto)}, erro=${escapeHtml(erro)}</span></li>`;
    }

    function attemptRow(a){
      const obj = a || {};
      const label = obj.days == null ? 'All-time' : `${obj.days}d`;
      const total = obj.totalAttempts != null ? int(obj.totalAttempts) : '—';
      const by = obj.byStatus || {};
      const active = by.active != null ? int(by.active) : '—';
      const finished = by.finished != null ? int(by.finished) : '—';
      const abandoned = by.abandoned == null ? '—' : int(by.abandoned);
      const abandonRate = fmtRateMaybe(obj.abandonRate);
      const note = obj.note ? ` <span class="muted">(${escapeHtml(String(obj.note))})</span>` : '';
      return `<li><span class="k">${escapeHtml(label)}:</span> <span class="v">attempts=${escapeHtml(total)}, active=${escapeHtml(active)}, finished=${escapeHtml(finished)}, abandoned=${escapeHtml(abandoned)}, abandonRate=${escapeHtml(abandonRate)}</span>${note}</li>`;
    }

    function renderTopList(items, emptyText){
      const arr = Array.isArray(items) ? items : [];
      if (!arr.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
      const lis = arr.map(it => {
        const desc = it && it.descricao != null ? String(it.descricao) : '—';
        const total = it && it.total != null ? int(it.total) : '—';
        const erros = it && it.erros != null ? int(it.erros) : '—';
        const taxa = it && it.taxaErroPct != null ? `${Number(it.taxaErroPct).toFixed(1)}%` : '—';
        return `<li>${escapeHtml(desc)} <span class="muted">(erro=${escapeHtml(taxa)}, erros=${escapeHtml(erros)}/${escapeHtml(total)})</span></li>`;
      }).join('');
      return `<ul>${lis}</ul>`;
    }

    function renderBasics(items){
      const arr = Array.isArray(items) ? items : [];
      if (!arr.length) return `<div class="empty">Sem respostas suficientes.</div>`;
      const lis = arr.map(it => {
        const label = it && it.basics ? 'Fundamentos' : 'Não-fundamentos';
        const total = it && it.total != null ? int(it.total) : '—';
        const erros = it && it.erros != null ? int(it.erros) : '—';
        const acerto = it && it.acertoPct != null ? `${Number(it.acertoPct).toFixed(1)}%` : '—';
        const taxaErro = it && it.taxaErroPct != null ? `${Number(it.taxaErroPct).toFixed(1)}%` : '—';
        return `<li>${escapeHtml(label)} <span class="muted">(acerto=${escapeHtml(acerto)}, erro=${escapeHtml(taxaErro)}, erros=${escapeHtml(erros)}/${escapeHtml(total)})</span></li>`;
      }).join('');
      return `<ul>${lis}</ul>`;
    }

    function renderTopCards(items){
      const arr = Array.isArray(items) ? items : [];
      if (!arr.length) return `<div class="empty">Sem cards com amostra mínima.</div>`;
      const lis = arr.map(it => {
        const id = it && it.id != null ? String(it.id) : '—';
        const q = it && it.pergunta != null ? String(it.pergunta) : '';
        const total = it && it.total != null ? int(it.total) : '—';
        const erros = it && it.erros != null ? int(it.erros) : '—';
        const taxa = it && it.taxaErroPct != null ? `${Number(it.taxaErroPct).toFixed(1)}%` : '—';
        const basics = it && it.basics ? 'Fundamentos' : '—';
        return `<li><strong>#${escapeHtml(id)}</strong> ${escapeHtml(q)} <span class="muted">(erro=${escapeHtml(taxa)}, erros=${escapeHtml(erros)}/${escapeHtml(total)}${basics !== '—' ? ', ' + escapeHtml(basics) : ''})</span></li>`;
      }).join('');
      return `<ul>${lis}</ul>`;
    }

    const perf = fc.performance || {};
    const attempts = fc.attempts || {};

    const metaNote = fc.meta && fc.meta.note ? String(fc.meta.note) : '';
    const metaInfo = fc.meta ? `<div class="muted" style="margin-bottom:8px;">Amostra mínima: ${escapeHtml(String(fc.meta.minTotal))} • TopN: ${escapeHtml(String(fc.meta.topN))}${metaNote ? ' • ' + escapeHtml(metaNote) : ''}</div>` : '';

    flashcardsBoxEl.classList.remove('muted');
    flashcardsBoxEl.innerHTML = `
      ${metaInfo}
      <div class="split">
        <div class="card" style="margin:0;">
          <h3>Performance (respostas)</h3>
          <ul>
            ${perfRow(perf.last7)}
            ${perfRow(perf.last30)}
            ${perfRow(perf.allTime)}
          </ul>
        </div>
        <div class="card" style="margin:0;">
          <h3>Engajamento (attempts)</h3>
          <ul>
            ${attemptRow(attempts.last7)}
            ${attemptRow(attempts.last30)}
            ${attemptRow(attempts.allTime)}
          </ul>
        </div>
      </div>

      <div class="split" style="margin-top:10px;">
        <div class="card" style="margin:0;">
          <h3>Onde focar: Princípios (30d)</h3>
          ${renderTopList(fc.byPrincipio && fc.byPrincipio.last30, 'Sem dados com amostra mínima.')}
        </div>
        <div class="card" style="margin:0;">
          <h3>Onde focar: Domínios de desempenho (30d)</h3>
          ${renderTopList(fc.byDominioDesempenho && fc.byDominioDesempenho.last30, 'Sem dados com amostra mínima.')}
        </div>
      </div>

      <div class="split" style="margin-top:10px;">
        <div class="card" style="margin:0;">
          <h3>Onde focar: Abordagens (30d)</h3>
          ${renderTopList(fc.byAbordagem && fc.byAbordagem.last30, 'Sem dados com amostra mínima.')}
        </div>
        <div class="card" style="margin:0;">
          <h3>Fundamentos vs não (30d)</h3>
          ${renderBasics(fc.byBasics && fc.byBasics.last30)}
        </div>
      </div>

      <div class="card" style="margin-top:10px;">
        <h3>Top flashcards problemáticos (30d)</h3>
        ${renderTopCards(fc.topCards && fc.topCards.last30)}
      </div>
    `;
  }

  function fmtPct(v){
    if (v == null) return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(2) + '%';
  }

  function fmtNum(v){
    if (v == null) return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return String(n);
  }

  function renderTopBottom(tb, valueSuffix, noteText){
    const weakest = tb && Array.isArray(tb.weakest) ? tb.weakest : [];
    const strongest = tb && Array.isArray(tb.strongest) ? tb.strongest : [];
    const li = (it) => `<li>${escapeHtml(String(it.label || '—'))}: ${escapeHtml(String(it.value))}${valueSuffix || ''}</li>`;
    const left = weakest.length ? weakest.map(li).join('') : '<li class="empty">—</li>';
    const right = strongest.length ? strongest.map(li).join('') : '<li class="empty">—</li>';

    const noteHtml = noteText
      ? `<div class="tb-note muted small">${escapeHtml(String(noteText))}</div>`
      : '';
    const cardClass = noteText ? 'card tb-has-note' : 'card';

    function formatBarValue(v, suffix){
      const n = Number(v);
      if (!Number.isFinite(n)) return '—';
      const txt = Number.isInteger(n) ? String(n) : n.toFixed(2);
      return txt + (suffix || '');
    }

    function renderMiniBars(items, colorCssVar, valueSuffix){
      const vals = (items || []).map(it => Number(it && it.value)).filter(v => Number.isFinite(v));
      const max = Math.max(1, Math.max(...vals, 100));
      const W = 120;
      const H = 82;
      const pad = 6;
      const barH = 10;
      const gap = 6;
      // NOTE: In InsightsIA the CSS variable --muted is used for muted *text* and is very light.
      // Using it as a chart series color produces almost-white bars with no contrast on light tracks.
      // Therefore, map muted series to a dedicated high-contrast chart color.
      const primary = (colorCssVar === '--muted')
        ? cssVar('--chart-muted', '#ef4444')
        : cssVar(colorCssVar, cssVar('--primary', '#0b5ed7'));
      const bg = '#f1f5f9';
      const stroke = '#e2e8f0';

      const rows = (items || []).slice(0, 5);
      const bars = rows.map((it, idx) => {
        const v = Number(it && it.value);
        const pct = Number.isFinite(v) ? Math.max(0, Math.min(1, v / max)) : 0;
        const x0 = pad;
        const y0 = pad + idx * (barH + gap);
        const w0 = W - pad * 2;
        const w1 = Math.max(0, Math.round(w0 * pct));
        const label = formatBarValue(v, valueSuffix);
        // Keep value label readable: white when the bar reaches the label area,
        // otherwise dark text on the unfilled (light) remainder.
        const labelColor = (pct >= 0.92) ? '#fff' : '#0f172a';
        const tx = x0 + w0 - 2;
        const ty = y0 + barH - 2;
        return `
          <rect x="${x0}" y="${y0}" width="${w0}" height="${barH}" rx="3" fill="${bg}" stroke="${stroke}" />
          <rect x="${x0}" y="${y0}" width="${w1}" height="${barH}" rx="3" fill="${primary}" />
          <text x="${tx}" y="${ty}" text-anchor="end" font-size="9" fill="${labelColor}">${escapeHtml(String(label))}</text>
        `;
      }).join('');

      return `
        <div class="tb-chart" aria-hidden="true">
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>
        </div>
      `;
    }

    return `
      <div class="split">
        <div class="${cardClass}">
          <h3>Piores</h3>
          <div class="tb-card">
            <div class="tb-list"><ul>${left}</ul></div>
            ${renderMiniBars(weakest, '--muted', valueSuffix)}
          </div>
          ${noteHtml}
        </div>
        <div class="${cardClass}">
          <h3>Melhores</h3>
          <div class="tb-card">
            <div class="tb-list"><ul>${right}</ul></div>
            ${renderMiniBars(strongest, '--primary', valueSuffix)}
          </div>
          ${noteHtml}
        </div>
      </div>
    `;
  }

  function renderIndicators(data){
    if (!indicatorsBoxEl) return;
    const s = data && data.indicatorsSummary ? data.indicatorsSummary : null;
    if (!s) { indicatorsBoxEl.innerHTML = '<span class="muted">Sem indicadores no payload</span>'; return; }

    const ind13Tasks = data && data.indicators && data.indicators.IND13 && Array.isArray(data.indicators.IND13.tasks)
      ? data.indicators.IND13.tasks
      : [];

    const parts = [];
    parts.push(`<div id="ind1" class="kv"><span class="k">IND1</span><span class="v">Exames completos (${escapeHtml(String(s.IND1?.days ?? '—'))}d): ${escapeHtml(String(s.IND1?.totalExams ?? '—'))}</span></div>`);
    parts.push(`<div id="ind2" class="kv"><span class="k">IND2</span><span class="v">Aprovação: ${escapeHtml(fmtPct(s.IND2?.approvalRatePercent))} (n=${escapeHtml(fmtNum(s.IND2?.total))})</span></div>`);
    parts.push(`<div id="ind3" class="kv"><span class="k">IND3</span><span class="v">Reprovação: ${escapeHtml(fmtPct(s.IND3?.failureRatePercent))} (n=${escapeHtml(fmtNum(s.IND3?.total))})</span></div>`);
    parts.push(`<div id="ind4" class="kv"><span class="k">IND4</span><span class="v">Questões disponíveis (tipo ${escapeHtml(fmtNum(s.IND4?.examTypeId))}): ${escapeHtml(fmtNum(s.IND4?.questionsAvailable))}</span></div>`);
    parts.push(`<div id="ind5" class="kv"><span class="k">IND5</span><span class="v">Questões respondidas (tipo ${escapeHtml(fmtNum(s.IND5?.examTypeId))}): ativas ${escapeHtml(fmtNum(s.IND5?.answeredDistinctActive))} / histórico ${escapeHtml(fmtNum(s.IND5?.answeredDistinctHistorical))}</span></div>`);
    parts.push(`<div id="ind6" class="kv"><span class="k">IND6</span><span class="v">Horas totais (tipo ${escapeHtml(fmtNum(s.IND6?.examTypeId))}): ${escapeHtml(fmtNum(s.IND6?.totalHours))}</span></div>`);

    parts.push(`<div id="ind11" class="kv"><span class="k">IND11</span><span class="v">Tempo médio/questão (${escapeHtml(fmtNum(s.IND11?.days))}d): ${escapeHtml(fmtNum(s.IND11?.avgMinutes))} min (${escapeHtml(fmtNum(s.IND11?.avgSeconds))} s), n=${escapeHtml(fmtNum(s.IND11?.totalQuestions))}</span></div>`);

    parts.push(`<div id="ind7"><div class="kv"><span class="k">IND7</span><span class="v">Grupos de processo (% corretas)</span></div>`);
    parts.push(renderTopBottom(s.IND7, '%'));
    parts.push(`</div>`);

    parts.push(`<div id="ind9"><div class="kv"><span class="k">IND9</span><span class="v">Abordagem (% acertos)</span></div>`);
    parts.push(renderTopBottom(s.IND9, '%'));
    parts.push(`</div>`);

    parts.push(`<div id="ind10"><div class="kv"><span class="k">IND10</span><span class="v">Domínios (melhor simulado, %)</span></div>`);
    parts.push(renderTopBottom(s.IND10, '%'));
    parts.push(`</div>`);

    parts.push(`<div id="ind12"><div class="kv"><span class="k">IND12</span><span class="v">Domínios agregados (% ponderado)</span></div>`);
    parts.push(renderTopBottom(
      s.IND12,
      '%',
      'Mostra sua % de acertos por domínio, ponderada pela quantidade de questões (domínios com mais questões têm mais peso).'
    ));
    parts.push(`</div>`);

    // IND14: Domínios (última vs penúltima) usando DG-DET-LAST2
    if (s.IND14) {
      const ind14 = s.IND14;
      const drops = ind14 && Array.isArray(ind14.biggestDrops) ? ind14.biggestDrops : [];
      const imps = ind14 && Array.isArray(ind14.biggestImprovements) ? ind14.biggestImprovements : [];
      const weak = ind14 && Array.isArray(ind14.persistentWeak) ? ind14.persistentWeak : [];

      const fmtPp = (n) => {
        const v = Number(n);
        if (!Number.isFinite(v)) return '—';
        const sgn = v > 0 ? '+' : '';
        return sgn + v.toFixed(1) + 'pp';
      };

      const liDelta = (arr) => {
        const list = Array.isArray(arr) ? arr : [];
        if (!list.length) return '<li class="empty">—</li>';
        return list.slice(0, 5).map(r => {
          const last = r && r.last != null ? Number(r.last) : null;
          const prev = r && r.previous != null ? Number(r.previous) : null;
          const d = r && r.delta != null ? Number(r.delta) : null;
          const lastTxt = (last != null && Number.isFinite(last)) ? last.toFixed(1) + '%' : '—';
          const prevTxt = (prev != null && Number.isFinite(prev)) ? prev.toFixed(1) + '%' : '—';
          return `<li>${escapeHtml(String(r.label || '—'))}: ${escapeHtml(prevTxt)} → ${escapeHtml(lastTxt)} (${escapeHtml(fmtPp(d))})</li>`;
        }).join('');
      };

      const liWeak = (arr) => {
        const list = Array.isArray(arr) ? arr : [];
        if (!list.length) return '<li class="empty">—</li>';
        return list.slice(0, 6).map(r => {
          const last = r && r.last != null ? Number(r.last) : null;
          const prev = r && r.previous != null ? Number(r.previous) : null;
          const lastTxt = (last != null && Number.isFinite(last)) ? last.toFixed(1) + '%' : '—';
          const prevTxt = (prev != null && Number.isFinite(prev)) ? prev.toFixed(1) + '%' : '—';
          return `<li>${escapeHtml(String(r.label || '—'))}: ${escapeHtml(prevTxt)} → ${escapeHtml(lastTxt)}</li>`;
        }).join('');
      };

      parts.push(`<div id="ind14"><div class="kv"><span class="k">IND14</span><span class="v">Domínios (última vs penúltima tentativa)</span></div>`);
      parts.push(`<div class="tb-note muted small">Comparação do % de corretas por domínio geral entre as 2 últimas tentativas concluídas (modo full).</div>`);

      parts.push(`<div class="kv"><span class="k">Última</span><span class="v">Piores/Melhores domínios na última tentativa</span></div>`);
      parts.push(renderTopBottom(ind14.last, '%'));

      parts.push(`<div class="kv"><span class="k">Penúltima</span><span class="v">Piores/Melhores domínios na penúltima tentativa</span></div>`);
      parts.push(renderTopBottom(ind14.previous, '%'));

      parts.push(`<div class="split">`);
      parts.push(`<div class="card"><h3>Maiores quedas</h3><ul>${liDelta(drops)}</ul></div>`);
      parts.push(`<div class="card"><h3>Maiores melhoras</h3><ul>${liDelta(imps)}</ul></div>`);
      parts.push(`</div>`);

      parts.push(`<div class="card"><h3>Consistentemente fracos (&lt;70% nas duas)</h3><ul>${liWeak(weak)}</ul></div>`);
      parts.push(`</div>`);
    }

    if (s.PASS && s.PASS.probabilityPercent != null) {
      const p = Number(s.PASS.probabilityPercent);
      const overall = s.PASS.overallPercent != null ? Number(s.PASS.overallPercent) : null;
      const thr = s.PASS.thresholdPercent != null ? Number(s.PASS.thresholdPercent) : 75;
      const overallTxt = (overall != null && Number.isFinite(overall)) ? ` • média geral ${overall.toFixed(2)}%` : '';
      parts.push(`<div id="ind12-prob" class="kv"><span class="k">PROB</span><span class="v">Probabilidade de aprovação (derivada do IND12): ${escapeHtml(String(Math.round(p)))}% (corte ${escapeHtml(String(thr))}%)${escapeHtml(String(overallTxt))}</span></div>`);
    }

    parts.push(`<div id="ind13"><div class="kv"><span class="k">IND13</span><span class="v">Tasks agregadas (% ponderado)</span></div>`);
    parts.push(renderTopBottom(
      s.IND13,
      '%',
      'Mostra sua % de acertos por Task (somente Tasks com amostra mínima; o n aparece no rótulo).'
    ));
    parts.push(`</div>`);

    if (ind13Tasks && ind13Tasks.length) {
      const ranked = ind13Tasks
        .map(t => {
          const impact = (t && t.impactScore != null) ? Number(t.impactScore) : null;
          const peso = (t && t.peso != null) ? Number(t.peso) : null;
          const percent = (t && t.percent != null) ? Number(t.percent) : null;
          return {
            descricao: t && t.descricao != null ? String(t.descricao) : '—',
            impactScore: Number.isFinite(impact) ? impact : null,
            peso: Number.isFinite(peso) ? peso : null,
            percent: Number.isFinite(percent) ? percent : null,
          };
        })
        .filter(t => t.impactScore != null)
        .sort((a,b) => b.impactScore - a.impactScore)
        .slice(0, 8);

      if (ranked.length) {
        const li = ranked.map(t => {
          const pctTxt = t.percent != null ? `${t.percent.toFixed(2)}%` : '—';
          const pesoTxt = t.peso != null ? String(t.peso) : '—';
          return `<li>${escapeHtml(t.descricao)} — impacto ${escapeHtml(String(t.impactScore))} (peso=${escapeHtml(pesoTxt)}, ${escapeHtml(pctTxt)})</li>`;
        }).join('');
        parts.push(`<div class="kv"><span class="k">FOCO</span><span class="v">Prioridades por impacto (peso × gap para 100%)</span></div>`);
        parts.push(`<div class="card"><ul>${li}</ul><div class="tb-note muted small">Use esta lista para decidir o que revisar primeiro quando o tempo até o exame é limitado.</div></div>`);
      }
    }

    indicatorsBoxEl.innerHTML = parts.join('');

    if (indicatorsErrorsEl) {
      const errs = data && data.meta && Array.isArray(data.meta.indicatorErrors) ? data.meta.indicatorErrors : [];
      if (errs.length) {
        indicatorsErrorsEl.style.display = 'block';
        indicatorsErrorsEl.textContent = 'Falhas ao calcular alguns INDs: ' + errs.map(e => `${e.indicator}: ${e.error}`).join(' | ');
      } else {
        indicatorsErrorsEl.style.display = 'none';
      }
    }
  }

  function escapeHtml(s){
    return s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderScoreChart(rows){
    if (!chartScoreEl) return;
    if (!rows || !rows.length) { chartScoreEl.innerHTML = '<div class="empty">Sem dados</div>'; return; }

    const labels = rows.map(r => String(r.date || '').slice(5));
    const values = rows.map(r => r.avgScorePercent == null ? null : Number(r.avgScorePercent));
    const valid = values.map(v => v == null ? null : Math.max(0, Math.min(100, v)));
    const has = valid.some(v => v != null);
    if (!has) { chartScoreEl.innerHTML = '<div class="empty">Sem score médio disponível</div>'; return; }

    const W = chartScoreEl.clientWidth || 800;
    const H = 260;
    const pad = 28;
    const innerW = W - pad*2;
    const innerH = H - pad*2;

    const maxVal = 100;

    function x(i){ return pad + (i/(labels.length-1 || 1))*innerW; }
    function y(v){ return pad + innerH - (v/maxVal)*innerH; }

    // Build path skipping nulls
    let d = '';
    let started = false;
    valid.forEach((v,i) => {
      if (v == null) return;
      d += (started ? ' L ' : ' M ') + x(i) + ',' + y(v);
      started = true;
    });

    const primary = cssVar('--primary', '#0b5ed7');

    const ticks = [0, 50, 100];
    const tickEls = ticks.map(t => `<text x="${pad-6}" y="${y(t)+4}" text-anchor="end" font-size="10" fill="#64748b">${t}%</text>`).join('');
    const xLabels = labels.map((l,i) => {
      // show fewer labels on small series
      const every = labels.length > 20 ? 4 : labels.length > 10 ? 2 : 1;
      if (i % every !== 0 && i !== labels.length-1) return '';
      return `<text x="${x(i)}" y="${H-pad+14}" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(l)}</text>`;
    }).join('');

    chartScoreEl.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <rect x="${pad}" y="${pad}" width="${innerW}" height="${innerH}" fill="#fafafa" stroke="#e2e8f0" />
        <path d="${d}" fill="none" stroke="${primary}" stroke-width="2" />
        ${tickEls}
        ${xLabels}
      </svg>
    `;
  }

  function renderRatesChart(rows){
    if (!chartRatesEl) return;
    if (!rows || !rows.length) { chartRatesEl.innerHTML = '<div class="empty">Sem dados</div>'; return; }

    const labels = rows.map(r => String(r.date || '').slice(5));
    const completion = rows.map(r => Math.max(0, Math.min(100, Number(r.completionRate || 0) * 100)));
    const abandon = rows.map(r => Math.max(0, Math.min(100, Number(r.abandonRate || 0) * 100)));

    const W = chartRatesEl.clientWidth || 800;
    const H = 260;
    const pad = 28;
    const innerW = W - pad*2;
    const innerH = H - pad*2;
    const maxVal = 100;

    function x(i){ return pad + (i/(labels.length-1 || 1))*innerW; }
    function y(v){ return pad + innerH - (v/maxVal)*innerH; }
    function path(arr){
      return arr.map((v,i) => (i===0 ? 'M' : 'L') + x(i) + ',' + y(v)).join(' ');
    }

    const primary = cssVar('--primary', '#0b5ed7');
    // --muted may be a light text color on dark themes; use a chart-specific color for contrast.
    const muted = cssVar('--chart-muted', '#ef4444');

    const ticks = [0, 50, 100];
    const tickEls = ticks.map(t => `<text x="${pad-6}" y="${y(t)+4}" text-anchor="end" font-size="10" fill="#64748b">${t}%</text>`).join('');
    const xLabels = labels.map((l,i) => {
      const every = labels.length > 20 ? 4 : labels.length > 10 ? 2 : 1;
      if (i % every !== 0 && i !== labels.length-1) return '';
      return `<text x="${x(i)}" y="${H-pad+14}" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(l)}</text>`;
    }).join('');

    chartRatesEl.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <rect x="${pad}" y="${pad}" width="${innerW}" height="${innerH}" fill="#fafafa" stroke="#e2e8f0" />
        <path d="${path(completion)}" fill="none" stroke="${primary}" stroke-width="2" />
        <path d="${path(abandon)}" fill="none" stroke="${muted}" stroke-width="2" stroke-dasharray="4 3" />
        ${tickEls}
        ${xLabels}
      </svg>
    `;
  }

  function render(data){
    const k = data && data.kpis ? data.kpis : {};
    if (kpiReadiness) kpiReadiness.textContent = int(k.readinessScore);
    if (kpiConsistency) kpiConsistency.textContent = int(k.consistencyScore);
    if (kpiAvgScore) kpiAvgScore.textContent = score(k.avgScorePercent);
    if (kpiCompletion) kpiCompletion.textContent = pct(k.completionRate);

    const ai = data && data.ai ? data.ai : {};
    if (headlineEl) headlineEl.textContent = ai.headline || 'Insights';
    renderList(insightsListEl, ai.insights, 'Sem insights ainda');
    renderList(risksListEl, ai.risks, 'Sem alertas');
    renderList(actionsListEl, ai.actions7d, 'Sem ações sugeridas');

    renderExplainability(ai);

    (function renderStudyPlan(){
      if (!studyPlanBoxEl) return;
      const plan = data && data.studyPlan ? data.studyPlan : null;
      const items = plan && Array.isArray(plan.items) ? plan.items : [];
      if (!plan || !items.length) {
        studyPlanBoxEl.innerHTML = '<div class="empty">Sem plano ainda (precisa ter Tasks com peso e amostra mínima).</div>';
        return;
      }

      const note = plan.note ? `<div class="muted small" style="margin-bottom:8px;">${escapeHtml(String(plan.note))}</div>` : '';
      const days = Number(plan.days || 7);
      const tpd = Number(plan.tasksPerDay || 2);
      const header = `<div class="muted small" style="margin-bottom:8px;">Plano: ${escapeHtml(String(days))} dias • ${escapeHtml(String(tpd))} task(s)/dia</div>`;

      const cards = items.map(it => {
        const tasks = Array.isArray(it.tasks) ? it.tasks : [];
        const checklist = Array.isArray(it.checklist) ? it.checklist : [];
        const taskLis = tasks.map(t => {
          const peso = (t && t.peso != null) ? Number(t.peso) : null;
          const percent = (t && t.percent != null) ? Number(t.percent) : null;
          const impact = (t && t.impactScore != null) ? Number(t.impactScore) : null;
          const meta = [
            Number.isFinite(peso) ? `peso=${peso}` : null,
            Number.isFinite(percent) ? `${percent.toFixed(2)}%` : null,
            Number.isFinite(impact) ? `impacto=${impact}` : null,
          ].filter(Boolean).join(', ');
          return `<li>${escapeHtml(String(t && t.descricao != null ? t.descricao : '—'))}${meta ? ` <span class=\"muted\">(${escapeHtml(meta)})</span>` : ''}</li>`;
        }).join('') || '<li class="empty">—</li>';

        const checkLis = checklist.map(s => `<li>${escapeHtml(String(s))}</li>`).join('') || '';

        return `
          <div class="card" style="margin-top:8px;">
            <div style="font-weight:800; font-size:0.9rem; margin-bottom:6px;">${escapeHtml(String(it.title || 'Dia'))}</div>
            <div class="small" style="font-weight:700; margin-bottom:6px;">Tasks</div>
            <ul>${taskLis}</ul>
            ${checkLis ? `<div class="small" style="font-weight:700; margin-top:10px;">Checklist</div><ul>${checkLis}</ul>` : ''}
          </div>
        `;
      }).join('');

      studyPlanBoxEl.innerHTML = note + header + cards;
    })();

    renderScoreChart(data.timeseries || []);
    renderRatesChart(data.timeseries || []);
    renderIndicators(data);
    renderFlashcards(data);

    // Used Ollama badge
    const badge = document.getElementById('ollamaBadge');
    if (badge && data && data.meta) {
      const used = (data.meta.usedLlm != null) ? Boolean(data.meta.usedLlm) : Boolean(data.meta.usedOllama);
      const provider = (data.meta.llmProvider ? String(data.meta.llmProvider) : (data.meta.usedOllama ? 'ollama' : '')).toLowerCase();
      const label = provider === 'gemini' ? 'Gemini' : 'Ollama';
      badge.textContent = used ? `Gerado por IA (${label}${data.meta.model ? ' · ' + data.meta.model : ''})` : 'Gerado por regras (fallback)';
    }
  }

  async function loadMe(){
    try {
      const resp = await fetch('/api/users/me', {
        headers: buildAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
      });
      if (!resp.ok) throw new Error('ME_NOT_OK');
      const me = await resp.json();
      const email = (me && (me.Email || me.email)) ? String(me.Email || me.email) : '—';
      if (meEmailEl) meEmailEl.textContent = email;
      return me;
    } catch(_){
      if (meEmailEl) meEmailEl.textContent = '—';
      return null;
    }
  }

  async function loadAll(){
    setLoading(true);
    setError(false);

    if (btn) {
      btn.disabled = true;
      btn.dataset._oldText = btn.textContent;
      btn.textContent = 'Atualizando...';
    }

    try {
      const days = 30;
      const me = await loadMe();

      const filters = getFiltersFromUi();
      saveFilters(filters);
      const params = new URLSearchParams({ days: String(days) });
      if (filters.ind13_min_total) params.set('ind13_min_total', String(filters.ind13_min_total));
      if (filters.ind13_dominio_id) params.set('ind13_dominio_id', String(filters.ind13_dominio_id));

      const resp = await fetch(`/api/ai/insights?${params.toString()}`, {
        headers: buildAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
      });
      if (!resp.ok) {
        let payload = null;
        try {
          payload = await resp.clone().json();
        } catch(_) {
          // ignore
        }

        if (resp.status === 403 && payload && payload.code === 'PREMIUM_REQUIRED') {
          throw new Error('PREMIUM_REQUIRED');
        }

        const msg = payload && (payload.message || payload.code)
          ? `${payload.code || resp.status}: ${payload.message || 'Erro'}`
          : `${resp.status}: Falha na resposta`;
        const rid = payload && payload.requestId ? ` (requestId=${payload.requestId})` : '';
        throw new Error(msg + rid);
      }
      const data = await resp.json();
      render(data);

      const email = (me && (me.Email || me.email)) ? String(me.Email || me.email) : null;
      const storedAt = Date.now();
      saveCached({ storedAt, days, email, filters, data });
      setLastUpdated(storedAt);
      setLoading(false);
    } catch(e) {
      logger.error(e);

      if (String(e && e.message || '') === 'PREMIUM_REQUIRED') {
        setError(true, 'Recurso Premium. Faça upgrade para acessar os Insights da IA.');
        setHint('Acesso premium necessário para Insights da IA.');
      } else {
        setError(true, 'Falha ao carregar. Verifique login e servidor.');
      }

      const cached = loadCached();
      if (cached && cached.storedAt) {
        setLastUpdated(cached.storedAt);
      }
      setLoading(false);
    } finally {
      if (btn) {
        btn.disabled = false;
        const old = btn.dataset._oldText;
        if (old) btn.textContent = old;
        delete btn.dataset._oldText;
      }
    }
  }

  if (btn) btn.addEventListener('click', loadAll);

  if (filterDomainEl) filterDomainEl.addEventListener('change', () => saveFilters(getFiltersFromUi()));
  if (filterMinTotalEl) filterMinTotalEl.addEventListener('change', () => saveFilters(getFiltersFromUi()));

  // Renderiza do cache (se existir) e só atualiza via clique no botão.
  (function initFromCache(){
    const cached = loadCached();
    const savedFilters = loadSavedFilters();
    if (savedFilters) applyFiltersToUi(savedFilters);
    if (cached && cached.data) {
      if (meEmailEl && cached.email) meEmailEl.textContent = cached.email;
      setLastUpdated(cached.storedAt);
      setError(false);
      setLoading(false);
      if (cached.filters) applyFiltersToUi(cached.filters);
      // Pequeno delay para o layout (sidebar/content) estabilizar antes de desenhar gráficos
      setTimeout(() => {
        try { render(cached.data); } catch(e) { logger.error(e); }
      }, 80);
    } else {
      setLastUpdated(null);
      setError(false);
      setHint('Clique em “Atualizar” para carregar os insights.');
    }
  })();

  // Popular dropdown de domínios e manter seleção (se existir)
  loadDomainsGeral();
})();
