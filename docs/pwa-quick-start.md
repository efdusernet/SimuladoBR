# 🚀 Guia Rápido: PWA Offline-First

## ✅ O que foi implementado (Fase 1)

### 1. **Service Worker v2.0** 
Cache inteligente com 3 estratégias diferentes e limpeza automática

### 2. **Banco de Dados Local (IndexedDB)**
Armazena questões, respostas e fila de sincronização

### 3. **Gerenciador de Sincronização**
Sincroniza automaticamente quando você volta online

### 4. **Indicador Visual**
Badge no canto superior direito mostra status de conexão

---

## 🧪 Como Testar Agora

### Passo 1: Iniciar o servidor
```powershell
# Backend
cd backend
npm start

# Acesse: http://localhost:3000
```

### Passo 2: Ativar o Service Worker
1. Abra o app no navegador
2. Abra DevTools (F12)
3. Vá em **Application** > **Service Workers**
4. Veja o SW v2.0.0 ativo

### Passo 3: Testar modo offline
1. **Responda algumas questões** (enquanto online)
2. Abra DevTools > **Network** > marque **Offline**
3. **Continue respondendo** - funciona!
4. Desmarque **Offline**
5. Veja o badge verde "Sincronizando..."
6. Respostas são enviadas automaticamente

### Passo 4: Ver estatísticas
1. Clique no **badge colorido** (canto superior direito)
2. Painel mostra:
   - Status de conexão
   - Itens pendentes
   - Questões em cache
   - Última sincronização

---

## 🎨 Componentes Visuais

### Badge de Status
- 🔴 **Roxo** = Offline
- 🟢 **Verde** = Online
- 🟡 **Laranja** = Sincronizando

### Página Offline
Quando navegar sem internet, aparece página bonita com:
- Ícone animado
- Mensagem tranquilizadora
- Botões de ação
- Lista de recursos disponíveis offline

---

## 🔧 Como Integrar nos Exames

### Em `exam.html` ou `examFull.html`:

```html
<!-- Antes de </body> -->
<script type="module">
  import offlineDB from '/utils/offlineDB.js';
  import syncManager from '/utils/syncManager.js';
  import '/components/offlineIndicator.js';

  // Inicializar
  await offlineDB.init();
  syncManager.init();

  // Salvar resposta com sync automático
  async function saveAnswerOffline(questionId, answer) {
    const sessionId = window.currentSessionId;
    
    // Salvar localmente
    await offlineDB.saveAnswer(sessionId, questionId, answer);
    
    // Adicionar à fila de sync (prioridade 10 = alta)
    await offlineDB.addToSyncQueue('submitAnswer', {
      sessionId,
      questionId,
      answer
    }, 10);
    
    // Tentar sincronizar imediatamente se online
    if (navigator.onLine) {
      syncManager.syncAll();
    }
  }

  // Usar no lugar do fetch direto
  window.saveAnswerOffline = saveAnswerOffline;
</script>
```

### Atualizar função existente:

```javascript
// ANTES (script_exam.js)
function saveAnswersForCurrentSession(){
  try {
    localStorage.setItem(`answers_${sessionId}`, JSON.stringify(ANSWERS));
  } catch(e) {}
}

// DEPOIS (adicionar)
async function saveAnswersOfflineFirst(){
  try {
    // Salvar no localStorage (compat)
    localStorage.setItem(`answers_${sessionId}`, JSON.stringify(ANSWERS));
    
    // NOVO: Salvar no IndexedDB também
    if (window.offlineDB) {
      await window.offlineDB.saveAttempt({
        sessionId: window.currentSessionId,
        userId: localStorage.getItem('userId'),
        answers: ANSWERS,
        status: 'in-progress',
        createdAt: Date.now()
      });
    }
  } catch(e) {
    console.warn('Erro ao salvar offline:', e);
  }
}
```

---

## 📱 Instalar como App

### Desktop (Chrome/Edge):
1. Ícone de **+** na barra de endereço
2. Clicar em "Instalar SimuladosBR"
3. App abre em janela própria

### Android:
1. Menu (⋮) > "Adicionar à tela inicial"
2. Ícone aparece na home
3. Abre em fullscreen

### iOS (Safari):
1. Botão **Compartilhar** 
2. "Adicionar à Tela de Início"
3. Funciona como app nativo

---

## 🐛 Debugging

### Ver cache atual:
```javascript
// No console do navegador
const stats = await offlineDB.getStats();
console.table(stats);
```

### Ver fila de sync:
```javascript
const pending = await offlineDB.getPendingSyncItems();
console.table(pending);
```

### Forçar sincronização:
```javascript
await syncManager.forceSyncNow();
```

### Limpar cache antigo:
```javascript
await offlineDB.cleanOldCache(7); // > 7 dias
```

### Ver status do Service Worker:
```javascript
navigator.serviceWorker.getRegistration().then(reg => {
  console.log('SW ativo:', reg.active);
  console.log('Versão:', reg.active.scriptURL);
});
```

---

## 🎯 Próximos Passos (Fase 2)

1. **Cache Preditivo**
   - Pre-baixar próximas 10 questões
   - Cache por domínio favorito

2. **Compressão**
   - Reduzir 60% do tamanho dos dados
   - Mais questões no mesmo espaço

3. **Indicadores Avançados**
   - Badge no ícone com contador
   - Notificações push
   - Barra de progresso de sync

---

## 📊 Benefícios Imediatos

✅ **Funciona sem internet** - Continue estudando offline  
✅ **Sincronização automática** - Zero perda de dados  
✅ **Performance melhor** - Carregamento instantâneo de cache  
✅ **Economia de dados** - Menos requisições de rede  
✅ **Experiência de app nativo** - Instalável e fullscreen  

---

## 🆘 Troubleshooting

### Service Worker não ativa?
```javascript
// Forçar update
navigator.serviceWorker.getRegistrations().then(regs => {
  regs.forEach(reg => reg.update());
});
```

### Cache muito grande?
```javascript
// Limpar todo o cache
await offlineDB.cleanOldCache(0);
```

### Sincronização travada?
```javascript
// Ver status
const status = await syncManager.getStatus();
console.log(status);

// Resetar fila se necessário
// (implementar no futuro)
```

---

## 📞 Contato

Dúvidas ou sugestões sobre PWA?  
Abra uma issue no GitHub ou contate o time de desenvolvimento.

**Versão do documento:** 1.0  
**Última atualização:** 2025-12-06
