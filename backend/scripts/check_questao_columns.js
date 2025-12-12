const sequelize = require('../config/database');

async function checkColumns() {
  try {
    const result = await sequelize.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'questao' AND table_schema = 'public' 
       ORDER BY ordinal_position`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    console.log('Colunas da tabela questao:');
    console.log(JSON.stringify(result.map(r => r.column_name), null, 2));
    
    // Check specific columns we're looking for
    const cols = result.map(r => r.column_name);
    console.log('\nColunas relevantes para filtros:');
    console.log('- iddominio:', cols.includes('iddominio') ? 'SIM' : 'NÃO');
    console.log('- IdDominio:', cols.includes('IdDominio') ? 'SIM' : 'NÃO');
    console.log('- codareaconhecimento:', cols.includes('codareaconhecimento') ? 'SIM' : 'NÃO');
    console.log('- CodAreaConhecimento:', cols.includes('CodAreaConhecimento') ? 'SIM' : 'NÃO');
    console.log('- codgrupoprocesso:', cols.includes('codgrupoprocesso') ? 'SIM' : 'NÃO');
    console.log('- CodGrupoProcesso:', cols.includes('CodGrupoProcesso') ? 'SIM' : 'NÃO');
    console.log('- codigocategoria:', cols.includes('codigocategoria') ? 'SIM' : 'NÃO');
    console.log('- CodigoCategoria:', cols.includes('CodigoCategoria') ? 'SIM' : 'NÃO');
    
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err);
    process.exit(1);
  }
}

checkColumns();
