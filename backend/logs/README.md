# Sistema de Logging Estruturado

Este diretório contém os arquivos de log do sistema quando `LOG_TO_FILE=true` ou em ambiente de produção.

## Arquivos de Log

### `combined.log`
Contém todos os logs (info, warn, error, debug) em formato JSON estruturado.

### `error.log`
Contém apenas logs de erro (level: error).

### `security.log`
Contém eventos de segurança:
- Tentativas de login (sucessos e falhas)
- Reset de senha
- Falhas de autorização
- Violações de CSRF
- Rate limiting excedido
- Atividades suspeitas

### `audit.log`
Contém trilha de auditoria de ações importantes:
- Início/conclusão/abandono de exames
- Transações de pagamento
- Exportação de dados
- Exclusão de dados de usuário
- Ações administrativas

## Formato dos Logs

Todos os logs são salvos em formato JSON estruturado com os seguintes campos:

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
    "event": "LOGIN_SUCCESS",
    "securityEvent": true
  }
}
```

## Campos Importantes

- **requestId**: ID único para rastrear requisição completa
- **userId**: ID do usuário autenticado
- **email**: Email do usuário
- **ip**: Endereço IP da requisição
- **event**: Tipo do evento (LOGIN_SUCCESS, PASSWORD_RESET, etc.)
- **securityEvent**: Flag indicando evento de segurança
- **auditEvent**: Flag indicando evento de auditoria

## Rotação de Logs

Os arquivos de log são automaticamente rotacionados quando atingem:
- **Tamanho máximo**: 10MB
- **Arquivos mantidos**: 5 versões (security.log e audit.log mantêm 10)

## Configuração

Configure via variáveis de ambiente:

```bash
# Habilitar logs em arquivo (padrão: false, exceto em produção)
LOG_TO_FILE=true

# Nível de log (debug, info, http, warn, error)
# Padrão: 'debug' em desenvolvimento, 'info' em produção
NODE_ENV=production
```

## Análise de Logs

### Buscar eventos de segurança
```bash
cat security.log | grep "LOGIN_FAILURE"
```

### Buscar por usuário específico
```bash
cat combined.log | grep "userId\":42"
```

### Buscar por request ID
```bash
cat combined.log | grep "requestId\":\"abc123"
```

### Contar falhas de login por IP
```bash
cat security.log | grep "LOGIN_FAILURE" | jq -r '.metadata.ip' | sort | uniq -c | sort -rn
```

## Monitoramento

Para ambiente de produção, recomenda-se:

1. **Agregação de Logs**: ELK Stack (Elasticsearch, Logstash, Kibana) ou CloudWatch
2. **Alertas**: Configurar alertas para:
   - Múltiplas falhas de login do mesmo IP
   - Violações de CSRF
   - Rate limiting excedido repetidamente
   - Erros 5xx em alta frequência
3. **Retenção**: Definir política de retenção conforme requisitos de compliance

## Limpeza Manual

Para limpar logs antigos:

```bash
# Remover logs com mais de 30 dias
find . -name "*.log" -mtime +30 -delete
```

## Privacidade e GDPR

Os logs podem conter dados pessoais (email, IP). Certifique-se de:
- Implementar política de retenção adequada
- Proteger acesso aos arquivos de log
- Considerar anonimização para logs de longo prazo
