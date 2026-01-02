// Script de teste para expirar tokens manualmente
require('dotenv').config();
const db = require('./models');
const { EmailVerification, User } = db;

async function testExpireTokens() {
    try {
        console.log('🔍 Buscando usuário...');
        const user = await User.findOne({ where: { Email: 'teixeirayuri23@gmail.com' } });
        
        if (!user) {
            console.log('❌ Usuário não encontrado');
            process.exit(1);
        }
        
        console.log('✓ Usuário encontrado, ID:', user.Id);
        
        console.log('\n🔍 Buscando tokens não usados...');
        const tokens = await EmailVerification.findAll({
            where: {
                UserId: user.Id,
                Used: false
            }
        });
        
        console.log(`✓ Encontrados ${tokens.length} tokens não usados\n`);
        
        for (const token of tokens) {
            console.log('📋 Token ID:', token.id);
            console.log('   Token:', token.Token);
            console.log('   ExpiresAt:', token.ExpiresAt);
            console.log('   Used:', token.Used);
            console.log('   Meta (raw):', token.Meta);
            
            try {
                const meta = token.Meta ? JSON.parse(token.Meta) : {};
                console.log('   Meta (parsed):', meta);
                console.log('   Meta type:', meta.type);
                
                if (meta.type === 'password_reset') {
                    console.log('   ✓ É password_reset, forçando expiração...');
                    await token.update({ ForcedExpiration: true });
                    console.log('   ✓ Expirado! ForcedExpiration:', true);
                } else {
                    console.log('   ⚠️  Não é password_reset, pulando');
                }
            } catch (e) {
                console.log('   ❌ Erro ao processar meta:', e.message);
            }
            console.log('');
        }
        
        console.log('✅ Teste concluído!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Erro:', err);
        process.exit(1);
    }
}

testExpireTokens();
