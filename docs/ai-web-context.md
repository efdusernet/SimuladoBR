# IA com contexto da Web (Admin)

Este documento descreve os endpoints de IA que **buscam dados na internet** e fornecem esse conteúdo ao modelo (Gemini), com foco em segurança (anti‑SSRF), limites e exemplos de uso.

## Visão geral

Foram adicionados 3 endpoints sob `/api/ai`:

- `GET /api/ai/web/search` — busca na web (Bing ou SerpAPI)
- `POST /api/ai/web/fetch` — fetch seguro + extração de texto
- `POST /api/ai/question-audit` — usa search + fetch para montar contexto e chama o Gemini retornando JSON

Também foram adicionados endpoints para **classificação de questão com masterdata dinâmica (DB)**:

- `GET /api/ai/masterdata/question-classification` — dicionários (DB) para orientar a IA
- `POST /api/ai/question-classify` — sugere valores **somente** dentre os IDs do dicionário e indica divergências com o que já está selecionado

Documentação detalhada da classificação (inclui UI “Analisar com IA”): ver `docs/ai-question-classification.md`.

**Autorização:** todos são **Admin** (middleware `requireAdmin`).

## Modelo (Gemini)

- O backend chama o Gemini via `backend/services/geminiClient.js` (orquestrado por `backend/services/llmClient.js`).
- Modelo padrão: `gemini-1.5-flash` (pode ser alterado com `GEMINI_MODEL`).

## Variáveis de ambiente

### Flags principais

- `AI_WEB_ENABLED` (default `false`)
  - Habilita os endpoints web.
- `AI_WEB_ALLOWLIST` (default vazio)
  - Lista de hosts permitidos para `fetch`.
  - Formato: separado por vírgula.
  - Suporta wildcard de sufixo: `*.wikipedia.org`.
- `AI_WEB_ALLOW_ALL` (default `false`)
  - Permite fetch para qualquer host **(menos seguro; use apenas em ambiente controlado)**.

### Gemini (LLM)

- `GEMINI_API_KEY` (obrigatória para usar Gemini)
- `GEMINI_MODEL` (opcional; default `gemini-1.5-flash`)
- `GEMINI_TIMEOUT_MS` (opcional; default `60000`)

### Provedor de busca

Escolha **um**:

- Bing:
  - `BING_SEARCH_KEY` (obrigatório para usar Bing)
  - `BING_SEARCH_ENDPOINT` (opcional; default `https://api.bing.microsoft.com/v7.0/search`)
- SerpAPI:
  - `SERPAPI_KEY` (obrigatório para usar SerpAPI)

### Limites e timeouts (defaults)

- `AI_WEB_FETCH_TIMEOUT_MS` (default `12000`)
- `AI_WEB_SEARCH_TIMEOUT_MS` (default `10000`)
- `AI_WEB_MAX_FETCH_BYTES` (default `350000`)
- `AI_WEB_MAX_EXTRACT_CHARS` (default `12000`)
- `AI_WEB_ALLOW_ANY_PORT` (default `false`)
  - Por padrão, apenas portas 80/443 são permitidas.

## Segurança (anti-SSRF)

O fetch é restringido por padrão para reduzir risco de SSRF:

- Somente `http`/`https`
- Por padrão, apenas portas 80/443 (`AI_WEB_ALLOW_ANY_PORT=false`)
- Bloqueia hosts locais (ex.: `localhost`, `*.local`, `*.localhost`)
- Resolve DNS e bloqueia hosts que resolvem para IPs privados/locais (ex.: `127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`, link-local)
- Requer allowlist (`AI_WEB_ALLOWLIST`) **ou** `AI_WEB_ALLOW_ALL=true`
- Limita bytes do corpo e tamanho do texto extraído

Observação: isso não substitui WAF/egress controls; é uma camada de proteção no app.

## Contratos dos endpoints

### 1) GET `/api/ai/web/search`

Busca links na internet para uma query.

- Auth: Admin
- Query:
  - `q` (obrigatório)
  - `k` (opcional; 1–10; default 5)

Response (exemplo):

```json
{
  "success": true,
  "meta": { "webEnabled": true },
  "provider": "bing",
  "query": "PMBOK 7 tailoring",
  "results": [
    { "title": "...", "url": "https://...", "snippet": "..." }
  ]
}
```

Erros comuns:
- `WEB_SEARCH_NOT_CONFIGURED`: não há chave `BING_SEARCH_KEY` nem `SERPAPI_KEY`

### 2) POST `/api/ai/web/fetch`

Faz fetch seguro e retorna texto extraído.

- Auth: Admin
- Body:

```json
{ "url": "https://en.wikipedia.org/wiki/Project_management" }
```

Response (exemplo):

```json
{
  "success": true,
  "meta": { "webEnabled": true },
  "page": {
    "url": "https://...",
    "status": 200,
    "contentType": "text/html; charset=UTF-8",
    "title": "...",
    "text": "texto extraído (limitado por AI_WEB_MAX_EXTRACT_CHARS)"
  }
}
```

### 3) POST `/api/ai/question-audit`

Audita coerência/correção de uma questão e usa fontes da web como contexto.

- Auth: Admin
- Body:

```jsonc
{
  "question": {
    "descricao": "Enunciado...",
    "examType": "pmp",
    "alternativas": ["A ...", "B ...", "C ...", "D ..."],
    "correta": "A"
  },
  "web": {
    "enabled": true,
    "query": "(opcional) query custom",
    "maxSources": 4
  }
}
```

