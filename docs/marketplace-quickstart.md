# Marketplace (Opção B) — Quickstart

Este guia é um atalho para subir a **segunda base** (Marketplace DB) e aplicar as migrations iniciais.

## 1) Configurar env vars

Edite `backend/.env` (recomendado) e configure **uma** opção:

> Importante: prefira `MARKETPLACE_DB_URL`.
> Em algumas máquinas, `DATABASE_URL` já existe no ambiente (ex.: chat-service) e pode fazer o backend apontar para o banco errado.

### Opção A: URL única

- `MARKETPLACE_DB_URL=postgres://user:pass@host:5432/SimuladosMarketplace`
- `MARKETPLACE_DB_SSL=false`

### Opção B: variáveis separadas

- `MARKETPLACE_DB_NAME=SimuladosMarketplace`
- `MARKETPLACE_DB_USER=postgres`
- `MARKETPLACE_DB_PASSWORD=...`
- `MARKETPLACE_DB_HOST=localhost`
- `MARKETPLACE_DB_PORT=5432`
- `MARKETPLACE_DB_SSL=false`

## 2) Criar o banco (PostgreSQL)

Crie o database vazio (exemplo):

- `createdb SimuladosMarketplace`

## 3) Aplicar migrations

Dentro de `backend/`:

- `npm run db:apply-sql:marketplace`

Dica: depois de subir o backend, valide o banco conectado em runtime (admin):

- `GET /api/v1/admin/marketplace/access/debug/db`

Isso executa os scripts em `backend/sql_marketplace/` em ordem crescente.

## 4) Verificação rápida

Se `SEQUELIZE_LOG=true`, o runner imprime a configuração segura e confirma conexão.

---

Docs detalhado: [docs/marketplace-segunda-base.md](docs/marketplace-segunda-base.md)
