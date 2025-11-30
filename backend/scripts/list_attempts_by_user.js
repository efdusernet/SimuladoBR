// List finished attempts for a given userId to debug history endpoint
// Usage: node backend/scripts/list_attempts_by_user.js --userId 25 [--limit 10]
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../models');

function arg(name, def=null){
  const flag = `--${name}`; const idx = process.argv.indexOf(flag);
  if(idx >= 0){ const v = process.argv[idx+1]; return (v && !v.startsWith('--')) ? v : true; }
  const pref = process.argv.find(a => a.startsWith(flag+'='));
  if(pref) return pref.split('=')[1];
  return def;
}

async function main(){
  const userId = Number(arg('userId'));
  if(!Number.isFinite(userId) || userId <= 0){ console.error('Parâmetro --userId inválido'); process.exit(1); }
  const limit = Math.min(Number(arg('limit', 20))||20, 100);
  await db.sequelize.authenticate();
  const rows = await db.ExamAttempt.findAll({
    where: { UserId: userId, Status: 'finished' },
    order: [['FinishedAt','DESC']],
    limit,
    attributes: ['Id','UserId','ExamTypeId','FinishedAt','StartedAt','Corretas','Total','ScorePercent','Aprovado']
  });
  if(!rows.length){ console.log('Nenhuma tentativa finished para UserId', userId); process.exit(0); }
  console.table(rows.map(r => ({
    Id: r.Id,
    Score: r.ScorePercent,
    Corretas: r.Corretas,
    Total: r.Total,
    Aprovado: r.Aprovado,
    Inicio: r.StartedAt,
    Fim: r.FinishedAt
  })));
  process.exit(0);
}

main().catch(e => { console.error('Erro list_attempts_by_user:', e); process.exit(1); });