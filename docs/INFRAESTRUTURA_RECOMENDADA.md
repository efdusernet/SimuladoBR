# Infraestrutura Recomendada (1 VPS) — SimuladosBR

**Versão:** 1.0.0  
**Data:** 2026-02-26  
**Escopo:** Hospedar o SimuladosBR **como está hoje** em **um único VPS**, incluindo backend (Node/Express + frontend), chat-service via `/chat/*`, PostgreSQL, Redis e PgBouncer.

## Objetivo de capacidade
- Alvo: **120+ usuários simultâneos**
- IA: via **Gemini** (chamada externa), **sem GPU**

## Recomendação de VPS (produção)
- **CPU:** 8 vCPU (x86_64)
- **Memória:** 16 GB RAM
- **Disco:** 320 GB SSD/NVMe (preferência NVMe)
- **Rede:** 1 Gbps (ou franquia alta)
- **Sistema operacional:** Ubuntu 22.04 LTS ou 24.04 LTS

> Observação: 4 vCPU / 8 GB pode funcionar em cenários mais leves, mas com 120+ simultâneos e Postgres no mesmo VPS tende a ficar no limite.

## Componentes do sistema (no mesmo VPS)
- **Nginx**: reverse proxy + TLS + WebSocket
- **Node.js 20**: SimuladosBR (API + frontend)
- **PostgreSQL**: banco principal (local)
- **Redis**: sessões (local)
- **PgBouncer**: pool de conexões Postgres (local)
- **Certbot/Let’s Encrypt**: HTTPS

## Portas e rede
### Portas expostas publicamente
- `22/tcp` — SSH
- `80/tcp` — HTTP
- `443/tcp` — HTTPS

### Portas internas (somente localhost / rede privada)
- `3000/tcp` — Node (upstream do Nginx)
- `5432/tcp` — PostgreSQL
- `6379/tcp` — Redis
- `6432/tcp` — PgBouncer

## Requisitos de proxy (chat)
- O app monta o **chat-service** via reverse-proxy em `/chat/*`.
- Deve suportar WebSocket admin em **`/chat/v1/admin/ws`**.
- Recomendação: manter chat no mesmo host (embedded ou processo separado), mas acessível ao usuário final sempre por `/chat/*`.

## Configuração recomendada (produção)
### Redis (sessões)
- Habilitar no backend:
  - `USE_REDIS=true`
  - `REDIS_URL=redis://127.0.0.1:6379`

### PgBouncer (pooling)
- PgBouncer escutando em `127.0.0.1:6432` e encaminhando para Postgres em `127.0.0.1:5432`.
- `pool_mode=session` (mais compatível com ORM/Sequelize).

### Backend (Postgres via PgBouncer)
- Apontar backend para PgBouncer:
  - `DB_HOST=127.0.0.1`
  - `DB_PORT=6432`
  - `PGBOUNCER=true`

### Pool do Sequelize (por processo)
- Início recomendado quando usando PgBouncer:
  - `DB_POOL_MAX=10`
  - `DB_POOL_MIN=0`

## Operação e observabilidade
- Process manager: **PM2** ou **systemd** (auto-restart + startup no boot)
- Logs: journald ou arquivos com rotação
- Backups:
  - Dump lógico do Postgres (diário) + retenção
  - Snapshot do VPS (se disponível)
- Monitoramento mínimo:
  - CPU/RAM/disco
  - conexões Postgres (ativas/idle)
  - fila/latência do app

## Checklist de segurança
- HTTPS obrigatório
- SSH com chave (desabilitar senha)
- Firewall/UFW ativo
- Segredos apenas em `.env`/secrets (nunca no repo)

## Anexos
- Guia passo a passo (1 VPS): `deploy/ONE_VPS_SETUP.md`
- Templates PgBouncer:
  - `deploy/pgbouncer/pgbouncer.ini.example`
  - `deploy/pgbouncer/userlist.txt.example`
