# Guia de Uso do Sistema de Logging Estruturado

## Visão Geral

O sistema de logging estruturado foi implementado usando **Winston** para fornecer:
- Trilha de auditoria completa
- Monitoramento de eventos de segurança
- Rastreamento de requisições
- Debugging estruturado em produção

## Estrutura

```
backend/
├── utils/
│   └── logger.js          # Sistema de logging principal
├── middleware/
│   └── logging.js         # Middlewares de HTTP logging
└── logs/                  # Arquivos de log (em produção)
    ├── combined.log       # Todos os logs
    ├── error.log          # Apenas erros
    ├── security.log       # Eventos de segurança
    └── audit.log          # Trilha de auditoria
```

## Usando o Logger

### 1. Importar o Logger

```javascript
const { logger, security, audit } = require('../utils/logger');
```

### 2. Logs Básicos

```javascript
// Logs de diferentes níveis
logger.info('Operação concluída com sucesso');
logger.warn('Configuração ausente, usando padrão');
logger.error('Falha ao processar requisição', { error: err.message });
logger.debug('Valor da variável:', { value: someValue });
```

### 3. Eventos de Segurança

```javascript
// Login bem-sucedido
security.loginSuccess(req, user);

// Falha de login
security.loginFailure(req, email, 'invalid_password');

// Reset de senha solicitado
security.passwordResetRequest(req, email);

// Reset de senha concluído
security.passwordResetSuccess(req, email);

// Falha de autorização
security.authorizationFailure(req, 'admin_panel', 'access_denied');

// Rate limit excedido
security.rateLimitExceeded(req);

// Falha de validação CSRF
security.csrfFailure(req);

// Atividade suspeita detectada
security.suspiciousActivity(req, 'Multiple failed login attempts from same IP');

// Ação administrativa
security.adminActionPerformed(req, 'delete_user', targetUserId);
```

### 4. Trilha de Auditoria

```javascript
// Exame iniciado
audit.examStarted(req, 'PMP', attemptId);

// Exame concluído
audit.examCompleted(req, 'PMP', attemptId, score);

// Exame abandonado
audit.examAbandoned(req, 'PMP', attemptId, 'timeout');

// Questão respondida
audit.questionAnswered(req, attemptId, questionId);

// Pagamento iniciado
audit.paymentInitiated(req, userId, amount, paymentId);

// Pagamento concluído
audit.paymentCompleted(req, userId, amount, paymentId);

// Dados exportados
audit.dataExported(req, 'exam_results', recordCount);

// Dados de usuário deletados
audit.userDataDeleted(req, targetUserId);
```

### 5. Log de Erros com Contexto

```javascript
const { logError } = require('../utils/logger');

try {
  // ... código que pode falhar
} catch (error) {
  logError(error, req, {
    operation: 'exam_creation',
    examType: 'PMP',
    userId: req.user.Id
  });
  
  res.status(500).json({ message: 'Erro ao criar exame' });
}
```

## Middlewares Automáticos

### Request Logging (já integrado)

Todos os requests HTTP são automaticamente logados com:
- Request ID único
- Método HTTP e URL
- Status code
- Duração da requisição
- IP do cliente
- User-Agent

### Request ID Tracking

Cada requisição recebe um ID único automaticamente:

```javascript
// Acessar o request ID
const requestId = req.id;

// O request ID é automaticamente incluído em todos os logs
logger.info('Processando operação', { someData: value });
// Output: ... "requestId": "abc123", "someData": "value" ...
```

## Configuração

### Variáveis de Ambiente

```bash
# Habilitar logs em arquivo (padrão: false, true em produção)
LOG_TO_FILE=true

# Ambiente (afeta nível de log padrão)
NODE_ENV=production  # level: 'info'
NODE_ENV=development # level: 'debug'
```

### Níveis de Log

1. **error** - Erros que requerem atenção imediata
2. **warn** - Avisos que devem ser investigados
3. **info** - Eventos importantes (login, logout, etc.)
4. **http** - Requisições HTTP
5. **debug** - Informações detalhadas para debugging

## Formato dos Logs

### Console (Desenvolvimento)

```
2025-12-11 10:30:45 info: Login successful [reqId=abc123 | userId=42 | email=user@example.com | ip=192.168.1.1 | POST /api/auth/login | status=200 | 45ms]
```

### Arquivo JSON (Produção)

```json
{
  "timestamp": "2025-12-11 10:30:45",
  "level": "info",
  "message": "Login successful",
  "metadata": {
    "requestId": "abc123",
    "userId": 42,
    "email": "user@example.com",
    "ip": "192.168.1.1",
    "method": "POST",
    "url": "/api/auth/login",
    "statusCode": 200,
    "duration": 45,
    "event": "LOGIN_SUCCESS",
    "securityEvent": true
  }
}
```

## Exemplos de Uso por Contexto

### Endpoint de Autenticação

