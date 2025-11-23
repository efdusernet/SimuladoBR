# API de Exames — Endpoints e Uso Rápido

> Documentação complementar: ver `docs/estatisticas-tentativas.md` para detalhes completos do sistema de estatísticas diárias (iniciadas, finalizadas, abandonadas, expurgadas, médias de score e fórmulas de taxas) e da aba "Estatísticas" no frontend.

Este documento resume os endpoints principais sob `/api/exams`, com propósito, payloads e onde são chamados no frontend.

Observações gerais
- Autorização por token de sessão do app: header `X-Session-Token: <sessionToken>` quando indicado.
- Responses em JSON; erros comuns: 400 (payload inválido), 404 (não encontrado), 500 (erro interno).

## POST /api/admin/exams/fixture-attempt
Cria uma tentativa finalizada artificial ("fixture") para testes e estatísticas sem processo de resposta manual.

- Auth: `X-Session-Token` (usuário admin — ver middleware `requireAdmin`)
- Body campos principais:
  - `userId: number` (obrigatório)
  - `overallPct: number` (% geral desejada; default 65)
  - `totalQuestions?: number` (default 180, limite 1–500)
  - `examTypeSlug?: string` (default `pmp`)
  - `peoplePct?`, `processPct?`, `businessPct?` (percentuais por domínio — ou todos ou nenhum)
- Query param opcional: `tolerance` (default 2) — diferença máxima permitida entre média dos domínios e `overallPct`.

### Regras de validação server-side
1. Se qualquer percentual de domínio for enviado, todos (`peoplePct`, `processPct`, `businessPct`) devem estar presentes.
2. Calcula-se a média `(peoplePct + processPct + businessPct) / 3`. Diferença absoluta para `overallPct` não pode exceder `tolerance`.
3. Percentuais ficam automaticamente dentro de 0–100.
4. Se inválido: resposta `400` com `{ error, details }`.

Exemplo de request coerente:
```jsonc
POST /api/admin/exams/fixture-attempt?tolerance=2
{
  "userId": 42,
  "overallPct": 70,
  "totalQuestions": 60,
  "examTypeSlug": "pmp",
  "peoplePct": 68,
  "processPct": 72,
  "businessPct": 70
}
```
Média domínios = 70.00 (aceita).

Exemplo incoerente (retorna 400):
```jsonc
{
  "userId": 42,
  "overallPct": 70,
  "peoplePct": 55,
  "processPct": 90,
  "businessPct": 90
}
```
Média = 78.33 → diff 8.33 > tolerance (2).

### Response (sucesso)
```json
{
  "attemptId": 1234,
  "userId": 42,
  "totalQuestions": 180,
  "corretas": 126,
  "scorePercent": "70.00",
  "domainCounts": { "people": 60, "process": 60, "business": 60 },
  "domainCorrects": { "people": 41, "process": 42, "business": 43 }
}
```
Metadados adicionais (percentuais solicitados/gerados, diferenças) estão em `exam_attempt.Meta`.

Campos novos em `Meta` (versão >= 1.1.0):
- `fixtureVersion`: versão da especificação usada para gerar a fixture (`1.1.0` atual: respostas com opções reais)
- `answerStrategy`: estratégia de resposta (`all-correct-options` para questões corretas; uma incorreta para erradas)

### Observações de implementação
- Distribuição de corretas por domínio tenta aproximar cada percentual solicitado, ajustando para somar o total de corretas globais calculado via `overallPct`.
- Se nenhum domínio for informado, usa-se `overallPct` para estimar corretas em cada domínio proporcionalmente ao total de questões do domínio.
- Tempo gasto sintético é gerado (25–80s por questão) para realismo em estatísticas.
- A partir de versão X (fixture aprimorado), respostas são inseridas com seleção de opções reais: questões marcadas corretas recebem TODAS as opções corretas selecionadas; questões incorretas recebem uma opção incorreta (ou fallback de uma única correta se não houver incorreta). Isso garante que indicadores que recalculam correção comparando opções (ex.: IND10 radar de domínios) reflitam os mesmos percentuais.
- Atualiza estatísticas diárias do usuário (`exam_attempt_user_stats`) com `finished_count` e média incremental.
- Metadados em `Meta.domainPercentsActual` e `Meta.domainCorrects` permanecem fonte auxiliar para auditoria.

