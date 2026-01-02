# Sistema de Logging Controlado - Guia de Uso

## Visão Geral

O novo sistema de logging resolve o **Issue #19: Excessive Console Logging in Production** implementando:

- ✅ Controle de níveis de log (DEBUG, INFO, WARN, ERROR, NONE)
- ✅ Desabilitação automática em produção
- ✅ Sanitização de dados sensíveis
- ✅ Redução de overhead de performance
- ✅ Prevenção de vazamento de informações

## Instalação

### 1. Incluir o script no HTML

Adicione **antes** de qualquer outro script que use logging:

```html
<!-- Em index.html, login.html, exam.html, etc. -->
<script src="/utils/logger.js"></script>
```

### 2. Usar o logger no código

```javascript
// Substituir console.log/debug/info/warn/error por:
logger.debug('Mensagem de debug', data);
logger.info('Informação', data);
logger.warn('Aviso', data);
logger.error('Erro', error);
```

## Níveis de Log

| Nível | Descrição | Quando usar |
|-------|-----------|-------------|
| `DEBUG` | Informações detalhadas para debugging | Desenvolvimento apenas |
| `INFO` | Eventos informativos importantes | Operações normais |
| `WARN` | Avisos que não são erros | Situações inesperadas mas tratadas |
| `ERROR` | Erros que precisam atenção | Exceções, falhas |
| `NONE` | Desabilita todos os logs | Produção silenciosa |

## Configuração de Ambiente

### Detecção Automática

- **Desenvolvimento** (localhost, 127.0.0.1): Todos os logs habilitados (DEBUG+)
- **Produção** (outro hostname): Apenas ERROR habilitado

### Configuração Manual

No console do navegador ou código:

```javascript
// Mudar nível em runtime
logger.setLevel('debug');  // Habilita todos os logs
logger.setLevel('info');   // Info, warn, error
logger.setLevel('warn');   // Warn, error
logger.setLevel('error');  // Apenas errors
logger.setLevel('none');   // Desabilita tudo

// Ver nível atual
logger.getLevel(); // Retorna: 'DEBUG', 'INFO', 'WARN', 'ERROR', ou 'NONE'

// Verificar se um nível está habilitado
logger.isEnabled('debug'); // true/false
```

A configuração é persistida no `localStorage` e sobrevive reloads.

## Sanitização de Dados Sensíveis

Em **produção**, dados sensíveis são automaticamente removidos:

```javascript
// Campos sensíveis removidos automaticamente:
const sensitiveData = {
  email: 'user@example.com',
  password: '12345',          // → [REDACTED]
  token: 'abc123',            // → [REDACTED]
  senha: 'secret',            // → [REDACTED]
  senhaHash: 'hash',          // → [REDACTED]
  sessionToken: 'token123',   // → [REDACTED]
  jwt: 'eyJhbG...',          // → [REDACTED]
  authorization: 'Bearer...'  // → [REDACTED]
};

logger.debug('Login attempt', sensitiveData);
// Em produção: { email: 'user@example.com', password: '[REDACTED]', ... }
```

## Migração do Código Existente

### Padrão de Substituição

```javascript
// ANTES (código antigo):
console.log('Debug info', data);
console.debug('Detailed debug', data);
console.info('Information', data);
console.warn('Warning', data);
console.error('Error', error);

// DEPOIS (código novo):
logger.debug('Debug info', data);
logger.debug('Detailed debug', data);
logger.info('Information', data);
logger.warn('Warning', data);
logger.error('Error', error);
```

### Fallback para Compatibilidade

Para suporte gradual, use o operador `?.`:

```javascript
// Se logger não estiver carregado, usa console como fallback
logger?.debug('Message', data) || console.debug('Message', data);
```

## Proteção em Produção

### Console.* Desabilitado

Em produção (quando `LOG_LEVEL >= ERROR`), os métodos do console são substituídos:

```javascript
console.log('test');   // Não faz nada (noop)
console.debug('test'); // Não faz nada (noop)
console.info('test');  // Não faz nada (noop)
console.warn('test');  // Não faz nada (noop)
console.error('test'); // Funciona (mantido para erros críticos)
```

### Restaurar Console Original

Se precisar debugar em produção:

```javascript
// Métodos originais salvos em window.__console
window.__console.log('Debug em produção');
window.__console.debug('Detailed debug');

// Ou mudar o nível do logger:
logger.setLevel('debug');
```

