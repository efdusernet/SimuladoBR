# SimuladosBR - Notes

Data: 2025-11-02

Este arquivo consolida o estado atual do projeto, decisões tomadas, endpoints relevantes e próximos passos, para facilitar a continuidade entre sessões.

## Estado atual (resumo)

- Suporte a múltiplos exames com tipos definidos no banco (tabela `exam_type`).
- Questões vinculadas a um tipo de exame (FK 1:N): coluna `questao.exam_type_id`.
- “Tipo de questão” por questão (rádio/checkbox) via `questao.tiposlug` ou `questao.multiplaescolha`; front renderiza por questão.
- Esquema extensível para tipos de questão (tabela `question_type` + colunas JSON em `questao`), com persistência de respostas tipadas em `exam_attempt_answer.resposta` (JSONB).
- Páginas admin:
  - `frontend/pages/admin/questionForm.html` — cadastro unitário de questão (rádio/checkbox), exige exam type.
  - `frontend/pages/admin/questionBulk.html` — carga em massa via JSON/XML (com exam type por lote ou por item).
- Mecanismo de migrações SQL simples: `backend/scripts/apply_sql.js` + `npm run db:apply-sql`.
- Endpoints de exame implementados (seleção, início on-demand, obter questão, submissão, pausa) com filtro por `exam_type` quando o tipo vem do DB.

## Migrações e esquema

Arquivos SQL (pasta `backend/sql/`):
- 001..005: `exam_type` e sementes iniciais do contexto de exame.
- 006: `exam_attempt_answer.option_id` nullable.
- 007: `question_type` (catálogo de tipos, UI/data/grading schemas).
- 008: altera `questao` (colunas: `tiposlug`, `interacaospec`, `correctspec`, `scoringpolicy`).
- 009: adiciona `exam_attempt_answer.resposta` (JSONB) para respostas tipadas.
- 010: seed para `question_type` com `single` e `multi`.
- 011: backfill `questao.tiposlug` a partir de `multiplaescolha`.
- 012: adiciona `questao.exam_type_id` (FK p/ `exam_type`) e índice.

Aplicação de migrações (PowerShell):
```
npm --prefix "c:\Users\efdus\OneDrive\App PMP\SimuladosBR\backend" run db:apply-sql
```

Observação: permissões de schema do Postgres precisam permitir CREATE/ALTER no schema `public` para o usuário do `.env`.

## Endpoints relevantes

- GET `/api/exams/types` — lista tipos de exame do DB (com fallback opcional ao registry interno se habilitado).
- POST `/api/exams/select` — seleciona questões e retorna sessão + questões inline (filtro por dominios/áreas/grupos e por exam type; cabeçalho/param `examType`).
- POST `/api/exams/start-on-demand` — cria sessão e persiste o blueprint/ordem; filtro por exam type aplicado.
- GET `/api/exams/:sessionId/question/:index` — busca questão por índice da sessão (respostas/explicação).
- POST `/api/exams/submit` — submissão (parcial ou final) de respostas.
- POST `/api/questions` — cria questão unitária com alternativas; exige exam type.
- POST `/api/questions/bulk` — carga em massa (JSON no body ou arquivo JSON/XML via multipart; campo `file`).
- Meta (usados no filtro do setup): `/api/meta/dominios`, `/api/meta/grupos`, `/api/meta/areas`.

## Formatos para carga em massa (JSON/XML)

1) JSON (objeto com lote)
```
{
  "examType": "pmp",                 // ou examTypeSlug / examTypeId
  "iddominio": 1,                     // (opcional) padrão do lote
  "codareaconhecimento": 1,
  "codgrupoprocesso": 1,
  "dica": "opcional",
  "questions": [
    {
      "descricao": "Enunciado...",     // obrigatório
      "tiposlug": "single",            // ou "multi"
      "options": [
        { "descricao": "A", "correta": true },
        { "descricao": "B" }
      ],
      "explicacao": "opcional",
      // overrides do lote
      "iddominio": 1,
      "codareaconhecimento": 2,
      "codgrupoprocesso": 3
    }
  ]
}
```

2) JSON (array)
- Envie `[{...}, {...}]` — cada item precisa ter `examTypeSlug` ou `examTypeId` (a menos que você esteja usando um wrapper de lote que define isso).

3) XML (arquivo)
```
<questions examType="pmp">
  <question>
    <descricao>Enunciado...</descricao>
    <tipo>single</tipo>
    <alternativas>
      <alternativa correta="true">Texto A</alternativa>
      <alternativa>Texto B</alternativa>
    </alternativas>
    <explicacao>Opcional</explicacao>
  </question>
</questions>
```

Notas:
- `examType` é obrigatório (no lote ou por item). Aceito por slug (ex.: `pmp`) ou por id numérico.
- Para `single`, se vier mais de uma alternativa correta, somente a primeira é mantida como correta.
- Se `explicacao` estiver presente, tentamos gravar em `explicacaoguia` (falha não aborta a questão).

## Frontend

- `pages/examSetup.html`: permite escolher exam type, quantidade, e filtros (domínios, grupos, áreas); chama `/api/exams/select` com `examType` e `onlyCount` para pré-checagem.
- `script_exam.js`: renderiza cada questão com `type` por questão (rádio/checkbox), mantém respostas e autosave local;
- `pages/admin/questionForm.html`: cadastro unitário com select de exam type; exige exam type.
- `pages/admin/questionBulk.html`: upload de JSON/XML; exam type por lote (select) ou por item.

