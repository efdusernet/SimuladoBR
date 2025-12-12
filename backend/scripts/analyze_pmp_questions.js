const sequelize = require('../config/database');

async function checkPmpQuestions() {
  try {
    console.log('=== ANÁLISE: Questões por Domínio e Exam Type ===\n');
    
    // Buscar exam_type_id para PMP
    const examTypes = await sequelize.query(
      `SELECT id, nome FROM exam_type ORDER BY id`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log('Tipos de Exame:');
    console.log(JSON.stringify(examTypes, null, 2));
    
    const pmpType = examTypes.find(t => (t.nome || '').toLowerCase().includes('pmp'));
    const pmpId = pmpType ? pmpType.id : null;
    console.log(`\nID do tipo PMP: ${pmpId}\n`);
    
    // Contagem total por domínio (sem filtro de exam_type)
    console.log('=== TOTAL de questões por domínio (SEM filtro de exam_type) ===');
    const totalPerDomain = await sequelize.query(
      `SELECT d.id, d.descricao, COUNT(q.id) as total
       FROM dominio d
       LEFT JOIN questao q ON q.iddominio = d.id AND q.excluido = false AND q.idstatus = 1
       GROUP BY d.id, d.descricao
       ORDER BY d.id`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log(JSON.stringify(totalPerDomain, null, 2));
    
    if (pmpId) {
      // Contagem por domínio COM filtro de exam_type = PMP
      console.log('\n=== TOTAL de questões por domínio (COM filtro exam_type = PMP) ===');
      const pmpPerDomain = await sequelize.query(
        `SELECT d.id, d.descricao, COUNT(q.id) as total
         FROM dominio d
         LEFT JOIN questao q ON q.iddominio = d.id 
           AND q.excluido = false 
           AND q.idstatus = 1 
           AND q.exam_type_id = :pmpId
         GROUP BY d.id, d.descricao
         ORDER BY d.id`,
        { replacements: { pmpId }, type: sequelize.QueryTypes.SELECT }
      );
      console.log(JSON.stringify(pmpPerDomain, null, 2));
      
      // Verificar quantas questões TÊM exam_type_id vs NÃO TÊM
      console.log('\n=== Distribuição de exam_type_id ===');
      const typeDistribution = await sequelize.query(
        `SELECT 
           exam_type_id,
           COUNT(*) as total
         FROM questao
         WHERE excluido = false AND idstatus = 1
         GROUP BY exam_type_id
         ORDER BY exam_type_id`,
        { type: sequelize.QueryTypes.SELECT }
      );
      console.log(JSON.stringify(typeDistribution, null, 2));
      
      // Verificar questões do domínio 4 especificamente
      console.log('\n=== Questões do domínio 4 (Planejamento) por exam_type_id ===');
      const domain4 = await sequelize.query(
        `SELECT 
           COALESCE(exam_type_id::text, 'NULL') as exam_type,
           COUNT(*) as total
         FROM questao
         WHERE iddominio = 4 AND excluido = false AND idstatus = 1
         GROUP BY exam_type_id
         ORDER BY exam_type_id`,
        { type: sequelize.QueryTypes.SELECT }
      );
      console.log(JSON.stringify(domain4, null, 2));
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err);
    process.exit(1);
  }
}

checkPmpQuestions();
