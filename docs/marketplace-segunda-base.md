# Marketplace — Opção B (Segunda Base) — Design Doc

Este documento define uma arquitetura para evoluir o SimuladosBR para um **marketplace de pacotes de questões (third-parties)** e múltiplas provas, usando **uma segunda base de dados dedicada ao conteúdo**.

> Objetivo da Opção B: reduzir blast-radius e melhorar governança/compliance do conteúdo de terceiros, mantendo o core (usuários, auth, pagamentos, tentativas) estável.

---

## 1) Escopo

### Metas

- Permitir que vendedores (vendors) publiquem **pacotes de questões** que podem ser comprados e usados no app.
- Garantir **versionamento imutável**: simulado em andamento referencia uma versão específica do pack.
- Isolar conteúdo (questões/alternativas/explicações/assets) em uma base separada, com **backup e restore independentes**.
- Evitar dependências perigosas entre bases (sem “joins cruzados” em runtime).

### Não-metas (por enquanto)

- Multi-tenant por DB (um DB por vendor). A Opção B aqui assume **um DB “marketplace” multi-vendor**.
- Curadoria automatizada via IA como requisito (pode ser plugável depois).
- Motor de pagamentos/checkout multi-moeda (o core já cobre billing; marketplace só integra entitlements).

---

## 2) Visão Geral da Arquitetura

### Bancos

- **Core DB (atual)**
  - Identidade/usuários/admin
  - Sessões/JWT/CSRF
  - Assinaturas, pagamentos, planos
  - Entitlements/licenças (quem tem acesso a qual pack)
  - Tentativas de exame (attempts), respostas, histórico, indicadores

- **Marketplace DB (novo)**
  - Vendors (vendedores)
  - Packs (produto de conteúdo)
  - Versões de pack (imutáveis)
  - Questões, alternativas, explicações, metadados
  - Classificações por prova (exam taxonomy)
  - Importação: staging + logs de validação
  - Assets (referências a arquivos) e metadados

### Regra de Ouro (anti-acoplamento)

- O core **nunca** faz query que dependa de join entre DBs.
- O core armazena referências “leves” (ex.: `pack_id`, `pack_version`, `vendor_id`) e valida direitos.
- O marketplace serve o conteúdo por API interna (ou módulo interno), retornando sempre a versão solicitada.

### Topologia de serviços (fase 1)

- Monólito backend atual com **2 conexões Sequelize**:
  - `dbCore` (já existe)
  - `dbMarketplace` (novo)

> Alternativa futura: extrair marketplace para um serviço separado, mantendo os mesmos contratos de API.

---

## 3) Identidades e IDs (recomendação)

Para evitar colisões e facilitar debug:

- IDs no marketplace podem ser UUID (`uuidv4`) para `vendor`, `pack`, `pack_version`, `question`.
- No core, entitlements podem manter:
  - `vendor_id` (UUID)
  - `pack_id` (UUID)
  - `pack_version` (string/semver) **ou** `pack_version_id` (UUID)

Recomendação prática:

- `pack_version_id` (UUID) como chave primária imutável.
- `pack_version` (semver) como campo humano.

---

## 4) Modelo de Dados (Marketplace DB)

Abaixo está um esqueleto; os nomes podem seguir o padrão atual do projeto (ex.: `snake_case` e schema `public`).

### 4.1 vendors

- `vendor_id` (UUID, PK)
- `name` (text)
- `status` (boolean)
- `created_at`, `updated_at`

### 4.2 packs

- `pack_id` (UUID, PK)
- `vendor_id` (UUID, FK vendors)
- `slug` (text, unique per vendor)
- `title` (text)
- `description` (text)
- `language` (text, ex.: `pt-BR`)
- `status` (enum: `draft|review|published|suspended`)
- `created_at`, `updated_at`

### 4.3 pack_versions (imutável)

- `pack_version_id` (UUID, PK)
- `pack_id` (UUID, FK)
- `version` (text, ex.: `1.0.0`)
- `published_at` (timestamp)
- `checksum` (text) — hash do conteúdo normalizado, para auditoria
- `question_count` (int)
- `status` (enum: `published|deprecated`)

**Regra:** uma versão publicada **não é editada**; mudanças criam uma nova versão.

### 4.4 questions

- `question_id` (UUID, PK)
- `pack_version_id` (UUID, FK)
- `prompt` (text)
- `type` (enum: `single|multiple|text`)
- `difficulty` (int 1–5)
- `explanation` (text, opcional)
- `is_math` (boolean)
- `created_at`

### 4.5 question_options

- `option_id` (UUID, PK)
- `question_id` (UUID, FK)
- `label` (text) — “A”, “B”… (opcional)
- `text` (text)
- `is_correct` (boolean)
- `explanation` (text, opcional)

### 4.6 taxonomy (por prova)

Para suportar múltiplas provas sem “hardcode”:

- `exam_catalog` — lista de provas suportadas (PMP, OAB1F, etc.)
- `taxonomy_node` — árvore/tagging (disciplina/domínio/tópico)
- `question_taxonomy` — N:N question ↔ taxonomy

