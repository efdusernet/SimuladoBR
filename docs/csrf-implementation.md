# CSRF Protection Implementation

## Overview
Implementação moderna de proteção CSRF (Cross-Site Request Forgery) usando o padrão Double Submit Cookie com validações adicionais de segurança.

**Data de Implementação:** 10 de dezembro de 2025  
**Categoria:** Segurança Crítica  
**Status:** ✅ Implementado

---

## Arquivos Criados/Modificados

### Backend

1. **`backend/middleware/csrf.js`** (NOVO)
   - Middleware customizado de proteção CSRF
   - Implementa Double Submit Cookie pattern
   - Store de tokens em memória (migrar para Redis em produção)
   - Validação de origem/referer
   - Cleanup automático de tokens expirados

2. **`backend/index.js`** (MODIFICADO)
   - Importa e configura middleware CSRF
   - Adiciona endpoint `/api/csrf-token` para obter tokens
   - Aplica proteção em todas as rotas `/api/` para métodos POST/PUT/DELETE/PATCH
   - Permite métodos seguros (GET/HEAD/OPTIONS) sem validação

### Frontend

1. **`frontend/utils/csrf.js`** (NOVO)
   - Classe `CSRFManager` para gerenciamento de tokens
   - Wrapper automático do `window.fetch` para injeção de tokens
   - Cache de tokens do cookie
   - Refresh automático após login
   - Inicialização automática na carga da página

2. **`frontend/index.html`** (MODIFICADO)
   - Adiciona script CSRF no `<head>`

3. **`frontend/login.html`** (MODIFICADO)
   - Adiciona script CSRF no `<head>`

---

## Como Funciona

### 1. Geração de Token (Backend)

```javascript
// Ao acessar GET /api/csrf-token (ou /api/v1/csrf-token)
const token = crypto.randomBytes(32).toString('hex');

// Token armazenado:
// 1. Em cookie (não httpOnly, para JavaScript poder ler)
// 2. Em memória (Map com metadata: createdAt, sessionId)

res.cookie('csrfToken', token, {
  httpOnly: false,      // Acessível para JS
  secure: production,   // HTTPS apenas em prod
  sameSite: 'strict',   // Proteção adicional
  maxAge: 3600000       // 1 hora
});
```

### 2. Validação de Token (Backend)

Para requisições POST/PUT/DELETE/PATCH em `/api/*`:

1. **Extrai tokens:**
   - Do header `X-CSRF-Token`
   - Do cookie `csrfToken`

2. **Valida:**
   - ✅ Ambos os tokens existem
   - ✅ Tokens são idênticos (Double Submit)
   - ✅ Token existe no store interno
   - ✅ Token não expirou (< 1 hora)
   - ✅ Origem/referer corresponde ao `FRONTEND_URL`

3. **Rejeita se inválido:**
   ```json
   {
     "error": "CSRF token invalid",
     "code": "CSRF_INVALID"
   }
   ```

### 3. Injeção Automática (Frontend)

```javascript
// Fetch automático com CSRF
fetch('/api/exams/start', {
  method: 'POST',
  body: JSON.stringify({ examType: 'pmp' }),
  credentials: 'include'
});

// O wrapper adiciona automaticamente:
headers: {
  'X-CSRF-Token': '<token-do-cookie>'
}
```

### 4. Fluxo Completo

```
1. Página carrega → csrf.js inicializa
2. GET /api/csrf-token (ou /api/v1/csrf-token) → Recebe token + cookie
3. Token armazenado no cookie (csrfToken)
4. Usuário faz POST /api/exams/start
5. Wrapper fetch adiciona header X-CSRF-Token
6. Backend valida: cookie == header
7. ✅ Requisição aprovada
```

---

## Segurança Implementada

### ✅ Proteção Contra CSRF
- Double Submit Cookie previne ataques cross-origin
- Validação de origem/referer adicional
- Token único por sessão
- Expiração automática (1 hora)

### ✅ Proteção Contra XSS
- Cookie `sameSite: 'strict'` previne envio em contextos externos
- Tokens aleatórios criptograficamente seguros
- Sem persistência em localStorage (vulnerável a XSS)

### ✅ Proteção Contra Replay Attacks
- Tokens expiram após 1 hora
- Cleanup periódico de tokens expirados (5 min)
- Token vinculado à sessão

### ✅ Defense in Depth
- CORS configurado (`FRONTEND_URL`)
- Cookie httpOnly `sessionToken` para autenticação JWT
- SameSite=strict em todos os cookies
- Validação de origem/referer

---

## Configuração

### Variáveis de Ambiente

```bash
# Backend (.env)
FRONTEND_URL=http://app.localhost:3000    # Origem permitida para CSRF
NODE_ENV=production                   # Habilita secure cookies
```

### Produção

⚠️ **IMPORTANTE:** Migrar store de tokens para Redis/Memcached

```javascript
// backend/middleware/csrf.js
// Substituir:
const tokenStore = new Map();

// Por:
const redis = require('redis');
const client = redis.createClient();

async function storeToken(token, data) {
  await client.setEx(
    `csrf:${token}`, 
    3600, // 1 hour TTL
    JSON.stringify(data)
  );
}

async function getToken(token) {
  const data = await client.get(`csrf:${token}`);
  return data ? JSON.parse(data) : null;
}
```

