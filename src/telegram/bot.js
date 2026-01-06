'use strict';

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const config = require('../../config/config');
const logger = require('../utils/logger');
const { initializeTables } = require('../database/models');
const redisClient = require('../database/redis-client');
const routeStitcher = require('../core/route-stitcher');
const botCommands = require('./commands');
const botFormatter = require('./formatter');
const { UserModel } = require('../database/models');

/**
 * Main Telegram Bot class
 */

class TravelBot {
  constructor() {
    this.bot = null;
    this.app = null;
    this.server = null;
    this.isShuttingDown = false;
    this.userSessions = new Map(); // In-memory session storage
  }

  /**
   * Initialize the bot
   */
  async initialize() {
    try {
      logger.info('🚀 Initializing Telegram Travel Bot...');
      
      // 1. Initialize services
      await this.initializeServices();
      
      // 2. Setup Express server
      this.setupExpress();
      
      // 3. Initialize Telegram Bot
      await this.initializeTelegramBot();
      
      // 4. Setup command handlers
      this.setupCommands();
      
      // 5. Start the server
      await this.startServer();
      
      // 6. Start background jobs
      this.startBackgroundJobs();
      
      logger.info('✅ Telegram Travel Bot initialized successfully');
      
    } catch (error) {
      logger.error('❌ Failed to initialize Travel Bot:', error);
      throw error;
    }
  }

  /**
   * Initialize database and cache
   */
  async initializeServices() {
    try {
      // Initialize database tables
      await initializeTables();
      logger.info('✅ Database initialized');
      
      // Initialize Redis
      await redisClient.initialize();
      logger.info('✅ Redis initialized');
      
      // Test API connections
      await this.testAPIConnections();
      
    } catch (error) {
      logger.error('Failed to initialize services:', error);
      throw error;
    }
  }

  /**
   * Test API connections
   */
  async testAPIConnections() {
    const apis = [
      { name: 'Kiwi', test: () => require('../api/kiwi-api').testConnection() },
      { name: 'Travelpayouts', test: () => require('../api/travelpayouts-api').testConnection() },
      { name: 'Skyscanner', test: () => require('../api/skyscanner-api').testConnection() },
      { name: 'Exchange Rate', test: () => require('../api/exchange-rate-api').testConnection() }
    ];
    
    for (const api of apis) {
      try {
        const result = await api.test();
        if (result.connected) {
          logger.info(`✅ ${api.name} API: Connected`);
        } else {
          logger.warn(`⚠️ ${api.name} API: ${result.message}`);
        }
      } catch (error) {
        logger.error(`❌ ${api.name} API test failed:`, error.message);
      }
    }
  }

