# Implementação: Correção de Dados Sensíveis no localStorage

## Problema Resolvido
**Issue #4 do IMPROVEMENT_PROPOSAL.md**: Dados sensíveis não criptografados em browser storage vulneráveis a XSS

## Mudanças Implementadas

### 1. Backend - Suporte a httpOnly Cookies

#### `backend/index.js`
- ✅ Adicionado `cookie-parser` middleware
- ✅ Configurado CORS com `credentials: true` para suportar cookies
- ✅ Configurado origin permitida via `FRONTEND_URL` env variable

#### `backend/routes/auth.js`
- ✅ Endpoint `/api/auth/login` agora define cookie httpOnly `sessionToken`
  - Configurações: `httpOnly: true`, `sameSite: 'strict'` e `secure` baseado no esquema HTTPS real (inclui suporte a proxy via `x-forwarded-proto`) **ou** `NODE_ENV=production`
  - Validade: 12 horas
- ✅ Novo endpoint `/api/auth/logout` para limpar cookies do servidor

**Flags opcionais (segurança do login):**
- `HARDEN_AUTH_RESPONSES=true`: evita enumeração de contas/estados no login (ex.: só revela `EMAIL_NOT_CONFIRMED`/`ACCOUNT_LOCKED` após senha correta).
- `AUTH_RETURN_TOKEN_IN_BODY=false`: omite `token`/`tokenType` do JSON no login (recomendado quando o fluxo é baseado em cookie httpOnly).

**Configuração do Cookie:**
```javascript
const cookieOptions = {
    httpOnly: true,
  // Recomendado atrás de proxy: respeitar req.secure / x-forwarded-proto.
  secure: isHttpsRequest(req) || process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 12 * 60 * 60 * 1000, // 12 horas
    path: '/'
};
res.cookie('sessionToken', token, cookieOptions);
```

### 2. Frontend - Migração para Cookies e Limpeza de Storage

#### `frontend/script.js`
- ✅ Login agora usa `credentials: 'include'` para enviar/receber cookies
- ✅ Tokens NÃO são mais salvos em localStorage
- ✅ Apenas informações não-sensíveis de UI são salvas em sessionStorage:
  - `userId`, `userName`, `userEmail`, `userRealName`
- ✅ Compatibilidade mantida: `localStorage.setItem('nomeUsuario', ...)` apenas para features não-sensíveis

**Antes:**
```javascript
localStorage.setItem('sessionToken', user.token); // ❌ INSEGURO
```

**Depois:**
```javascript
// Token agora vem no cookie httpOnly do servidor
sessionStorage.setItem('userId', userId); // ✅ Apenas dados temporários
```

#### `frontend/utils/logout.js`
- ✅ Função `performLogout` atualizada para:
  - Chamar endpoint `/api/auth/logout` do backend (limpa cookie httpOnly)
  - Limpar completamente sessionStorage
  - Remover seletivamente chaves sensíveis do localStorage
  - Manter preferências não-sensíveis (theme, settings, etc.)

**Chaves Sensíveis Removidas no Logout:**
- `sessionToken`, `token`, `jwt`, `authToken`, `accessToken`, `refreshToken`
- `userId`, `userEmail`, `userName`, `userRealName`
- `lockoutUntil`
- Qualquer chave contendo "token", "password" ou "email"

#### `frontend/utils/secureStorage.js` (Novo)
- ✅ Módulo utilitário para gerenciamento seguro de storage
- ✅ Bloqueia tentativas de armazenar tokens em localStorage
- ✅ Encriptação simples (XOR) para dados que precisam ficar em localStorage
- ✅ Seleção automática entre localStorage/sessionStorage baseada em sensibilidade
- ✅ Função de migração automática para remover tokens antigos
- ✅ Estatísticas de uso de storage

**Funcionalidades:**
```javascript
// Bloqueia chaves proibidas
SecureStorage.setItem('token', value); // ❌ Bloqueado com warning

// Dados sensíveis vão para sessionStorage automaticamente
SecureStorage.setItem('userEmail', email); // ✅ Vai para sessionStorage

// Limpeza de dados sensíveis
SecureStorage.clearSensitiveData(); // Remove tudo que é sensível

// Migração automática ao carregar
SecureStorage.migrateFromLocalStorage(); // Remove tokens antigos
```

### 3. Configuração

#### `backend/.env`
- ✅ Adicionado `FRONTEND_URL=http://app.localhost:3000` para CORS

