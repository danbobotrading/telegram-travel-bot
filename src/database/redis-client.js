'use strict';

const redis = require('redis');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Redis client for caching and rate limiting
 */

class RedisClient {
  constructor() {
    this.client = null;
    this.initialized = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 3;
  }

  /**
   * Initialize Redis connection
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      const options = {
        socket: {
          reconnectStrategy: (retries) => {
            this.connectionAttempts = retries;
            if (retries > this.maxConnectionAttempts) {
              logger.error('Max Redis reconnection attempts reached');
              return new Error('Max reconnection attempts reached');
            }
            return Math.min(retries * 100, 3000);
          }
        }
      };

      // Add password if provided
      if (config.redis.password) {
        options.password = config.redis.password;
      }

      // Add TLS if enabled
      if (config.redis.tls) {
        options.socket.tls = true;
      }

      this.client = redis.createClient({
        url: config.redis.url,
        ...options
      });

      // Setup event handlers
      this.setupEventHandlers();

      // Connect to Redis
      await this.client.connect();
      
      this.initialized = true;
      logger.info('✅ Redis connection established');
      
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  /**
   * Setup Redis event handlers
   */
  setupEventHandlers() {
    this.client.on('connect', () => {
      logger.debug('Redis connecting...');
    });

    this.client.on('ready', () => {
      logger.debug('Redis ready');
    });

    this.client.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    this.client.on('end', () => {
      logger.warn('Redis connection closed');
      this.initialized = false;
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.client) {
      await this.client.quit();
      this.initialized = false;
      logger.info('Redis connection closed');
    }
  }

  /**
   * Set key-value pair with TTL
   */
  async set(key, value, ttlSeconds = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const stringValue = JSON.stringify(value);
      
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, stringValue);
      } else {
        await this.client.set(key, stringValue);
      }
      