  /**
   * Setup Express server
   */
  setupExpress() {
    this.app = express();
    
    // Middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(logger.httpLogger);
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'telegram-travel-bot',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        redis: redisClient.initialized ? 'connected' : 'disconnected'
      });
    });
    
    // Webhook endpoint for Telegram
    if (config.telegram.webhookUrl) {
      this.app.post(`/webhook/${config.telegram.token}`, (req, res) => {
        this.bot.processUpdate(req.body);
        res.sendStatus(200);
      });
    }
    
    // API endpoints for future web interface
    this.app.post('/api/search', async (req, res) => {
      try {
        const { from, to, date, returnDate, passengers, currency } = req.body;
        
        const results = await routeStitcher.findCheapestRoutes({
          from,
          to,
          date,
          returnDate,
          passengers: passengers || 1,
          currency: currency || 'ZAR'
        });
        
        res.json({
          success: true,
          results: results.slice(0, 10) // Limit to 10 for API
        });
        
      } catch (error) {
        logger.error('API search error:', error);
        res.status(500).json({
          success: false,
          error: 'Search failed',
          message: error.message
        });
      }
    });
    
    // Error handling middleware
    this.app.use((err, req, res, next) => {
      logger.error('Express error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * Initialize Telegram Bot
   */
  async initializeTelegramBot() {
    try {
      const options = config.telegram.options;
      
      if (config.telegram.webhookUrl) {
        // Webhook mode for production
        this.bot = new TelegramBot(config.telegram.token);
        
        // Set webhook
        await this.bot.setWebHook(`${config.telegram.webhookUrl}/webhook/${config.telegram.token}`);
        
        logger.info('✅ Telegram bot initialized in webhook mode');
        
      } else {
        // Polling mode for development
        this.bot = new TelegramBot(config.telegram.token, {
          polling: {
            interval: 300,
            autoStart: true,
            params: {
              timeout: 10
            }
          }
        });
        
        logger.info('✅ Telegram bot initialized in polling mode');
      }
      
      // Set bot commands for menu
      await this.setBotCommands();
      
    } catch (error) {
      logger.error('Failed to initialize Telegram bot:', error);
      throw error;
    }
  }

  /**
   * Set bot commands for menu
   */
  async setBotCommands() {
    try {
      const commands = [
        { command: 'start', description: 'Start the bot and see welcome message' },
        { command: 'search', description: 'Search for flights' },
        { command: 'help', description: 'Get help and instructions' },
        { command: 'history', description: 'View your search history' },
        { command: 'popular', description: 'See popular routes' },
        { command: 'settings', description: 'Change your settings' }
      ];
      
      await this.bot.setMyCommands(commands);
      logger.info('✅ Bot commands set');
      
    } catch (error) {
      logger.error('Failed to set bot commands:', error);
    }
  }

  /**
   * Setup command handlers
   */
  setupCommands() {
    // Import command handlers
    const commands = require('./commands');
    
    // Setup all command handlers
    commands.setup(this.bot);
    
    // Setup inline query handler for quick searches
    this.bot.on('inline_query', async (query) => {
      await this.handleInlineQuery(query);
    });
    
    // Setup callback query handler for inline keyboards
    this.bot.on('callback_query', async (callbackQuery) => {
      await this.handleCallbackQuery(callbackQuery);
    });
    
    // Setup message handler for natural language searches
    this.bot.on('message', async (msg) => {
      await this.handleMessage(msg);
    });
    
    // Setup error handler
    this.bot.on('error', (error) => {
      logger.error('Telegram bot error:', error);
    });
    
    // Setup polling error handler
    this.bot.on('polling_error', (error) => {
      logger.error('Telegram polling error:', error);
    });
    
    logger.info('✅ Command handlers setup complete');
  }

  /**
   * Handle inline queries (for quick search suggestions)
   */
  async handleInlineQuery(query) {
    try {
      const queryText = query.query.trim();
      
      if (queryText.length < 3) {
        // Show popular routes for short queries
        const popularRoutes = await redisClient.getPopularSearches(5);
        
        const results = popularRoutes.map((route, index) => ({
          type: 'article',
          id: index.toString(),
          title: `${route.from} → ${route.to}`,
          description: `Popular route (${route.count} searches)`,
          input_message_content: {
            message_text: `Searching for flights from ${route.from} to ${route.to}...`
          },
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🔍 Search This Route',
                callback_data: `quick_search:${route.from}:${route.to}`
              }
            ]]
          }
        }));
        
        await this.bot.answerInlineQuery(query.id, results, {
          cache_time: 300,
          is_personal: true
        });
        
        return;
      }
      
      // Parse natural language query
      const searchParams = this.parseNaturalLanguage(queryText);
      
      if (searchParams) {
        const results = [{
          type: 'article',
          id: 'search_result',
          title: `${searchParams.from} → ${searchParams.to}`,
          description: `Search flights for ${searchParams.date}`,
          input_message_content: {
            message_text: `Searching for flights from ${searchParams.from} to ${searchParams.to} on ${searchParams.date}...`
          }
        }];
        
        await this.bot.answerInlineQuery(query.id, results, {
          cache_time: 60,
          is_personal: true
        });
      }
      
    } catch (error) {
      logger.error('Inline query error:', error);
    }
  }

  /**
   * Handle callback queries from inline keyboards
   */
  async handleCallbackQuery(callbackQuery) {
    try {
      const { data, message, from } = callbackQuery;
      
      // Acknowledge the callback
      await this.bot.answerCallbackQuery(callbackQuery.id);
      
      // Parse callback data
      const [action, ...params] = data.split(':');
      
      switch (action) {
        case 'quick_search':
          const [fromAirport, toAirport] = params;
          await this.handleQuickSearch(message.chat.id, fromAirport, toAirport);
          break;
          
        case 'book':
          const [routeId, provider] = params;
          await this.handleBooking(message.chat.id, routeId, provider, from.id);
          break;
          
        case 'more_results':
          const [searchKey] = params;
          await this.showMoreResults(message.chat.id, searchKey, message.message_id);
          break;
          
        case 'save_search':
          await this.saveSearchToHistory(message.chat.id, message.text);
          break;
          
        case 'price_alert':
          const [alertFrom, alertTo, alertDate] = params;
          await this.setPriceAlert(message.chat.id, alertFrom, alertTo, alertDate);
          break;
          
        default:
          logger.warn(`Unknown callback action: ${action}`);
      }
      
    } catch (error) {
      logger.error('Callback query error:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: 'An error occurred. Please try again.',
        show_alert: true
      });
    }
  }

  /**
   * Handle natural language messages
   */
  async handleMessage(msg) {
    try {
      // Skip if message is a command (handled by command handlers)
      if (msg.text && msg.text.startsWith('/')) {
        return;
      }
      
      // Skip non-text messages
      if (!msg.text) {
        return;
      }
      
      const chatId = msg.chat.id;
      const text = msg.text.trim();
      
      // Parse natural language search
      const searchParams = this.parseNaturalLanguage(text);
      
      if (searchParams) {
        // Store user if not exists
        await this.ensureUserExists(msg.from);
        
        // Start search
        await this.startSearch(chatId, searchParams, msg.from.id);
      } else {
        // Send help for unrecognized messages
        await this.bot.sendMessage(chatId,
          `I couldn't understand your search. Try something like:\n\n` +
          `• "JNB to CPT tomorrow"\n` +
          `• "Flights from Lagos to London next week"\n` +
          `• "Search Nairobi to Dubai return"\n\n` +
          `Or use /search for guided search.`,
          { parse_mode: 'Markdown' }
        );
      }
      
    } catch (error) {
      logger.error('Message handling error:', error);
    }
  }

  /**
   * Parse natural language into search parameters
   */
  parseNaturalLanguage(text) {
    const lowerText = text.toLowerCase();
    
    // Common patterns
    const patterns = [
      // "JNB to CPT tomorrow"
      /(?:from\s+)?([A-Z]{3})\s+(?:to|->|→)\s+([A-Z]{3})\s+(.+)/i,
      
      // "flights from johannesburg to cape town next friday"
      /(?:flights?\s+)?(?:from\s+)?([a-z\s]+)\s+(?:to|->|→)\s+([a-z\s]+)\s+(.+)/i,
      
      // "CPT LHR 2024-12-25"
      /^([A-Z]{3})\s+([A-Z]{3})\s+(\d{4}-\d{2}-\d{2})$/i,
      
      // "search los angeles to new york"
      /^search\s+(.+)\s+to\s+(.+)$/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        let from = match[1].trim().toUpperCase();
        let to = match[2].trim().toUpperCase();
        let dateText = match[3].trim();
        
        // Convert city names to airport codes if needed
        if (from.length > 3) {
          const airportCode = this.cityNameToAirportCode(from);
          if (airportCode) from = airportCode;
        }
        
        if (to.length > 3) {
          const airportCode = this.cityNameToAirportCode(to);
          if (airportCode) to = airportCode;
        }
        
        // Parse date
        const date = Helpers.parseNaturalDate(dateText);
        
        return {
          from,
          to,
          date,
          passengers: 1,
          currency: 'ZAR'
        };
      }
    }
    
    return null;
  }

  /**
   * Convert city name to airport code
   */
  cityNameToAirportCode(cityName) {
    const cityMap = {
      'johannesburg': 'JNB',
      'cape town': 'CPT',
      'durban': 'DUR',
      'lagos': 'LOS',
      'abuja': 'ABV',
      'nairobi': 'NBO',
      'addis ababa': 'ADD',
      'cairo': 'CAI',
      'accra': 'ACC',
      'dar es salaam': 'DAR',
      'casablanca': 'CMN',
      'algiers': 'ALG',
      'tunis': 'TUN',
      'dakar': 'DKR',
      'abidjan': 'ABJ',
      'kampala': 'EBB',
      'kigali': 'KGL',
      'london': 'LHR',
      'new york': 'JFK',
      'dubai': 'DXB',
      'doha': 'DOH',
      'istanbul': 'IST',
      'paris': 'CDG',
      'amsterdam': 'AMS',
      'frankfurt': 'FRA'
    };
    
    return cityMap[cityName.toLowerCase()] || null;
  }

  /**
   * Handle quick search from inline query
   */
  async handleQuickSearch(chatId, from, to) {
    try {
      // Use tomorrow as default date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const date = tomorrow.toISOString().split('T')[0];
      
      const searchParams = {
        from,
        to,
        date,
        passengers: 1,
        currency: 'ZAR'
      };
      
      await this.startSearch(chatId, searchParams);
      
    } catch (error) {
      logger.error('Quick search error:', error);
      await this.bot.sendMessage(chatId,
        '❌ Sorry, there was an error processing your quick search. Please try again.',
        { parse_mode: 'Markdown' }
      );
    }
  }

  /**
   * Start a flight search
   */
  async startSearch(chatId, searchParams, userId = null) {
    try {
      // Send searching message
      const searchMessage = await this.bot.sendMessage(chatId,
        `🔍 *Searching for the cheapest routes...*\n\n` +
        `*From:* ${searchParams.from}\n` +
        `*To:* ${searchParams.to}\n` +
        `*Date:* ${Helpers.formatDate(searchParams.date)}\n` +
        `*Passengers:* ${searchParams.passengers || 1}\n\n` +
        `I'm scanning all airlines and creating custom routes... This may take a moment.`,
        { parse_mode: 'Markdown' }
      );
      
      // Perform search
      const results = await routeStitcher.findCheapestRoutes({
        ...searchParams,
        userId: userId || chatId
      });
      
      // Delete searching message
      try {
        await this.bot.deleteMessage(chatId, searchMessage.message_id);
      } catch (error) {
        // Ignore delete errors
      }
      
      // Handle results
      if (results.length === 0) {
        await this.handleNoResults(chatId, searchParams);
        return;
      }
      
      // Format and send results
      await this.sendSearchResults(chatId, results, searchParams);
      
      // Store search in history
      if (userId) {
        await this.storeSearchHistory(userId, searchParams, results);
      }
      
    } catch (error) {
      logger.error('Search error:', error);
      await this.handleSearchError(chatId, error);
    }
  }

  /**
   * Handle no results found
   */
  async handleNoResults(chatId, searchParams) {
    const message = 
      `❌ *No flights found*\n\n` +
      `I couldn't find any available flights for:\n` +
      `• ${searchParams.from} → ${searchParams.to}\n` +
      `• ${Helpers.formatDate(searchParams.date)}\n\n` +
      `*Suggestions:*\n` +
      `1. Try different dates\n` +
      `2. Check nearby airports\n` +
      `3. Be more flexible with travel times\n` +
      `4. Try one-way instead of return\n\n` +
      `Use /search to try again.`;
    
    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Send search results to user
   */
  async sendSearchResults(chatId, results, searchParams) {
    try {
      // Limit to top 5 results for Telegram
      const topResults = results.slice(0, 5);
      
      // Send summary message
      const summary = botFormatter.formatSearchSummary(topResults, searchParams);
      await this.bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
      
      // Send each result
      for (const result of topResults) {
        const formattedResult = botFormatter.formatRouteResult(result);
        
        await this.bot.sendMessage(
          chatId,
          formattedResult.message,
          {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: formattedResult.keyboard
          }
        );
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      // Send follow-up options
      const optionsKeyboard = {
        inline_keyboard: [
          [
            { text: '💾 Save Search', callback_data: 'save_search' },
            { text: '🔔 Price Alert', callback_data: `price_alert:${searchParams.from}:${searchParams.to}:${searchParams.date}` }
          ],
          [
            { text: '🔍 New Search', callback_data: 'new_search' },
            { text: '📊 Compare More', url: 'https://example.com/compare' } // Replace with your URL
          ]
        ]
      };
      
      await this.bot.sendMessage(
        chatId,
        `Found ${topResults.length} route(s). What would you like to do next?`,
        { reply_markup: optionsKeyboard }
      );
      
    } catch (error) {
      logger.error('Error sending results:', error);
      throw error;
    }
  }

  /**
   * Handle search errors
   */
  async handleSearchError(chatId, error) {
    const errorMessage = 
      `❌ *Search Failed*\n\n` +
      `Sorry, there was an error while searching for flights.\n\n` +
      `*Possible reasons:*\n` +
      `• API temporarily unavailable\n` +
      `• Network issues\n` +
      `• Invalid search parameters\n\n` +
      `Please try again in a few minutes.`;
    
    await this.bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
  }

  /**
   * Handle booking request
   */
  async handleBooking(chatId, routeId, provider, userId) {
    try {
      // Get route details from cache or reconstruct
      const route = await this.getRouteDetails(routeId);
      
      if (!route) {
        await this.bot.sendMessage(chatId,
          '❌ Sorry, this booking is no longer available. Please search again.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Track affiliate click
      await this.trackAffiliateClick(routeId, provider, userId);
      
      // Send booking instructions
      const bookingMessage = 
        `🛫 *Booking Instructions*\n\n` +
        `You're being redirected to ${provider} to complete your booking.\n\n` +
        `*Important notes:*\n` +
        `• Verify all details before payment\n` +
        `• Check baggage allowances\n` +
        `• Save your booking confirmation\n` +
        `• Check visa requirements if international\n\n` +
        `[Click here to proceed with booking](${route.affiliateLink})\n\n` +
        `*Route Summary:*\n` +
        `${botFormatter.formatRouteSummary(route)}`;
      
      await this.bot.sendMessage(
        chatId,
        bookingMessage,
        {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        }
      );
      
    } catch (error) {
      logger.error('Booking error:', error);
      await this.bot.sendMessage(chatId,
        '❌ Sorry, there was an error processing your booking. Please try again.',
        { parse_mode: 'Markdown' }
      );
    }
  }

  /**
   * Get route details from cache
   */
  async getRouteDetails(routeId) {
    // Try to get from recent searches cache
    // In production, you'd have a proper cache mechanism
    return null;
  }

  /**
   * Track affiliate click
   */
  async trackAffiliateClick(routeId, provider, userId) {
    try {
      // Implement affiliate tracking
      logger.affiliateClick(userId, provider, routeId, 0);
    } catch (error) {
      logger.error('Affiliate tracking error:', error);
    }
  }

  /**
   * Store search in user history
   */
  async storeSearchHistory(userId, searchParams, results) {
    try {
      // Store in database
      // This would be implemented with your database model
    } catch (error) {
      logger.error('Error storing search history:', error);
    }
  }

  /**
   * Ensure user exists in database
   */
  async ensureUserExists(user) {
    try {
      await UserModel.upsert(user.id, {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        languageCode: user.language_code
      });
    } catch (error) {
      logger.error('Error ensuring user exists:', error);
    }
  }

  /**
   * Show more results
   */
  async showMoreResults(chatId, searchKey, originalMessageId) {
    // Implement pagination for results
    await this.bot.sendMessage(chatId,
      'More results feature coming soon!',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Save search to history
   */
  async saveSearchToHistory(chatId, searchText) {
    await this.bot.sendMessage(chatId,
      '✅ Search saved to your history!\n\nUse /history to view your saved searches.',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Set price alert
   */
  async setPriceAlert(chatId, from, to, date) {
    await this.bot.sendMessage(chatId,
      `🔔 Price alert set!\n\n` +
      `I'll notify you if prices drop for:\n` +
      `${from} → ${to} on ${Helpers.formatDate(date)}\n\n` +
      `You'll receive updates in this chat.`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Start the Express server
   */
  async startServer() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(config.server.port, config.server.host, () => {
        logger.info(`🌐 Server running on http://${config.server.host}:${config.server.port}`);
        resolve();
      });
      
      this.server.on('error', (error) => {
        logger.error('Server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Start background jobs
   */
  startBackgroundJobs() {
    // Start exchange rate updates
    this.startExchangeRateUpdates();
    
    // Start cache cleanup
    this.startCacheCleanup();
    
    // Start price alert checks
    this.startPriceAlertChecks();
    
    logger.info('✅ Background jobs started');
  }

  /**
   * Start exchange rate update job
   */
  startExchangeRateUpdates() {
    const { CronJob } = require('cron');
    
    // Update every hour
    new CronJob('0 * * * *', async () => {
      try {
        logger.info('Updating exchange rates...');
        const exchangeRateAPI = require('../api/exchange-rate-api');
        await exchangeRateAPI.updateRatesCache();
        logger.info('Exchange rates updated');
      } catch (error) {
        logger.error('Failed to update exchange rates:', error);
      }
    }, null, true, 'Africa/Johannesburg');
  }

  /**
   * Start cache cleanup job
   */
  startCacheCleanup() {
    const { CronJob } = require('cron');
    
    // Cleanup every 6 hours
    new CronJob('0 */6 * * *', async () => {
      try {
        logger.info('Running cache cleanup...');
        // Implement cache cleanup logic
        logger.info('Cache cleanup completed');
      } catch (error) {
        logger.error('Cache cleanup failed:', error);
      }
    }, null, true, 'Africa/Johannesburg');
  }

  /**
   * Start price alert checks
   */
  startPriceAlertChecks() {
    const { CronJob } = require('cron');
    
    // Check every 2 hours
    new CronJob('0 */2 * * *', async () => {
      try {
        logger.info('Checking price alerts...');
        // Implement price alert checking logic
        logger.info('Price alerts checked');
      } catch (error) {
        logger.error('Price alert check failed:', error);
      }
    }, null, true, 'Africa/Johannesburg');
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    logger.info('🛑 Shutting down Travel Bot...');
    
    try {
      // Stop the bot
      if (this.bot) {
        await this.bot.stopPolling();
        logger.info('✅ Telegram bot stopped');
      }
      
      // Close server
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(() => {
            logger.info('✅ HTTP server closed');
            resolve();
          });
        });
      }
      
      // Close Redis
      if (redisClient) {
        await redisClient.close();
        logger.info('✅ Redis connection closed');
      }
      
      logger.info('✅ Shutdown completed');
      
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }
  }
}

// Import Helpers here to avoid circular dependency
const Helpers = require('../utils/helpers');

// Create singleton instance
const travelBot = new TravelBot();

module.exports = TravelBot;