### Erros comuns
- `400 userId obrigatório` — campo ausente.
- `400 Forneça todos os percentuais ...` — domínios parciais.
- `400 Incoerência: média domínios ...` — violação de tolerância.
- `404 Usuário não encontrado` ou `ExamType não encontrado`.
- `500 Internal error` — falha inesperada.


## GET /api/exams
Lista tipos de exame disponíveis (fonte DB; fallback opcional via registry).
- Usado por: páginas que listam tipos (internamente por `listExams`).
- Response: `[{ id, nome, numeroQuestoes, duracaoMinutos, ... }]`

## GET /api/exams/types
Lista de tipos para UI (similar ao endpoint acima; interface estável).
- Usado por: `frontend/pages/admin/questionBulk.html` (carregar tipos).
- Response: `[{ id, nome, numeroQuestoes, duracaoMinutos, ... }]`

## POST /api/exams/select
Seleciona e retorna um conjunto de questões (com opções) e cria uma tentativa (`exam_attempt`).
- Usado por: `frontend/pages/examSetup.html` (contar/selecionar), wrappers em `exam.html`/`examFull.html`.
- Headers:
  - `X-Session-Token: <sessionToken>` (obrigatório)
  - `X-Exam-Mode: quiz | full` (opcional; se ausente o backend infere: `full` quando `count` >= número total de questões do tipo (ex.: 180), `quiz` quando `count` <= 50)
- Body:
  - `count: number` (obrigatório)
  - `examType?: string` (slug; default `pmp`)
  - `dominios?: number[]`, `areas?: number[]`, `grupos?: number[]`
  - `onlyCount?: boolean` (pré-checagem)
- Response (sucesso): `{ sessionId, total, attemptId, examMode, exam, questions }`

## POST /api/exams/start-on-demand
Inicia sessão persistindo perguntas, sem retornar o conteúdo completo de cada questão (fluxo alternativo).
- Usado por: reservado (não há chamada ativa no frontend no momento).
- Headers: `X-Session-Token`
- Body: `{ count, examType?, dominios?, areas?, grupos? }`
- Headers opcionais: `X-Exam-Mode: quiz | full` (mesma inferência quando ausente)
- Response: `{ sessionId, total, attemptId, examMode, exam }`

## GET /api/exams/:sessionId/question/:index
Busca uma questão específica da sessão (útil no fluxo on-demand).
- Usado por: fluxo on-demand (não habilitado no frontend atual).
- Response: `{ index, total, examType, question: { id, type, descricao, ... } }`

## POST /api/exams/submit
Registra respostas (parciais ou finais), computa nota na submissão final e encerra a tentativa.
- Usado por: `frontend/assets/build/script_exam.js` e `frontend/script_exam.js` ao salvar/encerrar.
- Headers: `X-Session-Token`
- Body:
  - `sessionId: string`
  - `answers: Array<{ questionId: number, optionId?: number, optionIds?: number[], response?: any }>`
  - `partial?: boolean` (default false; quando true, não encerra tentativa)
- Response (final): `{ sessionId, totalQuestions, totalCorrect, details }`
- Efeitos colaterais (final): atualiza `exam_attempt` com `Corretas`, `Total`, `ScorePercent`, `Aprovado`, `FinishedAt`, `Status='finished'`.
- **Validação de completude (frontend)**: Ao finalizar exame completo (`examFull.html`), valida-se se pelo menos 95% das questões foram respondidas:
  - Se ≥ 95%: prossegue com submit normal
  - Se < 95%: exibe modal de aviso; usuário pode sair sem salvar (não chama submit) ou continuar respondendo

