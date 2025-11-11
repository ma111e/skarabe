// Cache Storage Library
// Provides a clean abstraction over the Cache API with expiration support

(() => {
  'use strict';

  const CacheStorage = {
    // Check if Cache API is available
    isAvailable() {
      return typeof caches !== 'undefined' && 'caches' in window;
    },

    /**
     * Store data in cache with timestamp
     * @param {string} cacheName - Name of the cache
     * @param {string} key - Cache key (will be normalized to URL)
     * @param {any} data - Data to cache (will be JSON stringified)
     * @param {number} [maxAge] - Optional max age in milliseconds
     */
    async set(cacheName, key, data, maxAge = null) {
      try {
        if (!this.isAvailable()) {
          console.warn('[cache] Cache API not available');
          return false;
        }

        const cache = await caches.open(cacheName);
        const cacheData = {
          timestamp: Date.now(),
          maxAge,
          data
        };

        const response = new Response(JSON.stringify(cacheData), {
          headers: { 'Content-Type': 'application/json' }
        });

        const cacheKey = this._normalizeKey(key);
        await cache.put(cacheKey, response);
        return true;
      } catch (e) {
        console.warn('[cache] Failed to set cache', cacheName, key, e);
        return false;
      }
    },

    /**
     * Get data from cache
     * @param {string} cacheName - Name of the cache
     * @param {string} key - Cache key
     * @returns {Promise<any|null>} Cached data or null if not found/expired
     */
    async get(cacheName, key) {
      try {
        if (!this.isAvailable()) return null;

        const cache = await caches.open(cacheName);
        const cacheKey = this._normalizeKey(key);
        const response = await cache.match(cacheKey);

        if (!response) return null;

        const cacheData = await response.json();
        
        // Check expiration
        if (cacheData.maxAge !== null && cacheData.maxAge !== undefined) {
          const age = Date.now() - cacheData.timestamp;
          if (age > cacheData.maxAge) {
            // Expired - delete and return null
            await this.delete(cacheName, key);
            return null;
          }
        }

        return cacheData.data;
      } catch (e) {
        console.warn('[cache] Failed to get cache', cacheName, key, e);
        return null;
      }
    },

    /**
     * Delete a specific cache entry
     * @param {string} cacheName - Name of the cache
     * @param {string} key - Cache key
     */
    async delete(cacheName, key) {
      try {
        if (!this.isAvailable()) return false;

        const cache = await caches.open(cacheName);
        const cacheKey = this._normalizeKey(key);
        await cache.delete(cacheKey);
        return true;
      } catch (e) {
        console.warn('[cache] Failed to delete cache entry', cacheName, key, e);
        return false;
      }
    },

    /**
     * Clear entire cache
     * @param {string} cacheName - Name of the cache to clear
     */
    async clear(cacheName) {
      try {
        if (!this.isAvailable()) return false;

        await caches.delete(cacheName);
        return true;
      } catch (e) {
        console.warn('[cache] Failed to clear cache', cacheName, e);
        return false;
      }
    },

    /**
     * Get all keys in a cache
     * @param {string} cacheName - Name of the cache
     * @returns {Promise<string[]>} Array of cache keys
     */
    async keys(cacheName) {
      try {
        if (!this.isAvailable()) return [];

        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        return requests.map(req => req.url);
      } catch (e) {
        console.warn('[cache] Failed to get cache keys', cacheName, e);
        return [];
      }
    },

    /**
     * Check if a key exists in cache (and is not expired)
     * @param {string} cacheName - Name of the cache
     * @param {string} key - Cache key
     * @returns {Promise<boolean>}
     */
    async has(cacheName, key) {
      const data = await this.get(cacheName, key);
      return data !== null;
    },

    /**
     * Normalize key to a valid cache key (URL)
     * @private
     */
    _normalizeKey(key) {
      // If already a Request object, return as is
      if (key instanceof Request) return key;
      
      // If it looks like a URL, use it directly
      if (key.startsWith('http://') || key.startsWith('https://')) {
        return new Request(key);
      }
      
      // Otherwise, create a fake URL using current origin
      const baseUrl = window.location.origin;
      const url = `${baseUrl}/cache/${encodeURIComponent(key)}`;
      return new Request(url);
    }
  };

  // Expose globally
  if (typeof window !== 'undefined') {
    window.CacheStorage = CacheStorage;
  }

  // Also support module exports if needed
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CacheStorage;
  }

  // ===== Query Cache Helpers =====
  // High-level helpers for search query caching
  
  const QueryCache = {
    /**
     * Create cache key for search queries
     * @param {string} q - Search query
     * @param {object} opts - Search options
     * @param {Function} getSelectedTags - Function to get selected tags
     * @returns {string}
     */
    createSearchKey(q, opts, getSelectedTags) {
      const selectedTags = typeof getSelectedTags === 'function' ? getSelectedTags() : [];
      return JSON.stringify({
        q,
        exactMatch: opts.exactMatch,
        caseSensitive: opts.caseSensitive,
        useRegex: opts.useRegex,
        tags: Array.from(selectedTags)
      });
    },

    /**
     * Create cache key for worker queries
     * @param {Array} terms - Search terms
     * @param {Array} tags - Tags
     * @param {Array} tabs - Selected tabs
     * @param {object} options - Query options
     * @returns {string}
     */
    createWorkerKey(terms, tags, tabs, options) {
      return JSON.stringify({ terms, tags, tabs: tabs.sort(), options });
    },

    /**
     * Get cached query results
     * @param {string} key - Cache key (stringified query params)
     * @returns {Promise<any|null>}
     */
    async get(key) {
      if (!this.isAvailable()) return null;
      const cacheName = typeof QUERY_CACHE_NAME !== 'undefined' ? QUERY_CACHE_NAME : 'search-query-cache-v1';
      return await CacheStorage.get(cacheName, key);
    },

    /**
     * Store query results in cache
     * @param {string} key - Cache key (stringified query params)
     * @param {any} results - Results to cache
     */
    async set(key, results) {
      if (!this.isAvailable()) return;
      const cacheName = typeof QUERY_CACHE_NAME !== 'undefined' ? QUERY_CACHE_NAME : 'search-query-cache-v1';
      const maxAge = typeof QUERY_CACHE_MAX_AGE !== 'undefined' ? QUERY_CACHE_MAX_AGE : 24 * 60 * 60 * 1000;
      await CacheStorage.set(cacheName, key, results, maxAge);
      await this.cleanup();
    },

    /**
     * Clean up old cache entries
     */
    async cleanup() {
      if (!this.isAvailable()) return;
      const cacheName = typeof QUERY_CACHE_NAME !== 'undefined' ? QUERY_CACHE_NAME : 'search-query-cache-v1';
      const maxSize = typeof QUERY_CACHE_MAX_SIZE !== 'undefined' ? QUERY_CACHE_MAX_SIZE : 100;
      
      try {
        const keys = await CacheStorage.keys(cacheName);
        if (keys.length <= maxSize) return;

        // Delete oldest entries
        const toDelete = keys.slice(0, keys.length - maxSize);
        await Promise.all(toDelete.map(key => CacheStorage.delete(cacheName, key)));
        console.info(`[cache] Cleaned up ${toDelete.length} old query cache entries`);
      } catch (e) {
        console.warn('[cache] Cleanup failed', e);
      }
    },

    /**
     * Clear all query cache
     */
    async clear() {
      if (!this.isAvailable()) return;
      const cacheName = typeof QUERY_CACHE_NAME !== 'undefined' ? QUERY_CACHE_NAME : 'search-query-cache-v1';
      await CacheStorage.clear(cacheName);
    },

    isAvailable() {
      return CacheStorage.isAvailable();
    }
  };

  // Expose QueryCache globally
  if (typeof window !== 'undefined') {
    window.QueryCache = QueryCache;
  }
})();
