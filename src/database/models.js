'use strict';

const { Pool } = require('pg');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Database models for Telegram Travel Bot
 */

class Database {
  constructor() {
    this.pool = null;
    this.initialized = false;
  }

  /**
   * Initialize database connection pool
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      this.pool = new Pool({
        connectionString: config.database.url,
        ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
        max: config.database.pool.max,
        min: config.database.pool.min,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // Test connection
      await this.pool.query('SELECT NOW()');
      
      this.initialized = true;
      logger.info('✅ Database connection established');
      
      // Set up connection error handling
      this.pool.on('error', (err) => {
        logger.error('Unexpected database error:', err);
        this.initialized = false;
      });
      
    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  /**
   * Close database connections
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.initialized = false;
      logger.info('Database connections closed');
    }
  }

  /**
   * Get a client from the pool
   */
  async getClient() {
    if (!this.initialized) {
      await this.initialize();
    }
    
    return await this.pool.connect();
  }

  /**
   * Execute a query with parameters
   */
  async query(text, params) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const start = Date.now();
    
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      // Log slow queries
      if (duration > 1000) {
        logger.warn(`Slow query (${duration}ms):`, { text, params });
      }
      
      return result;
    } catch (error) {
      logger.error('Database query error:', { text, params, error: error.message });
      throw error;
    }
  }

  /**
   * Begin a transaction
   */
  async beginTransaction() {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      return client;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  /**
   * Commit a transaction
   */
  async commitTransaction(client) {
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  /**
   * Rollback a transaction
   */
  async rollbackTransaction(client) {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

// Create database instance
const db = new Database();

// User Model
class UserModel {
  /**
   * Create or update a user
   */
  static async upsert(telegramId, userData = {}) {
    const { username, firstName, lastName, languageCode } = userData;
    
    const query = `
      INSERT INTO users (
        telegram_id, username, first_name, last_name, language_code,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (telegram_id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        language_code = EXCLUDED.language_code,
        updated_at = NOW()
      RETURNING *;
    `;
    
    const result = await db.query(query, [
      telegramId, username, firstName, lastName, languageCode
    ]);
    
    return result.rows[0];
  }

  /**
   * Get user by Telegram ID
   */
  static async getByTelegramId(telegramId) {
    const query = 'SELECT * FROM users WHERE telegram_id = $1;';
    const result = await db.query(query, [telegramId]);
    return result.rows[0];
  }

  /**
   * Get user by ID
   */
  static async getById(id) {
    const query = 'SELECT * FROM users WHERE id = $1;';
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Update user search count
   */
  static async incrementSearchCount(telegramId) {
    const query = `
      UPDATE users 
      SET searches_count = searches_count + 1, 
          updated_at = NOW()
      WHERE telegram_id = $1
      RETURNING searches_count;
    `;
    
    const result = await db.query(query, [telegramId]);
    return result.rows[0]?.searches_count || 0;
  }

  /**
   * Get user statistics
   */
  static async getStats(telegramId) {
    const query = `
      SELECT 
        u.*,
        COUNT(s.id) as total_searches,
        COUNT(DISTINCT s.from_city) as unique_from_cities,
        COUNT(DISTINCT s.to_city) as unique_to_cities,
        MIN(s.created_at) as first_search_date,
        MAX(s.created_at) as last_search_date
      FROM users u
      LEFT JOIN searches s ON u.id = s.user_id
      WHERE u.telegram_id = $1
      GROUP BY u.id;
    `;
    
    const result = await db.query(query, [telegramId]);
    return result.rows[0];
  }

  /**
   * Get all users (for admin)
   */
  static async getAll(limit = 100, offset = 0) {
    const query = `
      SELECT * FROM users 
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2;
    `;
    
    const result = await db.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Delete user (for admin)
   */
  static async delete(telegramId) {
    const query = 'DELETE FROM users WHERE telegram_id = $1 RETURNING *;';
    const result = await db.query(query, [telegramId]);
    return result.rows[0];
  }
}

// Search Model
class SearchModel {
  /**
   * Save a search
   */
  static async save(searchData) {
    const {
      telegramId,
      fromCity,
      toCity,
      travelDate,
      returnDate,
      passengers,
      cabinClass,
      tripType,
      results,
      currency = 'ZAR',
    } = searchData;
    
    // Get user ID
    const user = await UserModel.getByTelegramId(telegramId);
    if (!user) {
      throw new Error(`User not found: ${telegramId}`);
    }
    
    const query = `
      INSERT INTO searches (
        user_id, from_city, to_city, travel_date, return_date,
        passengers, cabin_class, trip_type, results, currency,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *;
    `;
    
    const result = await db.query(query, [
      user.id,
      fromCity,
      toCity,
      travelDate,
      returnDate,
      passengers || 1,
      cabinClass || 'M',
      tripType || 'oneway',
      JSON.stringify(results || []),
      currency,
    ]);
    
    // Update user search count
    await UserModel.incrementSearchCount(telegramId);
    
    return result.rows[0];
  }

  /**
   * Get user's search history
   */
  static async getByTelegramId(telegramId, limit = 10, offset = 0) {
    const user = await UserModel.getByTelegramId(telegramId);
    if (!user) return [];
    
    const query = `
      SELECT s.* 
      FROM searches s
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    
    const result = await db.query(query, [user.id, limit, offset]);
    return result.rows;
  }

  /**
   * Get search by ID
   */
  static async getById(id) {
    const query = 'SELECT * FROM searches WHERE id = $1;';
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Get popular searches (for caching)
   */
  static async getPopularSearches(limit = 20) {
    const query = `
      SELECT 
        from_city,
        to_city,
        COUNT(*) as search_count,
        AVG(passengers) as avg_passengers,
        MIN(travel_date) as earliest_date,
        MAX(travel_date) as latest_date
      FROM searches
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY from_city, to_city
      ORDER BY search_count DESC
      LIMIT $1;
    `;
    
    const result = await db.query(query, [limit]);
    return result.rows;
  }

  /**
   * Get similar searches
   */
  static async getSimilarSearches(fromCity, toCity, limit = 5) {
    const query = `
      SELECT DISTINCT
        from_city,
        to_city,
        COUNT(*) as frequency,
        MIN(travel_date) as earliest_travel,
        MAX(travel_date) as latest_travel
      FROM searches
      WHERE (from_city = $1 AND to_city = $2)
         OR (from_city = $2 AND to_city = $1)
      GROUP BY from_city, to_city
      ORDER BY frequency DESC
      LIMIT $1;
    `;
    
    const result = await db.query(query, [fromCity, toCity, limit]);
    return result.rows;
  }

  /**
   * Delete old searches (cleanup)
   */
  static async deleteOld(olderThanDays = 90) {
    const query = `
      DELETE FROM searches 
      WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
      RETURNING COUNT(*) as deleted_count;
    `;
    
    const result = await db.query(query);
    return parseInt(result.rows[0].deleted_count, 10);
  }
}

// Affiliate Click Model
class AffiliateClickModel {
  /**
   * Track an affiliate click
   */
  static async track(clickData) {
    const {
      searchId,
      provider,
      routeId,
      userId,
      revenue = 0,
    } = clickData;
    
    const query = `
      INSERT INTO affiliate_clicks (
        search_id, provider, route_id, user_id, revenue, clicked_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *;
    `;
    
    const result = await db.query(query, [
      searchId,
      provider,
      routeId,
      userId,
      revenue,
    ]);
    
    return result.rows[0];
  }

  /**
   * Get affiliate click statistics
   */
  static async getStats(provider = null, startDate = null, endDate = null) {
    let query = `
      SELECT 
        provider,
        COUNT(*) as total_clicks,
        SUM(revenue) as total_revenue,
        AVG(revenue) as avg_revenue,
        MIN(clicked_at) as first_click,
        MAX(clicked_at) as last_click
      FROM affiliate_clicks
    `;
    
    const params = [];
    const conditions = [];
    
    if (provider) {
      conditions.push(`provider = $${params.length + 1}`);
      params.push(provider);
    }
    
    if (startDate) {
      conditions.push(`clicked_at >= $${params.length + 1}`);
      params.push(startDate);
    }
    
    if (endDate) {
      conditions.push(`clicked_at <= $${params.length + 1}`);
      params.push(endDate);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ` GROUP BY provider ORDER BY total_revenue DESC;`;
    
    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get clicks by search ID
   */
  static async getBySearchId(searchId) {
    const query = 'SELECT * FROM affiliate_clicks WHERE search_id = $1 ORDER BY clicked_at DESC;';
    const result = await db.query(query, [searchId]);
    return result.rows;
  }

  /**
   * Get clicks by user ID
   */
  static async getByUserId(userId) {
    const query = `
      SELECT ac.* 
      FROM affiliate_clicks ac
      JOIN searches s ON ac.search_id = s.id
      WHERE s.user_id = $1
      ORDER BY ac.clicked_at DESC;
    `;
    
    const result = await db.query(query, [userId]);
    return result.rows;
  }
}

// Cache Model
class CacheModel {
  /**
   * Save data to cache
   */
  static async set(key, data, ttlSeconds = 3600) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    
    const query = `
      INSERT INTO cached_routes (cache_key, data, expires_at, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (cache_key) DO UPDATE SET
        data = EXCLUDED.data,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW()
      RETURNING *;
    `;
    
    const result = await db.query(query, [
      key,
      JSON.stringify(data),
      expiresAt,
    ]);
    
    return result.rows[0];
  }

  /**
   * Get data from cache
   */
  static async get(key) {
    const query = `
      SELECT data 
      FROM cached_routes 
      WHERE cache_key = $1 
        AND expires_at > NOW();
    `;
    
    const result = await db.query(query, [key]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    try {
      return JSON.parse(result.rows[0].data);
    } catch (error) {
      logger.error('Failed to parse cached data:', error);
      return null;
    }
  }

  /**
   * Delete from cache
   */
  static async delete(key) {
    const query = 'DELETE FROM cached_routes WHERE cache_key = $1 RETURNING *;';
    const result = await db.query(query, [key]);
    return result.rows[0];
  }

  /**
   * Clean expired cache entries
   */
  static async cleanup() {
    const query = `
      DELETE FROM cached_routes 
      WHERE expires_at <= NOW()
      RETURNING COUNT(*) as deleted_count;
    `;
    
    const result = await db.query(query);
    return parseInt(result.rows[0].deleted_count, 10);
  }

  /**
   * Get cache statistics
   */
  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total_entries,
        COUNT(CASE WHEN expires_at > NOW() THEN 1 END) as active_entries,
        COUNT(CASE WHEN expires_at <= NOW() THEN 1 END) as expired_entries,
        MIN(created_at) as oldest_entry,
        MAX(created_at) as newest_entry,
        AVG(EXTRACT(EPOCH FROM (expires_at - created_at))) as avg_ttl_seconds
      FROM cached_routes;
    `;
    
    const result = await db.query(query);
    return result.rows[0];
  }
}

// Price Alert Model
class PriceAlertModel {
  /**
   * Create a price alert
   */
  static async create(alertData) {
    const {
      telegramId,
      fromCity,
      toCity,
      travelDate,
      returnDate,
      targetPrice,
      currency = 'ZAR',
      isActive = true,
    } = alertData;
    
    const user = await UserModel.getByTelegramId(telegramId);
    if (!user) {
      throw new Error(`User not found: ${telegramId}`);
    }
    
    const query = `
      INSERT INTO price_alerts (
        user_id, from_city, to_city, travel_date, return_date,
        target_price, currency, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *;
    `;
    
    const result = await db.query(query, [
      user.id,
      fromCity,
      toCity,
      travelDate,
      returnDate,
      targetPrice,
      currency,
      isActive,
    ]);
    
    return result.rows[0];
  }

  /**
   * Get active price alerts for a user
   */
  static async getActiveByTelegramId(telegramId) {
    const user = await UserModel.getByTelegramId(telegramId);
    if (!user) return [];
    
    const query = `
      SELECT pa.* 
      FROM price_alerts pa
      WHERE pa.user_id = $1 
        AND pa.is_active = true
        AND pa.travel_date >= CURRENT_DATE
      ORDER BY pa.travel_date ASC;
    `;
    
    const result = await db.query(query, [user.id]);
    return result.rows;
  }

  /**
   * Update price alert status
   */
  static async updateStatus(id, isActive) {
    const query = `
      UPDATE price_alerts 
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    
    const result = await db.query(query, [isActive, id]);
    return result.rows[0];
  }

  /**
   * Get alerts that need to be checked
   */
  static async getAlertsToCheck(limit = 50) {
    const query = `
      SELECT pa.*, u.telegram_id
      FROM price_alerts pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.is_active = true
        AND pa.travel_date >= CURRENT_DATE
        AND (pa.last_checked IS NULL OR pa.last_checked < NOW() - INTERVAL '6 hours')
      ORDER BY pa.last_checked NULLS FIRST
      LIMIT $1;
    `;
    
    const result = await db.query(query, [limit]);
    return result.rows;
  }

  /**
   * Update last checked time
   */
  static async updateLastChecked(id) {
    const query = `
      UPDATE price_alerts 
      SET last_checked = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `;
    
    const result = await db.query(query, [id]);
    return result.rows[0];
  }
}

// User Session Model
class UserSessionModel {
  /**
   * Create or update user session
   */
  static async upsert(telegramId, sessionData = {}) {
    const user = await UserModel.getByTelegramId(telegramId);
    if (!user) {
      throw new Error(`User not found: ${telegramId}`);
    }
    
    const query = `
      INSERT INTO user_sessions (
        user_id, data, last_activity, expires_at, created_at, updated_at
      ) VALUES ($1, $2, NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        data = EXCLUDED.data,
        last_activity = NOW(),
        expires_at = NOW() + INTERVAL '30 days',
        updated_at = NOW()
      RETURNING *;
    `;
    
    const result = await db.query(query, [
      user.id,
      JSON.stringify(sessionData),
    ]);
    
    return result.rows[0];
  }

  /**
   * Get user session
   */
  static async get(telegramId) {
    const user = await UserModel.getByTelegramId(telegramId);
    if (!user) return null;
    
    const query = `
      SELECT data 
      FROM user_sessions 
      WHERE user_id = $1 
        AND expires_at > NOW();
    `;
    
    const result = await db.query(query, [user.id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    try {
      return JSON.parse(result.rows[0].data);
    } catch (error) {
      logger.error('Failed to parse session data:', error);
      return null;
    }
  }

  /**
   * Delete expired sessions
   */
  static async cleanup() {
    const query = `
      DELETE FROM user_sessions 
      WHERE expires_at <= NOW()
      RETURNING COUNT(*) as deleted_count;
    `;
    
    const result = await db.query(query);
    return parseInt(result.rows[0].deleted_count, 10);
  }
}

// Initialize database tables
async function initializeTables() {
  const createTablesQuery = `
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username VARCHAR(255),
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      language_code VARCHAR(10),
      searches_count INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Searches table
    CREATE TABLE IF NOT EXISTS searches (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      from_city VARCHAR(100) NOT NULL,
      to_city VARCHAR(100) NOT NULL,
      travel_date DATE NOT NULL,
      return_date DATE,
      passengers INTEGER DEFAULT 1,
      cabin_class CHAR(1) DEFAULT 'M',
      trip_type VARCHAR(20) DEFAULT 'oneway',
      results JSONB,
      currency CHAR(3) DEFAULT 'ZAR',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Affiliate clicks table
    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id SERIAL PRIMARY KEY,
      search_id INTEGER REFERENCES searches(id) ON DELETE CASCADE,
      provider VARCHAR(50) NOT NULL,
      route_id VARCHAR(255),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      revenue DECIMAL(10,2) DEFAULT 0,
      clicked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Cached routes table
    CREATE TABLE IF NOT EXISTS cached_routes (
      id SERIAL PRIMARY KEY,
      cache_key VARCHAR(500) UNIQUE NOT NULL,
      data JSONB NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Price alerts table
    CREATE TABLE IF NOT EXISTS price_alerts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      from_city VARCHAR(100) NOT NULL,
      to_city VARCHAR(100) NOT NULL,
      travel_date DATE NOT NULL,
      return_date DATE,
      target_price DECIMAL(10,2) NOT NULL,
      currency CHAR(3) DEFAULT 'ZAR',
      is_active BOOLEAN DEFAULT true,
      last_checked TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- User sessions table
    CREATE TABLE IF NOT EXISTS user_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      data JSONB NOT NULL,
      last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    
    CREATE INDEX IF NOT EXISTS idx_searches_user_id ON searches(user_id);
    CREATE INDEX IF NOT EXISTS idx_searches_dates ON searches(travel_date, return_date);
    CREATE INDEX IF NOT EXISTS idx_searches_route ON searches(from_city, to_city);
    CREATE INDEX IF NOT EXISTS idx_searches_created_at ON searches(created_at);
    
    CREATE INDEX IF NOT EXISTS idx_clicks_search_id ON affiliate_clicks(search_id);
    CREATE INDEX IF NOT EXISTS idx_clicks_provider ON affiliate_clicks(provider);
    CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON affiliate_clicks(clicked_at);
    
    CREATE INDEX IF NOT EXISTS idx_cache_expires ON cached_routes(expires_at);
    CREATE INDEX IF NOT EXISTS idx_cache_key ON cached_routes(cache_key);
    
    CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON price_alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_active ON price_alerts(is_active);
    CREATE INDEX IF NOT EXISTS idx_alerts_dates ON price_alerts(travel_date, return_date);
    CREATE INDEX IF NOT EXISTS idx_alerts_last_checked ON price_alerts(last_checked);
    
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
  `;
  
  try {
    await db.query(createTablesQuery);
    logger.info('✅ Database tables initialized');
  } catch (error) {
    logger.error('Failed to initialize database tables:', error);
    throw error;
  }
}

module.exports = {
  db,
  UserModel,
  SearchModel,
  AffiliateClickModel,
  CacheModel,
  PriceAlertModel,
  UserSessionModel,
  initializeTables,
};