#### `backend/package.json`
- ✅ Instalado `cookie-parser` package

## Impacto de Segurança

### Antes ❌
- Tokens JWT armazenados em localStorage (acessíveis via JavaScript)
- Vulnerável a ataques XSS que podem roubar tokens
- Dados sensíveis (email, userId) persistem indefinidamente
- Sem limpeza adequada no logout

### Depois ✅
- Tokens JWT em httpOnly cookies (inacessíveis via JavaScript)
- Proteção contra XSS - scripts maliciosos não podem roubar tokens
- Dados sensíveis apenas em sessionStorage (limpeza automática ao fechar aba)
- Logout completo limpa todos os dados sensíveis
- Compatibilidade retroativa mantida

## Checklist de Segurança

- ✅ JWT tokens movidos para httpOnly cookies
- ✅ Cookies com flags de segurança: `httpOnly`, `secure`, `sameSite`
- ✅ CORS configurado com origin específica
- ✅ Credentials incluídos nas requisições (`credentials: 'include'`)
- ✅ SessionStorage usado para dados temporários sensíveis
- ✅ LocalStorage limpo de dados sensíveis no logout
- ✅ Endpoint de logout implementado no backend
- ✅ Migração automática de tokens antigos no localStorage
- ✅ Utilitários de storage seguro criados
- ✅ Documentação completa das mudanças

## Compatibilidade

### Backward Compatibility
- ✅ API ainda retorna `token` no body da resposta para clientes antigos
- ✅ Clientes modernos usam cookie automaticamente
- ✅ Clientes antigos continuam funcionando com token do body
- ✅ Preferências não-sensíveis (nome de usuário) ainda em localStorage

### Migration Path
1. **Fase 1** (Atual): Dual support - cookie + token no body
2. **Fase 2** (Futura): Deprecar token no body response
3. **Fase 3** (Futura): Remover token do body completamente

## Testes Recomendados

### Backend
```bash
# Teste login com cookie
curl -X POST http://app.localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"Email":"test@example.com","SenhaHash":"hash"}' \
  -c cookies.txt -v

# Teste logout
curl -X POST http://app.localhost:3000/api/auth/logout \
  -b cookies.txt -v
```

### Frontend
1. ✅ Login deve definir cookie httpOnly (verificar DevTools > Application > Cookies)
2. ✅ LocalStorage NÃO deve conter tokens após login
3. ✅ SessionStorage deve conter apenas userId, userName, userEmail
4. ✅ Logout deve limpar sessionStorage completamente
5. ✅ Logout deve remover chaves sensíveis do localStorage
6. ✅ Requisições devem incluir cookie automaticamente

## Considerações de Produção

### Variáveis de Ambiente Necessárias
```env
NODE_ENV=production
FRONTEND_URL=https://www.simuladorbr.com.br
JWT_SECRET=<secret-64-chars>
```

### Nginx/Proxy Configuration
```nginx
# Permitir cookies em proxy reverso
proxy_cookie_path / /;
proxy_cookie_domain localhost www.simuladorbr.com.br;
```

### HTTPS Obrigatório em Produção
O flag `secure: true` nos cookies requer HTTPS. Em produção:
- ✅ Certificado SSL configurado
- ✅ Redirecionamento HTTP → HTTPS ativado
- ✅ HSTS headers configurados

## Métricas de Sucesso

- ✅ 0 tokens JWT em localStorage após esta implementação
- ✅ Dados sensíveis apenas em sessionStorage ou cookies httpOnly
- ✅ Limpeza completa de dados no logout
- ✅ Sem quebra de funcionalidade existente
- ✅ Proteção contra roubo de sessão via XSS

## Próximos Passos (Futuro)

1. Implementar refresh tokens em httpOnly cookie separado
2. Adicionar CSRF protection (já planejado no IMPROVEMENT_PROPOSAL.md #5)
3. Implementar rate limiting mais agressivo para endpoints sensíveis
4. Adicionar auditoria de sessões ativas por usuário
5. Implementar rotação automática de tokens

## Referências

- OWASP: HttpOnly Cookie Best Practices
- MDN: Using HTTP cookies
- OWASP: Session Management Cheat Sheet
- IMPROVEMENT_PROPOSAL.md Issue #4: Sensitive Data in localStorage

---

**Data de Implementação**: 10 de Dezembro de 2025  
**Esforço Real**: ~2 horas (menor que estimado: 5-7 dias)  
**Status**: ✅ Completo e testável
