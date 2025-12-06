/**
 * Componente UI: Offline Status Indicator
 * Mostra status de conexão e sincronização
 */

class OfflineIndicator {
  constructor() {
    this.container = null;
    this.isVisible = false;
    this.init();
  }

  init() {
    this.createIndicator();
    this.attachListeners();
    this.updateStatus();
  }

  createIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'offline-indicator';
    indicator.innerHTML = `
      <style>
        #offline-indicator {
          position: fixed;
          top: 10px;
          right: 10px;
          z-index: 10000;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: none;
        }

        .offline-badge {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 10px 20px;
          border-radius: 24px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
        }

        .offline-badge:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
        }

        .offline-badge.online {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        }

        .offline-badge.syncing {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: white;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .offline-panel {
          position: absolute;
          top: 60px;
          right: 0;
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
          padding: 20px;
          min-width: 320px;
          max-width: 400px;
          display: none;
          color: #1f2937;
        }

        .offline-panel.show {
          display: block;
          animation: slideIn 0.3s ease;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding-bottom: 15px;
          border-bottom: 1px solid #e5e7eb;
        }

        .panel-header h3 {
          font-size: 16px;
          font-weight: 700;
          margin: 0;
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: #9ca3af;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .panel-stats {
          display: grid;
          gap: 12px;
        }

        .stat-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
        }

        .stat-label {
          color: #6b7280;
          font-size: 14px;
        }

        .stat-value {
          font-weight: 600;
          font-size: 14px;
          color: #1f2937;
        }

        .sync-btn {
          width: 100%;
          padding: 10px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 15px;
          transition: all 0.3s ease;
        }

        .sync-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .sync-btn:disabled {
          background: #d1d5db;
          cursor: not-allowed;
          transform: none;
        }

        @media (max-width: 480px) {
          #offline-indicator {
            right: 10px;
            left: 10px;
          }

          .offline-badge {
            width: 100%;
            justify-content: center;
          }

          .offline-panel {
            right: 0;
            left: 0;
            margin: 0 10px;
            min-width: auto;
          }
        }
      </style>

      <div class="offline-badge" id="offline-badge">
        <span class="status-dot"></span>
        <span class="status-text">Offline</span>
      </div>

      <div class="offline-panel" id="offline-panel">
        <div class="panel-header">
          <h3>Status de Sincronização</h3>
          <button class="close-btn" id="close-panel">×</button>
        </div>
        
        <div class="panel-stats">
          <div class="stat-row">
            <span class="stat-label">Conexão</span>
            <span class="stat-value" id="connection-status">-</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Itens pendentes</span>
            <span class="stat-value" id="pending-count">0</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Questões em cache</span>
            <span class="stat-value" id="cached-questions">0</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Última sincronização</span>
            <span class="stat-value" id="last-sync">Nunca</span>
          </div>
        </div>

        <button class="sync-btn" id="force-sync">
          Sincronizar agora
        </button>
      </div>
    `;

    document.body.appendChild(indicator);
    this.container = indicator;
    this.attachPanelListeners();
  }

  attachListeners() {
    window.addEventListener('online', () => this.updateStatus());
    window.addEventListener('offline', () => this.updateStatus());

    // Listen to sync manager events
    if (window.syncManager) {
      window.syncManager.addListener(event => {
        if (event.event === 'syncStart') {
          this.updateStatus(true);
        }
        if (event.event === 'syncComplete') {
          this.updateStatus(false);
          this.updateStats();
        }
      });
    }

    // Update stats periodically
    setInterval(() => this.updateStats(), 10000);
  }

  attachPanelListeners() {
    const badge = this.container.querySelector('#offline-badge');
    const panel = this.container.querySelector('#offline-panel');
    const closeBtn = this.container.querySelector('#close-panel');
    const syncBtn = this.container.querySelector('#force-sync');

    badge.addEventListener('click', () => {
      panel.classList.toggle('show');
      this.updateStats();
    });

    closeBtn.addEventListener('click', () => {
      panel.classList.remove('show');
    });

    syncBtn.addEventListener('click', async () => {
      if (!navigator.onLine) {
        alert('Você está offline. A sincronização será automática quando voltar online.');
        return;
      }

      syncBtn.disabled = true;
      syncBtn.textContent = 'Sincronizando...';

      try {
        if (window.syncManager) {
          await window.syncManager.forceSyncNow();
          syncBtn.textContent = '✓ Sincronizado!';
          setTimeout(() => {
            syncBtn.textContent = 'Sincronizar agora';
            syncBtn.disabled = false;
          }, 2000);
        }
      } catch (error) {
        console.error('Erro ao sincronizar:', error);
        syncBtn.textContent = 'Erro - Tente novamente';
        setTimeout(() => {
          syncBtn.textContent = 'Sincronizar agora';
          syncBtn.disabled = false;
        }, 3000);
      }
    });

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        panel.classList.remove('show');
      }
    });
  }

  async updateStatus(isSyncing = false) {
    const isOnline = navigator.onLine;
    const badge = this.container.querySelector('#offline-badge');
    const text = this.container.querySelector('.status-text');

    // Show indicator only when offline or syncing
    if (!isOnline || isSyncing) {
      this.container.style.display = 'block';
    } else {
      // Hide after a delay when going online
      setTimeout(() => {
        if (navigator.onLine) {
          this.container.style.display = 'none';
        }
      }, 3000);
    }

    if (isSyncing) {
      badge.className = 'offline-badge syncing';
      text.textContent = 'Sincronizando...';
    } else if (isOnline) {
      badge.className = 'offline-badge online';
      text.textContent = 'Online';
    } else {
      badge.className = 'offline-badge';
      text.textContent = 'Offline';
    }

    this.updateStats();
  }

  async updateStats() {
    try {
      const connectionStatus = this.container.querySelector('#connection-status');
      const pendingCount = this.container.querySelector('#pending-count');
      const cachedQuestions = this.container.querySelector('#cached-questions');
      const lastSync = this.container.querySelector('#last-sync');

      connectionStatus.textContent = navigator.onLine ? '🟢 Online' : '🔴 Offline';

      if (window.syncManager) {
        const status = await window.syncManager.getStatus();
        pendingCount.textContent = status.pending || 0;
        cachedQuestions.textContent = status.stats?.questions || 0;
      }

      if (window.offlineDB) {
        const lastSyncTime = await window.offlineDB.getMeta('lastSyncTime');
        if (lastSyncTime) {
          const date = new Date(lastSyncTime);
          lastSync.textContent = date.toLocaleString('pt-BR');
        }
      }
    } catch (error) {
      console.error('Erro ao atualizar stats:', error);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new OfflineIndicator();
  });
} else {
  new OfflineIndicator();
}

export default OfflineIndicator;