## POST /api/exams/:sessionId/pause/start
Inicia pausa (exame completo com checkpoints).
- Usado por: `frontend/pages/examFull.html`.
- Body: `{ index: number }` (checkpoint)
- Response: `{ ok: true, pauseUntil }`

## POST /api/exams/:sessionId/pause/skip
Pula pausa do checkpoint atual.
- Usado por: `frontend/pages/examFull.html`.
- Body: `{ index: number }`
- Response: `{ ok: true }`

## GET /api/exams/:sessionId/pause/status
Estado atual de pausa e política configurada.
- Usado por: `frontend/pages/examFull.html`.
- Response: `{ pauses, policy, examType }`

## POST /api/exams/resume
Reconstrói a sessão em memória a partir do banco (após restart do servidor).
- Usado por: `frontend/pages/exam.html` e `frontend/pages/examFull.html` (auto-resume).
- Headers: `X-Session-Token`
- Body: `{ sessionId?: string, attemptId?: number }`
- Response: `{ ok: true, sessionId, attemptId, total, examType }`

## GET /api/exams/last
Resumo da última tentativa finalizada do usuário (para o gauge da Home).
- Usado por: `frontend/index.html` (componente `lastExamResults`).
- Headers: `X-Session-Token`
- Response:
  ```json
  {
    "correct": number,
    "total": number,
    "scorePercent": number,
    "approved": boolean | null,
    "finishedAt": string,
    "examTypeId": number | null,
    "examMode": "quiz" | "full" | null
  }
  ```

## GET /api/exams/history?limit=3
Histórico das últimas N tentativas finalizadas do usuário (default 3).
- Headers: `X-Session-Token`
- Query: `limit` (1–10, default 3)
- Response: `[{ correct, total, scorePercent, approved, startedAt, finishedAt, examTypeId, durationSeconds, examMode }]`

Exemplo:
```json
[
  {
    "correct": 112,
    "total": 180,
    "scorePercent": 62.22,
    "approved": false,
    "startedAt": "2025-11-10T18:31:22.123Z",
    "finishedAt": "2025-11-10T20:58:55.456Z",
    "examTypeId": 1,
    "durationSeconds": 8800,
    "examMode": "full"
  },
  {
    "correct": 18,
    "total": 25,
    "scorePercent": 72.0,
    "approved": null,
    "startedAt": "2025-11-09T15:02:00.000Z",
    "finishedAt": "2025-11-09T15:40:12.000Z",
    "examTypeId": 1,
    "durationSeconds": 2280,
    "examMode": "quiz"
  }
]
```

---

### Modelos usados (resumo)
- `exam_attempt` (ExamAttempt): tentativa e metadados (ScorePercent, Aprovado, Started/FinishedAt, etc.)
- `exam_attempt_question` (ExamAttemptQuestion): questões por tentativa (TempoGastoSegundos, Correta)
- `exam_attempt_answer` (ExamAttemptAnswer): respostas selecionadas
- `exam_type` (ExamType): configuração por tipo de exame (numeroQuestoes, pausas, pontuação mínima)
- `question_type` (QuestionType): tipos de questão (single/multi/avançadas)
- `questao`: base de questões (relacionada via QuestionId)

### Notas
- Token de sessão: o app utiliza `localStorage.sessionToken`; o backend o resolve como user id, nome de usuário ou e-mail.
- Usuário com bloqueio: limites aplicados (ex.: máximo de 25 questões na seleção).
- Exame completo: 180 questões, pausas conforme `ExamType` (se configurado).
- Campo novo: `exam_attempt.exam_mode` armazena `quiz` ou `full` para cada tentativa. Persistência:
  - Definido pelo header `X-Exam-Mode` quando presente e válido.
  - Caso ausente, inferido por `count` (>= total definido para o tipo => `full`; <=50 => `quiz`; outro caso => null).
  - Retornado nos endpoints: `POST /api/exams/select`, `POST /api/exams/start-on-demand`, `GET /api/exams/last`, `GET /api/exams/history`.

