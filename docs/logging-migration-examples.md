# Exemplos de Migração para Logger System

## Exemplo 1: Debug Simples

### ANTES
```javascript
console.log('[exam] Loading questions');
console.log('[exam] Question count:', count);
```

### DEPOIS
```javascript
logger.debug('[exam] Loading questions');
logger.debug('[exam] Question count:', count);
```

---

## Exemplo 2: Info com Dados

### ANTES
```javascript
console.info('[login] User logged in', {
  userId: user.id,
  email: user.email
});
```

### DEPOIS
```javascript
logger.info('[login] User logged in', {
  userId: user.id,
  email: user.email
});
```

---

## Exemplo 3: Warning

### ANTES
```javascript
if (!token) {
  console.warn('[auth] No token found');
}
```

### DEPOIS
```javascript
if (!token) {
  logger.warn('[auth] No token found');
}
```

---

## Exemplo 4: Error Handling

### ANTES
```javascript
try {
  const data = await fetchData();
} catch (error) {
  console.error('[api] Fetch failed:', error);
}
```

### DEPOIS
```javascript
try {
  const data = await fetchData();
} catch (error) {
  logger.error('[api] Fetch failed:', error);
}
```

---

## Exemplo 5: Dados Sensíveis (Automático)

### ANTES
```javascript
console.log('Login data:', {
  email: 'user@example.com',
  password: 'secret123',
  token: 'abc123xyz'
});
// PROBLEMA: Expõe senha e token em produção!
```

### DEPOIS
```javascript
logger.debug('Login data:', {
  email: 'user@example.com',
  password: 'secret123',
  token: 'abc123xyz'
});
// EM PRODUÇÃO: { email: 'user@example.com', password: '[REDACTED]', token: '[REDACTED]' }
```

---

## Exemplo 6: Condicional por Ambiente

### ANTES
```javascript
if (process.env.NODE_ENV === 'development') {
  console.log('Debug info:', data);
}
```

### DEPOIS
```javascript
// Não precisa de condicional - o logger gerencia automaticamente
logger.debug('Debug info:', data);
```

---

## Exemplo 7: Performance Monitoring

### ANTES
```javascript
const start = Date.now();
doSomething();
console.log('Took', Date.now() - start, 'ms');
```

### DEPOIS
```javascript
const start = performance.now();
doSomething();
const duration = performance.now() - start;
logger.debug('Operation duration:', { ms: duration.toFixed(2) });
```

---

## Exemplo 8: Fallback (Migração Gradual)

Se ainda não tem certeza se logger está carregado:

```javascript
// Usa logger se disponível, senão usa console
logger?.debug('Message', data) || console.debug('Message', data);
logger?.info('Message', data) || console.info('Message', data);
logger?.warn('Message', data) || console.warn('Message', data);
logger?.error('Message', data) || console.error('Message', data);
```

---

## Exemplo 9: Controle Manual de Nível

```javascript
// Habilitar logs detalhados temporariamente
function debugMode() {
  logger.setLevel('debug');
  logger.info('Debug mode enabled - all logs visible');
  
  // Seu código de debug aqui
  performComplexOperation();
  
  // Restaurar nível original
  logger.setLevel('info');
}
```

---

## Exemplo 10: Formatação Estruturada

### ANTES
```javascript
console.log('User ' + userId + ' completed exam ' + examId + ' with score ' + score);
```

### DEPOIS
```javascript
logger.info('[exam] Exam completed', {
  userId,
  examId,
  score,
  timestamp: new Date().toISOString()
});
```

---

## Checklist de Migração

- [ ] Incluir `<script src="/utils/logger.js"></script>` no HTML
- [ ] Substituir `console.log` → `logger.debug` ou `logger.info`
- [ ] Substituir `console.debug` → `logger.debug`
- [ ] Substituir `console.info` → `logger.info`
- [ ] Substituir `console.warn` → `logger.warn`
- [ ] Substituir `console.error` → `logger.error`
- [ ] Testar em localhost (deve mostrar todos os logs)
- [ ] Testar em produção (deve mostrar apenas errors)
- [ ] Verificar sanitização de dados sensíveis

---

## Script de Migração Automática

Use este regex find/replace no seu editor:

### Find (Regex)
```regex
console\.(log|debug|info|warn|error)\(
```

### Replace
```
logger.$1(
```

**ATENÇÃO**: Revisar cada substituição manualmente!
- `console.log` → `logger.debug` ou `logger.info` (escolher apropriado)
- Verificar se não há uso especial de console (como `console.table`)
