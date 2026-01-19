# Sistema de Estatísticas Diárias de Tentativas (Exames/Quizzes)

Este documento descreve em profundidade a arquitetura, modelos, serviço, eventos de atualização, endpoints, fórmulas e integração frontend da funcionalidade de acompanhamento de métricas de tentativas (iniciadas, finalizadas, abandonadas, expurgadas, classificação de abandono e score médio ponderado) que persiste mesmo após purgas de dados históricos.

---

## 1. Objetivos

- Permitir que o usuário visualize suas taxas de abandono, conclusão e expurgo ao longo do tempo.
- Preservar agregações (contagens e score médio) de cada dia mesmo quando tentativas abandonadas antigas são expurgadas do banco principal.
- Classificar abandonos por tipo (timeout de inatividade, baixo progresso, manual) para diagnósticos de uso.
- Fornecer base para evoluções futuras (metas, alertas, comparação com média de outros usuários, etc.).
- Tornar o cálculo de taxas rápido (sem scans completos em tabelas grandes de tentativas) via agregação diária incrementada atomicamente.

---

## 2. Visão Geral da Arquitetura

| Camada | Componente | Função |
|--------|------------|--------|
| Banco  | Tabela `exam_attempt_user_stats` | Armazena agregações diárias por usuário (contagens, média de score) |
| Serviço | `UserStatsService` | API interna para incrementar e consultar estatísticas diárias |
| Controladores | `examController.js` | Dispara incrementos em eventos (start, finish, abandon, purge) |
| Rotas | `routes/users.js` | Exposição dos endpoints `/api/users/me/stats/daily` e `/api/users/me/stats/summary` |
| Frontend | `frontend/pages/Indicadores.html` (aba "Estatísticas") | Consome endpoints e renderiza métricas + gráficos SVG |

---

## 3. Migração Principal

Arquivo: `backend/sql/027_create_exam_attempt_user_stats.sql`

Cria a tabela de agregação diária:

```sql
CREATE TABLE IF NOT EXISTS exam_attempt_user_stats (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date DATE NOT NULL,
  started_count INTEGER NOT NULL DEFAULT 0,
  finished_count INTEGER NOT NULL DEFAULT 0,
  abandoned_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  low_progress_count INTEGER NOT NULL DEFAULT 0,
  purged_count INTEGER NOT NULL DEFAULT 0,
  avg_score_percent NUMERIC(6,3) NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_exam_attempt_user_stats_user_date UNIQUE (user_id, date)
);
```

Índice composto `(user_id, date)` para buscas de janela.

---

## 4. Modelo Sequelize

Arquivo: `backend/models/ExamAttemptUserStats.js`

Campos principais:
- `UserId`: usuário alvo.
- `Date`: dia calendário (UTC) da agregação.
- `StartedCount`, `FinishedCount`, `AbandonedCount`, `TimeoutCount`, `LowProgressCount`, `PurgedCount`.
- `AvgScorePercent`: média ponderada dos scores (%) das tentativas finalizadas naquele dia.
- `UpdatedAt`: timestamp de última atualização.

Sem timestamps automáticos (configurado `timestamps: false`).

---

## 5. Serviço Interno `UserStatsService`

Arquivo: `backend/services/UserStatsService.js`

### 5.1. Métodos
- `incrementStarted(userId, when?)`
- `incrementFinished(userId, scorePercent, when?)`
- `incrementAbandoned(userId, reason, when?)`
  - Se `reason === 'timeout_inactivity'` incrementa também `TimeoutCount`.
  - Se `reason === 'abandoned_low_progress'` incrementa também `LowProgressCount`.
- `incrementPurged(userId, when?)`
- `getDailyStats(userId, days)`
- `getSummary(userId, days)`

### 5.2. Estratégia de Upsert
Utiliza `INSERT ... ON CONFLICT (user_id, date) DO UPDATE` com incrementos atômicos:

