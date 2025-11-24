// Script para criar uma tentativa de exame "fixture" diretamente no banco
// Uso CLI: node scripts/create_fixture_attempt.js --userId 123 --overallPct 62 --totalQuestions 180 --examType pmp
// Este script seleciona questões aleatórias, marca uma fração como corretas e gera respostas com timestamps variados.
// Pode ser reutilizado pelo menu admin chamando este arquivo via processo filho ou migrado para endpoint (ver rota adicionada em exams_admin.js).

const path = require('path');
const db = require('../models');
const userStatsService = require('../services/UserStatsService')(db);

function argVal(name, def=null){
  const idx = process.argv.findIndex(a => a === `--${name}`);
  if(idx >= 0){
    const nxt = process.argv[idx+1];
    if(nxt && !nxt.startsWith('--')) return nxt;
    return true; // flag sem valor
  }
  const pref = process.argv.find(a => a.startsWith(`--${name}=`));
  if(pref){
    return pref.split('=')[1];
  }
  return def;
}

async function main(){
  const userIdRaw = argVal('userId');
  if(!userIdRaw){
    console.error('Parâmetro --userId é obrigatório');
    process.exit(1);
  }
  const userId = Number(userIdRaw);
  if(!Number.isFinite(userId) || userId <= 0){
    console.error('userId inválido');
    process.exit(1);
  }
  const overallPctRaw = argVal('overallPct','65');
  const overallPct = Math.max(0, Math.min(100, Number(overallPctRaw))); // clamp
  const totalQuestionsRaw = argVal('totalQuestions','180');
  const totalQuestions = Math.max(1, Math.min(500, Number(totalQuestionsRaw)));
  const examTypeSlug = (argVal('examType','pmp') || 'pmp').toString().trim();
  // Domain percent args
  const peoplePctRaw = argVal('peoplePct', null);
  const processPctRaw = argVal('processPct', null);
  const businessPctRaw = argVal('businessPct', null);
  function parseDom(v){ if(v==null) return null; const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null; }
  const peoplePct = parseDom(peoplePctRaw);
  const processPct = parseDom(processPctRaw);
  const businessPct = parseDom(businessPctRaw);
  function labelFromPct(p){ if(p==null) return '—'; if(p<=25) return 'Needs Improvement'; if(p<=50) return 'Below Target'; if(p<=75) return 'Target'; return 'Above Target'; }

  // Obter exam type
  const examType = await db.ExamType.findOne({ where: { Slug: examTypeSlug } });
  if(!examType){
    console.error('ExamType não encontrado para slug:', examTypeSlug);
    process.exit(1);
  }

  // Validar usuário
  const user = await db.User.findByPk(userId);
  if(!user){
    console.error('Usuário não encontrado:', userId);
    process.exit(1);
  }

  // Selecionar questões (id + iddominiogeral para distribuição por domínio)
  const sequelize = db.sequelize;
  const whereClauses = ["excluido = false","idstatus = 1",`exam_type_id = ${Number(examType.Id)}`];
  const whereSql = whereClauses.join(' AND ');
  const selectRowsQ = `SELECT id, iddominiogeral FROM questao WHERE ${whereSql} ORDER BY random() LIMIT :limit`;
  const questRows = await sequelize.query(selectRowsQ, { replacements: { limit: totalQuestions }, type: sequelize.QueryTypes.SELECT });
  const questionIds = questRows.map(r => Number(r.id)).filter(n => Number.isFinite(n));
  if(questionIds.length < totalQuestions){
    console.error(`Não há questões suficientes (${questionIds.length}) para total solicitado (${totalQuestions}).`);
    process.exit(1);
  }
  // Preparar dados de domínio
  const domainMap = {}; // key domainId -> { questions: [indices], count }
  questRows.forEach((r, idx) => {
    const dId = (r.iddominiogeral != null ? Number(r.iddominiogeral) : null);
    const key = dId != null && Number.isFinite(dId) ? dId : 'null';
    if(!domainMap[key]) domainMap[key] = { questions: [], count: 0 };
    domainMap[key].questions.push(idx); // armazenar índice em questionIds
    domainMap[key].count++;
  });

  // Obter descrições dos domínios (quando existirem IDs válidos)
  const validDomainIds = Object.keys(domainMap).filter(k => k !== 'null').map(k => Number(k));
  let domainDescMap = {}; // id -> descricao
  if(validDomainIds.length){
    try {
      const domRows = await sequelize.query(`SELECT id, descricao FROM dominiogeral WHERE id IN (${validDomainIds.join(',')})`, { type: sequelize.QueryTypes.SELECT });
      domRows.forEach(dr => { domainDescMap[Number(dr.id)] = dr.descricao; });
    } catch(e){ console.warn('Aviso: falha ao carregar dominiogeral:', e.message); }
  }

  // Função heurística para mapear descrição para chave semântica
  function keyFromDesc(desc){
    if(!desc || typeof desc !== 'string') return null;
    const d = desc.toLowerCase();
    if(/people|pessoa/.test(d)) return 'people';
    if(/process/.test(d)) return 'process';
    if(/business|negoci|ambiente/.test(d)) return 'business';
    return null;
  }

  // Construir agregação semântica
  const semanticDomains = { people: [], process: [], business: [] };
  const unmappedDomainIds = [];
  validDomainIds.forEach(did => {
    const semKey = keyFromDesc(domainDescMap[did]);
    if(semKey){
      // Adicionar índices das questões deste domínio
      domainMap[did].questions.forEach(idx => semanticDomains[semKey].push(idx));
    } else {
      unmappedDomainIds.push(did);
    }
  });
  // Fallback de ordenação para quaisquer domínios não mapeados (atribui por ordem às chaves vazias)
  const fallbackKeys = ['people','process','business'].filter(k => semanticDomains[k].length === 0);
  let fkPtr = 0;
  unmappedDomainIds.forEach(did => {
    const assignKey = fallbackKeys[fkPtr] || 'process';
    domainMap[did].questions.forEach(idx => semanticDomains[assignKey].push(idx));
    if(fkPtr < fallbackKeys.length - 1) fkPtr++;
  });

  // Tentar distribuir corretas respeitando percepções de domínio quando percentuais fornecidos
  const overallCorrectTarget = Math.round(questionIds.length * (overallPct/100));
  let perDomainTargets = { people: 0, process: 0, business: 0 };
  const requested = { people: peoplePct, process: processPct, business: businessPct };

  const domainCounts = {
    people: semanticDomains.people.length,
    process: semanticDomains.process.length,
    business: semanticDomains.business.length
  };

  const hasRequested = [peoplePct, processPct, businessPct].some(v => v != null);
  if(hasRequested){
    // Calcular alvo inicial (floor) e frações
    const fractional = [];
    Object.keys(perDomainTargets).forEach(k => {
      const cnt = domainCounts[k];
      const reqPct = requested[k];
      if(cnt === 0 || reqPct == null){ perDomainTargets[k] = 0; return; }
      const ideal = reqPct/100 * cnt;
      const base = Math.floor(ideal);
      perDomainTargets[k] = base;
      fractional.push({ k, frac: ideal - base, cap: cnt });
    });
    let currentSum = Object.values(perDomainTargets).reduce((a,b)=>a+b,0);
    let remaining = overallCorrectTarget - currentSum;
    if(remaining > 0){
      // adicionar corretas extras seguindo frações decrescentes
      fractional.sort((a,b)=>b.frac - a.frac);
      for(const f of fractional){
        if(remaining <= 0) break;
        if(perDomainTargets[f.k] < f.cap){ perDomainTargets[f.k]++; remaining--; }
      }
    } else if(remaining < 0){
      // remover seguindo frações crescentes
      fractional.sort((a,b)=>a.frac - b.frac);
      for(const f of fractional){
        if(remaining >= 0) break;
        if(perDomainTargets[f.k] > 0){ perDomainTargets[f.k]--; remaining++; }
      }
    }
    // Se ainda não zerou diferença, distribuir arbitrariamente
    if(remaining !== 0){
      const order = ['people','process','business'];
      for(const k of order){
        if(remaining === 0) break;
        const cap = domainCounts[k];
        if(remaining > 0 && perDomainTargets[k] < cap){ perDomainTargets[k]++; remaining--; }
        else if(remaining < 0 && perDomainTargets[k] > 0){ perDomainTargets[k]--; remaining++; }
      }
    }
  } else {
    // Sem percentuais solicitados: distribuição simples sequencial
    perDomainTargets.people = Math.round(domainCounts.people * (overallPct/100));
    perDomainTargets.process = Math.round(domainCounts.process * (overallPct/100));
    perDomainTargets.business = Math.round(domainCounts.business * (overallPct/100));
  }

  // Ajustar soma final para não exceder target (se passou por arredondamentos)
  let sumDomainCorrects = Object.values(perDomainTargets).reduce((a,b)=>a+b,0);
  if(sumDomainCorrects > overallCorrectTarget){
    // remover excessos das maiores diferenças
    const ordered = Object.keys(perDomainTargets).sort((a,b)=>perDomainTargets[b]-perDomainTargets[a]);
    for(const k of ordered){
      if(sumDomainCorrects <= overallCorrectTarget) break;
      if(perDomainTargets[k] > 0){ perDomainTargets[k]--; sumDomainCorrects--; }
    }
  } else if(sumDomainCorrects < overallCorrectTarget){
    // adicionar faltantes onde houver espaço
    const ordered = Object.keys(perDomainTargets).sort((a,b)=>(domainCounts[b]-perDomainTargets[b]) - (domainCounts[a]-perDomainTargets[a]));
    for(const k of ordered){
      if(sumDomainCorrects >= overallCorrectTarget) break;
      if(perDomainTargets[k] < domainCounts[k]){ perDomainTargets[k]++; sumDomainCorrects++; }
    }
  }

  // Preparar set de índices corretos
  const correctIndexSet = new Set();
  ['people','process','business'].forEach(k => {
    const list = semanticDomains[k];
    const need = perDomainTargets[k];
    for(let i=0; i<list.length && i<need; i++) correctIndexSet.add(list[i]);
  });

  const corretas = correctIndexSet.size; // final real
  const startedAt = new Date(Date.now() - questionIds.length * 45000); // 45s médio por questão
  let cumulativeSec = 0;

  const aprovMin = examType.PontuacaoMinimaPercent != null ? Number(examType.PontuacaoMinimaPercent) : null;
  const scorePercent = (corretas / questionIds.length * 100);
  const aprovado = aprovMin != null ? scorePercent >= aprovMin : null;

  let attemptId = null;
  await sequelize.transaction(async (t) => {
    const fixtureSpec = require('../config/fixtureSpec');
    const attempt = await db.ExamAttempt.create({
      UserId: user.Id,
      ExamTypeId: examType.Id,
      Modo: 'fixture',
      QuantidadeQuestoes: questionIds.length,
      ExamMode: 'full',
      StartedAt: startedAt,
      LastActivityAt: startedAt,
      Status: 'finished',
      Corretas: corretas,
      Total: questionIds.length,
      ScorePercent: scorePercent.toFixed(2),
      Aprovado: aprovado,
      PauseState: null,
      BlueprintSnapshot: {
        id: examType.Slug,
        nome: examType.Nome,
        numeroQuestoes: examType.NumeroQuestoes,
        duracaoMinutos: examType.DuracaoMinutos,
        opcoesPorQuestao: examType.OpcoesPorQuestao,
        multiplaSelecao: examType.MultiplaSelecao,
        pontuacaoMinima: aprovMin
      },
      FiltrosUsados: { fixture: true },
      Meta: {
        origin: 'fixture-script',
        domainPercentsRequested: { people: peoplePct, process: processPct, business: businessPct },
        domainPercentsActual: {
          people: domainCounts.people ? (perDomainTargets.people / domainCounts.people * 100).toFixed(2) : null,
          process: domainCounts.process ? (perDomainTargets.process / domainCounts.process * 100).toFixed(2) : null,
          business: domainCounts.business ? (perDomainTargets.business / domainCounts.business * 100).toFixed(2) : null
        },
        domainCounts,
        domainCorrects: perDomainTargets,
        domainPercentsDiff: {
          people: (peoplePct!=null && domainCounts.people) ? ( (perDomainTargets.people / domainCounts.people * 100) - peoplePct ).toFixed(2) : null,
          process: (processPct!=null && domainCounts.process) ? ( (perDomainTargets.process / domainCounts.process * 100) - processPct ).toFixed(2) : null,
          business: (businessPct!=null && domainCounts.business) ? ( (perDomainTargets.business / domainCounts.business * 100) - businessPct ).toFixed(2) : null
        },
        fixtureVersion: fixtureSpec.fixtureVersion,
        answerStrategy: fixtureSpec.answerStrategy
      },
      StatusReason: 'fixture-generated'
    }, { transaction: t });
    attemptId = attempt.Id;

    // Precarregar opções para cada questão selecionada
    let optionMap = new Map();
    try {
      if (questionIds.length) {
        const optRows = await db.sequelize.query(
          `SELECT "Id" as id, "IdQuestao" as qid, "IsCorreta" as correta FROM respostaopcao WHERE "IdQuestao" IN (${questionIds.join(',')})`,
          { type: db.Sequelize.QueryTypes.SELECT, transaction: t }
        );
        optRows.forEach(r => {
          const arr = optionMap.get(r.qid) || [];
            arr.push(r); optionMap.set(r.qid, arr);
        });
      }
    } catch(e){ console.warn('Falha carregar opções (script fixture):', e.message); }

    // Insert attempt questions & answers with realistic option selection
    const aqRows = [];
    const ansRows = [];
    questionIds.forEach((qid, idx) => {
      const isCorrect = correctIndexSet.has(idx);
      const tempo = 30 + Math.floor(Math.random()*60); // 30-90s
      cumulativeSec += tempo;
      const qUpdated = new Date(startedAt.getTime() + cumulativeSec*1000);
      aqRows.push({ AttemptId: attemptId, QuestionId: qid, Ordem: idx+1, TempoGastoSegundos: tempo, Correta: isCorrect, Meta: null, CreatedAt: startedAt, UpdatedAt: qUpdated });
    });
    const insertedQuestions = await db.ExamAttemptQuestion.bulkCreate(aqRows, { transaction: t, returning: true });

    insertedQuestions.forEach(q => {
      const qOpts = optionMap.get(q.QuestionId) || [];
      const correctOpts = qOpts.filter(o => o.correta);
      const incorrectOpts = qOpts.filter(o => !o.correta);
      const isCorrect = q.Correta;
      if (isCorrect && correctOpts.length){
        // Seleciona todas as corretas
        correctOpts.forEach(opt => {
          ansRows.push({ AttemptQuestionId: q.Id, OptionId: opt.id, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
        });
      } else {
        if (incorrectOpts.length){
          ansRows.push({ AttemptQuestionId: q.Id, OptionId: incorrectOpts[0].id, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
        } else if (correctOpts.length){
          // fallback: selecionar somente uma correta (multi corretas → continuará incorreta)
          ansRows.push({ AttemptQuestionId: q.Id, OptionId: correctOpts[0].id, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
        } else {
          // sem opções carregadas
          ansRows.push({ AttemptQuestionId: q.Id, OptionId: null, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
        }
      }
    });
    if (ansRows.length) await db.ExamAttemptAnswer.bulkCreate(ansRows, { transaction: t });

    // Finalizar attempt com FinishedAt = último updated
    const finishedAt = new Date(startedAt.getTime() + cumulativeSec*1000 + 5000); // +5s buffer
    await db.ExamAttempt.update({ FinishedAt: finishedAt, LastActivityAt: finishedAt }, { where: { Id: attemptId }, transaction: t });
  });

  // Atualizar estatísticas (finished)
  try { await userStatsService.incrementFinished(userId, overallPct); } catch(err){ console.warn('Falha incrementFinished:', err.message); }

  console.log(JSON.stringify({ attemptId, userId, totalQuestions: questionIds.length, corretas, scorePercent: scorePercent.toFixed(2), domainCounts, domainCorrects: perDomainTargets }, null, 2));
}

main().catch(err => { console.error('Erro fixture attempt:', err); process.exit(1); });
