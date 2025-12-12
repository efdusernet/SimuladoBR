const sequelize = require('../config/database');

async function testArrayQuery() {
  try {
    console.log('=== TESTANDO queries com ANY(ARRAY[:param]) ===\n');
    
    // Teste 1: Array simples
    console.log('Teste 1: Passando array [4]');
    const test1 = await sequelize.query(
      `SELECT COUNT(*)::int AS cnt 
       FROM questao q 
       WHERE q.excluido = false 
         AND q.idstatus = 1 
         AND q.exam_type_id = 1
         AND q.iddominio = ANY(ARRAY[:dominios])`,
      { 
        replacements: { dominios: [4] }, 
        type: sequelize.QueryTypes.SELECT 
      }
    );
    console.log('Resultado:', test1);
    
    // Teste 2: Usando cast explícito
    console.log('\nTeste 2: Com cast explícito para integer[]');
    const test2 = await sequelize.query(
      `SELECT COUNT(*)::int AS cnt 
       FROM questao q 
       WHERE q.excluido = false 
         AND q.idstatus = 1 
         AND q.exam_type_id = 1
         AND q.iddominio = ANY(:dominios::integer[])`,
      { 
        replacements: { dominios: [4] }, 
        type: sequelize.QueryTypes.SELECT 
      }
    );
    console.log('Resultado:', test2);
    
    // Teste 3: Verificar o que realmente está sendo passado
    console.log('\nTeste 3: Debug do replacement');
    const replacements = { dominios: [4] };
    console.log('Tipo de dominios:', typeof replacements.dominios);
    console.log('É array?:', Array.isArray(replacements.dominios));
    console.log('Valor:', JSON.stringify(replacements.dominios));
    console.log('Primeiro elemento tipo:', typeof replacements.dominios[0]);
    
    // Teste 4: Query direta sem ANY
    console.log('\nTeste 4: Query direta sem ANY (para comparação)');
    const test4 = await sequelize.query(
      `SELECT COUNT(*)::int AS cnt 
       FROM questao q 
       WHERE q.excluido = false 
         AND q.idstatus = 1 
         AND q.exam_type_id = 1
         AND q.iddominio = 4`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log('Resultado:', test4);
    
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err);
    process.exit(1);
  }
}

testArrayQuery();
