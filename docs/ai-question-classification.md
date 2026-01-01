# IA — Classificação de Questões (Admin)

Este documento descreve o fluxo “**Analisar com IA**” no cadastro de questão, incluindo:

- endpoints utilizados (`/api/ai/question-classify` e masterdata dinâmica),
- regras de segurança/validação (não inventar IDs),
- como o frontend envia os dados e como interpretar o retorno.

> Este fluxo é **Admin-only** (middleware `requireAdmin`).

## Objetivo

A IA deve, para cada questão:

1) **Classificar minuciosamente** a questão com base no contexto do enunciado.
2) **Sugerir valores** para campos específicos do formulário **somente** com IDs disponíveis na “masterdata” (vindos do banco).
3) **Indicar divergências** entre o que já está selecionado no formulário e o que a IA sugeriu, para revisão humana.

Campos cobertos (e somente estes):

- `iddominiogeral` (Domínio Geral)
- `iddominio` (Domínio)
- `idprincipio` (Princípio)
- `codigocategoria` (Categoria)
- `codgrupoprocesso` (Grupo de processo)
- `id_task` (Task)
- `dica` (texto curto)

## Pré-requisitos

- Usuário com papel **admin** (ver middleware `backend/middleware/requireAdmin.js`).
- Um provedor de LLM configurado no backend (selecionado por `LLM_PROVIDER`):
  - **Ollama (default)**
    - `LLM_PROVIDER=ollama`
    - `OLLAMA_ENABLED=true`
    - `OLLAMA_URL` (default `http://localhost:11434`)
    - `OLLAMA_MODEL` (default `llama3.1:8b`)
  - **Gemini (Google AI Studio)**
    - `LLM_PROVIDER=gemini`
    - `GEMINI_API_KEY=...`
    - `GEMINI_MODEL` (default `gemini-1.5-flash`)
    - `GEMINI_TIMEOUT_MS` (default 60000)

## Masterdata dinâmica (DB)

Para evitar prompt “hard-coded” e permitir evolução das tabelas sem intervenção manual, o backend fornece um endpoint que devolve os dicionários diretamente do banco.

### GET `/api/ai/masterdata/question-classification`

- Auth: Admin
- Response:

```json
{
  "success": true,
  "meta": { "scope": "question-classification", "fetchedAt": "2025-12-31T00:00:00.000Z" },
  "masterdata": {
    "iddominiogeral": [{"id": 1, "descricao": "Pessoas"}],
    "iddominio": [{"id": 1, "descricao": "Partes Interessadas"}],
    "idprincipio": [{"id": 1, "descricao": "Administração"}],
    "codigocategoria": [{"id": 1, "descricao": "Ágil"}],
    "codgrupoprocesso": [{"id": 1, "descricao": "Iniciação"}],
    "id_task": [{"id": 1, "descricao": "..."}]
  }
}
```

**Origem no banco:** o backend lê tabelas via `backend/services/masterdataService.js` (inclui `dominiogeral`, `dominio`, `principios`, `categoriaquestao`, `grupoprocesso`/`gruprocesso` e `Tasks`).

Observação: por padrão, o masterdata retornado considera apenas registros com `status=true` (ativos).

## Classificação e sugestão (IA)

### POST `/api/ai/question-classify`

- Auth: Admin
- Body:

```jsonc
{
  "question": {
    "descricao": "Enunciado...",
    "alternativas": ["A ...", "B ...", "C ...", "D ..."],
    "correta": "A"
  },
  "current": {
    "iddominiogeral": 2,
    "iddominio": 4,
    "idprincipio": 7,
    "codigocategoria": 3,
    "codgrupoprocesso": 2,
    "id_task": 20
  },
  "dicaMaxChars": 180,
  "web": {
    "enabled": false,
    "query": "(opcional) query custom",
    "maxSources": 3
  }
}
```

- `current`: são os IDs atualmente selecionados nos selects. Isso é usado para calcular divergências.
- `dicaMaxChars`: limite de tamanho da dica (default 180; clamp 60–400).
- `web` (opcional): quando `enabled=true`, o backend tenta buscar fontes na internet (via endpoints/serviço de web context) e inclui trechos no prompt.
  - Requer `AI_WEB_ENABLED=true` e allowlist/provedor configurados (ver `docs/ai-web-context.md`).

### Resposta

O backend retorna um JSON estruturado para consumo da UI:

- `result.context`: resumo + tags do contexto
- `result.fields.<campo>`: sugestão + comparação com o valor atual
- `disagreements[]`: lista simples de divergências
- `validationIssues[]`: tentativas de IDs inválidos retornados pela IA

Exemplo (parcial):

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
      "iddominio": {
        "suggestedId": 4,
        "currentId": 4,
        "differsFromCurrent": false,
        "confidence": "high",
        "reason": "..."
      },
      "idprincipio": {
        "suggestedId": 10,
        "currentId": 7,
        "differsFromCurrent": true,
        "confidence": "medium",
        "reason": "..."
      }
    },
    "dica": { "text": "...", "reason": "..." }
  },
  "validationIssues": [],
  "disagreements": [
    { "field": "idprincipio", "currentId": 7, "suggestedId": 10 }
  ]
}
```

## Regra crítica: “Nunca inventar dados”

Mesmo com instruções fortes no prompt, o **backend valida** as sugestões:

- Se a IA retornar `suggestedId` que não existe no masterdata do banco, o backend:
  - zera `suggestedId` para `null`
  - adiciona um item em `validationIssues` (`SUGGESTED_ID_NOT_ALLOWED`)

Isso evita propagação de IDs inventados.

## UI — Botão “Analisar com IA”

Página: `frontend/pages/admin/questionForm.html`.

Comportamento:

- Botão: **Analisar com IA**
- Envia:
  - `descricao`
  - `alternativas` (texto das alternativas preenchidas)
  - `correta` (letra A/B/C/D com base na alternativa marcada)
  - `current`: valores atuais dos selects (`iddominiogeral`, `iddominio`, `idprincipio`, `codigocategoria`, `grupo`→`codgrupoprocesso`, `idtask`→`id_task`)
- Mostra painel com:
  - resumo/tags
  - tabela “Atual vs Sugestão” e marcação **(diverge)**
  - dica sugerida (máx `dicaMaxChars`)

Importante: a UI **não aplica automaticamente** as sugestões nos selects; ela apenas apresenta para revisão humana.

## Exemplos (curl)

```bash
curl -H "X-Session-Token: <token_admin>" \
  http://localhost:3000/api/ai/masterdata/question-classification
```

```bash
curl -X POST -H "Content-Type: application/json" -H "X-Session-Token: <token_admin>" \
  -d '{"question":{"descricao":"...","alternativas":["A","B","C","D"],"correta":"A"},"current":{"iddominiogeral":2,"iddominio":4,"idprincipio":7,"codigocategoria":3,"codgrupoprocesso":2,"id_task":20},"dicaMaxChars":180}' \
  http://localhost:3000/api/ai/question-classify
```

## Referências de implementação

- Rotas: `backend/routes/ai.js`
- Endpoint masterdata: `backend/controllers/aiMasterdataController.js`
- Serviço DB: `backend/services/masterdataService.js`
- Endpoint IA: `backend/controllers/aiWebController.js`
- UI: `frontend/pages/admin/questionForm.html`