```sql
INSERT INTO exam_attempt_user_stats (user_id, date, started_count, finished_count, abandoned_count, timeout_count, low_progress_count, purged_count, avg_score_percent)
VALUES (:uid, :date, 0, 0, 0, 0, 0, 0, NULL)
ON CONFLICT (user_id, date)
DO UPDATE SET <increments>, updated_at = NOW();
```

### 5.3. Cálculo da Média Ponderada de Score
Ao finalizar tentativa:

```
novoAvg = ROUND(((oldAvg * finished_before) + scoreAtual) / (finished_before + 1), 3)
```

Se `finished_before == 0` → `avg_score_percent` torna-se `scoreAtual`.

### 5.4. Geração das Taxas por Dia (em `getDailyStats`)
- `abandonRate = abandoned / started` (0 se `started == 0`)
- `completionRate = finished / started`
- `purgeRate = abandoned > 0 ? purged / abandoned : 0`

### 5.5. Resumo (`getSummary`)
Agrega todos os dias solicitados somando contagens e recomputando média ponderada total sobre tentativas finalizadas (pesos = `FinishedCount` de cada dia). Retorna também as taxas globais usando as fórmulas acima.

---

## 6. Eventos que Disparam Incrementos

Arquivo: `backend/controllers/examController.js`

| Evento | Momento | Método chamado | Observações |
|--------|---------|----------------|-------------|
| Início da tentativa (persistida) | Após criar `ExamAttempt` ao selecionar questões ou start on-demand | `incrementStarted` | Usa `attempt.UserId` resolvido por `X-Session-Token` |
| Finalização (submit final) | Quando status muda para `finished` | `incrementFinished(scorePercent)` | Score (%) usado na média ponderada |
| Abandono | Marca tentativa como `abandoned` com `StatusReason` | `incrementAbandoned(reason)` | Classificação por `timeout_inactivity` ou `abandoned_low_progress` |
| Expurgo | Ao destruir tentativas abandonadas antigas | `incrementPurged` | Antes de remover o registro da tentativa |

Motivos de abandono mapeados:
- `timeout_inactivity`: inatividade acima do limite.
- `abandoned_low_progress`: baixa quantidade de questões após tempo mínimo.
- `user_abandon` (manual) — não incrementa contadores específicos além de `AbandonedCount`.

---

## 7. Endpoints Públicos de Estatísticas

Arquivo: `backend/routes/users.js`

### 7.1. Autenticação
Requer cabeçalho `X-Session-Token` contendo:
- ID numérico do usuário (ex.: `42`) **ou**
- `NomeUsuario` **ou**
- `Email`.

O frontend busca valores em `localStorage`: `sessionToken`, `nomeUsuario`, `nome`.

### 7.2. GET /api/users/me/stats/daily?days=30
Retorna série diária com as contagens e taxas calculadas.

Query:
- `days` (opcional) — padrão 30; intervalo permitido 1..180.

Response:
```json
{
  "days": 30,
  "data": [
    {
      "date": "2025-11-01",
      "started": 3,
      "finished": 2,
      "abandoned": 1,
      "timeout": 0,
      "lowProgress": 1,
      "purged": 0,
      "avgScorePercent": 68.333,
      "abandonRate": 0.3333,
      "completionRate": 0.6667,
      "purgeRate": 0
    }
  ]
}
```

### 7.3. GET /api/users/me/stats/summary?days=30
Retorna agregação do período (totais + taxas + média ponderada de score).

Response:
```json
{
  "periodDays": 30,
  "started": 15,
  "finished": 10,
  "abandoned": 5,
  "timeout": 2,
  "lowProgress": 1,
  "purged": 3,
  "avgScorePercent": 71.456,
  "abandonRate": 0.3333,
  "completionRate": 0.6667,
  "purgeRate": 0.6
}
```

### 7.4. Códigos de Erro
- `400`: ausência de `X-Session-Token`.
- `404`: usuário não encontrado pelo token.
- `500`: erro interno.

---

## 8. Fórmulas Oficiais

