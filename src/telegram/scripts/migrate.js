#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { db } = require('../src/database/models');
const logger = require('../src/utils/logger');

/**
 * Database migration script
 */

class MigrationRunner {
  constructor() {
    this.migrationsDir = path.join(__dirname, 'migrations');
    this.migrationsTable = 'schema_migrations';
  }

  async initialize() {
    try {
      // Ensure migrations directory exists
      await fs.mkdir(this.migrationsDir, { recursive: true });
      
      // Ensure migrations table exists
      await this.createMigrationsTable();
      
      logger.info('Migration system initialized');
      
    } catch (error) {
      logger.error('Failed to initialize migration system:', error);
      throw error;
    }
  }

  async createMigrationsTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
        id SERIAL PRIMARY KEY,
        version VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    
    await db.query(query);
  }

  async getAppliedMigrations() {
    const query = `SELECT version, name FROM ${this.migrationsTable} ORDER BY applied_at ASC;`;
    const result = await db.query(query);
    return result.rows;
  }

  async getMigrationFiles() {
    try {
      const files = await fs.readdir(this.migrationsDir);
      return files
        .filter(file => file.endsWith('.js') && file.match(/^\d+_.+\.js$/))
        .sort();
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async createMigration(name) {
    const timestamp = Date.now();
    const version = `${timestamp}`;
    const filename = `${version}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.js`;
    const filepath = path.join(this.migrationsDir, filename);
    
    const template = `'use strict';

/**
 * Migration: ${name}
 * Version: ${version}
 * Created: ${new Date().toISOString()}
 */

module.exports = {
  async up(query) {
    // Write your migration here
    // Example:
    // await query(\`
    //   CREATE TABLE example (
    //     id SERIAL PRIMARY KEY,
    //     name VARCHAR(255) NOT NULL
    //   );
    // \`);
  },

  async down(query) {
    // Write how to revert the migration here
    // Example:
    // await query('DROP TABLE IF EXISTS example;');
  }
};
`;
    
    await fs.writeFile(filepath, template);
    logger.info(`Created migration: ${filename}`);
    
    return filepath;
  }

  async runMigrations(targetVersion = null) {
    try {
      await this.initialize();
      
      const applied = await this.getAppliedMigrations();
      const appliedVersions = new Set(applied.map(m => m.version));
      
      const files = await this.getMigrationFiles();
      const pending = files.filter(file => {
        const version = file.split('_')[0];
        return !appliedVersions.has(version);
      });
      
      if (pending.length === 0) {
        logger.info('No pending migrations');
        return { applied: 0, pending: 0 };
      }
      
      logger.info(`Found ${pending.length} pending migration(s)`);
      
      let appliedCount = 0;
      
      for (const file of pending) {
        const version = file.split('_')[0];
        const name = file.replace(/^\d+_/, '').replace(/\.js$/, '').replace(/_/g, ' ');
        
        if (targetVersion && version > targetVersion) {
          break;
        }
        
        try {
          await this.runMigration(file, version, name);
          appliedCount++;
        } catch (error) {
          logger.error(`Failed to run migration ${file}:`, error);
          throw error;
        }
      }
      
      logger.info(`Applied ${appliedCount} migration(s)`);
      return { applied: appliedCount, pending: pending.length - appliedCount };
      
    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  }

  async runMigration(filename, version, name) {
    const filepath = path.join(this.migrationsDir, filename);
    const migration = require(filepath);
    
    logger.info(`Running migration: ${filename} (${name})`);
    
    // Start transaction
    const client = await db.beginTransaction();
    
    try {
      // Run migration up
      await migration.up(client);
      
      // Record migration
      await client.query(
        `INSERT INTO ${this.migrationsTable} (version, name) VALUES ($1, $2);`,
        [version, name]
      );
      
      // Commit transaction
      await db.commitTransaction(client);
      
      logger.info(`✓ Migration ${filename} completed`);
      
    } catch (error) {
      // Rollback on error
      await db.rollbackTransaction(client);
      throw error;
    }
  }

  async rollbackMigrations(count = 1) {
    try {
      await this.initialize();
      
      const applied = await this.getAppliedMigrations();
      const toRollback = applied.slice(-count).reverse();
      
      if (toRollback.length === 0) {
        logger.info('No migrations to rollback');
        return { rolledBack: 0 };
      }
      
      logger.info(`Rolling back ${toRollback.length} migration(s)`);
      
      let rolledBackCount = 0;
      
      for (const migration of toRollback) {
        try {
          await this.rollbackMigration(migration);
          rolledBackCount++;
        } catch (error) {
          logger.error(`Failed to rollback migration ${migration.version}:`, error);
          throw error;
        }
      }
      
      logger.info(`Rolled back ${rolledBackCount} migration(s)`);
      return { rolledBack: rolledBackCount };
      
    } catch (error) {
      logger.error('Rollback failed:', error);
      throw error;
    }
  }

  async rollbackMigration(migration) {
    const files = await this.getMigrationFiles();
    const file = files.find(f => f.startsWith(migration.version + '_'));
    
    if (!file) {
      throw new Error(`Migration file not found for version ${migration.version}`);
    }
    
    const filepath = path.join(this.migrationsDir, file);
    const migrationModule = require(filepath);
    
    logger.info(`Rolling back migration: ${file} (${migration.name})`);
    
    // Start transaction
    const client = await db.beginTransaction();
    
    try {
      // Run migration down
      if (migrationModule.down) {
        await migrationModule.down(client);
      }
      
      // Remove migration record
      await client.query(
        `DELETE FROM ${this.migrationsTable} WHERE version = $1;`,
        [migration.version]
      );
      
      // Commit transaction
      await db.commitTransaction(client);
      
      logger.info(`✓ Rollback ${file} completed`);
      
    } catch (error) {
      // Rollback on error
      await db.rollbackTransaction(client);
      throw error;
    }
  }

  async status() {
    try {
      await this.initialize();
      
      const applied = await this.getAppliedMigrations();
      const files = await this.getMigrationFiles();
      
      logger.info('Migration Status:');
      logger.info(`Applied: ${applied.length}`);
      logger.info(`Pending: ${files.length - applied.length}`);
      
      console.log('\n=== Applied Migrations ===');
      applied.forEach(m => {
        console.log(`✓ ${m.version} - ${m.name} (${m.applied_at})`);
      });
      
      console.log('\n=== Pending Migrations ===');
      files.forEach(file => {
        const version = file.split('_')[0];
        const name = file.replace(/^\d+_/, '').replace(/\.js$/, '').replace(/_/g, ' ');
        const isApplied = applied.some(m => m.version === version);
        
        if (!isApplied) {
          console.log(`○ ${version} - ${name}`);
        }
      });
      
      return { applied: applied.length, pending: files.length - applied.length };
      
    } catch (error) {
      logger.error('Failed to get migration status:', error);
      throw error;
    }
  }
}

// Command line interface
async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  const runner = new MigrationRunner();
  
  try {
    switch (command) {
      case 'up':
      case 'migrate':
        await runner.runMigrations(arg);
        break;
        
      case 'down':
      case 'rollback':
        await runner.rollbackMigrations(parseInt(arg || '1', 10));
        break;
        
      case 'create':
        if (!arg) {
          throw new Error('Migration name required');
        }
        await runner.createMigration(arg);
        break;
        
      case 'status':
        await runner.status();
        break;
        
      case 'init':
        await runner.initialize();
        logger.info('Migration system initialized');
        break;
        
      default:
        console.log(`
Database Migration Tool for Telegram Travel Bot

Usage:
  npm run migrate <command> [options]

Commands:
  up [version]    Run all pending migrations (or up to specific version)
  down [count]    Rollback migrations (default: 1)
  create <name>   Create a new migration file
  status          Show migration status
  init            Initialize migration system

Examples:
  npm run migrate create add_users_table
  npm run migrate up
  npm run migrate status
  npm run migrate down 2
        `);
        process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Migration error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = MigrationRunner;
