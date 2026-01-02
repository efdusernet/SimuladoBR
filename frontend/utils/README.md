# Frontend Utilities

## Logger System (logger.js)

Sistema de logging controlado para prevenir vazamento de informações e overhead de performance em produção.

### Uso Rápido

```javascript
// Substituir console.* por logger.*
logger.debug('Debug message', data);
logger.info('Info message', data);
logger.warn('Warning message', data);
logger.error('Error message', error);
```

### Configuração

```javascript
// Mudar nível em runtime
logger.setLevel('debug');  // Todos os logs
logger.setLevel('info');   // Info, warn, error
logger.setLevel('error');  // Apenas errors
logger.setLevel('none');   // Desabilita tudo

// Ver nível atual
logger.getLevel(); // 'DEBUG', 'INFO', 'WARN', 'ERROR', 'NONE'
```

### Comportamento por Ambiente

- **Development (localhost)**: Todos os logs habilitados por padrão
- **Production**: Apenas ERROR habilitado, dados sensíveis sanitizados

### Documentação Completa

Ver: [docs/logging-frontend-guide.md](../../docs/logging-frontend-guide.md)

## Outros Utilitários

- **layoutManager.js**: Gerenciamento de layout responsivo
- **logout.js**: Utilitário de logout
- **csrf.js**: Proteção CSRF
- **traffic.js**: Gerenciamento de tráfego
- **requests.js**: Wrapper para requisições HTTP