| Métrica | Fórmula | Observações |
|---------|---------|-------------|
| Taxa de Abandono | `AbandonedCount / StartedCount` | 0 se `StartedCount == 0` |
| Taxa de Conclusão | `FinishedCount / StartedCount` | 0 se `StartedCount == 0` |
| Taxa de Expurgo | `PurgedCount / AbandonedCount` | 0 se `AbandonedCount == 0` |
| Média Score (%) | Média ponderada por número de tentativas finalizadas por dia | Score diário médio ponderado em cada dia -> agregado |

Precisão: armazenada com até 3 casas decimais (`NUMERIC(6,3)`), exibida com 1 casa decimal na UI.

---

## 9. Integração Frontend (Aba "Estatísticas")

Arquivo: `frontend/pages/Indicadores.html`.

### 9.1. Estrutura
- Seção `<section id="sec-dashboard">` adicionada às abas.
- Elementos principais:
  - Painel de introdução (`#indicadoresIntro`).
  - Controles (select `#dashDays`, botão `#dashReload`, indicadores de estado `#dashLoading`, `#dashError`).
  - Grid de métricas resumo (`#dashSummary`).
  - Gráfico de taxas diárias (`#dashRatesChart`).
  - Gráfico de média de score (`#dashScoreChart`).

### 9.2. Lazy Load
Carregamento somente quando a aba é ativada pela primeira vez (`_dashLoadedOnce`). Subsequentes alterações de período (`#dashDays`) ou clique em "Recarregar" disparam novas chamadas.

### 9.3. Cabeçalhos de Requisição
```js
const headers = {
  'Accept': 'application/json',
  'X-Session-Token': sessionToken,
  ...getAuthHeadersLocal() // JWT se disponível
};
```

Se `sessionToken` ausente, exibe aviso amigável no grid.

### 9.4. Funções Principais
| Função | Papel |
|--------|-------|
| `loadDashboard()` | Orquestra fetch paralelo (summary + daily) |
| `renderDashboardSummary(summary)` | Monta cards de métricas |
| `renderRatesChart(rows)` | Gera SVG de linhas para abandono%, conclusão%, expurgo% |
| `renderScoreChartDash(rows)` | Gera SVG da média de score diária |
| `dashSetLoading(on)` / `dashSetError(on)` | Controle de estado visual |

### 9.5. Estados de UI
- Carregando: `#dashLoading` visível.
- Erro: `#dashError` visível (falha HTTP ou exceção).
- Sem dados: mensagem específica em cada container (`Sem dados`, `Sem dados diários`).
- Sem sessão: bloco explicativo solicitando login.

### 9.6. Escala dos Gráficos
- Altura fixa (`H = 260`), padding para eixos (`pad = 28`).
- Escala Y dinâmica com base no maior valor entre as séries (mínimo 10 para visibilidade). Ticks: 0, metade, máximo.
- Linhas codificadas por cor: Abandono (azul), Conclusão (verde), Expurgo (vermelho tracejado); Score (linha roxa).

---

## 10. Segurança e Considerações

- `X-Session-Token` aceita múltiplas formas (ID, NomeUsuario, Email); reforçar consistência futura (ideal: somente ID). 
- Purga física de tentativas não afeta as agregações (idempotência garantida pelos incrementos já gravados).
- Falhas nos incrementos são isoladas em `try/catch` para não bloquear fluxo de exame (logar e monitorar posteriormente).
- Armazenar métricas separadamente evita vazamento de dados históricos sensíveis sobre questões específicas.

---

## 11. Limitações Atuais

- Não há segmentação por tipo de exame (`ExamTypeId`) nas estatísticas diárias — métrica global do usuário.
- Não há distinção entre modos `quiz` e `full` nas agregações (apenas contagem total). Possível futura extensão adicionando colunas separadas.
- Sem endpoint comparativo (ex.: média da plataforma) ou ranking entre usuários.
- Score ponderado considera apenas tentativas finalizadas; não há ajuste por número de questões respondidas (já coberto implicitamente pela regra de finalização).