*Nota:* isso pode evoluir para “blueprints” e pesos por prova, mas o marketplace DB deve focar em **classificação do conteúdo**.

### 4.7 importação (staging)

- `import_job`
  - `import_job_id` (UUID)
  - `vendor_id`
  - `pack_id` (nullable na criação)
  - `status` (`uploaded|validated|failed|published`)
  - `created_at`

- `import_row` (opcional)
  - representa linhas do CSV/JSON normalizado para debug

- `import_validation_issue`
  - lista erros/avisos (ex.: alternativa faltando, gabarito inválido, etc.)

---

## 5) Modelo de Dados (Core DB)

O core precisa apenas do mínimo para controle de acesso:

### 5.1 entitlements (licenças)

- `entitlement_id`
- `user_id`
- `vendor_id` (UUID)
- `pack_id` (UUID)
- `pack_version_id` (UUID, opcional; se licenciar sempre “última versão” usar outro modelo)
- `source` (`purchase|admin_grant|subscription_bundle`)
- `starts_at`, `expires_at` (nullable)
- `created_at`

**Recomendação:** licenciar por `pack_version_id` para reprodutibilidade (mesmo conteúdo sempre).

---

## 6) Fluxos

### 6.1 Publicação (vendor → pack)

1. Vendor faz upload (`import_job: uploaded`)
2. Backend valida (estrutura, campos, duplicatas, limites) (`validated|failed`)
3. UI mostra preview + issues
4. Ao publicar:
   - gera `pack_version_id`
   - persiste questões e alternativas em tabelas finais
   - grava `checksum` e `question_count`

### 6.2 Compra/ativação

1. Usuário compra no core (ou admin libera)
2. Core grava entitlement
3. UI lista packs disponíveis consultando core (direitos)
4. Ao iniciar simulado:
   - core resolve `pack_version_id` permitido
   - core pede ao marketplace “N questões dessa versão + filtros”

### 6.3 Execução do simulado

- A tentativa (attempt) e as respostas permanecem no **core DB**.
- O conteúdo da questão é buscado do marketplace por ID + versão.

---

## 7) API (contratos sugeridos)

### Marketplace (interno / admin)

- `POST /api/admin/marketplace/vendors` — cria vendor
- `POST /api/admin/marketplace/vendors/:vendorId/packs` — cria pack
- `POST /api/admin/marketplace/vendors/:vendorId/packs/:packId/import` — upload + dry-run
- `POST /api/admin/marketplace/vendors/:vendorId/packs/:packId/publish` — publica e cria versão
- `GET /api/admin/marketplace/import-jobs/:id` — status e issues

### Store (público, autenticado)

- `GET /api/store/packs` — lista packs que o usuário tem direito (core + enrich via marketplace)
- `GET /api/store/packs/:packId/versions` — versions visíveis

### Integração com Exams

- `POST /api/exams/select` (ou endpoint novo) deve aceitar:
  - `packVersionIds[]` ou `packIds[]` (resolvidos para versions)
  - filtros opcionais (taxonomy)

---

## 8) Configuração e Deploy

### Env vars (proposta)

- Core (já existente): `DB_*`
- Marketplace (novo):
  - `MARKETPLACE_DB_HOST`
  - `MARKETPLACE_DB_PORT`
  - `MARKETPLACE_DB_NAME`
  - `MARKETPLACE_DB_USER`
  - `MARKETPLACE_DB_PASSWORD`
  - opcional: `MARKETPLACE_DB_SSL`

Ou alternativa única:

- `MARKETPLACE_DB_URL=postgres://user:pass@host:5432/dbname`

### Migrations

Recomendação:

- manter migrations do marketplace separadas, ex.:
  - `backend/sql_marketplace/` (novo)
  - e um runner que aceita `--db marketplace`

---

## 9) Segurança, Compliance e Moderação

- Vendor deve aceitar termos: garante direitos autorais/licenças do conteúdo.
- Auditoria: `import_job`, `published_at`, `checksum`, usuário/admin responsável.
- Conteúdo sensível:
  - não enviar texto de questões para provedores externos sem flag explícita.
- Anti-abuso:
  - limite de uploads
  - validação de payload (tamanho, MIME, SSRF em imagens/URLs)

---

## 10) Plano de Implementação (incremental)

1. Criar conexão `dbMarketplace` e validação de env vars
2. Criar migrations do marketplace DB (vendors/packs/versions/questions/options)
3. Implementar admin endpoints de import/publish (mesmo que inicialmente só JSON)
4. Implementar entitlements no core DB
5. Ajustar engine de exames para selecionar questões por `pack_version_id`
6. Criar UI mínima de admin para upload/preview/publish

---

## 11) Perguntas em aberto

- Licença “sempre última versão” vs “versão fixa” (impacta entitlements)
- Armazenamento de assets (DB vs filesystem vs object storage)
- Taxonomia por prova: schema único (genérico) vs por-exam (config)