---

## Testes

### Manual

1. **Token Válido:**
   ```bash
   # Obter token
  curl -c cookies.txt http://app.localhost:3000/api/csrf-token
   
   # Usar token
   curl -b cookies.txt \
     -H "X-CSRF-Token: <token-do-response>" \
     -H "Content-Type: application/json" \
     -d '{"Email":"test@test.com"}' \
    http://app.localhost:3000/api/users
   ```

2. **Token Inválido (deve falhar):**
   ```bash
   curl -H "X-CSRF-Token: fake-token" \
     -H "Content-Type: application/json" \
     -d '{"Email":"test@test.com"}' \
    http://app.localhost:3000/api/users
   
   # Response: 403 Forbidden
   # {"error":"CSRF token invalid","code":"CSRF_INVALID"}
   ```

3. **Origem Inválida (deve falhar):**
   ```bash
   curl -H "Origin: https://evil.com" \
     -H "X-CSRF-Token: <valid-token>" \
    http://app.localhost:3000/api/users
   
   # Response: 403 Forbidden
   # {"error":"Invalid origin","code":"CSRF_ORIGIN_MISMATCH"}
   ```

### Automatizados (a implementar)

```javascript
// test/csrf.test.js
describe('CSRF Protection', () => {
  it('should reject POST without CSRF token', async () => {
    const res = await request(app)
      .post('/api/exams/start')
      .send({ examType: 'pmp' });
    
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_MISSING');
  });

  it('should accept POST with valid CSRF token', async () => {
    // Get token
    const tokenRes = await request(app).get('/api/csrf-token');
    const cookie = tokenRes.headers['set-cookie'];
    const token = tokenRes.body.csrfToken;

    // Use token
    const res = await request(app)
      .post('/api/exams/start')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ examType: 'pmp' });
    
    expect(res.status).not.toBe(403);
  });
});
```

---

## Compatibilidade

### ✅ Navegadores Suportados
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Opera 76+

### ✅ Métodos HTTP

| Método | Validação CSRF | Motivo |
|--------|----------------|--------|
| GET | ❌ Não | Método seguro (idempotente) |
| HEAD | ❌ Não | Método seguro |
| OPTIONS | ❌ Não | Preflight CORS |
| POST | ✅ Sim | Altera estado |
| PUT | ✅ Sim | Altera estado |
| DELETE | ✅ Sim | Altera estado |
| PATCH | ✅ Sim | Altera estado |

### ⚠️ Endpoints Isentos

Nenhum endpoint está isento. Para isentar endpoints específicos (ex: webhooks):

```javascript
// backend/index.js
app.post('/api/webhooks/payment', (req, res) => {
  // Webhook externo - validar por assinatura HMAC
});

// Aplicar CSRF depois
app.use('/api/', csrfProtection);
```

---

## Troubleshooting

### Erro: "CSRF token missing"

**Causa:** Token não enviado no header ou cookie  
**Solução:** Verificar se `csrf.js` está carregado e `credentials: 'include'` está no fetch

### Erro: "CSRF token invalid"

**Causa:** Token do cookie ≠ token do header  
**Solução:** Limpar cookies e recarregar página para obter novo token

### Erro: "CSRF token expired"

**Causa:** Token com mais de 1 hora  
**Solução:** Implementado refresh automático - verificar console do browser

### Erro: "Invalid origin"

**Causa:** Origem da requisição não corresponde a `FRONTEND_URL`  
**Solução:** Verificar configuração `FRONTEND_URL` no `.env`

---

## Manutenção

### Rotação de Tokens
- Tokens expiram automaticamente após 1 hora
- Cleanup periódico a cada 5 minutos
- Refresh automático após login

### Monitoramento
Adicionar métricas:
```javascript
// backend/middleware/csrf.js
let csrfRejectCount = 0;
let csrfAcceptCount = 0;

// Expor em /api/metrics
app.get('/api/metrics', (req, res) => {
  res.json({
    csrf_rejects: csrfRejectCount,
    csrf_accepts: csrfAcceptCount,
    csrf_tokens_active: tokenStore.size
  });
});
```

### Logs de Segurança
```javascript
// Log tentativas de CSRF
if (!tokenFromRequest || !tokenFromCookie) {
  console.warn(`[SECURITY] CSRF attempt from ${req.ip} - ${req.path}`);
}
```

---

## Referências

- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Double Submit Cookie Pattern](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#double-submit-cookie)
- [MDN: SameSite Cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)

---

## Status da Implementação

- ✅ Middleware CSRF customizado criado
- ✅ Endpoint `/api/csrf-token` implementado
- ✅ Validação aplicada a rotas POST/PUT/DELETE/PATCH
- ✅ Frontend com injeção automática de tokens
- ✅ Wrapper do `fetch` para adicionar headers
- ✅ Cache e refresh de tokens
- ✅ Validação de origem/referer
- ✅ Cleanup automático de tokens expirados
- ⚠️ **PENDENTE:** Migrar store para Redis (produção)
- ⚠️ **PENDENTE:** Testes automatizados
- ⚠️ **PENDENTE:** Métricas de segurança

**Issue do IMPROVEMENT_PROPOSAL.md:** #5 - Missing CSRF Protection ✅ RESOLVIDO
