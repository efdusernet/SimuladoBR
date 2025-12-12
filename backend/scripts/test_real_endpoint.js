require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function testRealEndpoint() {
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  
  console.log('=== TESTANDO endpoint /api/exams/select real ===\n');
  console.log('URL:', `${BASE_URL}/api/exams/select`);

  const payload = {
    count: 1,
    onlyCount: true,
    examType: 'pmp',
    dominios: [4]
  };

  console.log('Payload enviado:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(`${BASE_URL}/api/exams/select`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-SQL': 'true'
      },
      body: JSON.stringify(payload)
    });

    console.log('\n✅ Status:', response.status);
    
    const data = await response.json();
    console.log('\nResposta recebida:');
    console.log(JSON.stringify(data, null, 2));

    if (data.available === 31) {
      console.log('\n✅✅✅ SUCESSO! Retornou 31 questões como esperado!');
    } else {
      console.log(`\n⚠️ Retornou ${data.available} questões (esperado: 31)`);
    }
  } catch (error) {
    console.error('\n❌ Erro:', error.message);
  }
}

testRealEndpoint().catch(console.error);
