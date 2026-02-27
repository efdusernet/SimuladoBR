# Tutorial — Instalar SimuladosBR do zero em VPS com CloudPanel

**Última revisão:** 2026-02-27

## Nota importante sobre Ubuntu 25.10
O **CloudPanel não lista Ubuntu 25.10 como sistema suportado**. Na documentação oficial de requisitos/instalação ("Other"), os Ubuntu suportados são **24.04 LTS** e **22.04**.

- Se você **precisa usar CloudPanel**, escolha **Ubuntu 24.04 LTS** (recomendado) ou **Ubuntu 22.04**.
- Se você **insistir em Ubuntu 25.10**, o caminho mais seguro é **não usar CloudPanel** e seguir um setup manual (ver [deploy/ONE_VPS_SETUP.md](../deploy/ONE_VPS_SETUP.md)).

A partir daqui, o tutorial assume **Ubuntu 24.04 LTS + CloudPanel**.

---

## 0) Pré-requisitos (antes de começar)
- VPS “limpo” (sem serviços) com acesso root.
- DNS:
  - `A` record do seu domínio (ex.: `www.simuladorbr.com.br`) apontando para o IP do VPS.
- Especificação recomendada para 120+ simultâneos com Postgres no mesmo VPS:
  - 8 vCPU / 16 GB RAM / 320 GB NVMe.

---

## 1) Acessar o servidor
Do seu computador:

```bash
ssh root@SEU_IP
```

---

## 2) Atualizar o sistema e instalar dependências básicas

```bash
apt update && apt -y upgrade
apt -y install curl wget sudo ufw git
```

---

## 3) Instalar o CloudPanel
A instalação oficial ("Other") usa um script baixado e validado por sha256.

```bash
curl -sS https://installer.cloudpanel.io/ce/v2/install.sh -o install.sh
```

A própria doc do CloudPanel fornece o hash esperado; confira com o que estiver no site no momento. Exemplo (verifique o valor no dia):

```bash
echo "<HASH_DA_DOC> install.sh" | sha256sum -c
```

Execute o instalador escolhendo um engine (CloudPanel pede MySQL/MariaDB para o painel; o **SimuladosBR usa PostgreSQL** e será instalado depois):

```bash
sudo DB_ENGINE=MYSQL_8.4 bash install.sh
```

---

## 4) Primeiro acesso ao CloudPanel e hardening
- Acesse: `https://SEU_IP:8443`
- Crie o usuário admin imediatamente.

Recomendação de segurança:
- Libere a porta `8443` apenas para o seu IP enquanto configura.
- Depois, mantenha `80`/`443` abertos para o público e restrinja `8443`.

Exemplo de UFW (ajuste seu IP):

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw allow from SEU_IP_PUBLICO to any port 8443 proto tcp
ufw enable
```

---

## 5) Criar o site no CloudPanel (Reverse Proxy)
No CloudPanel:
- **Add Site** → **Reverse Proxy**
- Domain: `www.simuladorbr.com.br`
- Reverse Proxy URL: `http://127.0.0.1:3000`

Depois:
- Em **SSL/TLS**, emita certificado Let’s Encrypt para o domínio.

> Isso faz o CloudPanel/Nginx cuidar de SSL, HTTP→HTTPS e proxy para o Node.

---

## 6) Instalar Node.js 20 + PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt -y install nodejs
npm i -g pm2
```

---

## 7) Instalar PostgreSQL, Redis e PgBouncer

```bash
apt -y install postgresql postgresql-contrib redis-server pgbouncer
systemctl enable postgresql redis-server pgbouncer
systemctl start postgresql redis-server
```

---

## 8) Criar bancos e usuários no PostgreSQL
Entre no psql:

```bash
sudo -u postgres psql
```

Crie DB/usuários (exemplo):

```sql
CREATE DATABASE "Simulados";
CREATE USER simulados_user WITH PASSWORD 'TROQUE_POR_SENHA_FORTE';
GRANT ALL PRIVILEGES ON DATABASE "Simulados" TO simulados_user;