Response (exemplo):

```json
{
  "success": true,
  "meta": {
    "model": "llama3.1:8b",
    "usedWeb": true,
    "sourcesCount": 3,
    "query": "..."
  },
  "audit": {
    "verdict": "warning",
    "issues": [
      {
        "type": "fact",
        "message": "...",
        "severity": "medium",
        "uncertain": true,
        "sourceUrls": ["https://..."]
      }
    ],
    "suggestions": ["..."],
    "correctedVersion": null,
    "sourcesUsed": [{ "url": "https://...", "title": "..." }]
  },
  "sources": [
    {
      "url": "https://...",
      "title": "...",
      "contentType": "text/html; charset=UTF-8",
      "excerpt": "..."
    }
  ]
}
```

### 4) GET `/api/ai/masterdata/question-classification`

Retorna os dicionários dinâmicos (vindos do banco) que a IA deve usar para sugerir valores.

- Auth: Admin

Observação: o masterdata retornado considera apenas registros **ativos** (`status=true`).

Response (exemplo):

```json
{
  "success": true,
  "meta": { "scope": "question-classification", "fetchedAt": "2025-12-31T00:00:00.000Z" },
  "masterdata": {
    "iddominiogeral": [{"id": 1, "descricao": "Pessoas"}],
    "iddominio_desempenho": [{"id": 1, "descricao": "Partes Interessadas"}],
    "idprincipio": [{"id": 1, "descricao": "Administração"}],
    "id_abordagem": [{"id": 1, "descricao": "Ágil"}],
    "codgrupoprocesso": [{"id": 1, "descricao": "Iniciação"}],
    "id_task": [{"id": 1, "descricao": "..."}]
  }
}
```

### 5) POST `/api/ai/question-classify`

Classifica a questão e sugere valores para **apenas** estes campos:

- `iddominio_desempenho`
- `idprincipio`
- `id_abordagem`
- `codgrupoprocesso`
- `iddominiogeral`
- `id_task`
- `dica` (texto curto)

O backend valida a resposta: se a IA sugerir um ID fora do dicionário retornado pelo endpoint de masterdata, o `suggestedId` é descartado e reportado em `validationIssues`.

- Auth: Admin
- Body (exemplo):

```jsonc
{
  "question": {
    "descricao": "Enunciado...",
    "alternativas": ["A ...", "B ...", "C ...", "D ..."],
    "correta": "A"
  },
  "current": {
    "iddominiogeral": 2,
    "iddominio_desempenho": 4,
    "idprincipio": 7,
    "id_abordagem": 3,
    "codgrupoprocesso": 2,
    "id_task": 20
  },
  "dicaMaxChars": 180,
  "web": { "enabled": false, "maxSources": 3 }
}
```

Response (exemplo):

```json
{
  "success": true,
  "meta": {
    "model": "llama3.1:8b",
    "dicaMaxChars": 180,
    "dicaTruncated": false,
    "validationIssuesCount": 0,
    "disagreementsCount": 2
  },
  "result": {
    "context": { "summary": "...", "tags": ["..."] },
    "fields": {
      "iddominio_desempenho": { "suggestedId": 4, "currentId": 4, "differsFromCurrent": false, "confidence": "high", "reason": "..." },
      "idprincipio": { "suggestedId": 10, "currentId": 7, "differsFromCurrent": true, "confidence": "medium", "reason": "..." }
    },
    "dica": { "text": "...", "reason": "..." }
  },
  "validationIssues": [],
  "disagreements": [{ "field": "idprincipio", "currentId": 7, "suggestedId": 10 }]
}
```

## Exemplos (curl)

> Ajuste `X-Session-Token` para um usuário admin.

- Search:

```bash
curl -H "X-Session-Token: <token>" "http://app.localhost:3000/api/ai/web/search?q=PMBOK%207%20tailoring&k=5"
```

- Fetch:

```bash
curl -X POST -H "Content-Type: application/json" -H "X-Session-Token: <token>" \
  -d '{"url":"https://en.wikipedia.org/wiki/Project_management"}' \
  http://app.localhost:3000/api/ai/web/fetch
```

- Audit:

```bash
curl -X POST -H "Content-Type: application/json" -H "X-Session-Token: <token>" \
  -d '{"question":{"descricao":"...","examType":"pmp","alternativas":["A","B","C","D"],"correta":"A"},"web":{"enabled":true,"maxSources":4}}' \
  http://app.localhost:3000/api/ai/question-audit
```

- Masterdata (question classification):

```bash
curl -H "X-Session-Token: <token>" \
  http://app.localhost:3000/api/ai/masterdata/question-classification
```

- Classify:

```bash
curl -X POST -H "Content-Type: application/json" -H "X-Session-Token: <token>" \
  -d '{"question":{"descricao":"...","alternativas":["A","B","C","D"],"correta":"A"},"current":{"iddominiogeral":2,"iddominio_desempenho":4,"idprincipio":7,"id_abordagem":3,"codgrupoprocesso":2,"id_task":20},"dicaMaxChars":180}' \
  http://app.localhost:3000/api/ai/question-classify
```

## Implementação (referências)

- Rotas: `backend/routes/ai.js`
- Controller: `backend/controllers/aiWebController.js`
- Serviço: `backend/services/webContext.js`
- Masterdata: `backend/controllers/aiMasterdataController.js` e `backend/services/masterdataService.js`
- UI (admin): `frontend/pages/admin/questionForm.html`
