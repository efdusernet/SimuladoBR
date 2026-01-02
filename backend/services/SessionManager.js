/**
 * Session Storage Manager
 * Provides persistent session storage with Redis support and in-memory fallback
 * Enables horizontal scaling and session recovery across server restarts
 */

const redis = require('redis');

const { logger } = require('../utils/logger');
class SessionManager {
  constructor() {
    this.client = null;
    this.isRedisAvailable = false;
    this.memoryStore = new Map(); // Fallback for development
    this.defaultTTL = 6 * 60 * 60; // 6 hours in seconds
    this.initializeRedis();
  }

  /**
   * Initialize Redis connection with graceful fallback
   */
  async initializeRedis() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const useRedis = process.env.USE_REDIS !== 'false'; // Default to true in production

    if (!useRedis) {
      logger.info('[SessionManager] Redis disabled - using in-memory storage (development mode)');
      return;
    }

    try {
      this.client = redis.createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error('[SessionManager] Redis reconnection failed after 10 attempts');
              return new Error('Redis reconnection limit exceeded');
            }
            return Math.min(retries * 100, 3000); // Exponential backoff, max 3s
          }
        }
      });

      this.client.on('error', (err) => {
        logger.error('[SessionManager] Redis error:', err.message);
        this.isRedisAvailable = false;
      });

      this.client.on('connect', () => {
        logger.info('[SessionManager] Redis connected successfully');
        this.isRedisAvailable = true;
      });

      this.client.on('ready', () => {
        logger.info('[SessionManager] Redis ready for operations');
        this.isRedisAvailable = true;
      });

      this.client.on('reconnecting', () => {
        logger.info('[SessionManager] Redis reconnecting...');
        this.isRedisAvailable = false;
      });

      await this.client.connect();
      
      // Test connection
      await this.client.ping();
      this.isRedisAvailable = true;
      logger.info('[SessionManager] Redis connection verified');

    } catch (error) {
      logger.warn('[SessionManager] Redis connection failed, falling back to in-memory storage:', error.message);
      this.isRedisAvailable = false;
      this.client = null;
    }
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Build Redis key for session
   */
  _buildKey(sessionId) {
    return `exam:session:${sessionId}`;
  }

  /**
   * Store session data
   * @param {string} sessionId - Unique session identifier
   * @param {object} data - Session data to store
   * @param {number} ttlMs - Time to live in milliseconds (default: 6 hours)
   */
  async putSession(sessionId, data, ttlMs = this.defaultTTL * 1000) {
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    const sessionData = {
      ...data,
      createdAt: data.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    if (this.isRedisAvailable && this.client) {
      try {
        const key = this._buildKey(sessionId);
        await this.client.setEx(key, ttlSeconds, JSON.stringify(sessionData));
        return true;
      } catch (error) {
        logger.error('[SessionManager] Redis putSession error:', error.message);
        // Fallback to memory
        this.isRedisAvailable = false;
      }
    }

    // Memory fallback
    const expiresAt = Date.now() + ttlMs;
    this.memoryStore.set(sessionId, { ...sessionData, expiresAt });
    return true;
  }

  /**
   * Retrieve session data
   * @param {string} sessionId - Session identifier
   * @returns {object|null} Session data or null if not found/expired
   */
  async getSession(sessionId) {
    if (this.isRedisAvailable && this.client) {
      try {
        const key = this._buildKey(sessionId);
        const data = await this.client.get(key);
        if (!data) return null;
        
        return JSON.parse(data);
      } catch (error) {
        logger.error('[SessionManager] Redis getSession error:', error.message);
        this.isRedisAvailable = false;
      }
    }

    // Memory fallback
    const session = this.memoryStore.get(sessionId);
    if (!session) return null;
    
    // Check expiration
    if (session.expiresAt && session.expiresAt < Date.now()) {
      this.memoryStore.delete(sessionId);
      return null;
    }
    
    return session;
  }

  /**
   * Update existing session with partial data
   * @param {string} sessionId - Session identifier
   * @param {object} patch - Partial data to merge
   * @returns {object|null} Updated session or null if not found
   */
  async updateSession(sessionId, patch) {
    const existing = await this.getSession(sessionId);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...patch,
      updatedAt: Date.now()
    };

    // Preserve TTL if in Redis
    if (this.isRedisAvailable && this.client) {
      try {
        const key = this._buildKey(sessionId);
        const ttl = await this.client.ttl(key);
        const ttlSeconds = ttl > 0 ? ttl : this.defaultTTL;
        
        await this.client.setEx(key, ttlSeconds, JSON.stringify(updated));
        return updated;
      } catch (error) {
        logger.error('[SessionManager] Redis updateSession error:', error.message);
        this.isRedisAvailable = false;
      }
    }

    // Memory fallback - preserve expiresAt
    const expiresAt = existing.expiresAt || (Date.now() + this.defaultTTL * 1000);
    this.memoryStore.set(sessionId, { ...updated, expiresAt });
    return updated;
  }

  /**
   * Delete session
   * @param {string} sessionId - Session identifier
   */
  async deleteSession(sessionId) {
    if (this.isRedisAvailable && this.client) {
      try {
        const key = this._buildKey(sessionId);
        await this.client.del(key);
        return true;
      } catch (error) {
        logger.error('[SessionManager] Redis deleteSession error:', error.message);
        this.isRedisAvailable = false;
      }
    }

    // Memory fallback
    this.memoryStore.delete(sessionId);
    return true;
  }

  /**
   * Extend session TTL
   * @param {string} sessionId - Session identifier
   * @param {number} ttlMs - New TTL in milliseconds
   */
  async extendSession(sessionId, ttlMs = this.defaultTTL * 1000) {
    if (this.isRedisAvailable && this.client) {
      try {
        const key = this._buildKey(sessionId);
        const ttlSeconds = Math.ceil(ttlMs / 1000);
        await this.client.expire(key, ttlSeconds);
        return true;
      } catch (error) {
        logger.error('[SessionManager] Redis extendSession error:', error.message);
        this.isRedisAvailable = false;
      }
    }

    // Memory fallback
    const session = this.memoryStore.get(sessionId);
    if (session) {
      session.expiresAt = Date.now() + ttlMs;
      this.memoryStore.set(sessionId, session);
    }
    return true;
  }

  /**
   * Get all session IDs (for debugging/maintenance)
   * Warning: Expensive operation in Redis
   */
  async getAllSessionIds() {
    if (this.isRedisAvailable && this.client) {
      try {
        const pattern = this._buildKey('*');
        const keys = await this.client.keys(pattern);
        return keys.map(k => k.replace('exam:session:', ''));
      } catch (error) {
        logger.error('[SessionManager] Redis getAllSessionIds error:', error.message);
      }
    }

    // Memory fallback
    return Array.from(this.memoryStore.keys());
  }

  /**
   * Cleanup expired sessions (memory store only - Redis handles TTL automatically)
   */
  cleanupExpiredSessions() {
    if (this.isRedisAvailable) return; // Redis handles this automatically

    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.memoryStore.entries()) {
      if (session.expiresAt && session.expiresAt < now) {
        this.memoryStore.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[SessionManager] Cleaned up ${cleanedCount} expired sessions from memory`);
    }
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    const stats = {
      backend: this.isRedisAvailable ? 'redis' : 'memory',
      redisConnected: this.isRedisAvailable
    };

    if (this.isRedisAvailable && this.client) {
      try {
        const info = await this.client.info('stats');
        const keys = await this.client.keys(this._buildKey('*'));
        stats.sessionCount = keys.length;
        stats.redisInfo = info;
      } catch (error) {
        stats.error = error.message;
      }
    } else {
      stats.sessionCount = this.memoryStore.size;
    }

    return stats;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.client) {
      try {
        await this.client.quit();
        logger.info('[SessionManager] Redis connection closed gracefully');
      } catch (error) {
        logger.error('[SessionManager] Error closing Redis connection:', error.message);
      }
    }
  }
}

// Singleton instance
const sessionManager = new SessionManager();

// Cleanup expired sessions every 5 minutes (memory store only)
setInterval(() => {
  sessionManager.cleanupExpiredSessions();
}, 5 * 60 * 1000);

// Graceful shutdown handler
process.on('SIGINT', async () => {
  logger.info('[SessionManager] Shutting down...');
  await sessionManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('[SessionManager] Shutting down...');
  await sessionManager.shutdown();
  process.exit(0);
});

module.exports = sessionManager;
