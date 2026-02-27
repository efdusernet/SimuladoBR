# Deploy em VPS (genérico)

Este guia assume uma VPS Linux (qualquer distro), acesso SSH e um Postgres acessível (local na VPS ou gerenciado).

## Visão geral

Você vai:

1) instalar Node.js e um process manager (PM2)
2) configurar variáveis de ambiente (sem commitar `.env`)
3) rodar migrações (`npm run migrate`)
4) subir o serviço (`npm run start`) e mantê-lo no ar
5) (opcional, recomendado) colocar Nginx na frente com HTTPS e suporte a WebSocket

## 1) Preparar o servidor

- Atualize pacotes da distro.
- Instale Node.js LTS.
- Instale Git (se for clonar) e build tools (quando necessário).

## 2) Postgres

Opção A (recomendado): Postgres gerenciado (RDS/Supabase/Neon/etc)

- Use o `DATABASE_URL` fornecido pelo provedor.
- Ajuste `PGSSLMODE` conforme recomendado pelo provedor (comum: `require` ou `verify-full`).

Opção B: Postgres na VPS

- Instale Postgres.
- Crie database e usuário.
- Garanta firewall e bind apenas no necessário.

## 3) Obter e preparar o app

- Clone o repositório na VPS.
- Entre na pasta do projeto.
- Instale dependências:

```bash
npm ci
```

Se não tiver lockfile, use `npm install`.

## 4) Variáveis de ambiente

Configure variáveis (exemplos; use seus próprios valores):

- `NODE_ENV=production`
- `PORT=4010` (ou outro)
- `DATABASE_URL=...`
- `PGSSLMODE=disable|require|verify-full`
- `CORS_ORIGINS=https://www.simuladorbr.com.br`

Admin:

- `ADMIN_TOKEN=...` (token bootstrap)
- (opcional) `ADMIN_TOKENS=Nome=token,...`
- (opcional) `ADMIN_TOKEN_PEPPER=...`
- (opcional) `ADMIN_TOKEN_ENCRYPTION_KEY=...` (32 bytes)

SMTP (se for usar convites):

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`

Onde colocar:

- preferível: variáveis no ambiente do process manager (PM2/systemd)
- alternativa: arquivo `.env` no servidor (fora do git)

## 5) Rodar migrações

Antes de subir em produção:

```bash
npm run migrate
```

## 6) Subir com PM2

Instalar PM2:

```bash
npm install -g pm2
```

Subir (exemplo):

```bash
pm2 start "npm run start" --name chat-service
pm2 save
pm2 startup
```

Valide:

- `curl http://127.0.0.1:4010/health`

## 7) Nginx (recomendado)

Coloque Nginx como reverse proxy para HTTPS e WebSocket.

Pontos obrigatórios:

- encaminhar tráfego HTTP para o Node
- habilitar WebSocket para `/v1/admin/ws`

Exemplo de bloco (ajuste domínio/portas):

```nginx
server {
  server_name www.simuladorbr.com.br;

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

Depois, habilite HTTPS (Let’s Encrypt/certbot ou seu provedor).

## 8) Checklist de validação

- `GET /health` responde ok
- widget carrega: `GET /widget/chat-widget.js`
- painel abre: `/admin/`
- WebSocket do painel funciona (se proxy ativo)
- CORS permite o domínio do SimuladosBR (widget consegue abrir e enviar mensagens)

## 9) Observações de segurança

- Não exponha `/admin` sem HTTPS.
- Tokens de admin/atendente equivalem a senha.
- Se credenciais vazaram (ex.: `.env` compartilhado), rotacione Postgres/SMTP/tokens.
