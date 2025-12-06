/**
 * Sync Manager - Gerencia sincronização offline → online
 * Com retry automático, exponential backoff e priorização
 */

import offlineDB from './offlineDB.js';

class SyncManager {
  constructor() {
    this.isSyncing = false;
    this.syncInterval = null;
    this.listeners = new Set();
    this.retryDelays = [1000, 3000, 10000, 30000]; // Exponential backoff
  }

  /**
   * Inicia monitoramento de conectividade e sync automático
   */
  init() {
    console.log('[SyncManager] Inicializando...');

    // Listener de conectividade
    window.addEventListener('online', () => {
      console.log('[SyncManager] Conexão restaurada');
      this.notify('online');
      this.syncAll();
    });

    window.addEventListener('offline', () => {
      console.log('[SyncManager] Conexão perdida');
      this.notify('offline');
    });

    // Sync periódico (quando online)
    this.syncInterval = setInterval(() => {
      if (navigator.onLine && !this.isSyncing) {
        this.syncAll();
      }
    }, 30000); // A cada 30s

    // Sync inicial se online
    if (navigator.onLine) {
      setTimeout(() => this.syncAll(), 2000);
    }
  }

  /**
   * Adiciona listener de eventos de sync
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notifica listeners
   */
  notify(event, data = {}) {
    this.listeners.forEach(callback => {
      try {
        callback({ event, data, timestamp: Date.now() });
      } catch (e) {
        console.error('[SyncManager] Erro ao notificar listener:', e);
      }
    });
  }

  /**
   * Sincroniza todos os itens pendentes
   */
  async syncAll() {
    if (this.isSyncing) {
      console.log('[SyncManager] Sync já em andamento, pulando...');
      return;
    }

    if (!navigator.onLine) {
      console.log('[SyncManager] Offline, sync adiado');
      return;
    }

    this.isSyncing = true;
    this.notify('syncStart');

    try {
      const items = await offlineDB.getPendingSyncItems();
      
      if (items.length === 0) {
        console.log('[SyncManager] Nenhum item pendente');
        this.notify('syncComplete', { synced: 0, failed: 0 });
        return;
      }

      console.log(`[SyncManager] Sincronizando ${items.length} itens...`);
      
      let synced = 0;
      let failed = 0;

      for (const item of items) {
        try {
          await this.syncItem(item);
          await offlineDB.markSynced(item.id);
          synced++;
          this.notify('itemSynced', { item, synced, total: items.length });
        } catch (error) {
          console.error('[SyncManager] Erro ao sincronizar item:', item.id, error);
          await offlineDB.incrementRetry(item.id);
          failed++;
          this.notify('itemFailed', { item, error });
        }

        // Pequeno delay entre itens para não sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`[SyncManager] Sync completo: ${synced} ok, ${failed} falhou`);
      this.notify('syncComplete', { synced, failed, total: items.length });

    } catch (error) {
      console.error('[SyncManager] Erro no sync:', error);
      this.notify('syncError', { error });
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sincroniza um item específico
   */
  async syncItem(item) {
    const { operation, data } = item;

    switch (operation) {
      case 'submitAnswer':
        return await this.syncAnswer(data);
      
      case 'submitExam':
        return await this.syncExamSubmit(data);
      
      case 'updateProgress':
        return await this.syncProgress(data);
      
      default:
        console.warn('[SyncManager] Operação desconhecida:', operation);
    }
  }

  /**
   * Sincroniza resposta individual
   */
  async syncAnswer(data) {
    const token = localStorage.getItem('sessionToken') || '';
    const baseUrl = window.SIMULADOS_CONFIG?.BACKEND_BASE || 'http://localhost:3000';

    const response = await fetch(`${baseUrl}/api/exams/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': token
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Sincroniza submissão de exame
   */
  async syncExamSubmit(data) {
    const token = localStorage.getItem('sessionToken') || '';
    const baseUrl = window.SIMULADOS_CONFIG?.BACKEND_BASE || 'http://localhost:3000';

    const response = await fetch(`${baseUrl}/api/exams/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': token
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Sincroniza progresso
   */
  async syncProgress(data) {
    const token = localStorage.getItem('sessionToken') || '';
    const baseUrl = window.SIMULADOS_CONFIG?.BACKEND_BASE || 'http://localhost:3000';

    const response = await fetch(`${baseUrl}/api/exams/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': token
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Força sync imediato (chamado pelo usuário)
   */
  async forceSyncNow() {
    if (!navigator.onLine) {
      throw new Error('Você está offline. A sincronização será automática quando voltar online.');
    }

    return await this.syncAll();
  }

  /**
   * Verifica se há itens pendentes
   */
  async hasPendingItems() {
    const items = await offlineDB.getPendingSyncItems();
    return items.length > 0;
  }

  /**
   * Retorna status da sincronização
   */
  async getStatus() {
    const items = await offlineDB.getPendingSyncItems();
    const stats = await offlineDB.getStats();

    return {
      online: navigator.onLine,
      syncing: this.isSyncing,
      pending: items.length,
      stats
    };
  }

  /**
   * Para o sync manager
   */
  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.listeners.clear();
    console.log('[SyncManager] Destruído');
  }
}

// Singleton
const syncManager = new SyncManager();

// Export global
if (typeof window !== 'undefined') {
  window.syncManager = syncManager;
}

export default syncManager;