## Segurança (pendente)

- Proteger `/api/questions` e `/api/questions/bulk` (e páginas admin) com autenticação/autorização (ex.: JWT + role admin; ou chave de API; ou IP allowlist temporário).
- Rate limit já existe na stack; manter limites de arquivo (10 MB) no upload.

## Observações de dependências

- Upload de arquivos usando Multer (recomendado manter em versão 2.x por motivos de segurança).
- Parser de XML: `fast-xml-parser`.
- DB: Postgres via Sequelize; migrações por SQL manual.

## Questões Pré-Teste e Distribuição ECO (Implementado Nov 2025)

### Conceito
Para exames completos (modo `full`, 180 questões), o sistema agora:
1. Seleciona **5 questões pré-teste** (`is_pretest = TRUE`) que **não contam para pontuação**.
2. Seleciona **175 questões regulares** distribuídas proporcionalmente pela **tabela ECO** (campo `share` por `id_dominio`).

### Estrutura de Dados

**Tabela `questao`:**
- `is_pretest BOOLEAN NOT NULL DEFAULT FALSE` — marca questões experimentais.

**Tabela `exam_attempt_question`:**
- `IsPreTest BOOLEAN NOT NULL DEFAULT FALSE` — marca questões pré-teste no attempt.

**Tabela `eco`:**
- `id_dominio INTEGER` — FK para `dominiogeral` (campo `iddominiogeral` em `questao`).
- `share NUMERIC` — percentual ou peso da distribuição (ex: `20` = 20% das 175 questões).

### Algoritmo de Seleção (Full Exam)

1. **Pré-teste (5 questões):**
   - `SELECT ... WHERE is_pretest = TRUE ORDER BY random() LIMIT 5`
   - Exclui questões já respondidas pelo usuário (se `onlyNew` ativo).

2. **Regular (175 questões):**
   - Busca shares da tabela `eco`.
   - Calcula alocação por domínio: `(share / soma_total) * 175`.
   - Aplica arredondamento com redistribuição de restos por fração maior.
   - Para cada domínio, seleciona questões: `WHERE is_pretest = FALSE AND iddominiogeral = X`.
   - Se faltar questões em algum domínio, completa com top-up geral.

3. **Combinação:**
   - Embaralha pretest + regular para ordem aleatória.
   - Persiste em `exam_attempt_question` com flag `IsPreTest`.

### Cálculo de Pontuação

Na submissão (`/api/exams/submit`):
1. Busca flags `IsPreTest` de `exam_attempt_question`.
2. Exclui questões pré-teste do contador `totalCorrect`.
3. Calcula `scorePercent = (totalCorrect / scorableCount) * 100` onde `scorableCount = 175`.
4. Persiste `Total = 175` (não 180) em `exam_attempt`.

**Resposta JSON inclui:**
- `totalQuestions: 180` — total incluindo pretest.
- `totalScorableQuestions: 175` — questões que contam para pontuação.
- `details[].isPretest: boolean` — flag por questão.

### Fallbacks e Compatibilidade

- Se tabela `eco` não existir ou estiver vazia: seleciona 175 aleatórias sem distribuição.
- Se não houver 5 questões pré-teste disponíveis: usa quantas houver (não bloqueia exame).
- Try-catch na busca de `IsPreTest` garante compatibilidade com DBs sem a coluna.
- Modo legado (quiz, não-full) mantém seleção aleatória simples sem pretest.

### Commits Relacionados
- `bd6a340` — feat: implement pretest questions and ECO-based distribution
- `743dbab` — fix: exclude pretest questions from scoring calculation

## Próximos passos sugeridos

1) Segurança admin
- Exigir autenticação/admin para `/api/questions` e `/api/questions/bulk` e restringir acesso às páginas admin.

2) Postman
- Adicionar requests na coleção para `/api/questions` e `/api/questions/bulk` (exemplos JSON e XML), facilitando testes.

3) Engine de correção para tipos avançados
- Implementar correção para questões não baseadas em alternativas (usar `questao.correctspec` + `exam_attempt_answer.resposta`).

4) Telemetria e auditoria
- Logar operações de criação/carga em massa (quem, quando, quantas).

5) Melhorias de UX admin
- Validar campos e pré-visualização de alternativas; realçar conflitos (ex.: mais de uma correta para single).

6) Gestão de Pré-Teste
- Interface admin para marcar/desmarcar questões como pré-teste.
- Dashboard de análise estatística para promover questões pré-teste (p-value, discriminação).
- Configurar distribuição de pré-teste por domínio (evitar concentração).

## Como testar rápido

- Backend:
```
# Iniciar backend
npm --prefix "c:\\Users\\efdus\\OneDrive\\App PMP\\SimuladosBR\\backend" start
```

- Cadastro unitário (admin): abrir `frontend/pages/admin/questionForm.html`, escolher exam type, preencher e salvar.
- Carga em massa (admin): abrir `frontend/pages/admin/questionBulk.html`, escolher modo, exam type e enviar.
- Simulado: abrir `frontend/pages/examSetup.html`, escolher exam type e filtros, iniciar; confirmar que só questões do tipo selecionado aparecem.

---
Manter este arquivo atualizado a cada mudança significativa ajuda a garantir continuidade entre sessões e alinhamento de decisões.