---

## Indicadores

Observações gerais
- Autorização via JWT: header `Authorization: Bearer <token>`.
- Janelas de tempo: parâmetro `days` (1–120, default 30).
- Filtro por modo: `exam_mode=quiz|full` (opcional). Se ausente, aplica-se lógica de exame completo.
- Filtro por usuário: `idUsuario` (opcional; inteiro > 0). Quando presente, restringe aos exames daquele usuário.
- Filtro de exames completos: considera tentativas com `exam_mode='full'` ou `quantidade_questoes = FULL_EXAM_QUESTION_COUNT` (definido por `.env`).

### GET /api/indicators/exams-completed?days=30&exam_mode=full&idUsuario=42
Total de exames finalizados no período.
- Query: 
  - `days` (opcional; default 30)
  - `exam_mode` (opcional; "quiz" ou "full"; default: full-exam logic quando ausente)
  - `idUsuario` (opcional; inteiro > 0)
- Response: `{ days, examMode, userId, total }`

### GET /api/indicators/approval-rate?days=30&exam_mode=full&idUsuario=42
Percentual de aprovação no período (nota >= 75%).
- Query: 
  - `days` (opcional; default 30)
  - `exam_mode` (opcional; "quiz" ou "full"; default: full-exam logic quando ausente)
  - `idUsuario` (opcional; inteiro > 0)
- Response: `{ days, examMode, userId, total, approved, ratePercent }`

### GET /api/indicators/failure-rate?days=30&exam_mode=full&idUsuario=42
Percentual de reprovação no período (nota < 75%).
- Query: 
  - `days` (opcional; default 30)
  - `exam_mode` (opcional; "quiz" ou "full"; default: full-exam logic quando ausente)
  - `idUsuario` (opcional; inteiro > 0)
- Response: `{ days, examMode, userId, total, failed, ratePercent }`

### GET /api/indicators/overview
Resumo agregado para cards na página de Indicadores.
- Status: estrutura base retornada (valores placeholder) — em evolução.
- Response: `{ last15: { you, others }, last30: { you, others }, meta: { windowDays } }`

---

### GET /api/indicators/questions-count?exam_type=1
Quantidade de questões disponíveis no simulador.
- Auth: `Authorization: Bearer <token>`
- Query:
  - `exam_type` (opcional; inteiro > 0). Quando ausente, retorna o total de todas as questões ativas.
- Regra: considera `questao.excluido=false` e `questao.idstatus=1`.
- Response: `{ examTypeId: number|null, total: number }`

### GET /api/indicators/answered-count?exam_type=1&idUsuario=42
Quantidade distinta de questões já respondidas pelo usuário (por tipo de exame).
- Auth: `Authorization: Bearer <token>`
- Query:
  - `exam_type` (obrigatório; inteiro > 0)
  - `idUsuario` (opcional; se ausente, usa o usuário do JWT)
- Regra: `COUNT(DISTINCT aq.question_id)` em `exam_attempt_question` com join em `exam_attempt_answer`, filtrando por `a.user_id` e `a.exam_type_id`.
- Response: `{ examTypeId: number, userId: number, total: number }`

### GET /api/indicators/total-hours?exam_type=1&idUsuario=42
Total de horas gastas no simulador pelo usuário (por tipo de exame).
- Auth: `Authorization: Bearer <token>`
- Query:
  - `exam_type` (obrigatório; inteiro > 0)
  - `idUsuario` (opcional; se ausente, usa o usuário do JWT)
- Regra: soma `exam_attempt_question.tempo_gasto_segundos` das tentativas do usuário (status finished ou null), retorna também em horas.
- Response: `{ examTypeId: number, userId: number, segundos: number, horas: number }`