CREATE DATABASE "ChatService";
GRANT ALL PRIVILEGES ON DATABASE "ChatService" TO simulados_user;
```

Saia com `\q`.

---

## 9) Configurar PgBouncer (porta 6432)
Objetivo: o app conecta em **PgBouncer** (6432) e o PgBouncer reutiliza conexões com o Postgres (5432).

1) Copie o template do repo para o local do PgBouncer:

- Arquivo base: [deploy/pgbouncer/pgbouncer.ini.example](../deploy/pgbouncer/pgbouncer.ini.example)

No VPS:

```bash
cp /caminho/do/repo/deploy/pgbouncer/pgbouncer.ini.example /etc/pgbouncer/pgbouncer.ini
```

Edite para garantir:
- `listen_addr = 127.0.0.1`
- `listen_port = 6432`
- `pool_mode = session`

2) Configurar autenticação simples (md5)

No `/etc/pgbouncer/pgbouncer.ini`, ajuste:
- `auth_type = md5`
- `auth_file = /etc/pgbouncer/userlist.txt`

Gerar hash md5 (formato exigido pelo PgBouncer):

```bash
USERNAME="simulados_user"
PASSWORD="TROQUE_POR_SENHA_FORTE"
HASH=$(echo -n "${PASSWORD}${USERNAME}" | md5sum | awk '{print $1}')
echo "\"${USERNAME}\" \"md5${HASH}\"" | sudo tee /etc/pgbouncer/userlist.txt
```

Reinicie:

```bash
systemctl restart pgbouncer
systemctl status pgbouncer --no-pager
```

---

## 10) Configurar Redis (sessões)
Por padrão, Redis já fica em localhost. O que importa é ligar no app:
- `USE_REDIS=true`
- `REDIS_URL=redis://127.0.0.1:6379`

---

## 11) Fazer deploy do código
Exemplo usando `/opt/simuladosbr`:

```bash
mkdir -p /opt/simuladosbr
cd /opt/simuladosbr

git clone <URL_DO_SEU_REPO> .
```

Instalar dependências:

```bash
cd /opt/simuladosbr/frontend
npm install
npm run build

cd /opt/simuladosbr/chat-service
npm install

cd /opt/simuladosbr/backend
npm install
```

---

## 12) Configurar variáveis de ambiente (produção)
### Backend
Crie/edite `/opt/simuladosbr/backend/.env` (não comitar) com pelo menos:

```dotenv
NODE_ENV=production
PORT=3000

APP_BASE_URL=https://www.simuladorbr.com.br
FRONTEND_URL=https://www.simuladorbr.com.br

# Postgres via PgBouncer
DB_NAME=Simulados
DB_USER=simulados_user
DB_PASSWORD=TROQUE_POR_SENHA_FORTE
DB_HOST=127.0.0.1
DB_PORT=6432
PGBOUNCER=true

# Pool por processo (bom default)
DB_POOL_MAX=10
DB_POOL_MIN=0
DB_POOL_ACQUIRE_MS=30000
DB_POOL_IDLE_MS=10000

# Redis
USE_REDIS=true
REDIS_URL=redis://127.0.0.1:6379

# Segurança
JWT_SECRET=GERE_UM_SECRET_FORTE

# Gemini
GEMINI_API_KEY=SUA_CHAVE
GEMINI_MODEL=gemini-2.5-flash

# Chat embutido no mesmo Node (recomendado para simplificar)
CHAT_SERVICE_EMBED=true
CHAT_SERVICE_HOST=www.simuladorbr.com.br
```

### Chat-service
Crie/edite `/opt/simuladosbr/chat-service/.env` com:

```dotenv
NODE_ENV=production
PORT=4010

# Postgres via PgBouncer
DATABASE_URL=postgres://simulados_user:TROQUE_POR_SENHA_FORTE@127.0.0.1:6432/ChatService

# Token admin do painel do chat-service
ADMIN_TOKEN=TROQUE_POR_UM_TOKEN_FORTE

# CORS para o domínio do app
CORS_ORIGINS=https://www.simuladorbr.com.br
```

> Mesmo em modo embutido, manter o `.env` do chat-service é útil porque o backend carrega esse arquivo quando `CHAT_SERVICE_EMBED=true`.

---

## 13) Migrar bancos (SQL) e iniciar
### Backend (SQL do SimuladosBR)

```bash
cd /opt/simuladosbr/backend
npm run db:apply-sql
```

### Chat-service (migrations)

```bash
cd /opt/simuladosbr/chat-service
npm run migrate
```

### Subir o backend com PM2

```bash
cd /opt/simuladosbr/backend
pm2 start index.js --name simuladosbr --instances 4
pm2 save
pm2 startup
```

---

## 14) Validar
- Acesse `https://www.simuladorbr.com.br`
- Verifique:
  - login
  - criação/retomada de exame
  - chat widget (`/chat/widget/chat-widget.js`)

---

## Troubleshooting rápido
- 502 no domínio: confirme `pm2 status` e se o Node está ouvindo em `127.0.0.1:3000`.
- Sessões “somem”: confirme `USE_REDIS=true` e `redis-cli ping`.
- Erro de DB: confirme PgBouncer em `:6432` e Postgres em `:5432`.
