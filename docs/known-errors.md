# Erros Conhecidos

Este documento lista problemas recorrentes e suas causas/soluções confirmadas no projeto SimuladosBR.

Para um histórico detalhado de incidentes (ex.: o problema do menu Admin intermitente no desktop/InsightsIA e ajustes de cache/cookies/CSRF), ver `KNOWN_ISSUES.md` na raiz do projeto.

## 1. 403 ao selecionar questões (POST /api/exams/select)
- Sintomas: No console, mensagens como `Failed to fetch questions 403`. Nenhuma questão carregada, primeira renderização mostra `id undefined` e imagem não resolvida.
- Causa raiz:
  - Em fluxos locais (file:// ou diferentes origens), o cabeçalho `X-CSRF-Token` não era garantido em todas as chamadas, apesar do wrapper; o backend (Double Submit Cookie) exige que o `X-CSRF-Token` corresponda ao cookie `csrfToken`.
- Evidências:
  - Network mostrava POST 403 sem `X-CSRF-Token`; cookie `csrfToken` presente.
  - Logs do middleware de CSRF indicam falha por token ausente/mismatch.
- Correção aplicada:
  - `frontend/utils/csrf.js`: já buscava token em `/api/csrf-token` com `credentials: 'include'` e injeta token em requests `/api/*` de mesma origem ou origem de backend confiável.
  - `frontend/script_exam.js`: reforçado para incluir explicitamente `X-CSRF-Token` obtido via `window.csrfManager.token` no POST `/api/exams/select`.
  - Backend (previamente): Cookie `SameSite=lax` em desenvolvimento e relaxo de origem para localhost/file://.
- Como verificar:
  - Network → POST /api/exams/select deve conter `X-CSRF-Token` e autenticação (cookie `sessionToken` ou `Authorization: Bearer <token>` / `X-Session-Token: <token>`), além do cookie `csrfToken`.
  - Resposta 200 deve trazer `questions` com `id`, `descricao`, `options`, `imagem_url`.
- Workaround (se persistir):
  - Atualizar/forçar `SIMULADOS_CONFIG.BACKEND_BASE` para mesma origem do backend.
  - Garantir carregamento de `utils/csrf.js` antes de `script_exam.js`.

## 2. Placeholder de questões sem `id`
- Sintomas: Logs `renderQuestion idx 0 id undefined ...` e imagem não resolvida.
- Causa raiz: Fallback de UI executado quando seleção falha (403/400), criando questão de amostra sem `id`.
- Correção:
  - Endereçar a causa (403). Com POST resolvido, as questões retornam com `id` e imagens enriquecidas pelo backend.
- Como detectar: Ver `resp.ok` e logs `Failed to fetch questions <status>`.

## 3. Imagens não exibidas inicialmente
- Sintomas: `hasRaw? false srcResolved? false origin null`.
- Causa: Campo `imagem_url` ausente no primeiro SELECT.
- Correção: Backend enriquece `imagem_url` após seleção para todas as IDs; cliente mescla e persiste.
- Verificação: Network → Resposta inclui imagens; logs mostram contagem de questões com imagem.

## 4. Conta Bloqueada
- Sintomas: No login, aparece a mensagem: `Conta bloqueada por muitas tentativas. Aguarde 4:48 para tentar novamente.` (o tempo varia).
- Causa raiz:
  - O backend aplica um **bloqueio temporário por usuário** após repetidas falhas de senha.
  - Regra atual: ao errar a senha, incrementa `Usuario.AccessFailedCount`; ao chegar em **5 falhas**, zera o contador e grava `Usuario.FimBloqueio = agora + 5 minutos`.
  - Enquanto `FimBloqueio` estiver no futuro, o endpoint de login retorna `ACCOUNT_LOCKED` (HTTP 423) com `lockoutSecondsLeft`.
- Observação importante:
  - Isso é diferente do rate limit por IP do endpoint `/api/auth/login` (HTTP 429, janela de 15 min). É possível “cair” em ambos, dependendo do caso.
- Como verificar:
  - Verificar no banco se `Usuario.FimBloqueio` está preenchido e maior que `NOW()` para o e-mail em questão.
  - No Network do browser, a resposta do POST `/api/auth/login` pode trazer `code: ACCOUNT_LOCKED` e os campos `lockoutUntil` / `lockoutSecondsLeft`.

### Workaround (desbloquear corrigindo na tabela)
Use somente em desenvolvimento/testes locais.

**Opção A — via SQL (Postgres):**
```sql
UPDATE "Usuario"
SET "AccessFailedCount" = 0,
    "FimBloqueio" = NULL,
    "DataAlteracao" = NOW()
WHERE "Email" = 'seuemail@dominio.com';
```

**Opção B — via script (recomendado):**
```bash
node backend/scripts/unlock_user.js seuemail@dominio.com
```

- Depois, tente logar novamente com as credenciais corretas.
- Se o bloqueio voltar, é um indicativo de senha errada (ou usuário sem `SenhaHash`).

## Referências de arquivos
- Frontend: `frontend/utils/csrf.js`, `frontend/script_exam.js`, `frontend/pages/examFull.html`.
- Backend: `backend/middleware/csrfProtection.js`, `backend/controllers/examController.js`, `backend/routes/auth.js`, `backend/scripts/unlock_user.js`.

## 5. 401 com `SESSION_REVOKED` após novo login
- Sintomas: chamadas autenticadas começam a retornar 401 com mensagem do tipo “Sua sessão foi encerrada porque houve um novo login”.
- Causa raiz: política de **sessão única** (JWT inclui `sid` e o backend compara com `UserActiveSession.SessionId`). Quando o usuário faz login em outro dispositivo/navegador, a sessão anterior é revogada.
- Como resolver:
  - Refazer login e usar o token/cookie mais recente.
  - Em clientes API (Postman/app), sempre atualizar o token após login.
