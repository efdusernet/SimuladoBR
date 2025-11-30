(function(){
  function clearExamDataShared(){
    try {
      const sid = (window.currentSessionId || localStorage.getItem('currentSessionId') || localStorage.getItem('tempSessionId') || '').trim();
      if (sid) {
        const keys = [
          `progress_${sid}`,
          `answers_${sid}`,
          `questions_${sid}`,
          `highlights_${sid}`,
          `questoesMarcadas_${sid}`,
          `backBarrier_${sid}`,
          `allowContinueAfterCheckpoint_${sid}`,
          `pauseUntil_${sid}`,
          `pauseConsumed_${sid}_cp1`,
          `pauseConsumed_${sid}_cp2`,
          `FirstStop_${sid}`,
          `SecondStop_${sid}`
        ];
        keys.forEach(k => { try { localStorage.removeItem(k); } catch(_){} });
      }
      ['examQuestionCount','examCountFromDefault','examFilters'].forEach(k=>{ try{ localStorage.removeItem(k);}catch(_){}});
    } catch(_){ }
    try { sessionStorage.clear(); } catch(_){}
    try {
      if (window.caches && caches.keys) {
        caches.keys().then(names => names.forEach(n => caches.delete(n))).catch(()=>{});
      }
    } catch(_){}
    try { if (typeof showToast === 'function') showToast('Exame finalizado. Dados locais limpos.'); } catch(_){}
  }
  // Expose globally and provide compatibility alias
  window.clearExamDataShared = clearExamDataShared;
  if (typeof window.clearExamData !== 'function') {
    window.clearExamData = clearExamDataShared;
  }
})();
