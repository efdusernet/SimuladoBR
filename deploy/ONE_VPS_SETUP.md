# Setup (1 VPS) — SimuladosBR + Postgres + Redis + PgBouncer

Objetivo: rodar tudo em **um único VPS** (backend + frontend + chat + banco + cache) com uma baseline robusta para ~120+ usuários simultâneos.

> Importante: **não** comite segredos. Qualquer credencial que já tenha ido para o Git deve ser considerada **comprometida** e rotacionada.

## Tamanho de VPS sugerido

- **8 vCPU / 16 GB RAM / NVMe** (ex.: 160–320 GB)

## Portas expostas (firewall)

- 22 (SSH)
- 80/443 (HTTP/HTTPS)

Postgres/Redis/PgBouncer ficam **apenas localhost**.

## 1) Instalar dependências (Ubuntu 22.04/24.04)

```bash
sudo apt update
sudo apt install -y nginx git ufw

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Postgres + Redis + PgBouncer
sudo apt install -y postgresql postgresql-contrib redis-server pgbouncer

# PM2
sudo npm i -g pm2
```

## 2) Banco: Postgres local

Crie o DB e o usuário (exemplo; troque por valores reais apenas no servidor):

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE "Simulados";
CREATE USER simulados_user WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE "Simulados" TO simulados_user;
```

## 3) Redis local (sessões)

```bash
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

## 4) PgBouncer local (pooling)

Templates no repo:

- [deploy/pgbouncer/pgbouncer.ini.example](deploy/pgbouncer/pgbouncer.ini.example)
- [deploy/pgbouncer/userlist.txt.example](deploy/pgbouncer/userlist.txt.example)

Regras importantes:

- `listen_addr = 127.0.0.1`
- `listen_port = 6432`
- `pool_mode = session` (default mais compatível com ORMs)

Instalação sugerida (no VPS):

```bash
sudo cp deploy/pgbouncer/pgbouncer.ini.example /etc/pgbouncer/pgbouncer.ini
sudo cp deploy/pgbouncer/userlist.txt.example /etc/pgbouncer/userlist.txt

sudo chown pgbouncer:pgbouncer /etc/pgbouncer/pgbouncer.ini /etc/pgbouncer/userlist.txt
sudo chmod 640 /etc/pgbouncer/userlist.txt

sudo systemctl enable pgbouncer
sudo systemctl restart pgbouncer
```

## 5) Variáveis de ambiente (produção)

### Backend (`backend/.env` no servidor)

```dotenv
NODE_ENV=production
PORT=3000

# Postgres via PgBouncer
DB_NAME=Simulados
DB_USER=simulados_user
DB_PASSWORD=CHANGE_ME_STRONG_PASSWORD
DB_HOST=127.0.0.1
DB_PORT=6432
PGBOUNCER=true

# Pool por processo Node (bom default quando há PgBouncer)
DB_POOL_MAX=10
DB_POOL_MIN=0
DB_POOL_ACQUIRE_MS=30000
DB_POOL_IDLE_MS=10000

# Redis sessões
USE_REDIS=true
REDIS_URL=redis://127.0.0.1:6379

# URLs
APP_BASE_URL=https://www.simuladorbr.com.br
FRONTEND_URL=https://www.simuladorbr.com.br

# Segurança
JWT_SECRET=CHANGE_ME_64_HEX_OR_LONG_RANDOM

# Gemini
GEMINI_API_KEY=CHANGE_ME
GEMINI_MODEL=gemini-2.5-flash
```

Opcional: chat embutido no mesmo processo Node (quando aplicável no seu setup):

```dotenv
CHAT_SERVICE_EMBED=true
CHAT_SERVICE_HOST=www.simuladorbr.com.br
```

### Chat-service (`chat-service/.env` no servidor, se necessário)

Se você roda o chat-service separado (ou precisa dele configurado), use `DATABASE_URL` apontando para o PgBouncer:

```dotenv
DATABASE_URL=postgres://simulados_user:CHANGE_ME_STRONG_PASSWORD@127.0.0.1:6432/ChatService
CORS_ORIGINS=https://www.simuladorbr.com.br
```

## 6) Subir a aplicação (PM2)

```bash
git clone <seu-repo> simuladosbr
cd simuladosbr

cd backend
npm install
npm run db:apply-sql

# Para 8 vCPU, um bom default é 4 processos
pm2 start index.js --name simuladosbr --instances 4
pm2 save
pm2 startup
```

## 7) Nginx (proxy + WebSocket)

Crie `/etc/nginx/sites-available/simuladosbr`:

```nginx
server {
  listen 80;
  server_name www.simuladorbr.com.br;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket upgrade (necessário para /chat/v1/admin/ws)
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Ative:

```bash
sudo ln -s /etc/nginx/sites-available/simuladosbr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 8) HTTPS (Let’s Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d www.simuladorbr.com.br
```

## 9) Firewall básico

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## Defaults escolhidos (por quê)

- Redis ligado: mantém sessões/estado resilientes a restart.
- PgBouncer: reduz risco de estourar conexões do Postgres.
- Vários processos Node: melhora throughput; dimensione `DB_POOL_MAX` pensando no total de conexões ao PgBouncer.