---

## 12. Possíveis Extensões Futuras

| Ideia | Descrição |
|-------|-----------|
| Segmentar por ExamType | Adicionar colunas específicas (started_full, started_quiz, etc.). |
| Taxa de recuperação | Métrica: tentativas abandonadas seguidas de uma finalizada no mesmo dia ou dia seguinte. |
| Alertas personalizados | Notificar usuário ao exceder limite de abandonos consecutivos. |
| Benchmark anônimo | Comparar taxa de conclusão com média global (privacidade preservada). |
| Exportação CSV/JSON | Endpoint adicional para download dos dados diários. |
| Retenção de janela móvel | Otimizar queries para períodos longos (cache interno). |

---

## 13. Exemplos de Uso (Frontend)

### 13.1. Fetch manual (console)
```js
fetch('/api/users/me/stats/summary?days=60', {
  headers: { 'X-Session-Token': localStorage.sessionToken }
}).then(r => r.json()).then(console.log);
```

### 13.2. Manipulação de ausência de sessão
```js
const sessionToken = localStorage.getItem('sessionToken') || localStorage.getItem('nomeUsuario');
if (!sessionToken) {
  // exibir mensagem ou redirecionar
}
```

---

## 14. Checklist de Integração Rápida

- [x] Executar migração 027.
- [x] Incluir modelos `ExamAttemptUserStats` e serviço `UserStatsService`.
- [x] Chamar incrementos nos pontos: start, finish, abandon, purge.
- [x] Criar rotas `/me/stats/daily` e `/me/stats/summary` com validação de `X-Session-Token`.
- [x] Adicionar aba "Estatísticas" ao `Indicadores.html` com lazy load.
- [x] Renderizar gráficos SVG e cards de métricas.
- [x] Manipular estados: carregando, erro, sem dados, sem sessão.

---

## 15. Resumo Rápido (TL;DR)

Persistimos contagens diárias por usuário em `exam_attempt_user_stats` usando upsert atômico. Eventos de ciclo de vida das tentativas disparam incrementos. Dois endpoints (`/stats/daily` e `/stats/summary`) expõem série temporal e agregados. A aba "Estatísticas" consome esses endpoints via `X-Session-Token` e exibe taxas (abandono, conclusão, expurgo) e média de score ponderada. Purga de tentativas não apaga métricas históricas.

Nota (Admin): a ação "Excluir histórico" nas páginas de revisão executa um **purge total** da tentativa e também recompõe/remover o agregado diário (`exam_attempt_user_stats`) do usuário naquele dia (e limpa `exam_attempt_purge_log` do `attemptId`), com o objetivo de não deixar rastros na base.

---

## 16. Referências Cruzadas

- Migração: `backend/sql/027_create_exam_attempt_user_stats.sql`
- Modelo: `backend/models/ExamAttemptUserStats.js`
- Serviço: `backend/services/UserStatsService.js`
- Controlador: `backend/controllers/examController.js`
- Rotas: `backend/routes/users.js`
- Frontend: `frontend/pages/Indicadores.html`

---

## 17. Perguntas Frequentes (FAQ)

| Pergunta | Resposta |
|----------|----------|
| Por que não recalcular tudo on-demand? | Custo de varrer tentativas cresce e purga remove dados granulares. Agregação diária garante rapidez e persistência. |
| Como lidar se um incremento falhar? | O exame continua; logar e eventualmente reconstruir dia afetado via script de reconciliação futura. |
| Score médio pode ficar incorreto se houver ajuste retroativo? | Sim; para correções usar processo de recomputação: zerar row e reprocessar tentativas do dia. |
| Taxa de expurgo > 100% é possível? | Não; purged nunca excede abandoned salvo corrupção de dados. Monitorar com alerta se `purged_count > abandoned_count`. |
| Onde configurar limites de timeout/baixo progresso? | Política interna (arquivo de config / variáveis), aplicada no controlador que avalia abandono. |

