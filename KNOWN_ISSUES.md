# Known Issues (Histórico + Correções Confirmadas)

Data de referência: 2026-01-31

Este arquivo documenta um incidente específico (e suas correções) que envolveu:
- Menu **Admin** não aparecendo de forma determinística no desktop (principalmente na página InsightsIA).
- Ambiente dev com múltiplos hosts (`localhost` vs `app.localhost`) e cookies.
- Respostas 304/caching atrapalhando sondas de permissão.
- Uma tentativa de cookie `Domain=.localhost` que quebrou CSRF.

> Observação: há também um documento separado de erros recorrentes em `docs/known-errors.md`.

---

## 1) Incidente: Menu Admin some de forma intermitente (desktop / InsightsIA)

### Sintomas
- Usuário é admin (confirmado por `GET /api/users/me` retornando `TipoUsuario: "admin"`), mas o item/accordion “Admin” no sidebar não aparece em alguns loads.
- Afetava principalmente páginas que montam o sidebar dinamicamente via `/components/sidebar.html` (ex.: InsightsIA no desktop).

### Hipóteses levantadas durante investigação
- Falha/intermitência na checagem de admin no front (sonda em endpoint admin).
- Conteúdo do sidebar “servido” não batendo com o código esperado (stale/versão diferente).
- Host misturado (`localhost` vs `app.localhost`) quebrando cookies/sessão.
- Cache/304 retornando resposta “não atualizada” na checagem de admin.

---

## 2) Causa raiz (comprovada): mismatch de host + caching + checagem frágil

### 2.1) Host misturado: `localhost` vs `app.localhost`
- O projeto tem dois contextos:
  - `http://localhost:3000` → site “produto/marketing” (público) e regras de redirecionamento.
  - `http://app.localhost:3000` → app autenticado (simulados/admin).
- Cookies são **host-only** no desenvolvimento (por segurança e compatibilidade). Isso significa:
  - Logar em `localhost` NÃO garante que o cookie de sessão valha para `app.localhost`.
- Resultado: UI/sondas executadas em uma origem diferente podem não ver sessão/admin.

### 2.2) Cache/304 interferindo em sondas de admin
- Em alguns fluxos o browser devolvia 304 (Not Modified) em chamadas de API usadas como “prova” de admin.
- Isso pode causar comportamento intermitente porque a UI acha que “não confirmou admin” (ou usa resultado anterior).

### 2.3) Checagem de admin no sidebar era “única” e podia falhar
- O sidebar escondia o accordion Admin por padrão.
- A lógica de exibição dependia fortemente de uma checagem (probe) que podia falhar por:
  - sessão não presente (host errado)
  - cache/304
  - problemas de fetch/credenciais

---

## 3) Mudanças e correções aplicadas (confirmadas em runtime)

### 3.1) Backend: desabilitar ETag e forçar no-cache em `/api/*`
Objetivo: impedir 304/stale state atrapalhando as sondas de identidade/admin.

Ajustes:
- `app.set('etag', false)`.
- Middleware aplicando headers de no-cache:
  - `Cache-Control: no-store`
  - `Pragma: no-cache`
  - `Expires: 0`

Validação:
- Respostas de `GET /api/users/me` passaram a vir sem `ETag`.
- Sondas não ficam presas em 304.

### 3.2) Reversão de cookies `Domain=.localhost` (corrigiu “CSRF token missing”)
Tentativa:
- Foi testado usar `Domain=.localhost` para “compartilhar” cookies entre `localhost` e `app.localhost`.

Problema:
- Browsers tratam `.localhost` de forma inconsistente e frequentemente rejeitam cookie com `Domain=.localhost`.
- Isso gerou erro no login: **“CSRF token missing”** (cookie do CSRF não estava sendo aceito/enviado).

Correção:
- Em desenvolvimento, cookies voltaram a ser **host-only** (sem `Domain`).
- Adicionado cleanup de cookies legados `Domain=.localhost` (limpeza defensiva) para evitar estado misto em máquinas que testaram a versão antiga.

Validação:
- Fluxo `GET /api/csrf-token` + `POST /api/auth/login` voltou a funcionar.

### 3.3) Frontend: fallback determinístico no sidebar para admin via `/api/users/me`
Objetivo: tornar o menu Admin “determinístico” na UI quando o usuário é admin, mesmo que a sonda admin falhe.

Mudança:
- Em `frontend/components/sidebar.html`, a função `checkAdminAccess()` passou a:
  1) tentar `ensureAdminAccess({ maxAgeMs: 15000 })`
  2) se falhar, fazer fallback para `GET /api/users/me` e considerar admin quando:
     - `TipoUsuario === "admin"` (ou variações compatíveis)

Validação:
- Script automatizado confirmou:
  - `/api/users/me` retornando `TipoUsuario=admin`
  - endpoint admin respondendo 200
  - `/components/sidebar.html` servido contendo o marcador do fallback

---

## 4) Evidência importante encontrada: arquivo servido ≠ código “esperado” no editor

Durante o diagnóstico houve um momento em que:
- O servidor respondia `200` para `/components/sidebar.html`, mas o conteúdo retornado não continha a alteração recente.
- Ao comparar **hash** e **mtime** do arquivo servido vs arquivo local, foi possível provar o que o servidor estava realmente entregando.

Como verificar de forma objetiva:
- Usar os headers de debug adicionados pelo static server:
  - `X-SimuladosBR-Static-File`
  - `X-SimuladosBR-Static-Mtime`
- Comparar com o arquivo local (`Get-Item` / `Get-FileHash`).

Resultado final:
- Após patch aplicado no arquivo em disco, o conteúdo servido passou a incluir o fallback e o menu Admin voltou a aparecer corretamente.

---

## 5) Scripts de apoio criados/usados na investigação

- `scripts/test-login-app-localhost.ps1`
  - Faz login com CSRF, consulta `/api/users/me`, testa endpoint admin, baixa `/components/sidebar.html` e checa marcadores.

- `scripts/patch-sidebar-admin-fallback.ps1`
  - Aplica patch idempotente no bloco de `checkAdminAccess()` para inserir o fallback `/api/users/me`.

- `scripts/debug-admin-users.js`
  - Lista usuários admin via RBAC e valida se um email tem role admin.

- `scripts/grant-admin-role.js`
  - Concede role admin a um usuário por email (idempotente).

---

## 6) Recomendações para evitar regressão

1) Em dev, use **sempre** `http://app.localhost:3000` para navegar na app autenticada.
2) Evite tentar “compartilhar” cookies com `Domain=.localhost` em dev.
3) Manter `/api/*` com `Cache-Control: no-store` e `etag` desabilitado.
4) Para UI de admin:
   - Não depender de uma única sonda “frágil”; preferir `/api/users/me` como fonte canônica de papel/role.
5) Se aparecer discrepância entre “código no editor” e “conteúdo servido”, valide com:
   - hash do conteúdo servido
   - header `X-SimuladosBR-Static-Mtime`

---

## 7) Estado atual (após correções)

- Login/CSRF funcionando em dev com cookies host-only.
- API sem cache/ETag para evitar 304 em endpoints sensíveis.
- Sidebar com fallback para `/api/users/me`, deixando o menu Admin consistente quando o usuário é admin.