### GET /api/indicators/process-group-stats?exam_mode=full&idUsuario=42&idExame=123
Estatísticas de acertos/erros por grupo de processos no último exame completo do usuário.
- Auth: `Authorization: Bearer <token>`
- Query:
  - `exam_mode` (opcional; padrão 'full')
  - `idUsuario` (opcional; se ausente, usa o usuário do JWT)
  - `idExame` (opcional; se ausente, busca o último exame finished do usuário com exam_mode especificado)
- Regra: para cada `grupo_processos` distinto, calcula qtd de acertos (`is_correct=true`) e erros (`is_correct=false`), retorna percentuais.
- Response: 
  ```json
  {
    "userId": 42,
    "examMode": "full",
    "idExame": 123,
    "grupos": [
      {
        "grupo": "Iniciação",
        "acertos": 8,
        "erros": 2,
        "total": 10,
        "percentAcertos": 80.00,
        "percentErros": 20.00
      },
      ...
    ]
  }
  ```

---

### Registro de Indicadores (metadata)
Entradas semeadas na tabela `indicator` (idempotentes por código):

- **IND1** - `Exames Realizados Resultados 30 dias`
  - Descrição: Somatório de tentativas de exames nos últimos X dias (padrão 30).
  - Parâmetros: `{"diasPadrao":30, "alternativas":[30,60], "examMode":["quiz","full"], "idUsuario":null}`
  - Fórmula (descr.): `COUNT(exam_attempt WHERE exam_mode IN (quiz,full) AND finished_at >= NOW() - (X days))`
  - Observação: Quando `exam_mode` ausente, fallback para full-exam logic (`exam_mode='full'` OU `quantidade_questoes = FULL_EXAM_QUESTION_COUNT`).

- **IND2** - `% de aprovação no período`
  - Descrição: `(Exames com score_percent >= 75% * 100) / Exames no período (padrão 30 dias).`
  - Parâmetros: `{"diasPadrao":30, "examMode":["quiz","full"], "idUsuario":null}`
  - Fórmula (descr.): `(COUNT WHERE score_percent >= 75 / COUNT total) * 100`

- **IND3** - `% de reprovação no período`
  - Descrição: `(Exames com score_percent < 75% * 100) / Exames no período (padrão 30 dias).`
  - Parâmetros: `{"diasPadrao":30, "examMode":["quiz","full"], "idUsuario":null}`
  - Fórmula (descr.): `(COUNT WHERE score_percent < 75 / COUNT total) * 100`

- **IND4** - `Quantidade questões do simulador`
  - Descrição: `Total de questões disponíveis (excluido=false, idstatus=1). Parâmetro opcional examTypeId.`
  - Parâmetros: `{"examTypeId":null}`
  - Fórmula (descr.): `COUNT(questao WHERE excluido=false AND idstatus=1 [AND exam_type_id = :examTypeId])`

- **IND5** - `Quantidade questões respondidas`
  - Descrição: `Qtd. distinta de questões respondidas pelo usuário (JOIN exam_attempt/question/answer) por examTypeId.`
  - Parâmetros: `{"examTypeId":1, "idUsuario":null}`
  - Fórmula (descr.): `COUNT(DISTINCT aq.question_id WHERE a.user_id=:idUsuario AND a.exam_type_id=:examTypeId)`

- **IND6** - `Total horas no simulador`
  - Descrição: `Soma do tempo gasto por questão (exam_attempt_question.tempo_gasto_segundos) por usuário/examTypeId.`
  - Parâmetros: `{"examTypeId":1, "idUsuario":null}`
  - Fórmula (descr.): `SUM(aq.tempo_gasto_segundos)/3600 WHERE a.user_id=:idUsuario AND a.exam_type_id=:examTypeId`

  
