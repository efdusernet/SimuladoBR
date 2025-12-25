(function(){
  const btn = document.getElementById('btnCarregar');
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const meEmailEl = document.getElementById('meEmail');

  const kpiReadiness = document.getElementById('kpiReadiness');
  const kpiConsistency = document.getElementById('kpiConsistency');
  const kpiAvgScore = document.getElementById('kpiAvgScore');
  const kpiCompletion = document.getElementById('kpiCompletion');

  const headlineEl = document.getElementById('aiHeadline');
  const insightsListEl = document.getElementById('aiInsights');
  const risksListEl = document.getElementById('aiRisks');
  const actionsListEl = document.getElementById('aiActions');

  const chartScoreEl = document.getElementById('chartScore');
  const chartRatesEl = document.getElementById('chartRates');
  const indicatorsBoxEl = document.getElementById('indicatorsBox');
  const indicatorsErrorsEl = document.getElementById('indicatorsErrors');

  function buildAuthHeaders(){
    const headers = { 'Accept': 'application/json' };
    try {
      const jwtTok = ((localStorage.getItem('jwtToken') || localStorage.getItem('jwt') || '')).trim();
      const jwtType = ((localStorage.getItem('jwtTokenType') || localStorage.getItem('jwt_type') || 'Bearer')).trim() || 'Bearer';
      const sessionToken = (localStorage.getItem('sessionToken') || '').trim();
      if (jwtTok) headers['Authorization'] = `${jwtType} ${jwtTok}`;
      if (sessionToken) headers['X-Session-Token'] = sessionToken;
    } catch(_){ }
    return headers;
  }

  function setLoading(on){ if (loadingEl) loadingEl.style.display = on ? 'block' : 'none'; }
  function setError(on){ if (errorEl) errorEl.style.display = on ? 'block' : 'none'; }

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

  function renderTopBottom(tb, valueSuffix){
    const weakest = tb && Array.isArray(tb.weakest) ? tb.weakest : [];
    const strongest = tb && Array.isArray(tb.strongest) ? tb.strongest : [];
    const li = (it) => `<li>${escapeHtml(String(it.label || '—'))}: ${escapeHtml(String(it.value))}${valueSuffix || ''}</li>`;
    const left = weakest.length ? weakest.map(li).join('') : '<li class="empty">—</li>';
    const right = strongest.length ? strongest.map(li).join('') : '<li class="empty">—</li>';

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
      const primary = cssVar(colorCssVar, cssVar('--primary', '#0b5ed7'));
      const bg = '#f1f5f9';
      const stroke = '#e2e8f0';
      const labelColor = '#000';

      const rows = (items || []).slice(0, 5);
      const bars = rows.map((it, idx) => {
        const v = Number(it && it.value);
        const pct = Number.isFinite(v) ? Math.max(0, Math.min(1, v / max)) : 0;
        const x0 = pad;
        const y0 = pad + idx * (barH + gap);
        const w0 = W - pad * 2;
        const w1 = Math.max(0, Math.round(w0 * pct));
        const label = formatBarValue(v, valueSuffix);
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
        <div class="card">
          <h3>Piores</h3>
          <div class="tb-card">
            <div class="tb-list"><ul>${left}</ul></div>
            ${renderMiniBars(weakest, '--muted', valueSuffix)}
          </div>
        </div>
        <div class="card">
          <h3>Melhores</h3>
          <div class="tb-card">
            <div class="tb-list"><ul>${right}</ul></div>
            ${renderMiniBars(strongest, '--primary', valueSuffix)}
          </div>
        </div>
      </div>
    `;
  }

  function renderIndicators(data){
    if (!indicatorsBoxEl) return;
    const s = data && data.indicatorsSummary ? data.indicatorsSummary : null;
    if (!s) { indicatorsBoxEl.innerHTML = '<span class="muted">Sem indicadores no payload</span>'; return; }

    const parts = [];
    parts.push(`<div class="kv"><span class="k">IND1</span><span class="v">Exames completos (${escapeHtml(String(s.IND1?.days ?? '—'))}d): ${escapeHtml(String(s.IND1?.totalExams ?? '—'))}</span></div>`);
    parts.push(`<div class="kv"><span class="k">IND2</span><span class="v">Aprovação: ${escapeHtml(fmtPct(s.IND2?.approvalRatePercent))} (n=${escapeHtml(fmtNum(s.IND2?.total))})</span></div>`);
    parts.push(`<div class="kv"><span class="k">IND3</span><span class="v">Reprovação: ${escapeHtml(fmtPct(s.IND3?.failureRatePercent))} (n=${escapeHtml(fmtNum(s.IND3?.total))})</span></div>`);
    parts.push(`<div class="kv"><span class="k">IND4</span><span class="v">Questões disponíveis (tipo ${escapeHtml(fmtNum(s.IND4?.examTypeId))}): ${escapeHtml(fmtNum(s.IND4?.questionsAvailable))}</span></div>`);
    parts.push(`<div class="kv"><span class="k">IND5</span><span class="v">Questões respondidas (tipo ${escapeHtml(fmtNum(s.IND5?.examTypeId))}): ativas ${escapeHtml(fmtNum(s.IND5?.answeredDistinctActive))} / histórico ${escapeHtml(fmtNum(s.IND5?.answeredDistinctHistorical))}</span></div>`);
    parts.push(`<div class="kv"><span class="k">IND6</span><span class="v">Horas totais (tipo ${escapeHtml(fmtNum(s.IND6?.examTypeId))}): ${escapeHtml(fmtNum(s.IND6?.totalHours))}</span></div>`);

    parts.push(`<div class="kv"><span class="k">IND11</span><span class="v">Tempo médio/questão (${escapeHtml(fmtNum(s.IND11?.days))}d): ${escapeHtml(fmtNum(s.IND11?.avgMinutes))} min (${escapeHtml(fmtNum(s.IND11?.avgSeconds))} s), n=${escapeHtml(fmtNum(s.IND11?.totalQuestions))}</span></div>`);

    parts.push(`<div class="kv"><span class="k">IND7</span><span class="v">Grupos de processo (% corretas)</span></div>`);
    parts.push(renderTopBottom(s.IND7, '%'));

    parts.push(`<div class="kv"><span class="k">IND9</span><span class="v">Abordagem (% acertos)</span></div>`);
    parts.push(renderTopBottom(s.IND9, '%'));

    parts.push(`<div class="kv"><span class="k">IND10</span><span class="v">Domínios (melhor simulado, %)</span></div>`);
    parts.push(renderTopBottom(s.IND10, '%'));

    parts.push(`<div class="kv"><span class="k">IND12</span><span class="v">Domínios agregados (% ponderado)</span></div>`);
    parts.push(renderTopBottom(s.IND12, '%'));

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
    const muted = cssVar('--muted', '#6c757d');

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

    renderScoreChart(data.timeseries || []);
    renderRatesChart(data.timeseries || []);
    renderIndicators(data);

    // Used Ollama badge
    const badge = document.getElementById('ollamaBadge');
    if (badge && data && data.meta) {
      badge.textContent = data.meta.usedOllama ? `Gerado por IA (Ollama${data.meta.model ? ' · ' + data.meta.model : ''})` : 'Gerado por regras (fallback)';
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

    try {
      const days = 30;
      await loadMe();
      const resp = await fetch(`/api/ai/insights?days=${days}`, {
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
        const msg = payload && (payload.message || payload.code)
          ? `${payload.code || resp.status}: ${payload.message || 'Erro'}`
          : `${resp.status}: Falha na resposta`;
        const rid = payload && payload.requestId ? ` (requestId=${payload.requestId})` : '';
        throw new Error(msg + rid);
      }
      const data = await resp.json();
      render(data);
    } catch(e) {
      logger.error(e);
      setError(true);
    }

    setLoading(false);
  }

  if (btn) btn.addEventListener('click', loadAll);
  setTimeout(loadAll, 50);
})();
