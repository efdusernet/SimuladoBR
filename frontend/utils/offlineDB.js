/**
 * IndexedDB Manager para PWA Offline-First
 * Gerencia cache local de questões, tentativas e sincronização
 */

const DB_NAME = 'SimuladosBR';
const DB_VERSION = 3;

// Stores
const STORES = {
  QUESTIONS: 'questions',           // Cache de questões
  ATTEMPTS: 'attempts',             // Tentativas offline
  ANSWERS: 'answers',               // Respostas pendentes
  SYNC_QUEUE: 'syncQueue',         // Fila de sincronização
  META: 'meta'                      // Metadados e configurações
};

class OfflineDB {
  constructor() {
    this.db = null;
    this.isReady = false;
  }

  /**
   * Inicializa o banco de dados
   */
  async init() {
    if (this.isReady) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        logger.error('[OfflineDB] Erro ao abrir DB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isReady = true;
        logger.info('[OfflineDB] DB inicializado com sucesso');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        logger.info('[OfflineDB] Upgrade necessário:', event.oldVersion, '→', event.newVersion);

        // Store: Questions (cache de questões)
        if (!db.objectStoreNames.contains(STORES.QUESTIONS)) {
          const questionsStore = db.createObjectStore(STORES.QUESTIONS, { keyPath: 'id' });
          questionsStore.createIndex('examType', 'examType', { unique: false });
          questionsStore.createIndex('domain', 'iddominio_desempenho', { unique: false });
          questionsStore.createIndex('cached', 'cachedAt', { unique: false });
          logger.info('[OfflineDB] Store "questions" criado');
        } else {
          // Migration: update domain index keyPath to `iddominio_desempenho`
          try {
            const tx = event.target.transaction;
            const questionsStore = tx.objectStore(STORES.QUESTIONS);
            if (questionsStore && questionsStore.indexNames && questionsStore.indexNames.contains('domain')) {
              try { questionsStore.deleteIndex('domain'); } catch (_) {}
            }
            if (questionsStore && questionsStore.createIndex) {
              questionsStore.createIndex('domain', 'iddominio_desempenho', { unique: false });
            }
          } catch (_) {
            // Best-effort: if migration fails, cache still works via full scan filter.
          }
        }

        // Store: Attempts (tentativas offline)
        if (!db.objectStoreNames.contains(STORES.ATTEMPTS)) {
          const attemptsStore = db.createObjectStore(STORES.ATTEMPTS, { keyPath: 'sessionId' });
          attemptsStore.createIndex('userId', 'userId', { unique: false });
          attemptsStore.createIndex('status', 'status', { unique: false });
          attemptsStore.createIndex('created', 'createdAt', { unique: false });
          logger.info('[OfflineDB] Store "attempts" criado');
        }

        // Store: Answers (respostas pendentes de sync)
        if (!db.objectStoreNames.contains(STORES.ANSWERS)) {
          const answersStore = db.createObjectStore(STORES.ANSWERS, { keyPath: 'id', autoIncrement: true });
          answersStore.createIndex('sessionId', 'sessionId', { unique: false });
          answersStore.createIndex('synced', 'synced', { unique: false });
          answersStore.createIndex('timestamp', 'timestamp', { unique: false });
          logger.info('[OfflineDB] Store "answers" criado');
        }

        // Store: Sync Queue (operações pendentes)
        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
          const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
          syncStore.createIndex('operation', 'operation', { unique: false });
          syncStore.createIndex('priority', 'priority', { unique: false });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
          syncStore.createIndex('retries', 'retries', { unique: false });
          logger.info('[OfflineDB] Store "syncQueue" criado');
        }

        // Store: Meta (configurações e estado)
        if (!db.objectStoreNames.contains(STORES.META)) {
          db.createObjectStore(STORES.META, { keyPath: 'key' });
          logger.info('[OfflineDB] Store "meta" criado');
        }
      };
    });
  }

  /**
   * Salva questões no cache local
   */
  async cacheQuestions(questions, examType = 'pmp') {
    await this.init();
    const tx = this.db.transaction(STORES.QUESTIONS, 'readwrite');
    const store = tx.objectStore(STORES.QUESTIONS);
    const cachedAt = Date.now();

    const promises = questions.map(q => {
      const cached = {
        ...q,
        examType,
        cachedAt,
        offline: true
      };
      return store.put(cached);
    });

    await Promise.all(promises);
    logger.info(`[OfflineDB] ${questions.length} questões em cache (${examType})`);
    return questions.length;
  }

  /**
   * Busca questões do cache
   */
  async getQuestions(filters = {}) {
    await this.init();
    const tx = this.db.transaction(STORES.QUESTIONS, 'readonly');
    const store = tx.objectStore(STORES.QUESTIONS);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        let questions = request.result || [];

        // Aplicar filtros
        if (filters.examType) {
          questions = questions.filter(q => q.examType === filters.examType);
        }
        if (filters.domain) {
          questions = questions.filter(q => q.iddominio_desempenho === filters.domain);
        }
        if (filters.limit) {
          questions = questions.slice(0, filters.limit);
        }

        logger.info(`[OfflineDB] ${questions.length} questões recuperadas do cache`);
        resolve(questions);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Salva tentativa localmente
   */
  async saveAttempt(attempt) {
    await this.init();
    const tx = this.db.transaction(STORES.ATTEMPTS, 'readwrite');
    const store = tx.objectStore(STORES.ATTEMPTS);

    const attemptData = {
      ...attempt,
      synced: false,
      updatedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
      const request = store.put(attemptData);
      request.onsuccess = () => {
        logger.info('[OfflineDB] Tentativa salva:', attempt.sessionId);
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Salva resposta na fila de sincronização
   */
  async saveAnswer(sessionId, questionId, answer) {
    await this.init();
    const tx = this.db.transaction(STORES.ANSWERS, 'readwrite');
    const store = tx.objectStore(STORES.ANSWERS);

    const answerData = {
      sessionId,
      questionId,
      answer,
      synced: false,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const request = store.add(answerData);
      request.onsuccess = () => {
        logger.info('[OfflineDB] Resposta salva offline:', questionId);
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Adiciona operação na fila de sincronização
   */
  async addToSyncQueue(operation, data, priority = 5) {
    await this.init();
    const tx = this.db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.SYNC_QUEUE);

    const queueItem = {
      operation,
      data,
      priority,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: 3,
      status: 'pending'
    };

    return new Promise((resolve, reject) => {
      const request = store.add(queueItem);
      request.onsuccess = () => {
        logger.info('[OfflineDB] Operação adicionada à fila:', operation);
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Busca itens pendentes na fila
   */
  async getPendingSyncItems() {
    await this.init();
    const tx = this.db.transaction(STORES.SYNC_QUEUE, 'readonly');
    const store = tx.objectStore(STORES.SYNC_QUEUE);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const items = (request.result || [])
          .filter(item => item.status === 'pending' && item.retries < item.maxRetries)
          .sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);
        logger.info(`[OfflineDB] ${items.length} itens pendentes de sincronização`);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Marca item da fila como sincronizado
   */
  async markSynced(itemId) {
    await this.init();
    const tx = this.db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.SYNC_QUEUE);

    return new Promise((resolve, reject) => {
      const getReq = store.get(itemId);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item.status = 'synced';
          item.syncedAt = Date.now();
          const putReq = store.put(item);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Incrementa contador de tentativas de um item
   */
  async incrementRetry(itemId) {
    await this.init();
    const tx = this.db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.SYNC_QUEUE);

    return new Promise((resolve, reject) => {
      const getReq = store.get(itemId);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item.retries = (item.retries || 0) + 1;
          item.lastRetry = Date.now();
          const putReq = store.put(item);
          putReq.onsuccess = () => resolve(item.retries);
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve(0);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Salva metadado
   */
  async setMeta(key, value) {
    await this.init();
    const tx = this.db.transaction(STORES.META, 'readwrite');
    const store = tx.objectStore(STORES.META);

    return new Promise((resolve, reject) => {
      const request = store.put({ key, value, updatedAt: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Busca metadado
   */
  async getMeta(key, defaultValue = null) {
    await this.init();
    const tx = this.db.transaction(STORES.META, 'readonly');
    const store = tx.objectStore(STORES.META);

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : defaultValue);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Limpa cache antigo (older than N days)
   */
  async cleanOldCache(daysOld = 7) {
    await this.init();
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const tx = this.db.transaction(STORES.QUESTIONS, 'readwrite');
    const store = tx.objectStore(STORES.QUESTIONS);
    const index = store.index('cached');

    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);
      let deleted = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          logger.info(`[OfflineDB] ${deleted} questões antigas removidas do cache`);
          resolve(deleted);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Estatísticas do cache
   */
  async getStats() {
    await this.init();
    const stats = {};

    for (const storeName of Object.values(STORES)) {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const countReq = store.count();
      
      stats[storeName] = await new Promise((resolve) => {
        countReq.onsuccess = () => resolve(countReq.result);
        countReq.onerror = () => resolve(0);
      });
    }

    logger.info('[OfflineDB] Estatísticas:', stats);
    return stats;
  }
}

// Singleton instance
const offlineDB = new OfflineDB();

// Export para uso global
if (typeof window !== 'undefined') {
  window.offlineDB = offlineDB;
}

export default offlineDB;
