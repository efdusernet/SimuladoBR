// Create a minimal finished ExamAttempt without needing real questions/options.
// Usage: node backend/scripts/create_dummy_attempt.js --userId 25 --correct 42 --total 60 --examType pmp
// If no examType provided or not found, ExamTypeId will be null.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../models');

function arg(name, def=null){
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if(idx >= 0){
    const v = process.argv[idx+1];
    return (v && !v.startsWith('--')) ? v : true;
  }
  const pref = process.argv.find(a => a.startsWith(flag+'='));
  if(pref) return pref.split('=')[1];
  return def;
}

async function main(){
  const userId = Number(arg('userId'));
  if(!Number.isFinite(userId) || userId <= 0){
    console.error('Parâmetro --userId inválido');
    process.exit(1);
  }
  const correct = Number(arg('correct', 30));
  const total = Number(arg('total', 60));
  if(!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0){
    console.error('Parâmetros --correct/--total inválidos');
    process.exit(1);
  }
  const examTypeSlug = String(arg('examType','pmp')||'pmp').trim();
  await db.sequelize.authenticate();
  const user = await db.User.findByPk(userId);
  if(!user){ console.error('Usuário não encontrado:', userId); process.exit(2); }
  const examType = await db.ExamType.findOne({ where: { Slug: examTypeSlug } });
  const examTypeId = examType ? examType.Id : null;
  const startedAt = new Date(Date.now() - 1000*60*total*0.8); // simulate duration
  const finishedAt = new Date();
  const aprovMin = examType && examType.PontuacaoMinimaPercent != null ? Number(examType.PontuacaoMinimaPercent) : null;
  const scorePercent = total > 0 ? (correct * 100 / total) : 0;
  const aprovado = aprovMin != null ? scorePercent >= aprovMin : null;
  const attempt = await db.ExamAttempt.create({
    UserId: user.Id,
    ExamTypeId: examTypeId,
    Modo: 'dummy',
    QuantidadeQuestoes: total,
    ExamMode: 'full',
    StartedAt: startedAt,
    LastActivityAt: finishedAt,
    FinishedAt: finishedAt,
    Status: 'finished',
    Corretas: correct,
    Total: total,
    ScorePercent: scorePercent.toFixed(2),
    Aprovado: aprovado,
    PauseState: null,
    BlueprintSnapshot: examType ? {
      id: examType.Slug,
      nome: examType.Nome,
      numeroQuestoes: examType.NumeroQuestoes,
      duracaoMinutos: examType.DuracaoMinutos,
      opcoesPorQuestao: examType.OpcoesPorQuestao,
      multiplaSelecao: examType.MultiplaSelecao,
      pontuacaoMinima: aprovMin
    } : null,
    FiltrosUsados: { dummy: true },
    Meta: { origin: 'dummy-script' },
    StatusReason: 'dummy-generated'
  });
  console.log(JSON.stringify({ attemptId: attempt.Id, userId, examTypeId, correct, total, scorePercent }, null, 2));
  process.exit(0);
}

main().catch(e => { console.error('Erro create_dummy_attempt:', e); process.exit(1); });