      return true;
    } catch (error) {
      logger.error('Redis set error:', error);
      throw error;
    }
  }

  /**
   * Get value by key
   */
  async get(key) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const value = await this.client.get(key);
      
      if (!value) {
        return null;
      }
      
      return JSON.parse(value);
    } catch (error) {
      logger.error('Redis get error:', error);
      return null;
    }
  }

  /**
   * Delete key
   */
  async del(key) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      logger.error('Redis delete error:', error);
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.client.exists(key);
      return result > 0;
    } catch (error) {
      logger.error('Redis exists error:', error);
      throw error;
    }
  }

  /**
   * Set key with TTL if not exists (NX)
   */
  async setnx(key, value, ttlSeconds) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const stringValue = JSON.stringify(value);
      const result = await this.client.set(key, stringValue, {
        NX: true,
        EX: ttlSeconds
      });
      
      return result === 'OK';
    } catch (error) {
      logger.error('Redis setnx error:', error);
      throw error;
    }
  }

  /**
   * Increment key value
   */
  async incr(key) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error('Redis incr error:', error);
      throw error;
    }
  }

  /**
   * Increment key by specific amount
   */
  async incrBy(key, increment) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.incrBy(key, increment);
    } catch (error) {
      logger.error('Redis incrBy error:', error);
      throw error;
    }
  }

  /**
   * Set hash field
   */
  async hset(key, field, value) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const stringValue = JSON.stringify(value);
      return await this.client.hSet(key, field, stringValue);
    } catch (error) {
      logger.error('Redis hset error:', error);
      throw error;
    }
  }

  /**
   * Get hash field
   */
  async hget(key, field) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const value = await this.client.hGet(key, field);
      
      if (!value) {
        return null;
      }
      
      return JSON.parse(value);
    } catch (error) {
      logger.error('Redis hget error:', error);
      return null;
    }
  }

  /**
   * Get all hash fields
   */
  async hgetall(key) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.client.hGetAll(key);
      
      // Parse JSON values
      const parsedResult = {};
      for (const [field, value] of Object.entries(result)) {
        try {
          parsedResult[field] = JSON.parse(value);
        } catch {
          parsedResult[field] = value;
        }
      }
      
      return parsedResult;
    } catch (error) {
      logger.error('Redis hgetall error:', error);
      return {};
    }
  }

  /**
   * Delete hash field
   */
  async hdel(key, field) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.hDel(key, field);
    } catch (error) {
      logger.error('Redis hdel error:', error);
      throw error;
    }
  }

  /**
   * Add to sorted set
   */
  async zadd(key, score, member) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const stringMember = JSON.stringify(member);
      return await this.client.zAdd(key, { score, value: stringMember });
    } catch (error) {
      logger.error('Redis zadd error:', error);
      throw error;
    }
  }

  /**
   * Get range from sorted set
   */
  async zrange(key, start, stop, withScores = false) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const options = withScores ? { WITHSCORES: true } : {};
      const result = await this.client.zRange(key, start, stop, options);
      
      if (!withScores) {
        return result.map(item => {
          try {
            return JSON.parse(item);
          } catch {
            return item;
          }
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Redis zrange error:', error);
      return [];
    }
  }

  /**
   * Get range by score from sorted set
   */
  async zrangebyscore(key, min, max, limit = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.client.zRangeByScore(key, min, max, limit ? { LIMIT: limit } : {});
      
      return result.map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return item;
        }
      });
    } catch (error) {
      logger.error('Redis zrangebyscore error:', error);
      return [];
    }
  }

  /**
   * Remove from sorted set
   */
  async zrem(key, member) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const stringMember = JSON.stringify(member);
      return await this.client.zRem(key, stringMember);
    } catch (error) {
      logger.error('Redis zrem error:', error);
      throw error;
    }
  }

  /**
   * Get sorted set size
   */
  async zcard(key) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.zCard(key);
    } catch (error) {
      logger.error('Redis zcard error:', error);
      throw error;
    }
  }

  /**
   * Add to list
   */
  async lpush(key, value) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const stringValue = JSON.stringify(value);
      return await this.client.lPush(key, stringValue);
    } catch (error) {
      logger.error('Redis lpush error:', error);
      throw error;
    }
  }

  /**
   * Get from list
   */
  async lrange(key, start, stop) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.client.lRange(key, start, stop);
      
      return result.map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return item;
        }
      });
    } catch (error) {
      logger.error('Redis lrange error:', error);
      return [];
    }
  }

  /**
   * Trim list
   */
  async ltrim(key, start, stop) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.lTrim(key, start, stop);
    } catch (error) {
      logger.error('Redis ltrim error:', error);
      throw error;
    }
  }

  /**
   * Get list length
   */
  async llen(key) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.lLen(key);
    } catch (error) {
      logger.error('Redis llen error:', error);
      throw error;
    }
  }

  /**
   * Set expiration for key
   */
  async expire(key, seconds) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      logger.error('Redis expire error:', error);
      throw error;
    }
  }

  /**
   * Get TTL for key
   */
  async ttl(key) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error('Redis ttl error:', error);
      throw error;
    }
  }

  /**
   * Get all keys matching pattern
   */
  async keys(pattern) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error('Redis keys error:', error);
      return [];
    }
  }

  /**
   * Scan for keys matching pattern
   */
  async scan(cursor, pattern, count = 100) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.scan(cursor, {
        MATCH: pattern,
        COUNT: count
      });
    } catch (error) {
      logger.error('Redis scan error:', error);
      return { cursor: '0', keys: [] };
    }
  }

  /**
   * Flush all data (use with caution!)
   */
  async flushall() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.flushAll();
    } catch (error) {
      logger.error('Redis flushall error:', error);
      throw error;
    }
  }

  /**
   * Get Redis info
   */
  async info() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.client.info();
    } catch (error) {
      logger.error('Redis info error:', error);
      return null;
    }
  }

  /**
   * Rate limiting using Redis
   */
  async rateLimit(key, windowMs, maxRequests) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const now = Date.now();
      const windowStart = now - windowMs;
      
      // Remove old requests
      await this.client.zRemRangeByScore(key, 0, windowStart);
      
      // Count current requests
      const currentRequests = await this.client.zCard(key);
      
      if (currentRequests >= maxRequests) {
        // Get oldest request to calculate wait time
        const oldest = await this.client.zRange(key, 0, 0, { WITHSCORES: true });
        const oldestTime = parseInt(oldest[1], 10);
        const waitTime = windowStart + windowMs - now;
        
        return {
          allowed: false,
          remaining: 0,
          reset: new Date(now + waitTime),
          retryAfter: Math.ceil(waitTime / 1000)
        };
      }
      
      // Add current request
      await this.client.zAdd(key, { score: now, value: now.toString() });
      await this.client.expire(key, Math.ceil(windowMs / 1000));
      
      return {
        allowed: true,
        remaining: maxRequests - currentRequests - 1,
        reset: new Date(now + windowMs),
        retryAfter: null
      };
    } catch (error) {
      logger.error('Redis rate limit error:', error);
      // Allow request if Redis fails (fail-open)
      return {
        allowed: true,
        remaining: maxRequests,
        reset: new Date(Date.now() + windowMs),
        retryAfter: null
      };
    }
  }

  /**
   * Cache search results with intelligent TTL
   */
  async cacheSearchResults(key, results, searchParams) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Determine TTL based on search type
      let ttl = config.cache.routeTtl;
      
      if (searchParams) {
        const { travelDate } = searchParams;
        const daysUntilTravel = Math.ceil((new Date(travelDate) - new Date()) / (1000 * 60 * 60 * 24));
        
        if (daysUntilTravel <= 1) {
          ttl = 1800; // 30 minutes for imminent travel
        } else if (daysUntilTravel <= 7) {
          ttl = 3600; // 1 hour for travel within a week
        } else if (daysUntilTravel <= 30) {
          ttl = 7200; // 2 hours for travel within a month
        }
      }
      
      await this.set(key, {
        results,
        cachedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
      }, ttl);
      
      return true;
    } catch (error) {
      logger.error('Failed to cache search results:', error);
      return false;
    }
  }

  /**
   * Get cached search results
   */
  async getCachedSearchResults(key) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const cached = await this.get(key);
      
      if (!cached || !cached.results) {
        return null;
      }
      
      // Check if cache is still valid
      if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
        await this.del(key);
        return null;
      }
      
      return cached.results;
    } catch (error) {
      logger.error('Failed to get cached search results:', error);
      return null;
    }
  }

  /**
   * Track popular searches
   */
  async trackPopularSearch(from, to) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const key = `popular:${from}:${to}`;
      const score = Date.now();
      
      // Add to sorted set with timestamp as score
      await this.zadd('popular_searches', score, { from, to, timestamp: new Date().toISOString() });
      
      // Keep only last 1000 searches
      await this.zremrangebyscore('popular_searches', 0, score - (30 * 24 * 60 * 60 * 1000)); // 30 days
      
      return true;
    } catch (error) {
      logger.error('Failed to track popular search:', error);
      return false;
    }
  }

  /**
   * Get popular searches
   */
  async getPopularSearches(limit = 10) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Get recent searches and count frequencies
      const recentSearches = await this.zrangebyscore(
        'popular_searches',
        Date.now() - (7 * 24 * 60 * 60 * 1000), // Last 7 days
        Date.now(),
        { offset: 0, count: 1000 }
      );
      
      // Count frequencies
      const frequencies = {};
      recentSearches.forEach(search => {
        const key = `${search.from}:${search.to}`;
        frequencies[key] = (frequencies[key] || 0) + 1;
      });
      
      // Sort by frequency
      const sorted = Object.entries(frequencies)
        .sort(([,a], [,b]) => b - a)
        .slice(0, limit)
        .map(([key, count]) => {
          const [from, to] = key.split(':');
          return { from, to, count };
        });
      
      return sorted;
    } catch (error) {
      logger.error('Failed to get popular searches:', error);
      return [];
    }
  }
}

// Create singleton instance
const redisClient = new RedisClient();

module.exports = redisClient;
