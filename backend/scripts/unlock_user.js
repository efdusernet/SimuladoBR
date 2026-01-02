// Usage:
//   node backend/scripts/unlock_user.js user@example.com
//
// Clears temporary lockout caused by repeated failed login attempts.

const db = require('../models');

async function main() {
  const emailArg = process.argv.slice(2).join(' ').trim();
  if (!emailArg || emailArg === '--help' || emailArg === '-h') {
    console.error('Usage: node backend/scripts/unlock_user.js <email>');
    process.exit(2);
  }

  const email = String(emailArg).trim().toLowerCase();

  const user = await db.User.findOne({ where: { Email: email } });
  if (!user) {
    console.error('User not found for email:', email);
    process.exit(1);
  }

  await user.update({
    AccessFailedCount: 0,
    FimBloqueio: null,
    DataAlteracao: new Date(),
  });

  console.log('Unlocked user:', { Id: user.Id, Email: user.Email });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('unlock_user failed:', err);
    process.exit(1);
  });
