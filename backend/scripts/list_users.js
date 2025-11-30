// List users in DB for quick debug (exclude SenhaHash)
// Usage: node backend/scripts/list_users.js [limit]
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../models');

async function run(){
  try {
    await db.sequelize.authenticate();
    const limit = Math.min(parseInt(process.argv[2]) || 50, 500);
    const rows = await db.User.findAll({
      attributes: ['Id','Email','NomeUsuario','EmailConfirmado','BloqueioAtivado','DataCadastro','DataAlteracao'],
      order: [['Id','DESC']],
      limit
    });
    console.table(rows.map(r => ({
      Id: r.Id,
      Email: r.Email,
      NomeUsuario: r.NomeUsuario,
      Confirmado: r.EmailConfirmado,
      Bloqueio: r.BloqueioAtivado
    })));
  } catch(e){
    console.error('Erro listando usuários', e);
    process.exit(1);
  } finally {
    try { await db.sequelize.close(); } catch(_){ }
  }
}
run();