require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

async function checkExamTypes() {
  console.log('=== Verificando exam_type table ===\n');

  const query = 'SELECT id, nome, slug, ativo FROM exam_type ORDER BY id';
  
  try {
    const rows = await sequelize.query(query, {
      type: sequelize.QueryTypes.SELECT
    });

    console.log('Exam Types no banco:');
    rows.forEach(row => {
      console.log(`  ID: ${row.id}, Nome: ${row.nome}, Slug: ${row.slug}, Ativo: ${row.ativo}`);
    });

    console.log('\n=== Teste de busca por slug ===');
    const slug = 'pmp';
    console.log(`Buscando exam type com slug="${slug}"...`);
    
    const found = rows.find(r => r.slug.toLowerCase() === slug.toLowerCase());
    if (found) {
      console.log(`✅ Encontrado: ID=${found.id}, Nome=${found.nome}, Slug=${found.slug}`);
    } else {
      console.log(`❌ Não encontrado! Slugs disponíveis: ${rows.map(r => r.slug).join(', ')}`);
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await sequelize.close();
  }
}

checkExamTypes().catch(console.error);