---

## 18. Script de Reconstrução (Sugestão Futuras Manutenções)

Caso precise recalcular estatísticas de um intervalo:
1. Selecionar tentativas originais por usuário e dia.
2. Para cada dia, agrupar e gerar contagens.
3. Fazer `UPDATE` direto ou recriar linha com `DELETE` + novo `INSERT`.
4. Reaplicar fórmula de média ponderada.

---

## 19. Boas Práticas de Evolução

---

## 20. Jobs Recomendados (Agendamentos / Cron)

Embora o sistema seja event-driven, alguns jobs opcionais aumentam confiabilidade:

| Job | Frequência sugerida | Objetivo | Observações |
|-----|---------------------|----------|-------------|
| Marcar abandonos (`markAbandonedAttempts`) | Cada 15–30 min | Atualizar tentativas inativas para `abandoned` (gera incrementos) | Evita concentrar abandonos apenas quando usuário volta |
| Purgar abandonos (`purgeAbandonedAttempts`) | 1x/dia (madrugada) | Remover tentativas antigas preservando métricas | Incrementa `purged` antes de excluir |
| Reconciliação (`reconcile_user_stats.js`) | 1x/dia ou manual | Garantir que agregados refletem tentativas reais | Usa logs de purga para reconstruir `purged_count` |
| Integridade | 1x/dia | Alertar anomalias (purged_count > abandoned_count) | Pode enviar para log/monitoramento |
| Backup tabela stats | 1x/dia | Preservar histórico antes de alterações maiores | Export CSV ou dump SQL |

### 20.1. Script de Reconciliação

Arquivo: `backend/scripts/reconcile_user_stats.js`

Uso básico:
```bash
node backend/scripts/reconcile_user_stats.js --from 2025-11-01 --to 2025-11-21 --mode rebuild
```

Opções:
- `--from YYYY-MM-DD` / `--to YYYY-MM-DD` (obrigatório): intervalo inclusivo.
- `--user <id>`: limita a um usuário específico.
- `--mode rebuild|merge`: `rebuild` apaga linhas existentes no intervalo, `merge` apenas insere/atualiza.
- `--dry-run`: mostra preview sem persistir.

Regras de reconstrução:
1. Usa `StartedAt` para definir o dia das tentativas (independentemente de finalização).
2. Classifica abandono por `Status='abandoned'` + `StatusReason`.
3. Calcula média de score com tentativas finalizadas (`Status='finished'`).
4. Recompõe `PurgedCount` usando `exam_attempt_purge_log.PurgedAt`.

Segurança:
- Rodar preferencialmente em horário de baixa carga.
- Em caso de falha o script aborta e faz rollback da transação.

Crontab exemplo (Linux):
```cron
# Marcar abandonos a cada 20 min
*/20 * * * * node /app/backend/scripts/mark_abandoned.js >> /var/log/app/cron.log 2>&1

# Purgar abandonos diariamente às 02:10
10 2 * * * node /app/backend/scripts/purge_abandoned.js >> /var/log/app/cron.log 2>&1

# Reconciliação diária às 02:25 (últimos 30 dias)
25 2 * * * node /app/backend/scripts/reconcile_user_stats.js --from $(date -d '30 days ago' +\%F) --to $(date +\%F) --mode merge >> /var/log/app/cron.log 2>&1
```

Windows (Task Scheduler) – ação:
```
Program/script: node
Arguments: backend\scripts\reconcile_user_stats.js --from 2025-11-01 --to 2025-11-21 --mode rebuild
Start in: C:\Path\Para\Projeto
```

---

- Adicionar testes unitários para o serviço (verificar média ponderada após várias finalizações).
- Auditar logs de erro dos incrementos para garantir integridade.
- Considerar soft-delete lógico para tentativas purgadas se precisar auditoria futura.
- Expor versão da API de estatísticas para mudanças compatíveis.

---

Fim do documento.
