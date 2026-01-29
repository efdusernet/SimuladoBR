# 🚀 Deploy Guide - SimuladosBR

## Opções de Deployment

### 1. Vercel (Recomendado - Grátis)

**Melhor para:** Frontend + Serverless API

#### Setup Vercel:

```bash
# Instalar Vercel CLI
npm i -g vercel

# Na raiz do projeto
vercel login
vercel
```

#### Configuração (`vercel.json`):
```json
{
  "version": 2,
  "builds": [
    {
      "src": "frontend/**",
      "use": "@vercel/static"
    },
    {
      "src": "backend/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/backend/index.js"
    },
    {
      "src": "/(.*)",
      "dest": "/frontend/$1"
    }
  ],
  "env": {
    "DATABASE_URL": "@database-url",
    "JWT_SECRET": "@jwt-secret",
    "NODE_ENV": "production"
  }
}
```

#### Banco de Dados:
- **Opção 1:** [Supabase](https://supabase.com) - Postgres grátis
- **Opção 2:** [Railway](https://railway.app) - Postgres com $5 de crédito
- **Opção 3:** [Neon](https://neon.tech) - Serverless Postgres grátis

**Custo:** $0/mês (hobby plan)

---

### 2. Railway.app

**Melhor para:** Backend + Banco tudo junto

#### Deploy com Railway:

```bash
# Instalar Railway CLI
npm i -g @railway/cli

# Login e deploy
railway login
railway init
railway up
```

#### Adicionar Postgres:
```bash
railway add postgres
```

Variáveis de ambiente são injetadas automaticamente.

**Custo:** ~$5-10/mês após trial

---

### 3. Render.com

**Melhor para:** Apps fullstack simples

#### Setup Render:

1. Conectar repo GitHub
2. Criar Web Service:
   - **Build:** `cd backend && npm install`
   - **Start:** `cd backend && npm start`
3. Criar PostgreSQL (free tier)
4. Adicionar variáveis de ambiente

**Custo:** $0/mês (free tier com limitações)

---

### 4. VPS Tradicional (DigitalOcean, Linode, AWS EC2)

**Melhor para:** Controle total

#### Setup Ubuntu 22.04:

```bash
# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar PostgreSQL
sudo apt install postgresql postgresql-contrib

# Instalar PM2
sudo npm install -g pm2

# Clonar repo
git clone https://github.com/efdusernet/SimuladoBR.git
cd SimuladoBR/backend
npm install

# Aplicar migrações
npm run db:apply-sql

# Iniciar com PM2
pm2 start index.js --name simuladosbr-api
pm2 startup
pm2 save

# Nginx como reverse proxy
sudo apt install nginx
```

#### Nginx config (`/etc/nginx/sites-available/simuladosbr`):
```nginx
server {
    listen 80;
    server_name seudominio.com.br;
    
    # Frontend
    root /var/www/simuladosbr/frontend;
    index index.html;
    
    # API
    location /api {
        # upstream interno do Node (mesma máquina)
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
# Ativar site
sudo ln -s /etc/nginx/sites-available/simuladosbr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# SSL com Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com.br
```

**Custo:** $5-10/mês (Droplet básico)

---

## Variáveis de Ambiente Necessárias

```env
# Backend (.env)
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET=sua_chave_secreta_muito_forte_aqui
NODE_ENV=production
PORT=3000

# Email (opcional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu@email.com
SMTP_PASS=sua_senha

# MercadoPago (opcional)
MERCADOPAGO_ACCESS_TOKEN=seu_token
```

---

## Checklist Pré-Deploy

### Segurança
- [ ] Trocar JWT_SECRET para valor forte (>32 chars)
- [ ] Habilitar HTTPS (SSL/TLS)
- [ ] Configurar CORS corretamente
- [ ] Rate limiting ativado
- [ ] Helmet.js configurado
- [ ] Variáveis sensíveis em secrets (nunca no código)

### Performance
- [ ] Minificar CSS/JS (`npm run build` no frontend)
- [ ] Habilitar gzip/brotli no servidor
- [ ] CDN para assets estáticos (Cloudflare)
- [ ] Cache headers configurados
- [ ] Service Worker ativado

### Banco de Dados
- [ ] Migrações aplicadas
- [ ] Backup automatizado configurado
- [ ] Índices criados
- [ ] Connection pooling habilitado

### Monitoring
- [ ] Sentry ou similar para error tracking
- [ ] Uptime monitoring (UptimeRobot grátis)
- [ ] Analytics (Google Analytics ou Plausible)
- [ ] Logs centralizados

---

## CI/CD com GitHub Actions

Criar `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
    
    - name: Install backend dependencies
      run: cd backend && npm ci
    
    - name: Run tests
      run: cd backend && npm test
    
    - name: Deploy to Vercel
      uses: amondnet/vercel-action@v20
      with:
        vercel-token: ${{ secrets.VERCEL_TOKEN }}
        vercel-org-id: ${{ secrets.ORG_ID }}
        vercel-project-id: ${{ secrets.PROJECT_ID }}
        vercel-args: '--prod'
```

---

## Domínio Customizado

### Opção 1: Comprar domínio
- [Registro.br](https://registro.br) - .br por ~R$40/ano
- [Namecheap](https://namecheap.com) - .com por ~$10/ano
- [Cloudflare Registrar](https://cloudflare.com) - preço de custo

### Opção 2: Subdomínio grátis
- `simuladosbr.vercel.app` (Vercel)
- `simuladosbr.onrender.com` (Render)
- `simuladosbr.up.railway.app` (Railway)

### DNS Configuration:
```
Type    Name    Value
A       @       IP_DO_SERVIDOR
CNAME   www     seudominio.com.br
TXT     @       "vercel-domain-verification=..."
```

---

## Estimativa de Custos

### Setup Grátis (até ~1k usuários/mês)
- **Hosting:** Vercel Free
- **Banco:** Supabase Free (500MB, 2GB bandwidth)
- **CDN:** Cloudflare Free
- **Total:** **$0/mês**

### Setup Premium (até ~10k usuários/mês)
- **Hosting:** Vercel Pro - $20/mês
- **Banco:** Supabase Pro - $25/mês
- **Monitoring:** Sentry Team - $26/mês
- **Domínio:** ~$10/ano
- **Total:** **~$71/mês**

### Setup Escalável (100k+ usuários/mês)
- **Hosting:** VPS (DigitalOcean) - $48/mês (8GB RAM)
- **Banco:** Managed Postgres - $60/mês
- **CDN:** Cloudflare Pro - $20/mês
- **Monitoring:** Datadog - $15/mês
- **Total:** **~$143/mês**

---

## SEO & Marketing

### SEO Básico:

```html
<!-- Em index.html -->
<head>
  <title>SimuladosBR - Simulados PMP | Preparação Certificação PMI</title>
  <meta name="description" content="Plataforma completa de simulados para certificação PMP. Mais de 1000 questões, estatísticas detalhadas e modo offline.">
  <meta name="keywords" content="PMP, PMI, simulado, certificação, gestão de projetos">
  
  <!-- Open Graph -->
  <meta property="og:title" content="SimuladosBR - Simulados PMP">
  <meta property="og:description" content="Prepare-se para a certificação PMP com nossos simulados reais">
  <meta property="og:image" content="/assets/og-image.png">
  <meta property="og:url" content="https://simuladosbr.com.br">
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="SimuladosBR - Simulados PMP">
  <meta name="twitter:description" content="Prepare-se para a certificação PMP">
  <meta name="twitter:image" content="/assets/twitter-card.png">
  
  <!-- Schema.org -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    "name": "SimuladosBR",
    "description": "Plataforma de simulados PMP",
    "url": "https://simuladosbr.com.br"
  }
  </script>
</head>
```

### Criar `sitemap.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://simuladosbr.com.br/</loc>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://simuladosbr.com.br/login</loc>
    <priority>0.8</priority>
  </url>
</urlset>
```

### Criar `robots.txt`:
```
User-agent: *
Allow: /
Disallow: /api/
Disallow: /pages/admin/

Sitemap: https://simuladosbr.com.br/sitemap.xml
```

---

## Suporte & Manutenção

### Backup Automático:
```bash
# Cron job diário (3AM)
0 3 * * * pg_dump $DATABASE_URL | gzip > /backups/db_$(date +\%Y\%m\%d).sql.gz
```

### Health Check Endpoint:
```javascript
// backend/routes/health.js
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

### Monitoring com UptimeRobot (grátis):
1. Criar conta em [uptimerobot.com](https://uptimerobot.com)
2. Adicionar monitor HTTP(s)
3. URL: `https://seudominio.com.br/health`
4. Intervalo: 5 minutos
5. Alertas: Email/SMS quando down

---

## 📞 Suporte

Dúvidas sobre deploy?
- 📧 Email: suporte@simuladosbr.com.br
- 💬 Discord: [link]
- 📖 Docs: https://docs.simuladosbr.com.br

---

**Última atualização:** 2025-12-06  
**Versão:** 2.0.0
