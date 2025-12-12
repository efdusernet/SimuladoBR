require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

async function testHttpSimulation() {
  console.log('=== SIMULANDO requisição HTTP real ===\n');

  // Simula req.body exatamente como vem do frontend
  const reqBody = {
    count: 1,
    onlyCount: true,
    examType: 'pmp',
    dominios: [4] // Array de numbers como enviado pelo frontend
  };

  console.log('req.body recebido:', JSON.stringify(reqBody, null, 2));

  // Simula o processamento no controller
  const examTypeId = 1; // PMP
  const dominios = Array.isArray(reqBody.dominios) && reqBody.dominios.length 
    ? reqBody.dominios.map(Number) 
    : null;

  console.log('\nApós processamento:');
  console.log('  dominios:', dominios);
  console.log('  typeof dominios[0]:', typeof dominios[0]);
  console.log('  Array.isArray(dominios):', Array.isArray(dominios));

  // Simula construção das cláusulas WHERE
  const whereClauses = ['q.excluido = false', 'q.idstatus = 1'];
  const replacements = {};

  whereClauses.push('q.exam_type_id = :examTypeId');
  replacements.examTypeId = examTypeId;

  if (dominios && dominios.length) {
    whereClauses.push('q.iddominio = ANY(ARRAY[:dominios])');
    replacements.dominios = dominios;
  }

  const whereSql = whereClauses.join(' AND ');
  const countQuery = `SELECT COUNT(*)::int AS cnt FROM questao q WHERE ${whereSql}`;

  console.log('\nQuery gerada:');
  console.log(countQuery);
  console.log('\nReplacements:');
  console.log(JSON.stringify(replacements, null, 2));

  // Executa a query
  try {
    const result = await sequelize.query(countQuery, {
      replacements,
      type: sequelize.QueryTypes.SELECT
    });

    console.log('\n✅ Resultado da query:', result[0].cnt);
  } catch (error) {
    console.error('\n❌ Erro:', error.message);
    console.error('SQL:', error.sql);
  } finally {
    await sequelize.close();
  }
}

testHttpSimulation().catch(console.error);
