# Rodando em `app.localhost:3000` (subdomínio local)

Este guia configura o SimuladosBR para rodar como se estivesse em um subdomínio (ex.: `www.simuladorbr.com.br`), mas localmente.

**Objetivo:** acessar o app em `http://app.localhost:3000` com **frontend + backend no mesmo servidor/origem** e **PWA/Service Worker habilitados**.

---

## Por que `app.localhost`?

- Simula com mais fidelidade o cenário real de subdomínio (produção), sem sair do loopback.
- Ajuda a detectar cedo problemas comuns em migração de host: cookies, redirecionamentos, URLs absolutas e PWA.

> Observação: na maioria dos ambientes, `*.localhost` resolve para loopback automaticamente. Se não resolver no seu Windows, use o script de `hosts` abaixo.

> Chat-service (modo embedded): quando `CHAT_SERVICE_EMBED=true`, o backend também pode responder em `http://chat.localhost:3000` (host configurável via `CHAT_SERVICE_HOST`).

---

## Passo a passo (Windows)

### 1) Adicionar `app.localhost` no `hosts`

Execute como **Administrador**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-app-localhost.ps1
```

Para remover a entrada:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-app-localhost.ps1 -Remove
```

Se você estiver usando chat-service em modo embedded com host dedicado, pode ser necessário adicionar também `chat.localhost` manualmente no `hosts` (se `*.localhost` não resolver no seu Windows):

```
127.0.0.1 app.localhost
127.0.0.1 chat.localhost
```

### 2) Iniciar o servidor em `app.localhost:3000`

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-app-localhost.ps1
```

Esse script define (apenas para o processo atual):
- `PORT=3000`
- `FRONTEND_URL=http://app.localhost:3000`
- `APP_BASE_URL=http://app.localhost:3000`
- `BACKEND_BASE=http://app.localhost:3000`
- `APP_HOST=app.localhost`

### 3) Abrir o app

- `http://app.localhost:3000`

Se `CHAT_SERVICE_EMBED=true`, você também pode acessar o chat-service diretamente em:
- `http://chat.localhost:3000`

E a compatibilidade via mount continua disponível no host do app:
- `http://app.localhost:3000/chat/`

---

## Impactos reais (o que muda ao sair de `localhost`)

### 1) CORS (quase nenhum no fluxo principal)

Se frontend e backend estão no **mesmo host e porta**, o navegador considera **same-origin** e **não aplica CORS** para `/api/*`.

CORS só volta a aparecer se:
- você fizer requests para outro host/porta (ex.: `http://localhost:4010`), ou
- você rodar um frontend separado em outra origem.

Mesmo assim, o backend mantém uma allowlist segura para dev/prod (inclui `localhost` e `*.localhost` em dev).

### 2) Cookies e login

- `localhost` e `app.localhost` são **hosts diferentes**.
- Resultado esperado: cookies/sessões emitidos em `localhost` **não valem** para `app.localhost`.

Da mesma forma, `chat.localhost` também é um host diferente:
- cookies do SimuladosBR emitidos em `app.localhost` não são compartilhados com `chat.localhost` (e vice-versa).
- isso é esperado e ajuda a detectar problemas reais de subdomínio.

Isso é positivo (isolamento correto), mas durante testes dá a sensação de “perdi o login”.

### 3) CSRF

O backend valida origin/referer. Para dev, `*.localhost` é tratado como local (ex.: `app.localhost`).

Se você vir `CSRF_ORIGIN_MISMATCH`:
- confirme que você está acessando sempre o app pelo mesmo host (não misturar `localhost` e `app.localhost`), e
- confira se o request está indo para `/api/*` na mesma origem.

### 4) PWA / Service Worker / Cache

Esse é o impacto mais visível:
- `http://localhost:3000` e `http://app.localhost:3000` têm **Service Worker e caches separados**.

Ao migrar o host, é normal precisar:
- DevTools → **Application** → **Service Workers** → *Unregister*
- DevTools → **Application** → **Storage** → *Clear site data*

> Dica: se algo parece “não atualizar”, quase sempre é cache/Service Worker controlando a origem antiga.

### 5) URLs absolutas

Evite URLs hardcoded (`http://localhost:3000`). O frontend foi ajustado para usar, por padrão:

- `window.location.origin` como `BACKEND_BASE`

Isso garante que a mesma build funciona tanto em `localhost` quanto em `app.localhost` e em produção.

---

## Postman

O environment padrão usa `BACKEND_BASE=http://app.localhost:3000`.

Se preferir testar em `localhost`, basta editar a variável no Postman.

---

## Leitura complementar (implementação)

- Implementação end-to-end (chat-service + parâmetros free/premium + UI admin “Parâmetro Usuários”): `docs/IMPLEMENTATION_ADMIN_USER_PARAMS_CHAT_SERVICE.md`

---

## Troubleshooting

### `ERR_NAME_NOT_RESOLVED` ao abrir `app.localhost`
- Rode o script de hosts como Admin: `scripts/setup-app-localhost.ps1`.

### Porta 3000 ocupada
- Feche qualquer dev server (ex.: outro Node/React) usando 3000.

### Login não persiste / parece deslogar
- Verifique se você não alternou entre `localhost` e `app.localhost` (cookies são diferentes).
- Limpe o storage do domínio atual e faça login novamente.

### App com aparência/JS “antigos”
- Unregister do SW e limpe cache/site data na origem atual (ver seção PWA).
