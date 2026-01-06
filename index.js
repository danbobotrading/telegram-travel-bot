#!/usr/bin/env node
'use strict';

require('dotenv').config();
const TravelBot = require('./src/telegram/bot');
const logger = require('./src/utils/logger');

/**
 * Telegram Travel Bot - Main Entry Point
 * Advanced flight search with virtual interlining for African routes
 */

class Application {
  constructor() {
    this.bot = null;
    this.shuttingDown = false;
  }

  async start() {
    try {
      logger.info('🚀 Starting Telegram Travel Bot...');
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

      // Handle uncaught exceptions
      this.setupErrorHandlers();

      // Initialize and start the bot
      this.bot = new TravelBot();
      await this.bot.initialize();

      logger.info('✅ Travel Bot started successfully');
      logger.info('🤖 Bot is now listening for messages...');

      // Graceful shutdown handler
      this.setupGracefulShutdown();

    } catch (error) {
      logger.error('❌ Failed to start Travel Bot:', error);
      process.exit(1);
    }
  }

  setupErrorHandlers() {
    // Uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('💥 UNCAUGHT EXCEPTION:', error);
      if (!this.shuttingDown) {
        this.shutdown(1);
      }
    });

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('⚠️ UNHANDLED REJECTION at:', promise, 'reason:', reason);
    });

    // SIGTERM signal
    process.on('SIGTERM', () => {
      logger.info('📩 Received SIGTERM signal');
      this.shutdown(0);
    });

    // SIGINT signal (Ctrl+C)
    process.on('SIGINT', () => {
      logger.info('📩 Received SIGINT signal');
      this.shutdown(0);
    });
  }

  setupGracefulShutdown() {
    // Graceful shutdown function
    const gracefulShutdown = async (signal) => {
      if (this.shuttingDown) return;
      
      this.shuttingDown = true;
      logger.info(`🛑 Received ${signal}. Starting graceful shutdown...`);

      try {
        // Shutdown bot
        if (this.bot) {
          await this.bot.shutdown();
        }

        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    // Attach signal handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  async shutdown(exitCode = 0) {
    this.shuttingDown = true;
    logger.info('🔴 Shutting down Travel Bot...');

    try {
      if (this.bot) {
        await this.bot.shutdown();
      }

      // Close database connections, etc.
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      logger.info('👋 Shutdown completed');
      process.exit(exitCode);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the application
if (require.main === module) {
  const app = new Application();
  app.start().catch(error => {
    logger.error('Fatal error during startup:', error);
    process.exit(1);
  });
}

module.exports = Application;