```javascript
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const user = await authenticateUser(email, password);
    
    if (!user) {
      security.loginFailure(req, email, 'invalid_credentials');
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    
    security.loginSuccess(req, user);
    return res.json({ user });
    
  } catch (err) {
    logError(err, req, { operation: 'login' });
    return res.status(500).json({ message: 'Erro interno' });
  }
});
```

### Controller com Auditoria

```javascript
async function createExam(req, res) {
  try {
    const exam = await Exam.create(req.body);
    
    audit.examStarted(req, exam.type, exam.id);
    logger.info('Exam created successfully', {
      examId: exam.id,
      examType: exam.type,
      userId: req.user.Id
    });
    
    return res.json({ exam });
    
  } catch (err) {
    logError(err, req, {
      operation: 'create_exam',
      examType: req.body.type
    });
    return res.status(500).json({ message: 'Erro ao criar exame' });
  }
}
```

### Middleware de Autorização

```javascript
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    security.authorizationFailure(req, 'admin_resource', 'missing_role');
    return res.status(403).json({ error: 'Acesso negado' });
  }
  
  next();
}
```

## Análise e Monitoramento

### Buscar Eventos Específicos

```bash
# Todas as falhas de login
cat security.log | grep "LOGIN_FAILURE"

# Por usuário
cat combined.log | grep "userId\":42"

# Por tipo de evento
cat security.log | grep "RATE_LIMIT_EXCEEDED"
```

### Análise com jq

```bash
# Top 10 IPs com mais falhas de login
cat security.log | grep "LOGIN_FAILURE" | \
  jq -r '.metadata.ip' | \
  sort | uniq -c | sort -rn | head -10

# Contar eventos por tipo
cat security.log | \
  jq -r '.metadata.event' | \
  sort | uniq -c | sort -rn

# Requisições mais lentas
cat combined.log | grep "HTTP Request" | \
  jq -r 'select(.metadata.duration > 1000) | "\(.metadata.duration)ms \(.metadata.url)"' | \
  sort -rn | head -20
```

### Alertas Recomendados

Configure alertas para:

1. **Múltiplas falhas de login** (>5 em 15 min do mesmo IP)
2. **Rate limiting frequente** (mesmo IP/usuário)
3. **Falhas de CSRF** (possível ataque)
4. **Erros 5xx em alta frequência** (>10 por minuto)
5. **Atividades suspeitas** (qualquer evento marcado)
6. **Falhas de autorização repetidas** (tentativa de escalação de privilégios)

## Melhores Práticas

### ✅ DO

- Use eventos de segurança para todas as operações sensíveis
- Inclua contexto relevante em todos os logs
- Use níveis apropriados (error para erros, warn para avisos)
- Log de ações administrativas para auditoria
- Incluir request ID em logs customizados

### ❌ DON'T

- Nunca logar senhas ou tokens completos
- Evitar logs excessivos em loops (use debug level)
- Não logar dados pessoais desnecessários
- Não usar console.log em produção (use logger)
- Não ignorar erros silenciosamente

## Integração com Serviços Externos

### ELK Stack (Elasticsearch, Logstash, Kibana)

1. Configure Logstash para ler os arquivos JSON
2. Envie para Elasticsearch
3. Visualize em Kibana com dashboards

### CloudWatch (AWS)

```javascript
// Adicionar transport do CloudWatch
const CloudWatchTransport = require('winston-cloudwatch');

logger.add(new CloudWatchTransport({
  logGroupName: 'SimuladosBR',
  logStreamName: 'backend',
  awsRegion: 'us-east-1'
}));
```

### Sentry (Error Tracking)

```javascript
// Apenas para erros críticos
if (level === 'error') {
  Sentry.captureException(error, {
    extra: metadata
  });
}
```

## Rotação e Manutenção

Os logs são automaticamente rotacionados quando atingem 10MB. Para manutenção manual:

```bash
# Comprimir logs antigos
gzip backend/logs/*.log

# Limpar logs com mais de 30 dias
find backend/logs -name "*.log" -mtime +30 -delete

# Verificar tamanho total
du -sh backend/logs/
```

## Conformidade e Privacidade

### GDPR / LGPD

Os logs contêm dados pessoais (email, IP). Certifique-se de:

1. Política de retenção definida (recomendado: 90 dias)
2. Acesso restrito aos arquivos de log
3. Anonimização para análises de longo prazo
4. Processo para deletar logs de usuário específico sob solicitação

### Implementar Anonimização

```javascript
// Função para anonimizar email em logs antigos
function anonymizeEmail(email) {
  const [user, domain] = email.split('@');
  return `${user.substring(0, 2)}***@${domain}`;
}
```

## Suporte

Para dúvidas ou problemas com o sistema de logging, consulte:
- Documentação Winston: https://github.com/winstonjs/winston
- Arquivo de log: `backend/logs/README.md`
- Código fonte: `backend/utils/logger.js`
