const sequelize = require('../config/database');

async function checkData() {
  try {
    console.log('=== DOMÍNIOS ===');
    const dominios = await sequelize.query(
      `SELECT id, descricao FROM dominio ORDER BY id`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log(JSON.stringify(dominios, null, 2));
    
    console.log('\n=== ÁREAS DE CONHECIMENTO ===');
    const areas = await sequelize.query(
      `SELECT id, descricao FROM areaconhecimento ORDER BY id`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log(JSON.stringify(areas, null, 2));
    
    console.log('\n=== GRUPOS DE PROCESSO ===');
    const grupos = await sequelize.query(
      `SELECT id, descricao FROM grupoprocesso ORDER BY id`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log(JSON.stringify(grupos, null, 2));
    
    console.log('\n=== CATEGORIAS ===');
    const categorias = await sequelize.query(
      `SELECT id, descricao FROM categoriaquestao ORDER BY id`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log(JSON.stringify(categorias, null, 2));
    
    console.log('\n=== CONTAGEM DE QUESTÕES POR DOMÍNIO ===');
    const countDom = await sequelize.query(
      `SELECT iddominio, COUNT(*) as total 
       FROM questao 
       WHERE excluido = false AND idstatus = 1
       GROUP BY iddominio 
       ORDER BY iddominio`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log(JSON.stringify(countDom, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err);
    process.exit(1);
  }
}

checkData();
