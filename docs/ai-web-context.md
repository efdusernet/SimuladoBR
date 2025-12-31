# IA com contexto da Web (Admin)

Este documento descreve os endpoints de IA que **buscam dados na internet** e fornecem esse conteúdo ao modelo (Ollama), com foco em segurança (anti‑SSRF), limites e exemplos de uso.

## Visão geral

Foram adicionados 3 endpoints sob `/api/ai`:

- `GET /api/ai/web/search` — busca na web (Bing ou SerpAPI)
- `POST /api/ai/web/fetch` — fetch seguro + extração de texto
- `POST /api/ai/question-audit` — usa search + fetch para montar contexto e chama o Ollama retornando JSON

**Autorização:** todos são **Admin** (middleware `requireAdmin`).

## Modelo (Ollama)

- O backend chama o Ollama via `backend/services/ollamaClient.js`.
- Modelo padrão: `llama3.1:8b` (pode ser alterado com `OLLAMA_MODEL`).
- URL padrão do Ollama: `http://localhost:11434` (via `OLLAMA_URL`).

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

## Exemplos (curl)

> Ajuste `X-Session-Token` para um usuário admin.

- Search:

```bash
curl -H "X-Session-Token: <token>" "http://localhost:3000/api/ai/web/search?q=PMBOK%207%20tailoring&k=5"
```

- Fetch:

```bash
curl -X POST -H "Content-Type: application/json" -H "X-Session-Token: <token>" \
  -d '{"url":"https://en.wikipedia.org/wiki/Project_management"}' \
  http://localhost:3000/api/ai/web/fetch
```

- Audit:

```bash
curl -X POST -H "Content-Type: application/json" -H "X-Session-Token: <token>" \
  -d '{"question":{"descricao":"...","examType":"pmp","alternativas":["A","B","C","D"],"correta":"A"},"web":{"enabled":true,"maxSources":4}}' \
  http://localhost:3000/api/ai/question-audit
```

## Implementação (referências)

- Rotas: `backend/routes/ai.js`
- Controller: `backend/controllers/aiWebController.js`
- Serviço: `backend/services/webContext.js`
