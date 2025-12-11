/**
 * Validation Test Suite
 * Tests input validation against common attack vectors
 */

const { authSchemas, examSchemas } = require('./middleware/validation');

console.log('=== Input Validation Test Suite ===\n');

const tests = [
  {
    name: 'Valid Login',
    schema: authSchemas.login,
    data: { Email: 'user@example.com', SenhaHash: 'a'.repeat(64) },
    expect: 'pass'
  },
  {
    name: 'SQL Injection in Email',
    schema: authSchemas.login,
    data: { Email: "admin'--", SenhaHash: 'a'.repeat(64) },
    expect: 'block'
  },
  {
    name: 'XSS in Email',
    schema: authSchemas.login,
    data: { Email: 'test@example.com<script>', SenhaHash: 'a'.repeat(64) },
    expect: 'block'
  },
  {
    name: 'Short Password Hash',
    schema: authSchemas.login,
    data: { Email: 'user@example.com', SenhaHash: 'short' },
    expect: 'block'
  },
  {
    name: 'Valid Exam Selection',
    schema: examSchemas.selectQuestions,
    data: { examType: 'PMP', dominios: [1, 2, 3] },
    expect: 'pass'
  },
  {
    name: 'Invalid Exam Type',
    schema: examSchemas.selectQuestions,
    data: { examType: 'INVALID' },
    expect: 'block'
  },
  {
    name: 'SQL in Domains Array',
    schema: examSchemas.selectQuestions,
    data: { examType: 'PMP', dominios: ['DROP TABLE'] },
    expect: 'block'
  },
  {
    name: 'Buffer Overflow - Long Email',
    schema: authSchemas.login,
    data: { Email: 'a'.repeat(300) + '@example.com', SenhaHash: 'a'.repeat(64) },
    expect: 'block'
  },
  {
    name: 'Type Confusion - Numeric Email',
    schema: authSchemas.login,
    data: { Email: 12345, SenhaHash: 'a'.repeat(64) },
    expect: 'block'
  },
  {
    name: 'Valid Password Reset',
    schema: authSchemas.resetPassword,
    data: { email: 'user@example.com', token: 'ABC123', senhaHash: 'a'.repeat(64) },
    expect: 'pass'
  }
];

let passed = 0;
let failed = 0;

tests.forEach(test => {
  const result = test.schema.validate(test.data);
  const success = (test.expect === 'pass' && !result.error) || 
                  (test.expect === 'block' && result.error);
  
  if (success) {
    console.log('✓', test.name);
    passed++;
  } else {
    console.log('✗', test.name, '- Expected:', test.expect, 
                'Got:', result.error ? 'blocked' : 'passed');
    if (result.error) {
      console.log('  Error:', result.error.message);
    }
    failed++;
  }
});

console.log('\n=== Results ===');
console.log('Passed:', passed + '/' + tests.length);
console.log('Failed:', failed + '/' + tests.length);

process.exit(failed > 0 ? 1 : 0);
