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

  // Selecionar IDs de questões
  const sequelize = db.sequelize;
  const whereClauses = ["excluido = false","idstatus = 1",`exam_type_id = ${Number(examType.Id)}`];
  const whereSql = whereClauses.join(' AND ');
  const selectIdsQ = `SELECT id FROM questao WHERE ${whereSql} ORDER BY random() LIMIT :limit`;
  const questRows = await sequelize.query(selectIdsQ, { replacements: { limit: totalQuestions }, type: sequelize.QueryTypes.SELECT });
  const questionIds = questRows.map(r => Number(r.id)).filter(n => Number.isFinite(n));
  if(questionIds.length < totalQuestions){
    console.error(`Não há questões suficientes (${questionIds.length}) para total solicitado (${totalQuestions}).`);
    process.exit(1);
  }

  const corretas = Math.round(questionIds.length * (overallPct/100));
  const startedAt = new Date(Date.now() - questionIds.length * 45000); // 45s médio por questão
  let cumulativeSec = 0;

  const aprovMin = examType.PontuacaoMinimaPercent != null ? Number(examType.PontuacaoMinimaPercent) : null;
  const scorePercent = (corretas / questionIds.length * 100);
  const aprovado = aprovMin != null ? scorePercent >= aprovMin : null;

  let attemptId = null;
  await sequelize.transaction(async (t) => {
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
      Meta: { origin: 'fixture-script', domainPercents: { people: peoplePct, process: processPct, business: businessPct }, domainLabels: { people: labelFromPct(peoplePct), process: labelFromPct(processPct), business: labelFromPct(businessPct) } },
      StatusReason: 'fixture-generated'
    }, { transaction: t });
    attemptId = attempt.Id;

    // Insert attempt questions & answers
    const aqRows = [];
    const ansRows = [];
    questionIds.forEach((qid, idx) => {
      const isCorrect = idx < corretas; // primeiros corretos
      const tempo = 30 + Math.floor(Math.random()*60); // 30-90s
      cumulativeSec += tempo;
      const qUpdated = new Date(startedAt.getTime() + cumulativeSec*1000);
      aqRows.push({ AttemptId: attemptId, QuestionId: qid, Ordem: idx+1, TempoGastoSegundos: tempo, Correta: isCorrect, Meta: null, CreatedAt: startedAt, UpdatedAt: qUpdated });
    });
    const insertedQuestions = await db.ExamAttemptQuestion.bulkCreate(aqRows, { transaction: t, returning: true });
    // Create answers with incremental updated_at; OptionId fica null para evitar FK inválida
    insertedQuestions.forEach(q => {
      ansRows.push({ AttemptQuestionId: q.Id, OptionId: null, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
    });
    await db.ExamAttemptAnswer.bulkCreate(ansRows, { transaction: t });

    // Finalizar attempt com FinishedAt = último updated
    const finishedAt = new Date(startedAt.getTime() + cumulativeSec*1000 + 5000); // +5s buffer
    await db.ExamAttempt.update({ FinishedAt: finishedAt, LastActivityAt: finishedAt }, { where: { Id: attemptId }, transaction: t });
  });

  // Atualizar estatísticas (finished)
  try { await userStatsService.incrementFinished(userId, overallPct); } catch(err){ console.warn('Falha incrementFinished:', err.message); }

  console.log(JSON.stringify({ attemptId, userId, totalQuestions: questionIds.length, corretas, scorePercent: scorePercent.toFixed(2) }, null, 2));
}

main().catch(err => { console.error('Erro fixture attempt:', err); process.exit(1); });
