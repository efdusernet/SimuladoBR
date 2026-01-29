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

  buildAuthHeaders(contentType = 'application/json') {
    try {
      if (window.Auth && typeof window.Auth.getAuthHeaders === 'function') {
        return window.Auth.getAuthHeaders({ contentType });
      }
    } catch (_e) { }

    const headers = { 'Content-Type': contentType };
    try {
      const token = String(localStorage.getItem('sessionToken') || '').trim() || String(localStorage.getItem('nomeUsuario') || '').trim();
      if (token) headers['X-Session-Token'] = token;
    } catch (_e) { }
    return headers;
  }

  /**
   * Inicia monitoramento de conectividade e sync automático
   */
  init() {
    logger.info('[SyncManager] Inicializando...');

    // Listener de conectividade
    window.addEventListener('online', () => {
      logger.info('[SyncManager] Conexão restaurada');
      this.notify('online');
      this.syncAll();
    });

    window.addEventListener('offline', () => {
      logger.info('[SyncManager] Conexão perdida');
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
        logger.error('[SyncManager] Erro ao notificar listener:', e);
      }
    });
  }

  /**
   * Sincroniza todos os itens pendentes
   */
  async syncAll() {
    if (this.isSyncing) {
      logger.info('[SyncManager] Sync já em andamento, pulando...');
      return;
    }

    if (!navigator.onLine) {
      logger.info('[SyncManager] Offline, sync adiado');
      return;
    }

    this.isSyncing = true;
    this.notify('syncStart');

    try {
      const items = await offlineDB.getPendingSyncItems();
      
      if (items.length === 0) {
        logger.info('[SyncManager] Nenhum item pendente');
        this.notify('syncComplete', { synced: 0, failed: 0 });
        return;
      }

      logger.info(`[SyncManager] Sincronizando ${items.length} itens...`);
      
      let synced = 0;
      let failed = 0;

      for (const item of items) {
        try {
          await this.syncItem(item);
          await offlineDB.markSynced(item.id);
          synced++;
          this.notify('itemSynced', { item, synced, total: items.length });
        } catch (error) {
          logger.error('[SyncManager] Erro ao sincronizar item:', item.id, error);
          await offlineDB.incrementRetry(item.id);
          failed++;
          this.notify('itemFailed', { item, error });
        }

        // Pequeno delay entre itens para não sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info(`[SyncManager] Sync completo: ${synced} ok, ${failed} falhou`);
      this.notify('syncComplete', { synced, failed, total: items.length });

    } catch (error) {
      logger.error('[SyncManager] Erro no sync:', error);
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
        logger.warn('[SyncManager] Operação desconhecida:', operation);
    }
  }

  /**
   * Sincroniza resposta individual
   */
  async syncAnswer(data) {
    const baseUrl = window.SIMULADOS_CONFIG?.BACKEND_BASE || (window.location && window.location.origin) || 'http://app.localhost:3000';

    const headers = this.buildAuthHeaders('application/json');

    const response = await fetch(`${baseUrl}/api/exams/answer`, {
      method: 'POST',
      headers,
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
    const baseUrl = window.SIMULADOS_CONFIG?.BACKEND_BASE || (window.location && window.location.origin) || 'http://app.localhost:3000';

    const headers = this.buildAuthHeaders('application/json');

    const response = await fetch(`${baseUrl}/api/exams/submit`, {
      method: 'POST',
      headers,
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
    const baseUrl = window.SIMULADOS_CONFIG?.BACKEND_BASE || (window.location && window.location.origin) || 'http://app.localhost:3000';

    const headers = this.buildAuthHeaders('application/json');

    const response = await fetch(`${baseUrl}/api/exams/progress`, {
      method: 'POST',
      headers,
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
    logger.info('[SyncManager] Destruído');
  }
}

// Singleton
const syncManager = new SyncManager();

// Export global
if (typeof window !== 'undefined') {
  window.syncManager = syncManager;
}

export default syncManager;
