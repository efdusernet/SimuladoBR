// Seed a test user directly in the DB (bypassing /api/users) for local debugging.
// Usage (PowerShell): node backend/scripts/seed_test_user.js email@example.com MinhaSenha123
// The login flow expects SenhaHash stored as bcrypt hash of the client-side SHA-256 hex.
// This script reproduces that: plaintext -> sha256 hex -> bcrypt -> Usuario.SenhaHash

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../models');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function sha256Hex(str){
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

async function main(){
  const argv = process.argv.slice(2);
  const email = argv[0];
  const password = argv[1];

  const flags = new Set(argv.slice(2).filter((a) => typeof a === 'string' && a.startsWith('--')));
  const nonFlags = argv.slice(2).filter((a) => typeof a === 'string' && !a.startsWith('--'));
  const nome = nonFlags[0];

  // Default matches previous behavior: create FREE user (BloqueioAtivado=true)
  // Flags:
  //   --premium  -> BloqueioAtivado=false
  //   --free     -> BloqueioAtivado=true
  const isPremium = flags.has('--premium') ? true : (flags.has('--free') ? false : false);
  const bloqueioAtivado = !isPremium;

  if (!email || !password){
    console.error('Uso: node backend/scripts/seed_test_user.js <email> <senha> [nomeOpcional] [--premium|--free]');
    process.exit(1);
  }
  const sequelize = db.sequelize;
  try { await sequelize.authenticate(); } catch(e){ console.error('Falha ao conectar DB:', e); process.exit(2); }

  const User = db.User;
  const emailLower = email.trim().toLowerCase();
  let existing = await User.findOne({ where: { Email: emailLower } });
  if (existing){
    console.log('Usuário já existe. Atualizando senha e confirmação de e-mail. Id=', existing.Id);
  }
  const shaHex = await sha256Hex(password);
  const bcryptHash = await bcrypt.hash(shaHex, 10);
  const now = new Date();

  if (!existing){
    existing = await User.create({
      AccessFailedCount: 0,
      Email: emailLower,
      EmailConfirmado: true,
      BloqueioAtivado: bloqueioAtivado,
      FimBloqueio: null,
      NomeUsuario: emailLower,
      SenhaHash: bcryptHash,
      NumeroTelefone: null,
      Nome: nome || emailLower,
      ForcarLogin: null,
      DataCadastro: now,
      DataAlteracao: now,
      Excluido: null
    });
    console.log('Usuário criado Id=', existing.Id);
  } else {
    await existing.update({
      SenhaHash: bcryptHash,
      EmailConfirmado: true,
      BloqueioAtivado: bloqueioAtivado,
      DataAlteracao: now,
    });
    console.log('Usuário atualizado (senha/confirmacao/bloqueio) Id=', existing.Id);
  }

  console.log('Pronto. Faça login com:', emailLower, 'Senha:', password, 'Tipo:', (isPremium ? 'premium' : 'free'));
  process.exit(0);
}

main();