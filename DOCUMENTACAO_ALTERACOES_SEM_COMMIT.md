# Documentação das alterações (sem commit)

Data: 2026-02-03

Este arquivo descreve **todas as alterações locais** ainda **não commitadas** neste workspace, incluindo arquivos **modificados** e **novos (untracked)**.

## 1) Inventário de arquivos alterados

### Modificados
- `backend/routes/questions.js`
- `frontend/pages/exam.html`
- `frontend/pages/examFull.html`
- `frontend/pages/examSetup.html`
- `frontend/script_exam.js`

### Novos (untracked)
- `backend/controllers/questionFeedbackController.js`
- `backend/sql/058_create_questao_like.sql`

## 2) Backend — feedback (like/dislike) por questão

### 2.1) Migração SQL: tabela `public.questao_like`
Arquivo: `backend/sql/058_create_questao_like.sql`

- Cria (se não existir) a tabela `public.questao_like` para persistir voto por **(questão, usuário)**.
- Colunas:
  - `idquestao` (FK para `public.questao(id)`)
  - `idusario` (FK para `public."Usuario"("Id")`)
  - `like` (int, default 0)
  - `dislike` (int, default 0)
- Restrições:
  - PK `(idquestao, idusario)`.
  - **Fallback idempotente**: `CREATE UNIQUE INDEX IF NOT EXISTS questao_like_uq (idquestao, idusario)` para garantir compatibilidade com ambientes onde a tabela já existia **sem PK/índice**.

Motivo do fallback: o endpoint usa `INSERT ... ON CONFLICT (idquestao, idusario)`, que no Postgres exige **constraint/índice unique correspondente**.

### 2.2) Controller: novos endpoints de feedback
Arquivo: `backend/controllers/questionFeedbackController.js`

Implementa 3 handlers (autenticados por sessão):

- `GET /api/questions/:id/feedback`
  - Retorna `{ ok, questionId, likes, dislikes, myVote }`.
  - `myVote`: `1` (like), `-1` (dislike), `0` (neutro).

- `POST /api/questions/:id/feedback` body `{ vote: 1 | -1 | 0 }`
  - `vote = 1`: upsert para like.
  - `vote = -1`: upsert para dislike.
  - `vote = 0`: remove o voto (DELETE).
  - Retorna o mesmo payload do GET.

- `POST /api/questions/feedback/batch` body `{ questionIds: number[] }`
  - Retorna `{ ok, byId }` onde `byId[questionId] = { likes, dislikes, myVote }`.

Validações e erros padronizados:
- `QUESTION_FEEDBACK_TABLE_MISSING`: tabela não existe (necessário rodar migration 058).
- `QUESTION_FEEDBACK_MISSING_UNIQUE`: tabela existe, mas sem índice/unique necessário para `ON CONFLICT` (necessário rodar migration 058).

### 2.3) Rotas
Arquivo: `backend/routes/questions.js`

- Registra as rotas acima sob `router` de questions, todas protegidas por `requireUserSession`.

## 3) Frontend — UX do simulado + grid + marcação + feedback

### 3.1) Setup do simulado: presets de quantidade + resumo mais claro
Arquivo: `frontend/pages/examSetup.html`

- Substitui input livre de quantidade por **presets** (checkbox com comportamento de rádio): 25, 30, 50, 75, 90.
- Regras por plano (baseado em `localStorage.BloqueioAtivado`):
  - Gratuito: mantém apenas 25 e 30 habilitados; presets premium ficam desabilitados com badge.
  - Premium: presets completos.
- Ajusta o resumo:
  - Mostra “questões disponíveis” apenas quando há filtros.
  - Mostra “você vai iniciar com X questões” considerando regras do app e disponibilidade.
- Nova lógica de contagem final ao iniciar:
  - Com filtros: calcula `available` via `onlyCount` e aplica regra de cap mínimo (premium) e caps 15/50/full.
  - Sem filtros: premium pode ir direto para “exame completo” (tela dedicada) quando a escolha implica `FULL_TARGET`.