- **IND7** - `% Acertos/Erros por Grupo de Processos`
  - Descrição: `Mostra a % de questões certas x % de questões erradas relacionada a cada grupo de processos no último exame completo (exam_mode=full) do usuário.`
  - Parâmetros: `{"idUsuario":null, "idExame":null, "examMode":"full"}`
  - Fórmula (descr.): Para cada grupo_processos: `acertos = COUNT(exam_attempt_question WHERE user_correct=true)`, `erros = COUNT(exam_attempt_question WHERE user_correct=false)`, `total_grupo = acertos + erros`, `% Acertos = (acertos / total_grupo) × 100`, `% Erros = (erros / total_grupo) × 100`

  - Resultado: array de `{grupo, acertos, erros, total, percentAcertos, percentErros}` ordenado por grupo

- **IND8** - `% Acertos/Erros por Área de Conhecimento`
  - Descrição: `Mostra a % de questões certas x % de questões erradas relacionada a cada Área de Conhecimento no último exame completo (exam_mode=full) do usuário.`
  - Parâmetros: `{"idUsuario":null, "idExame":null, "examMode":"full"}`
  - Fórmula (descr.): Para cada área de conhecimento: `acertos = COUNT(exam_attempt_question WHERE user_correct=true)`, `erros = COUNT(exam_attempt_question WHERE user_correct=false)`, `total_grupo = acertos + erros`, `% Acertos = (acertos / total_grupo) × 100`, `% Erros = (erros / total_grupo) × 100`
  - Resultado: array de `{area conhecimento, acertos, erros, total, percentAcertos, percentErros}` ordenado por área

- **IND9** - `% Acertos/Erros por Abordagem`
  - Endpoint: `GET /api/indicators/approach-stats`
  - Descrição: `Mostra a % de questões certas x % de questões erradas relacionada a cada abordagem (categoriaquestao) no último exame completo (exam_mode=full) do usuário.`
  - Parâmetros: `{"idUsuario":null, "idExame":null, "examMode":"full"}`
  - Fórmula (descr.): Para cada abordagem: `acertos = COUNT(exam_attempt_question WHERE user_correct=true)`, `erros = COUNT(exam_attempt_question WHERE user_correct=false)`, `total_grupo = acertos + erros`, `% Acertos = (acertos / total_grupo) × 100`, `% Erros = (erros / total_grupo) × 100`
  - Resultado: array de `{abordagem, acertos, erros, total, percentAcertos, percentErros}` ordenado por id

- **IND10** - `Performance por Domínio`
  - Endpoint: `GET /api/indicators/IND10`
  - Descrição: `Mostra a % de pontuação (acertos) por domínio geral (Pessoas, Processos, Ambiente de Negócios). Pode retornar os dados do melhor exame ou do último exame do usuário, dependendo do parâmetro examMode.`
  - Parâmetros: 
    - `idUsuario` (opcional, extraído do token se não fornecido)
    - `examMode` (obrigatório): `"best"` | `"last"`
      - `"last"`: Retorna estatísticas do último exame finalizado
      - `"best"`: Calcula performance de todos os exames e retorna o exame com melhor desempenho geral
  - Headers: `X-Session-Token: <sessionToken>` (obrigatório)
  - Fórmula (descr.): 
    - Para cada domínio: `corretas = COUNT(exam_attempt_answer WHERE correta=true)`, `total = COUNT(exam_attempt_question)`, `percentage = (corretas / total) × 100`
    - Apenas exames com `exam_mode='full'` e `finished_at IS NOT NULL` são considerados
    - Domínios são obtidos de `dominiogeral` via FK `questao.iddominiogeral`
  - Response:
    ```json
    {
      "userId": number,
      "examMode": "best" | "last",
      "examAttemptId": number | null,
      "examDate": string | null,
      "domains": [
        {
          "id": number,
          "name": string,
          "corretas": number,
          "total": number,
          "percentage": number
        }
      ]
    }
    ```
  - Usado por: `frontend/pages/progressoGeral.html` (gráfico radar de domínios)


