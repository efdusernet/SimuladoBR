# Guia de Deployment — Google Play Store

Este documento consolida todos os passos necessários para publicar o **SimuladosBR** na Google Play Store, desde preparação técnica até submissão e manutenção pós-lançamento.

---

## Índice

1. [Pré-requisitos e Decisões Estratégicas](#1-pré-requisitos-e-decisões-estratégicas)
2. [Preparação Técnica (PWA/TWA vs App Nativo)](#2-preparação-técnica-pwatwa-vs-app-nativo)
3. [Implementação TWA (Trusted Web Activity)](#3-implementação-twa-trusted-web-activity)
4. [Assets e Branding](#4-assets-e-branding)
5. [Compliance e Políticas do Google](#5-compliance-e-políticas-do-google)
6. [Build, Assinatura e Upload](#6-build-assinatura-e-upload)
7. [Configuração da Play Console](#7-configuração-da-play-console)
8. [Testes e Validação](#8-testes-e-validação)
9. [Lançamento e Monitoramento](#9-lançamento-e-monitoramento)
10. [Manutenção Pós-Lançamento](#10-manutenção-pós-lançamento)
11. [Checklist Final](#11-checklist-final)

---

## 1. Pré-requisitos e Decisões Estratégicas

### 1.1. Conta Google Play Console
- [ ] Criar conta de desenvolvedor na [Google Play Console](https://play.google.com/console) (taxa única de $25 USD)
- [ ] Verificar identidade e configurar método de pagamento
- [ ] Configurar informações de contato e suporte

### 1.2. Decisão de Arquitetura

**Opções:**
1. **TWA (Trusted Web Activity)** — Recomendado ✅
   - Empacota PWA existente como app Android nativo
   - Reutiliza 100% do código frontend/backend
   - Updates automáticos sem republicar no Play Store
   - Menor tamanho de download
   - Melhor para aplicações web-first

2. **App Nativo (React Native / Flutter / Kotlin)**
   - Maior controle sobre features nativas
   - Melhor performance em animações pesadas
   - Requer reescrita significativa

**Decisão recomendada:** TWA, pois o app já é web-based e bem otimizado.

### 1.3. Nome e Pacote
- **Nome do app:** SimuladosBR (ou "PMP Simulados BR" se mais descritivo)
- **Package name:** `br.simulados.pmp` ou `br.simulados.app`
  - ⚠️ Nome do pacote **não pode ser alterado** após primeira publicação
  - Deve seguir formato: `dominio.empresa.app`
  - Evitar uso de marcas registradas (PMI, PMP) no package name

### 1.4. Domínio e HTTPS
- [ ] Garantir que o app roda em domínio próprio com HTTPS válido
- [ ] Configurar certificado SSL (Let's Encrypt, Cloudflare, etc.)
- [ ] Testar acessibilidade via `https://seudominio.com`

---

## 2. Preparação Técnica (PWA/TWA vs App Nativo)

### 2.1. Completar PWA (Progressive Web App)

#### Manifest (Web App Manifest)
Arquivo: `frontend/manifest.json`

**Estrutura mínima obrigatória:**
```json
{
  "name": "SimuladosBR - Simulados PMP",
  "short_name": "SimuladosBR",
  "description": "Simulados completos para certificação PMP com questões reais e indicadores detalhados",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#4f46e5",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/assets/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/assets/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

**Checklist manifest:**
- [ ] `name` e `short_name` definidos
- [ ] `start_url` aponta para a raiz ou página de login
- [ ] `display: "standalone"` (remove barra de navegação do navegador)
- [ ] `background_color` e `theme_color` alinhados ao branding
- [ ] Ícones em 192x192 e 512x512 (PNG, com background sólido)
- [ ] `orientation` definido (portrait para mobile)

#### Service Worker
Arquivo: `frontend/sw.js`

**Funcionalidades essenciais:**
- Cache de assets estáticos (HTML, CSS, JS)
- Fallback offline para rotas principais
- Atualização automática de versão

**Exemplo mínimo:**
```javascript
const CACHE_NAME = 'simuladosbr-v1.1.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/login.html',
  '/styles.css',
  '/assets/build/script.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      );
    })
  );
});
```

**Checklist Service Worker:**
- [ ] Registrado em `index.html` com fallback silencioso
- [ ] Cache de assets críticos
- [ ] Estratégia de atualização (network-first ou cache-first)
- [ ] Versionamento do cache

#### Meta Tags e Links no HTML
Adicionar em `<head>` de todas as páginas principais:

```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#4f46e5">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="SimuladosBR">
<link rel="apple-touch-icon" href="/assets/icon-192.png">
```

### 2.2. Otimizações Mobile
- [ ] Touch-friendly: botões com min-height 44px
- [ ] `touch-action: manipulation` para evitar delay de 300ms
- [ ] Viewport configurado: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`
- [ ] Safe area insets para notch/home indicator: `padding-bottom: calc(env(safe-area-inset-bottom) + 48px)`
- [ ] Remover hover states que não fazem sentido em touch

### 2.3. Performance
- [ ] Lighthouse score > 90 (Performance, Accessibility, Best Practices, SEO)
- [ ] Lazy loading de imagens e componentes não críticos
- [ ] Minificação e bundling de assets (já implementado via `build.mjs`)
- [ ] Compressão gzip/brotli no servidor
- [ ] CDN para assets estáticos (opcional, mas recomendado)

---

## 3. Implementação TWA (Trusted Web Activity)

### 3.1. Ferramentas Necessárias
- **Bubblewrap CLI** (Google, para gerar TWA automaticamente)
  ```bash
  npm install -g @bubblewrap/cli
  ```

- **Android Studio** (para build e debug)
  - Download: https://developer.android.com/studio
  - Instalar SDK Platform 33+ (Android 13)
  - Configurar emulador ou device físico

### 3.2. Inicializar Projeto TWA

No diretório raiz do projeto:

```bash
bubblewrap init --manifest https://seudominio.com/manifest.json
```

**Respostas típicas:**
- **Domain:** `seudominio.com`
- **Name:** `SimuladosBR`
- **Package name:** `br.simulados.pmp`
- **Start URL:** `/`
- **Display mode:** `standalone`
- **Orientation:** `portrait`
- **Status bar color:** `#4f46e5`
- **Navigation bar color:** `#0f172a`
- **Fallback enabled:** `yes` (importante para offline)

Isso cria:
- `twa-manifest.json` (configuração do TWA)
- Estrutura de projeto Android

### 3.3. Configurar Digital Asset Links

**O que é?**
Mecanismo do Android para verificar que seu app Android está autorizado a abrir seu domínio web sem barra de URL.

**Passos:**
1. Gerar assetlinks JSON:
   ```bash
   bubblewrap fingerprint
   ```
   Isso gera SHA-256 do certificado de assinatura.

2. Criar arquivo `.well-known/assetlinks.json` no servidor:
   ```json
   [
     {
       "relation": ["delegate_permission/common.handle_all_urls"],
       "target": {
         "namespace": "android_app",
         "package_name": "br.simulados.pmp",
         "sha256_cert_fingerprints": [
           "AB:CD:EF:..."
         ]
       }
     }
   ]
   ```

3. Publicar em `https://seudominio.com/.well-known/assetlinks.json`
   - ⚠️ Deve estar acessível publicamente
   - Content-Type: `application/json`
   - Sem redirecionamento

4. Validar:
   ```bash
   bubblewrap validate --url https://seudominio.com
   ```

### 3.4. Personalizações TWA

Edite `twa-manifest.json`:

```json
{
  "packageId": "br.simulados.pmp",
  "host": "seudominio.com",
  "name": "SimuladosBR",
  "launcherName": "SimuladosBR",
  "display": "standalone",
  "themeColor": "#4f46e5",
  "navigationColor": "#0f172a",
  "backgroundColor": "#0f172a",
  "enableNotifications": false,
  "startUrl": "/",
  "iconUrl": "https://seudominio.com/assets/icon-512.png",
  "maskableIconUrl": "https://seudominio.com/assets/icon-512.png",
  "splashScreenFadeOutDuration": 300,
  "enableSiteSettingsShortcut": false,
  "orientation": "portrait",
  "fallbackType": "customtabs",
  "features": {
    "playBilling": {
      "enabled": false
    }
  },
  "shortcuts": []
}
```

**Configurações importantes:**
- `enableNotifications: true` se planeja usar push notifications
- `fallbackType: "customtabs"` garante experiência decente se Digital Asset Links falhar
- `shortcuts`: atalhos de launcher (ex: "Novo Simulado", "Indicadores")

---

## 4. Assets e Branding

### 4.1. Ícones (Obrigatórios)

**Ícone adaptativo (Adaptive Icon):**
- **Foreground:** 432x432px (PNG com transparência)
- **Background:** 432x432px (PNG ou cor sólida)
- Safe zone central: 288x288px (conteúdo principal)
- Total canvas: 432x432px (sobra para máscara do OS)

**Ícone de launcher legado:**
- 512x512px (PNG, background sólido)

**Ferramentas:**
- [Android Asset Studio](https://romannurik.github.io/AndroidAssetStudio/icons-launcher.html)
- Figma/Photoshop com template de adaptive icon

**Checklist:**
- [ ] `icon-192.png` e `icon-512.png` presentes em `/assets`
- [ ] Ícones com background **não transparente** (evita problemas no Play Store)
- [ ] Testar visualização em diferentes formatos (círculo, squircle, arredondado)
- [ ] Contraste adequado (não usar texto muito pequeno)

### 4.2. Screenshots (Obrigatórios)

**Play Store exige no mínimo 2 screenshots por dispositivo:**

**Smartphone (obrigatório):**
- Tamanho: 16:9 ou 9:16 (recomendado: 1080x1920px ou 1080x2340px)
- Mínimo: 320px na menor dimensão
- Máximo: 3840px na maior dimensão
- Formato: PNG ou JPEG (< 8MB cada)
- Quantidade: 2-8 screenshots

**Tablet (opcional mas recomendado):**
- 7" ou 10" (recomendado: 1200x1920px ou 2048x2732px)
- Mesmas regras de tamanho

**Dicas:**
- Capture telas principais: Login, Setup de Exame, Questão, Resultados, Indicadores
- Use emulador Android Studio ou device físico
- Considere adicionar molduras/captions explicativos (aumenta conversão)
- Ferramentas: [Previewed](https://previewed.app/), Figma, Shotsnapp

### 4.3. Feature Graphic (Obrigatório)

**Dimensões:** 1024x500px (PNG ou JPEG, < 1MB)

**Uso:** Aparece no topo da listagem do app no Play Store.

**Conteúdo:**
- Logotipo + tagline (ex: "Simulados Completos para PMP")
- Sem texto excessivo (legibilidade em thumbnails)
- Cores alinhadas ao tema do app

### 4.4. Banner de TV (Opcional)
Se não for lançar em Android TV, pode ignorar.

### 4.5. Vídeo Promocional (Opcional)
- URL do YouTube
- 30-120 segundos
- Mostra fluxo do app e diferenciais

---

## 5. Compliance e Políticas do Google

### 5.1. Política de Privacidade (Obrigatório)

**O que incluir:**
- Tipos de dados coletados (email, tentativas de exame, tempo de uso)
- Finalidade da coleta (autenticação, estatísticas, melhorias)
- Compartilhamento com terceiros (se houver: analytics, payment gateways)
- Direitos do usuário (LGPD: acesso, correção, exclusão)
- Retenção de dados
- Cookies e tecnologias de rastreamento
- Contato do desenvolvedor

**Onde publicar:**
- Página web dedicada: `https://seudominio.com/privacidade`
- Link informado na Play Console

**Template LGPD compatível:**
- [TermsFeed](https://www.termsfeed.com/privacy-policy-generator/)
- [GetTerms](https://getterms.io/)

**Checklist:**
- [ ] Política publicada em URL pública e acessível
- [ ] Menciona explicitamente "Android" e "Google Play"
- [ ] Atualizada com data vigente
- [ ] Linguagem clara (português do Brasil)
- [ ] Mecanismo de contato visível (email de suporte)

### 5.2. Classificação de Conteúdo

**Questionário do Google Play:**
- **Violência:** Nenhuma
- **Sexualidade:** Nenhuma
- **Linguagem:** Nenhuma
- **Drogas/Álcool:** Nenhum
- **Tema:** Educação/Treinamento

**Classificação esperada:** Livre (L) no Brasil, Everyone (E) nos EUA.

### 5.3. Classificação Etária
- **Target:** 18+ (conteúdo educacional profissional)
- Se houver menores usando, considerar 12+ ou 16+

### 5.4. Segurança de Dados (Data Safety)

Formulário obrigatório na Play Console desde 2022.

**Informar:**
- **Dados coletados:**
  - Informações pessoais: Email, Nome
  - Atividade do app: Tentativas de exame, progresso
  - IDs de dispositivo: (se usar Firebase/Analytics)
- **Finalidade:**
  - Funcionalidade do app
  - Análise
  - Autenticação
- **Compartilhamento:** Não (ou listar terceiros: ex. Stripe, Google Analytics)
- **Segurança:** Dados criptografados em trânsito (HTTPS)
- **Exclusão:** Usuário pode solicitar exclusão de conta

**Checklist:**
- [ ] Preencher formulário "Data Safety" na Play Console
- [ ] Garantir que prática declarada corresponde à realidade
- [ ] Implementar mecanismo de exclusão de conta (opcional mas recomendado)

### 5.5. Famílias e Público Infantil

Se **não** for direcionado a crianças (<13 anos):
- [ ] Declarar que o app **não é voltado para crianças**
- [ ] Não usar linguagem infantil ou imagens que atraiam crianças

Se for voltado para crianças:
- Políticas muito mais rígidas (ads, coleta de dados, conteúdo)

### 5.6. Permissões do Android

TWA requer poucas permissões. Principais:

**Obrigatórias:**
- `INTERNET` (já incluída automaticamente)

**Opcionais (apenas se necessário):**
- `CAMERA` (se futuras questões usarem foto)
- `VIBRATE` (feedback tátil)
- `WAKE_LOCK` (manter tela ligada durante exame)

**Evitar:**
- Permissões não utilizadas (Play Store rejeita apps com permissões desnecessárias)

### 5.7. Termos de Serviço (Recomendado)

Não obrigatório para Play Store, mas recomendado para proteger o desenvolvedor.

**Incluir:**
- Regras de uso (não compartilhar conta, não fraudar exames)
- Limitação de responsabilidade (app não substitui curso oficial PMP)
- Propriedade intelectual (questões são autorais)
- Suspensão/banimento por abuso

---

## 6. Build, Assinatura e Upload

### 6.1. Gerar Keystore (Chave de Assinatura)

**Única vez:**
```bash
keytool -genkey -v -keystore simuladosbr-release.keystore -alias simuladosbr -keyalg RSA -keysize 2048 -validity 10000
```

**Responder:**
- Senha do keystore (guardar com segurança!)
- Nome, organização, cidade, estado, país
- Senha da chave (pode ser igual ao keystore)

**⚠️ CRÍTICO:**
- Fazer **backup seguro** do keystore (nuvem criptografada, cofre)
- Se perder a chave, **não poderá mais atualizar o app**
- Considerar migrar para [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756) (Google gerencia a chave final)

### 6.2. Build do APK/AAB

**Android App Bundle (AAB) é obrigatório desde 2021.**

**Via Bubblewrap:**
```bash
bubblewrap build
```

Isso gera:
- `app-release-bundle.aab` (para upload no Play Store)
- `app-release-signed.apk` (para testes locais)

**Via Android Studio:**
1. Abrir projeto TWA no Android Studio
2. Build > Generate Signed Bundle / APK
3. Selecionar "Android App Bundle"
4. Escolher keystore e senha
5. Build variant: `release`

**Tamanho esperado:**
- AAB: 2-5 MB (TWA é muito leve)
- APK: 3-7 MB

### 6.3. Testar o Build Localmente

**Instalar APK no device:**
```bash
adb install app-release-signed.apk
```

**Ou via Android Studio:**
- Run > Run 'app'

**Checklist de testes:**
- [ ] App abre sem erros
- [ ] Digital Asset Links funcionando (sem barra de URL)
- [ ] Navegação funciona (login, exames, indicadores)
- [ ] Offline fallback ativo (modo avião → abrir app)
- [ ] Ícone e splash screen corretos
- [ ] Orientação travada (portrait)
- [ ] Notch/safe area respeitados

### 6.4. Upload na Play Console

**Passos:**
1. Acessar [Google Play Console](https://play.google.com/console)
2. Criar novo app (se primeira vez):
   - Tipo: App (não jogo)
   - Nome: SimuladosBR
   - Idioma padrão: Português (Brasil)
   - App ou jogo: App
   - Gratuito ou pago: Gratuito (ou pago se houver cobrança)
3. Ir para **Releases > Production** (ou Internal testing para alpha)
4. Criar nova release
5. Upload do AAB
6. Preencher "Release notes" (changelog)
   - Exemplo: "Versão inicial com simulados completos, questões pré-teste e indicadores de desempenho."
7. Review e submit

**Primeira release demora 1-7 dias para revisão.**

---

## 7. Configuração da Play Console

### 7.1. Informações do App

**Nome e descrição:**
- **Título:** SimuladosBR - Simulados PMP (max 50 caracteres)
- **Descrição curta:** Simulados completos para certificação PMP com indicadores detalhados e questões reais. (max 80 caracteres)
- **Descrição completa:** (max 4000 caracteres)
  ```
  Prepare-se para a certificação PMP com o SimuladosBR, a plataforma completa de simulados que oferece:

  ✅ Simulados completos de 180 questões no formato oficial
  ✅ Questões categorizadas por Domínio, Grupo de Processos e Área de Conhecimento
  ✅ Sistema de questões pré-teste (não contabilizadas na nota)
  ✅ Distribuição inteligente baseada no ECO (Exam Content Outline)
  ✅ Indicadores detalhados de desempenho por domínio e grupo
  ✅ Estatísticas históricas de tentativas e evolução
  ✅ Modo Quiz para treinos rápidos personalizados
  ✅ Sistema de pausas nos checkpoints 60 e 120 questões
  ✅ Retomada automática de sessão após interrupções
  ✅ Interface otimizada para mobile

  RECURSOS PRINCIPAIS:
  • Banco de questões atualizado e revisado
  • Explicações detalhadas para cada questão
  • Filtros por domínio, área e abordagem
  • Histórico completo de tentativas com exportação CSV
  • Gráficos de radar de desempenho por domínio
  • Acompanhamento de progresso e metas
  • Modo offline para prática sem internet

  IDEAL PARA:
  • Candidatos ao exame PMP
  • Profissionais que desejam testar conhecimentos
  • Instrutores de preparação para certificação

  NOTAS:
  • App gratuito com opção de upgrade (se aplicável)
  • Requer cadastro e verificação de email
  • Conteúdo alinhado ao PMBOK 7ª edição

  Dúvidas ou suporte: contato@simuladosbr.com
  ```

### 7.2. Categorização

- **Categoria principal:** Educação
- **Subcategoria:** Treinamento Profissional
- **Tags:** PMP, Project Management, Simulados, Certificação, PMI

### 7.3. Detalhes de Contato

- **E-mail do desenvolvedor:** contato@simuladosbr.com (ou seu email)
- **Website:** https://seudominio.com
- **Telefone:** (opcional, mas ajuda na credibilidade)

### 7.4. Países e Regiões

**Distribuição inicial:**
- Brasil (obrigatório)
- Portugal, Angola, Moçambique (mercado lusófono)

**Expansão futura:**
- EUA, Canadá (se adicionar inglês)
- Toda América Latina (se adicionar espanhol)

### 7.5. Preços

- **Gratuito:** Sim (com possibilidade de in-app purchases se houver planos premium)
- Se houver plano pago, configurar em "In-app products"

---

## 8. Testes e Validação

### 8.1. Internal Testing Track

Antes de lançar em produção:

**Passos:**
1. Play Console > Releases > Testing > Internal testing
2. Upload do AAB
3. Adicionar testers (emails autorizados)
4. Compartilhar link de opt-in
5. Testers instalam e reportam bugs

**Duração recomendada:** 1-2 semanas

**Checklist de testes internos:**
- [ ] Login e registro funcionam
- [ ] Seleção e início de exame completo (180 questões)
- [ ] Pausas nos checkpoints (60, 120)
- [ ] Submissão final e cálculo de score
- [ ] Indicadores carregam corretamente
- [ ] Histórico de tentativas acessível
- [ ] Filtros por domínio/área/categoria funcionam
- [ ] Modo offline básico
- [ ] Performance em devices low-end (Android Go)
- [ ] Bateria não drena excessivamente

### 8.2. Closed/Open Beta (Opcional)

**Closed Beta:**
- Grupo maior de testers (100-1000 usuários)
- Feedback via formulário ou email

**Open Beta:**
- Qualquer usuário pode entrar
- Listado no Play Store com badge "Early Access"
- Bom para validação em escala antes do lançamento oficial

### 8.3. Pre-Launch Report (Automático)

Google testa automaticamente em ~20 devices reais:
- Crashes
- ANRs (App Not Responding)
- Problemas de UI
- Acessibilidade

Revisar relatório antes de promover para produção.

---

## 9. Lançamento e Monitoramento

### 9.1. Staged Rollout (Recomendado)

Libere gradualmente:
- **Dia 1:** 5% dos usuários
- **Dia 3:** 20%
- **Dia 7:** 50%
- **Dia 10:** 100%

Isso permite pausar/reverter se houver problema crítico.

**Como configurar:**
- Play Console > Release > Production > Rollout percentage

### 9.2. Monitoramento Pós-Lançamento

**Métricas críticas (primeiros 7 dias):**
- **Crash rate:** < 0.5% (meta: 0%)
- **ANR rate:** < 0.1%
- **Instalações vs desinstalações:** ratio > 3:1
- **Rating médio:** > 4.0 estrelas
- **Tempo de sessão:** > 10 min (indicativo de engajamento)

**Ferramentas:**
- Play Console > Dashboard
- Firebase Crashlytics (se integrado)
- Google Analytics (se integrado)

### 9.3. Responder Reviews

- Responder **todas** reviews negativas (demonstra cuidado)
- Agradecer reviews positivas
- Incentivar usuários satisfeitos a deixarem review (in-app prompt após exame completo)

---

## 10. Manutenção Pós-Lançamento

### 10.1. Atualizações Regulares

**Frequência recomendada:** A cada 2-4 semanas

**O que atualizar:**
- Correção de bugs reportados
- Novas questões (via backend, não requer republicar app)
- Melhorias de performance
- Novos indicadores ou features

**Versionamento:**
- Seguir semver: `1.0.0` → `1.0.1` (patch), `1.1.0` (minor), `2.0.0` (major)
- Atualizar `versionCode` (inteiro crescente) e `versionName` (string legível)

### 10.2. Monitoramento Contínuo

**Semanalmente:**
- [ ] Revisar crash reports
- [ ] Responder reviews
- [ ] Verificar métricas de engajamento

**Mensalmente:**
- [ ] Analisar funil de conversão (cadastro → primeiro exame → exame completo)
- [ ] A/B test de features (se ferramenta disponível)
- [ ] Atualizar FAQ e documentação de suporte

### 10.3. Compliance Contínuo

- [ ] Revisar mudanças nas políticas do Google Play (notificações mensais)
- [ ] Atualizar Privacy Policy se coleta de dados mudar
- [ ] Renovar certificado SSL (Let's Encrypt auto-renova)
- [ ] Manter dependências atualizadas (Node.js, Sequelize, etc.)

### 10.4. Expansão de Features

**Roadmap sugerido pós-lançamento:**
- [ ] Push notifications (lembretes de estudo)
- [ ] Dark mode (já parcialmente implementado)
- [ ] Integração com pagamentos (Google Play Billing)
- [ ] Modo multiplayer/competição
- [ ] Suporte a outros idiomas (inglês, espanhol)
- [ ] Integração com LMS (Learning Management Systems)

---

## 11. Checklist Final

### Pré-Lançamento

**Técnico:**
- [ ] PWA completo (manifest.json, service worker, ícones)
- [ ] HTTPS válido e Digital Asset Links configurado
- [ ] TWA build gerado e assinado
- [ ] Testado em 3+ devices Android (diferentes versões)
- [ ] Performance: Lighthouse > 90
- [ ] Tamanho do app < 10MB

**Assets:**
- [ ] Ícone 192x192 e 512x512 (maskable)
- [ ] 2-8 screenshots de smartphone
- [ ] Feature graphic 1024x500
- [ ] Descrição completa e curta escritas
- [ ] Vídeo promocional (opcional)

**Compliance:**
- [ ] Política de privacidade publicada e linkada
- [ ] Data Safety preenchido
- [ ] Classificação de conteúdo completa
- [ ] Termos de serviço (opcional mas recomendado)

**Play Console:**
- [ ] Conta de desenvolvedor ativa ($25 pagos)
- [ ] App criado com package name correto
- [ ] AAB uploadado
- [ ] Release notes escritos
- [ ] Categorização e tags definidas
- [ ] Países de distribuição selecionados

**Testes:**
- [ ] Internal testing com 5+ usuários por 1 semana
- [ ] Todos os bugs críticos corrigidos
- [ ] Pre-launch report revisado (sem crashes)

### Pós-Lançamento

**Primeiras 24h:**
- [ ] Monitorar crash rate a cada 2h
- [ ] Responder primeiros reviews
- [ ] Verificar instalações vs desinstalações

**Primeira semana:**
- [ ] Staged rollout até 100%
- [ ] Responder todas as reviews
- [ ] Publicar post em redes sociais (se houver)
- [ ] Email para beta testers agradecendo

**Primeiro mês:**
- [ ] Análise completa de métricas
- [ ] Implementar top 3 features mais pedidas
- [ ] Otimizar ASO (App Store Optimization)
- [ ] Considerar campanhas pagas (Google Ads for Apps)

---

## Recursos Adicionais

### Documentação Oficial
- [Android Developer Guide](https://developer.android.com/distribute/best-practices/launch/)
- [Google Play Console Help](https://support.google.com/googleplay/android-developer/)
- [Trusted Web Activity Docs](https://developers.google.com/web/android/trusted-web-activity)
- [Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap)

### Ferramentas
- [Lighthouse](https://developers.google.com/web/tools/lighthouse) (auditoria PWA)
- [PWA Builder](https://www.pwabuilder.com/) (alternativa ao Bubblewrap)
- [Android Asset Studio](https://romannurik.github.io/AndroidAssetStudio/) (ícones)
- [App Privacy Policy Generator](https://app-privacy-policy-generator.nisrulz.com/)

### Comunidades
- [Stack Overflow - Android](https://stackoverflow.com/questions/tagged/android)
- [Reddit - r/androiddev](https://www.reddit.com/r/androiddev/)
- [Google Play Academy](https://playacademy.exceedlms.com/student/catalog)

---

## Contato e Suporte

Para dúvidas sobre este guia ou sobre o processo de deployment:
- **Email:** contato@simuladosbr.com
- **GitHub Issues:** https://github.com/efdusernet/SimuladoBR/issues

---

**Última atualização:** 2025-11-24  
**Versão do guia:** 1.0.0
