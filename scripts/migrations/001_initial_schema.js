'use strict';

/**
 * Migration: Initial Database Schema
 * Version: 001
 * Created: ${new Date().toISOString()}
 */

module.exports = {
  async up(query) {
    // Users table
    await query(`
      CREATE TABLE users (
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
    `);

    // Searches table
    await query(`
      CREATE TABLE searches (
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
    `);

    // Affiliate clicks table
    await query(`
      CREATE TABLE affiliate_clicks (
        id SERIAL PRIMARY KEY,
        search_id INTEGER REFERENCES searches(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL,
        route_id VARCHAR(255),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        revenue DECIMAL(10,2) DEFAULT 0,
        clicked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Cached routes table
    await query(`
      CREATE TABLE cached_routes (
        id SERIAL PRIMARY KEY,
        cache_key VARCHAR(500) UNIQUE NOT NULL,
        data JSONB NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Price alerts table
    await query(`
      CREATE TABLE price_alerts (
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
    `);

    // User sessions table
    await query(`
      CREATE TABLE user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL,
        last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Indexes for performance
    await query(`
      CREATE INDEX idx_users_telegram_id ON users(telegram_id);
      CREATE INDEX idx_users_username ON users(username);
      
      CREATE INDEX idx_searches_user_id ON searches(user_id);
      CREATE INDEX idx_searches_dates ON searches(travel_date, return_date);
      CREATE INDEX idx_searches_route ON searches(from_city, to_city);
      CREATE INDEX idx_searches_created_at ON searches(created_at);
      
      CREATE INDEX idx_clicks_search_id ON affiliate_clicks(search_id);
      CREATE INDEX idx_clicks_provider ON affiliate_clicks(provider);
      CREATE INDEX idx_clicks_clicked_at ON affiliate_clicks(clicked_at);
      
      CREATE INDEX idx_cache_expires ON cached_routes(expires_at);
      CREATE INDEX idx_cache_key ON cached_routes(cache_key);
      
      CREATE INDEX idx_alerts_user_id ON price_alerts(user_id);
      CREATE INDEX idx_alerts_active ON price_alerts(is_active);
      CREATE INDEX idx_alerts_dates ON price_alerts(travel_date, return_date);
      CREATE INDEX idx_alerts_last_checked ON price_alerts(last_checked);
      
      CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);
    `);

    // Insert initial data
    await query(`
      INSERT INTO users (telegram_id, username, first_name, searches_count)
      VALUES (123456789, 'admin', 'Admin', 0)
      ON CONFLICT (telegram_id) DO NOTHING;
    `);
  },

  async down(query) {
    // Drop in reverse order (due to foreign keys)
    await query('DROP INDEX IF EXISTS idx_sessions_expires;');
    await query('DROP INDEX IF EXISTS idx_sessions_user_id;');
    await query('DROP INDEX IF EXISTS idx_alerts_last_checked;');
    await query('DROP INDEX IF EXISTS idx_alerts_dates;');
    await query('DROP INDEX IF EXISTS idx_alerts_active;');
    await query('DROP INDEX IF EXISTS idx_alerts_user_id;');
    await query('DROP INDEX IF EXISTS idx_cache_key;');
    await query('DROP INDEX IF EXISTS idx_cache_expires;');
    await query('DROP INDEX IF EXISTS idx_clicks_clicked_at;');
    await query('DROP INDEX IF EXISTS idx_clicks_provider;');
    await query('DROP INDEX IF EXISTS idx_clicks_search_id;');
    await query('DROP INDEX IF EXISTS idx_searches_created_at;');
    await query('DROP INDEX IF EXISTS idx_searches_route;');
    await query('DROP INDEX IF EXISTS idx_searches_dates;');
    await query('DROP INDEX IF EXISTS idx_searches_user_id;');
    await query('DROP INDEX IF EXISTS idx_users_username;');
    await query('DROP INDEX IF EXISTS idx_users_telegram_id;');

    await query('DROP TABLE IF EXISTS user_sessions;');
    await query('DROP TABLE IF EXISTS price_alerts;');
    await query('DROP TABLE IF EXISTS cached_routes;');
    await query('DROP TABLE IF EXISTS affiliate_clicks;');
    await query('DROP TABLE IF EXISTS searches;');
    await query('DROP TABLE IF EXISTS users;');
  }
};