- Persistência:
  - `localStorage.examQuestionCount` passa a ser preenchido a partir do preset.
  - Mantém o comportamento de `startExam` em `sessionStorage`.

### 3.2) Tela de questões (exam): grid embutido + marcação persistente + thumbs
Arquivo: `frontend/pages/exam.html`

- Adiciona botões na header:
  - “Marcar questão” (`#bmark`)
  - “Grid de questões” (`#bgrid`)
- Adiciona modal `#gridModal` com iframe `#gridFrame` que carrega `grid.html`.
- Implementa persistência de marcação no `localStorage`:
  - Chave por sessão: `questoesMarcadas_${sessionId}` (fallback `questoesMarcadas`).
  - Cada entrada inclui `{ currentIdx, questionNumber, letter, savedAt }`.
  - Mantém a letra sincronizada com a alternativa marcada.
- UX:
  - Estado “ativo” no botão de marcar (`.mark-active`) quando a questão atual está marcada.
  - **Desabilita** marcar e grid até existir sessão ativa + total de questões carregado.
  - `openGrid()` faz guard: se não estiver pronto, exibe toast.
- Troca de ícones “Gostei/Não gostei” por **thumbs up/down** (SVG).
- Define cores do estado pressionado via `aria-pressed`:
  - Like: azul
  - Dislike: vermelho claro
- Endurece o uso de `examQuestionCount` no start:
  - Reforça limites por plano (gratuito/premium) para evitar valores “stale” no localStorage.

### 3.3) Tela de exame completo (examFull): paridade de UX para marcar/grid
Arquivo: `frontend/pages/examFull.html`

- Mesma classe `.mark-active` no botão `#bmark`.
- Mesmo guard para `openGrid()` (toast se não houver sessão/questões).
- Mesma estratégia de habilitar/desabilitar `#bmark` e `#bgrid` conforme sessão ativa.
- Mudança interna de listener: usa event delegation em `#answersForm` para manter sincronização de letra da marcação consistente.

### 3.4) Engine do simulado: feedback persistido via API
Arquivo: `frontend/script_exam.js`

- Evolui o `initFeedback()`:
  - Em vez de só alternar `aria-pressed` localmente, passa a sincronizar com backend.
  - Ao mudar questão, faz `GET /api/questions/:id/feedback` e aplica `myVote`.
  - Ao clicar em like/dislike, faz `POST /api/questions/:id/feedback` com `{ vote }`.
  - UI otimista com fallback para re-sync em caso de erro.
  - Proteção contra race: ignora respostas tardias de questão anterior.
- Headers:
  - Preferência por `window.Auth.getAuthHeaders()` quando disponível.
  - Fallback para `X-Session-Token` (quando existir em `localStorage.sessionToken`).
  - `credentials: 'include'` para cookies.

### 3.5) Engine do simulado: controle de fonte do enunciado com persistência
Arquivo: `frontend/script_exam.js`

- Corrige o controle `Aa`/slider para realmente alterar o tamanho do enunciado (`#questionText`) via CSS vars `--question-font-size` e `--question-line-height`.
- Persiste a preferência em `localStorage` (`ui_question_font_size_px`) e restaura na inicialização.
- Quando há valor manual salvo, impede que o ajuste automático de tipografia sobrescreva a escolha do usuário.

## 4) Notas operacionais

- Para o recurso de feedback funcionar em qualquer ambiente, é obrigatório aplicar a migration:
  - `backend/sql/058_create_questao_like.sql`
- Isso é importante inclusive se a tabela já existir, porque o script garante o índice único necessário.

## 5) Checklist rápido de validação manual

1) Rodar a migration 058 no banco do ambiente.
2) Abrir um simulado em `exam.html`:
   - Confirmar que `Marcar questão` alterna e persiste ao navegar.
   - Abrir o grid e filtrar “Marcadas”.
3) Clicar em thumbs up/down em uma questão:
   - Confirmar mudança de cor e persistência ao avançar/voltar.
   - Confirmar que refresh mantém o estado via GET.