## Exemplos de Uso

### Exemplo 1: Login Flow

```javascript
// script.js
async function handleLogin(email, password) {
  logger.debug('[login] Iniciando login para', email);
  
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    
    if (!response.ok) {
      logger.warn('[login] Falha no login', { status: response.status, email });
      return;
    }
    
    const data = await response.json();
    logger.info('[login] Login bem-sucedido', { userId: data.user?.id });
    
  } catch (error) {
    logger.error('[login] Erro na requisição', error);
  }
}
```

### Exemplo 2: Exam Loading

```javascript
// script_exam.js
async function loadQuestions() {
  logger.debug('[exam] Carregando questões', { count: QtdQuestoes });
  
  try {
    const response = await fetch('/api/exams/select');
    const questions = await response.json();
    
    logger.info('[exam] Questões carregadas', { 
      count: questions.length,
      withImages: questions.filter(q => q.imagem_url).length
    });
    
    return questions;
    
  } catch (error) {
    logger.error('[exam] Falha ao carregar questões', error);
    throw error;
  }
}
```

### Exemplo 3: Performance Monitoring

```javascript
// Medir performance apenas em desenvolvimento
function performanceLog(label, fn) {
  if (logger.isEnabled('debug')) {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    logger.debug(`[perf] ${label}`, { duration: `${duration.toFixed(2)}ms` });
    return result;
  }
  return fn();
}

// Uso:
const shuffledOptions = performanceLog('Shuffle options', () => {
  return shuffleArray(options);
});
```

## Benefícios

### Performance

- ✅ **Zero overhead em produção**: Logs desabilitados não executam
- ✅ **Sem memory leaks**: Console limpo em produção
- ✅ **Bundle size menor**: Logs podem ser removidos em build

### Segurança

- ✅ **Sem vazamento de dados**: Informações sensíveis sanitizadas
- ✅ **Sem exposição de tokens**: JWT/passwords removidos automaticamente
- ✅ **Logs controlados**: Apenas níveis apropriados em cada ambiente

### Debugging

- ✅ **Logs estruturados**: Timestamp e nível em cada mensagem
- ✅ **Controle granular**: Habilitar/desabilitar por nível
- ✅ **Persistência**: Configuração salva no localStorage

## Build para Produção

### Opção 1: Terser/UglifyJS (Recomendado)

Configure o build para remover completamente os logs:

```javascript
// terser.config.js
module.exports = {
  compress: {
    drop_console: true,         // Remove console.*
    drop_debugger: true,        // Remove debugger
    pure_funcs: [               // Remove logger.*
      'logger.debug',
      'logger.info'
      // Mantém logger.warn e logger.error
    ]
  }
};
```

### Opção 2: Webpack Plugin

```javascript
// webpack.config.js
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
            pure_funcs: ['logger.debug', 'logger.info']
          }
        }
      })
    ]
  }
};
```

## Troubleshooting

### Logs não aparecem

```javascript
// Verificar nível atual
console.log('Nível atual:', logger.getLevel());

// Habilitar todos os logs
logger.setLevel('debug');

// Verificar se está em produção
console.log('Produção?', window.location.hostname !== 'localhost');
```

### Logger não definido

```html
<!-- Garantir que logger.js está carregado ANTES -->
<script src="/utils/logger.js"></script>
<script src="/script.js"></script>
```

### Dados sensíveis ainda aparecem

```javascript
// Verificar se está realmente em produção
if (window.location.hostname === 'localhost') {
  // Sanitização não é aplicada em desenvolvimento
  logger.debug('Dados sensíveis visíveis em dev');
}

// Forçar sanitização mesmo em dev:
// Modifique isProduction() em logger.js para retornar sempre true
```

## Próximos Passos

1. ✅ Incluir `logger.js` em todos os HTMLs
2. ✅ Migrar `console.*` para `logger.*` gradualmente
3. ✅ Configurar build para produção (drop_console)
4. ✅ Testar em ambiente de staging
5. ✅ Monitorar performance em produção

## Referências

- [Issue #19: Excessive Console Logging](../IMPROVEMENT_PROPOSAL.md#19-excessive-console-logging-in-production)
- [MDN: Console API](https://developer.mozilla.org/en-US/docs/Web/API/Console)
- [Logging Best Practices](https://12factor.net/logs)
