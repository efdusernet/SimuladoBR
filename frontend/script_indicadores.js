(function(){
  const tokenInput = document.getElementById('sessionToken');
  const btn = document.getElementById('btnCarregar');
  const summaryEl = document.getElementById('summary');
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const chartContainer = document.getElementById('chartContainer');
  const scoreChartContainer = document.getElementById('scoreChartContainer');

  // Prefill token from localStorage if exists
  try { const st = localStorage.getItem('sessionToken'); if (st && !tokenInput.value) tokenInput.value = st; } catch(_){}

  function fmtPercent(v){ if(v==null) return '—'; return (v*100).toFixed(1)+'%'; }
  function fmtScore(v){ if(v==null) return '—'; return Number(v).toFixed(1)+'%'; }

  async function loadAll(){
    const token = (tokenInput.value||'').trim();
    if(!token){ alert('Session token obrigatório'); return; }
    localStorage.setItem('sessionToken', token);
    setLoading(true); setError(false);
    try {
      const days = 30;
      const [summaryResp,dailyResp] = await Promise.all([
        fetch(`/api/users/me/stats/summary?days=${days}`, { headers: { 'X-Session-Token': token }, credentials: 'include' }),
        fetch(`/api/users/me/stats/daily?days=${days}`, { headers: { 'X-Session-Token': token }, credentials: 'include' })
      ]);
      if(!summaryResp.ok || !dailyResp.ok) throw new Error('Falha na resposta');
      const summary = await summaryResp.json();
      const dailyWrap = await dailyResp.json();
      const daily = (dailyWrap && dailyWrap.data) ? dailyWrap.data : [];
      renderSummary(summary);
      renderDailyChart(daily);
      renderScoreChart(daily);
    } catch(e){ logger.error(e); setError(true); }
    setLoading(false);
  }

  function setLoading(on){ loadingEl.style.display = on ? 'block':'none'; }
  function setError(on){ errorEl.style.display = on ? 'block':'none'; }

  function renderSummary(s){
    if(!s){ summaryEl.innerHTML = '<div class="empty">Sem dados</div>'; return; }
    const items = [
      { k:'Iniciadas', v:s.started },
      { k:'Finalizadas', v:s.finished },
      { k:'Abandonadas', v:s.abandoned },
      { k:'Timeout', v:s.timeout },
      { k:'Baixo progresso', v:s.lowProgress },
      { k:'Expurgadas', v:s.purged },
      { k:'Taxa abandono', v:fmtPercent(s.abandonRate) },
      { k:'Taxa conclusão', v:fmtPercent(s.completionRate) },
      { k:'Taxa expurgo', v:fmtPercent(s.purgeRate) },
      { k:'Média score', v:fmtScore(s.avgScorePercent) }
    ];
    summaryEl.innerHTML = items.map(m => `<div class="metric"><h2>${m.k}</h2><div class="value">${m.v}</div></div>`).join('');
  }

  function renderDailyChart(rows){
    if(!rows.length){ chartContainer.innerHTML = '<div class="empty">Sem dados diários suficientes</div>'; return; }
    // Build normalized arrays
    const labels = rows.map(r=>r.date.slice(5)); // MM-DD
    const abandon = rows.map(r=> (r.abandonRate*100));
    const completion = rows.map(r=> (r.completionRate*100));
    const purge = rows.map(r=> (r.purgeRate*100));
    // Determine max for scaling
    const maxVal = Math.max(10, ...abandon, ...completion, ...purge);
    const W = chartContainer.clientWidth || 800;
    const H = 300;
    const pad = 28;
    const innerW = W - pad*2;
    const innerH = H - pad*2;
    function x(i){ return pad + (i/(labels.length-1))*innerW; }
    function y(v){ return pad + innerH - (v/maxVal)*innerH; }
    function path(arr){ return arr.map((v,i)=> (i===0? 'M':'L')+x(i)+','+y(v)).join(' '); }
    const abandonPath = path(abandon);
    const completionPath = path(completion);
    const purgePath = path(purge);
    // Y axis ticks (0, max/2, max)
    const ticks = [0, maxVal/2, maxVal];
    const tickEls = ticks.map(t=> `<text x="${pad-6}" y="${y(t)+4}" text-anchor="end" font-size="10" fill="#64748b">${t.toFixed(0)}%</text>`).join('');
    const xLabels = labels.map((l,i)=> `<text x="${x(i)}" y="${H-pad+14}" text-anchor="middle" font-size="10" fill="#64748b">${l}</text>`).join('');
    const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <rect x="${pad}" y="${pad}" width="${innerW}" height="${innerH}" fill="#fafafa" stroke="#e2e8f0" />
      <path d="${abandonPath}" fill="none" stroke="#0b5ed7" stroke-width="2" />
      <path d="${completionPath}" fill="none" stroke="#16a34a" stroke-width="2" />
      <path d="${purgePath}" fill="none" stroke="#dc2626" stroke-width="2" stroke-dasharray="4 3" />
      ${tickEls}
      ${xLabels}
    </svg>`;
    chartContainer.innerHTML = svg;
  }

  function renderScoreChart(rows){
    if(!rows.length){ scoreChartContainer.innerHTML = '<div class="empty">Sem dados de score</div>'; return; }
    const labels = rows.map(r=>r.date.slice(5));
    const scores = rows.map(r=> (r.avgScorePercent==null? null : r.avgScorePercent));
    const validScores = scores.filter(v=> v!=null);
    if(!validScores.length){ scoreChartContainer.innerHTML = '<div class="empty">Sem média de score disponível</div>'; return; }
    const maxVal = Math.max(100, ...validScores);
    const W = scoreChartContainer.clientWidth || 800;
    const H = 300; const pad = 28; const innerW = W - pad*2; const innerH = H - pad*2;
    function x(i){ return pad + (i/(labels.length-1))*innerW; }
    function y(v){ return pad + innerH - (v/maxVal)*innerH; }
    const pathScores = validScores.map((v,i)=> (i===0? 'M':'L')+x(i)+','+y(v)).join(' ');
    const ticks = [0, maxVal/2, maxVal];
    const tickEls = ticks.map(t=> `<text x="${pad-6}" y="${y(t)+4}" text-anchor="end" font-size="10" fill="#64748b">${t.toFixed(0)}%</text>`).join('');
    const xLabels = labels.map((l,i)=> `<text x="${x(i)}" y="${H-pad+14}" text-anchor="middle" font-size="10" fill="#64748b">${l}</text>`).join('');
    const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <rect x="${pad}" y="${pad}" width="${innerW}" height="${innerH}" fill="#fafafa" stroke="#e2e8f0" />
      <path d="${pathScores}" fill="none" stroke="#6366f1" stroke-width="2" />
      ${tickEls}
      ${xLabels}
    </svg>`;
    scoreChartContainer.innerHTML = svg;
  }

  btn.addEventListener('click', loadAll);
  // Auto-load if token present
  if((tokenInput.value||'').trim()) setTimeout(loadAll, 50);
})();
