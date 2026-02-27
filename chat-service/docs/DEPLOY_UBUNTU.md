# Deploy em Ubuntu (Nginx + systemd)

Este guia é uma receita “padrão Ubuntu” para produção.

## 0) Suposições

- Ubuntu 22.04+ (ou similar)
- Domínio apontado para a VPS (ex.: `www.simuladorbr.com.br`)
- Postgres remoto (recomendado) ou local

## 1) Instalar dependências

- Node.js LTS
- Nginx
- (opcional) Certbot

## 2) Criar usuário e diretório do app

- Crie um usuário de serviço (opcional, recomendado).
- Coloque o código em algo como `/opt/chat-service`.

## 3) Configurar variáveis de ambiente

Recomendação: não use `.env` no repo para produção; use um arquivo Environment do systemd.

Crie um arquivo, por exemplo:

- `/etc/chat-service.env`

Com variáveis (exemplos, sem segredos):

- `NODE_ENV=production`
- `PORT=4010`
- `DATABASE_URL=...`
- `PGSSLMODE=require`
- `CORS_ORIGINS=https://www.simuladorbr.com.br`
- `ADMIN_TOKEN=...`

Ajuste permissões para evitar leitura indevida.

## 4) Instalar deps e rodar migrações

Na pasta do projeto:

```bash
npm ci
npm run migrate
```

## 5) Criar unit do systemd

Crie:

- `/etc/systemd/system/chat-service.service`

Exemplo:

```ini
[Unit]
Description=chat-service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/chat-service
EnvironmentFile=/etc/chat-service.env
ExecStart=/usr/bin/node /opt/chat-service/src/index.js
Restart=always
RestartSec=3

# Hardening básico
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/chat-service

[Install]
WantedBy=multi-user.target
```

Ativar:

```bash
systemctl daemon-reload
systemctl enable --now chat-service
systemctl status chat-service
```

Health check local:

```bash
curl http://127.0.0.1:4010/health
```

## 6) Nginx (reverse proxy + WebSocket)

Se você expõe o chat-service para o SimuladosBR via `https://www.simuladorbr.com.br/chat/*`, você pode:

- manter o chat-service **apenas interno** em `http://127.0.0.1:4010` (recomendado)
- e configurar o Nginx do domínio principal para fazer o mount em `/chat`

Exemplo de bloco (dentro do site do domínio principal):

```nginx
server {
  server_name www.simuladorbr.com.br;

  # Garanta que /chat redireciona para /chat/
  location = /chat { return 301 /chat/; }

  # Mount do chat-service em /chat/* (strip do prefixo /chat/)
  location /chat/ {
    proxy_pass http://127.0.0.1:4010/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # WebSocket do painel admin (sob /chat)
  location /chat/v1/admin/ws {
    proxy_pass http://127.0.0.1:4010/v1/admin/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

Habilitar:

```bash
ln -s /etc/nginx/sites-available/chat-service /etc/nginx/sites-enabled/chat-service
nginx -t
systemctl reload nginx
```

## 7) HTTPS

Recomendado: Let’s Encrypt com certbot.

Após emitir o certificado, ajuste o server block para TLS (o certbot costuma fazer isso automaticamente).

## 8) Validação

- `https://www.simuladorbr.com.br/chat/health` ok
- `https://www.simuladorbr.com.br/chat/widget/chat-widget.js` carrega
- `https://www.simuladorbr.com.br/chat/admin/` abre
- painel recebe atualizações (WS) via `/chat/v1/admin/ws`
- widget funciona no SimuladosBR (CORS e domínio correto)

## 9) Notas importantes

- Se o painel `/admin` for servido em outro domínio/porta, inclua esse origin em `CORS_ORIGINS`.
- CORS precisa conter a origem do SimuladosBR (o domínio do site, não a URL completa).
- Tokens e senhas devem ser rotacionados se houver vazamento.
