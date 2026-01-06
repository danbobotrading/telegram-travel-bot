'use strict';

const config = require('../../config/config');
const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');
const { UserModel, SearchModel } = require('../database/models');
const routeStitcher = require('../core/route-stitcher');
const formatter = require('./formatter');

/**
 * Telegram bot command handlers
 */

class BotCommands {
  constructor() {
    this.userStates = new Map(); // Store user conversation states
    this.MAX_SEARCH_HISTORY = 10;
  }

  /**
   * Setup all command handlers
   */
  setup(bot) {
    this.bot = bot;
    
    // Start command
    bot.onText(/\/start/, async (msg) => {
      await this.handleStart(msg);
    });
    
    // Help command
    bot.onText(/\/help/, async (msg) => {
      await this.handleHelp(msg);
    });
    
    // Search command
    bot.onText(/\/search/, async (msg) => {
      await this.handleSearch(msg);
    });
    
    // History command
    bot.onText(/\/history/, async (msg) => {
      await this.handleHistory(msg);
    });
    
    // Popular command
    bot.onText(/\/popular/, async (msg) => {
      await this.handlePopular(msg);
    });
    
    // Settings command
    bot.onText(/\/settings/, async (msg) => {
      await this.handleSettings(msg);
    });
    
    // About command
    bot.onText(/\/about/, async (msg) => {
      await this.handleAbout(msg);
    });
    
    // Stats command (admin only)
    bot.onText(/\/stats/, async (msg) => {
      await this.handleStats(msg);
    });
    
    logger.info('✅ Command handlers registered');
  }

  /**
   * Handle /start command
   */
  async handleStart(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    try {
      // Register/update user in database
      await UserModel.upsert(user.id, {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        languageCode: user.language_code
      });
      
      // Send welcome message
      const welcomeMessage = formatter.formatWelcomeMessage(user.first_name);
      await this.bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      
      // Send quick actions
      const quickActions = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔍 Search Flights', callback_data: 'quick_search_menu' },
              { text: '📖 How It Works', callback_data: 'how_it_works' }
            ],
            [
              { text: '⭐ Popular Routes', callback_data: 'show_popular' },
              { text: '⚙️ Settings', callback_data: 'show_settings' }
            ]
          ]
        }
      };
      
      await this.bot.sendMessage(
        chatId,
        'What would you like to do?',
        quickActions
      );
      
      logger.info(`New user started: ${user.username || user.id} (${user.first_name})`);
      
    } catch (error) {
      logger.error('Start command error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Handle /help command
   */
  async handleHelp(msg) {
    const chatId = msg.chat.id;
    
    try {
      const helpMessage = formatter.formatHelpMessage();
      await this.bot.sendMessage(chatId, helpMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      
    } catch (error) {
      logger.error('Help command error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Handle /search command
   */
  async handleSearch(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    try {
      // Start search conversation
      await this.startSearchConversation(chatId, user.id);
      
    } catch (error) {
      logger.error('Search command error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Start search conversation
   */
  async startSearchConversation(chatId, userId) {
    try {
      // Store user state
      this.userStates.set(userId, {
        step: 'awaiting_from',
        searchData: {}
      });
      
      // Ask for origin
      await this.bot.sendMessage(
        chatId,
        '📍 *Where are you flying from?*\n\n' +
        'Please enter city name or airport code (e.g., "Johannesburg" or "JNB"):\n\n' +
        '*Tip:* You can also send your location for nearby airports.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [[{ text: '📍 Send Location', request_location: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        }
      );
      
    } catch (error) {
      logger.error('Search conversation error:', error);
      throw error;
    }
  }

  /**
   * Handle search step responses
   */
  async handleSearchStep(userId, chatId, text, location = null) {
    const state = this.userStates.get(userId);
    if (!state) return;
    
    try {
      switch (state.step) {
        case 'awaiting_from':
          await this.handleFromInput(userId, chatId, text, location, state);
          break;
          
        case 'awaiting_to':
          await this.handleToInput(userId, chatId, text, state);
          break;
          
        case 'awaiting_date':
          await this.handleDateInput(userId, chatId, text, state);
          break;
          
        case 'awaiting_passengers':
          await this.handlePassengersInput(userId, chatId, text, state);
          break;
          
        case 'awaiting_confirmation':
          await this.handleConfirmation(userId, chatId, text, state);
          break;
      }
      
    } catch (error) {
      logger.error('Search step error:', error);
      await this.bot.sendMessage(
        chatId,
        '❌ Sorry, there was an error processing your input. Please try again.',
        { parse_mode: 'Markdown' }
      );
      
      // Reset conversation
      this.userStates.delete(userId);
    }
  }

  /**
   * Handle origin input
   */
  async handleFromInput(userId, chatId, text, location, state) {
    let airportCode = null;
    
    if (location) {
      // Handle location input
      airportCode = await this.getAirportFromLocation(location);
    } else if (text) {
      // Handle text input
      airportCode = Helpers.extractAirportCode(text);
    }
    
    if (!airportCode) {
      await this.bot.sendMessage(
        chatId,
        '❌ I couldn\'t identify that airport. Please try again with a valid airport code or city name.\n\n' +
        'Examples: "JNB", "Johannesburg", "Cape Town"',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Update state
    state.searchData.from = airportCode;
    state.step = 'awaiting_to';
    this.userStates.set(userId, state);
    
    // Ask for destination
    await this.bot.sendMessage(
      chatId,
      `✅ Departure set to *${airportCode}*\n\n` +
      '🎯 *Where do you want to go?*\n\n' +
      'Enter city name or airport code (e.g., "Cape Town" or "CPT"):',
      {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
      }
    );
  }

  /**
   * Handle destination input
   */
  async handleToInput(userId, chatId, text, state) {
    const airportCode = Helpers.extractAirportCode(text);
    
    if (!airportCode) {
      await this.bot.sendMessage(
        chatId,
        '❌ I couldn\'t identify that airport. Please try again with a valid airport code or city name.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Check if same as origin
    if (airportCode === state.searchData.from) {
      await this.bot.sendMessage(
        chatId,
        '❌ Destination cannot be the same as origin. Please enter a different airport.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Update state
    state.searchData.to = airportCode;
    state.step = 'awaiting_date';
    this.userStates.set(userId, state);
    
    // Ask for date
    await this.bot.sendMessage(
      chatId,
      `✅ Destination set to *${airportCode}*\n\n` +
      '📅 *When are you traveling?*\n\n' +
      'Enter date (e.g., "2024-12-25", "tomorrow", "next Friday"):\n\n' +
      '*Tip:* Dates should be in YYYY-MM-DD format for best results.',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Handle date input
   */
  async handleDateInput(userId, chatId, text, state) {
    const date = Helpers.parseNaturalDate(text);
    
    // Validate date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const travelDate = new Date(date);
    
    if (travelDate < today) {
      await this.bot.sendMessage(
        chatId,
        '❌ Travel date cannot be in the past. Please enter a future date.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Check if too far in future (max 1 year)
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 1);
    
    if (travelDate > maxDate) {
      await this.bot.sendMessage(
        chatId,
        '❌ Travel date is too far in the future (max 1 year). Please enter a date within the next year.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Update state
    state.searchData.date = date;
    state.step = 'awaiting_passengers';
    this.userStates.set(userId, state);
    
    // Ask for passengers
    const passengerKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '1 Adult', callback_data: 'passengers:1' },
            { text: '2 Adults', callback_data: 'passengers:2' },
            { text: '3 Adults', callback_data: 'passengers:3' }
          ],
          [
            { text: '4 Adults', callback_data: 'passengers:4' },
            { text: '5 Adults', callback_data: 'passengers:5' },
            { text: 'Custom', callback_data: 'passengers:custom' }
          ]
        ]
      }
    };
    
    await this.bot.sendMessage(
      chatId,
      `✅ Travel date set to *${Helpers.formatDate(date)}*\n\n` +
      '👥 *How many passengers?*\n\n' +
      'Select number of adults:',
      {
        parse_mode: 'Markdown',
        reply_markup: passengerKeyboard.reply_markup
      }
    );
  }

  /**
   * Handle passengers input
   */
  async handlePassengersInput(userId, chatId, text, state) {
    let passengers = 1;
    
    if (text === 'custom') {
      // Ask for custom number
      await this.bot.sendMessage(
        chatId,
        '👥 *Enter number of passengers (1-9):*',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    const match = text.match(/passengers:(\d+)/);
    if (match) {
      passengers = parseInt(match[1], 10);
    } else {
      // Try to parse from text
      const parsed = parseInt(text, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 9) {
        passengers = parsed;
      } else {
        await this.bot.sendMessage(
          chatId,
          '❌ Please enter a valid number between 1 and 9.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }
    
    // Update state
    state.searchData.passengers = passengers;
    state.searchData.currency = 'ZAR';
    state.step = 'awaiting_confirmation';
    this.userStates.set(userId, state);
    
    // Show confirmation
    await this.showSearchConfirmation(chatId, state.searchData);
  }

  /**
   * Show search confirmation
   */
  async showSearchConfirmation(chatId, searchData) {
    const confirmationMessage = 
      `✅ *Search Summary*\n\n` +
      `📍 *From:* ${searchData.from}\n` +
      `🎯 *To:* ${searchData.to}\n` +
      `📅 *Date:* ${Helpers.formatDate(searchData.date)}\n` +
      `👥 *Passengers:* ${searchData.passengers}\n` +
      `💰 *Currency:* ${searchData.currency}\n\n` +
      `Is this correct?`;
    
    const confirmationKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Yes, Search Now', callback_data: 'confirm_search' },
            { text: '✏️ Edit Search', callback_data: 'edit_search' }
          ],
          [
            { text: '➕ Add Return Flight', callback_data: 'add_return' },
            { text: '🔄 One-way/Return', callback_data: 'toggle_trip_type' }
          ]
        ]
      }
    };
    
    await this.bot.sendMessage(
      chatId,
      confirmationMessage,
      {
        parse_mode: 'Markdown',
        reply_markup: confirmationKeyboard.reply_markup
      }
    );
  }

  /**
   * Handle search confirmation
   */
  async handleConfirmation(userId, chatId, text, state) {
    if (text === 'confirm_search') {
      // Start the search
      await this.executeSearch(chatId, userId, state.searchData);
      
      // Clear user state
      this.userStates.delete(userId);
      
    } else if (text === 'edit_search') {
      // Reset to first step
      state.step = 'awaiting_from';
      this.userStates.set(userId, state);
      
      await this.bot.sendMessage(
        chatId,
        '✏️ *Editing search...*\n\n' +
        'Let\'s start over. Where are you flying from?',
        { parse_mode: 'Markdown' }
      );
    }
  }

  /**
   * Execute the search
   */
  async executeSearch(chatId, userId, searchData) {
    try {
      // Send searching message
      const searchMessage = await this.bot.sendMessage(
        chatId,
        `🔍 *Searching for flights...*\n\n` +
        `I'm finding the cheapest routes from ${searchData.from} to ${searchData.to}.\n` +
        `This may take a moment as I search across all airlines.`,
        { parse_mode: 'Markdown' }
      );
      
      // Perform search
      const results = await routeStitcher.findCheapestRoutes({
        ...searchData,
        userId
      });
      
      // Delete searching message
      try {
        await this.bot.deleteMessage(chatId, searchMessage.message_id);
      } catch (error) {
        // Ignore delete errors
      }
      
      // Handle results
      if (results.length === 0) {
        await this.handleNoResults(chatId, searchData);
        return;
      }
      
      // Send results
      await this.sendResults(chatId, results, searchData, userId);
      
    } catch (error) {
      logger.error('Search execution error:', error);
      await this.handleSearchError(chatId, error);
    }
  }

  /**
   * Send search results
   */
  async sendResults(chatId, results, searchData, userId) {
    try {
      // Send summary
      const summary = formatter.formatSearchSummary(results, searchData);
      await this.bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
      
      // Send each result (limit to 3 for Telegram)
      const displayResults = results.slice(0, 3);
      
      for (const result of displayResults) {
        const formatted = formatter.formatRouteResult(result);
        
        await this.bot.sendMessage(
          chatId,
          formatted.message,
          {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: formatted.keyboard
          }
        );
        
        // Small delay to avoid rate limiting
        await Helpers.sleep(300);
      }
      
      // Save search to history
      await this.saveSearchToHistory(userId, searchData, results);
      
      // Send follow-up options
      if (results.length > 3) {
        await this.bot.sendMessage(
          chatId,
          `*Found ${results.length} routes total.*\n\n` +
          `View more results and advanced filters on our website.`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Ask for feedback
      await this.askForFeedback(chatId);
      
    } catch (error) {
      logger.error('Error sending results:', error);
      throw error;
    }
  }

  /**
   * Handle no results
   */
  async handleNoResults(chatId, searchData) {
    const message = formatter.formatNoResultsMessage(searchData);
    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Handle search error
   */
  async handleSearchError(chatId, error) {
    const message = formatter.formatErrorMessage(error);
    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Save search to history
   */
  async saveSearchToHistory(userId, searchData, results) {
    try {
      await SearchModel.save({
        telegramId: userId,
        ...searchData,
        results: results.slice(0, 5) // Save top 5 results
      });
    } catch (error) {
      logger.error('Error saving search history:', error);
    }
  }

  /**
   * Ask for feedback
   */
  async askForFeedback(chatId) {
    const feedbackKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👍 Helpful', callback_data: 'feedback:helpful' },
            { text: '👎 Not Helpful', callback_data: 'feedback:not_helpful' }
          ]
        ]
      }
    };
    
    await this.bot.sendMessage(
      chatId,
      'Was this search helpful?',
      feedbackKeyboard
    );
  }

  /**
   * Handle /history command
   */
  async handleHistory(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      const searches = await SearchModel.getByTelegramId(userId, this.MAX_SEARCH_HISTORY);
      
      if (searches.length === 0) {
        await this.bot.sendMessage(
          chatId,
          '📭 *No search history found.*\n\n' +
          'Your recent searches will appear here after you start searching.\n\n' +
          'Use /search to find flights now!',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Format history
      const historyMessage = formatter.formatSearchHistory(searches);
      await this.bot.sendMessage(chatId, historyMessage, { parse_mode: 'Markdown' });
      
      // Add buttons to re-run searches
      const historyKeyboard = {
        reply_markup: {
          inline_keyboard: searches.slice(0, 5).map((search, index) => [
            {
              text: `🔍 ${search.from_city} → ${search.to_city} (${Helpers.formatDate(search.travel_date)})`,
              callback_data: `re_search:${search.id}`
            }
          ])
        }
      };
      
      await this.bot.sendMessage(
        chatId,
        'Click any search to run it again:',
        historyKeyboard
      );
      
    } catch (error) {
      logger.error('History command error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Handle /popular command
   */
  async handlePopular(msg) {
    const chatId = msg.chat.id;
    
    try {
      // Get popular routes from Redis
      const popularRoutes = await require('../database/redis-client').getPopularSearches(10);
      
      if (popularRoutes.length === 0) {
        await this.bot.sendMessage(
          chatId,
          '📊 *Popular routes will appear here soon.*\n\n' +
          'As more people search, I\'ll show you the most popular routes.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Format popular routes
      const popularMessage = formatter.formatPopularRoutes(popularRoutes);
      await this.bot.sendMessage(chatId, popularMessage, { parse_mode: 'Markdown' });
      
      // Add quick search buttons
      const popularKeyboard = {
        reply_markup: {
          inline_keyboard: popularRoutes.slice(0, 6).map(route => [
            {
              text: `✈️ ${route.from} → ${route.to} (${route.count}x)`,
              callback_data: `quick_search:${route.from}:${route.to}`
            }
          ])
        }
      };
      
      await this.bot.sendMessage(
        chatId,
        'Click any route to search now:',
        popularKeyboard
      );
      
    } catch (error) {
      logger.error('Popular command error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Handle /settings command
   */
  async handleSettings(msg) {
    const chatId = msg.chat.id;
    
    try {
      const settingsMessage = formatter.formatSettingsMessage();
      
      const settingsKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 Currency', callback_data: 'settings:currency' },
              { text: '🌍 Region', callback_data: 'settings:region' }
            ],
            [
              { text: '🔔 Notifications', callback_data: 'settings:notifications' },
              { text: '📊 Search Preferences', callback_data: 'settings:preferences' }
            ],
            [
              { text: '📱 Language', callback_data: 'settings:language' },
              { text: '🔒 Privacy', callback_data: 'settings:privacy' }
            ]
          ]
        }
      };
      
      await this.bot.sendMessage(
        chatId,
        settingsMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: settingsKeyboard.reply_markup
        }
      );
      
    } catch (error) {
      logger.error('Settings command error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Handle /about command
   */
  async handleAbout(msg) {
    const chatId = msg.chat.id;
    
    try {
      const aboutMessage = formatter.formatAboutMessage();
      await this.bot.sendMessage(chatId, aboutMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      
    } catch (error) {
      logger.error('About command error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Handle /stats command (admin only)
   */
  async handleStats(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if user is admin
    const adminIds = config.telegram.adminIds || [];
    if (!adminIds.includes(userId)) {
      await this.bot.sendMessage(
        chatId,
        '❌ This command is for administrators only.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    try {
      // Get statistics
      const userStats = await UserModel.getStats(userId);
      const allUsers = await UserModel.getAll(5); // Get top 5 users
      
      const statsMessage = formatter.formatStatsMessage(userStats, allUsers);
      await this.bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
      
    } catch (error) {
      logger.error('Stats command error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Get airport from location
   */
  async getAirportFromLocation(location) {
    // Simplified - in production, use a proper geocoding service
    const { latitude, longitude } = location;
    
    // Mock response for common locations
    if (latitude > -26.5 && latitude < -25.5 && longitude > 27.5 && longitude < 28.5) {
      return 'JNB'; // Johannesburg area
    } else if (latitude > -34.5 && latitude < -33.5 && longitude > 18.0 && longitude < 19.0) {
      return 'CPT'; // Cape Town area
    } else if (latitude > 6.0 && latitude < 7.0 && longitude > 3.0 && longitude < 4.0) {
      return 'LOS'; // Lagos area
    }
    
    return null;
  }

  /**
   * Send error message
   */
  async sendErrorMessage(chatId) {
    await this.bot.sendMessage(
      chatId,
      '❌ Sorry, something went wrong. Please try again or contact support if the problem persists.',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Handle callback queries
   */
  async handleCallbackQuery(callbackQuery) {
    const { data, message, from } = callbackQuery;
    const chatId = message.chat.id;
    const userId = from.id;
    
    try {
      // Acknowledge callback
      await this.bot.answerCallbackQuery(callbackQuery.id);
      
      // Parse callback data
      const [action, ...params] = data.split(':');
      
      // Handle different callback actions
      switch (action) {
        case 'quick_search_menu':
          await this.startSearchConversation(chatId, userId);
          break;
          
        case 'how_it_works':
          await this.showHowItWorks(chatId);
          break;
          
        case 'show_popular':
          await this.handlePopular({ chat: { id: chatId }, from });
          break;
          
        case 'show_settings':
          await this.handleSettings({ chat: { id: chatId }, from });
          break;
          
        case 'passengers':
          await this.handlePassengersInput(userId, chatId, `passengers:${params[0]}`, this.userStates.get(userId));
          break;
          
        case 'confirm_search':
          await this.handleConfirmation(userId, chatId, 'confirm_search', this.userStates.get(userId));
          break;
          
        case 'edit_search':
          await this.handleConfirmation(userId, chatId, 'edit_search', this.userStates.get(userId));
          break;
          
        case 'quick_search':
          const [fromAirport, toAirport] = params;
          await this.executeQuickSearch(chatId, userId, fromAirport, toAirport);
          break;
          
        case 're_search':
          const [searchId] = params;
          await this.reRunSearch(chatId, userId, searchId);
          break;
          
        case 'book':
          const [routeId, provider] = params;
          await this.handleBooking(chatId, routeId, provider, userId);
          break;
          
        case 'feedback':
          const [feedbackType] = params;
          await this.handleFeedback(chatId, feedbackType);
          break;
          
        default:
          logger.warn(`Unknown callback action: ${action}`);
      }
      
    } catch (error) {
      logger.error('Callback query handler error:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: 'An error occurred',
        show_alert: true
      });
    }
  }

  /**
   * Show how it works
   */
  async showHowItWorks(chatId) {
    const message = 
      `*🤔 How Travel Scout Works*\n\n` +
      `1. *Multi-Source Search*: I search across Kiwi, Skyscanner, and Travelpayouts simultaneously\n\n` +
      `2. *Virtual Interlining*: I combine separate tickets from different airlines to find cheaper routes\n\n` +
      `3. *Price Normalization*: All prices converted to ZAR with baggage and fees included\n\n` +
      `4. *Smart Ranking*: Routes sorted by total cost, not just ticket price\n\n` +
      `5. *Affiliate Links*: I earn commission when you book (no extra cost to you!)\n\n` +
      `*Example:*\n` +
      `JNB → LHR direct: R15,000\n` +
      `JNB → ADD (FlySafair) + ADD → LHR (Ethiopian): R8,500\n` +
      `*I'll show you the R8,500 option!*`;
    
    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Execute quick search
   */
  async executeQuickSearch(chatId, userId, from, to) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];
    
    await this.executeSearch(chatId, userId, {
      from,
      to,
      date,
      passengers: 1,
      currency: 'ZAR'
    });
  }

  /**
   * Re-run a saved search
   */
  async reRunSearch(chatId, userId, searchId) {
    try {
      const search = await SearchModel.getById(searchId);
      if (!search) {
        await this.bot.sendMessage(
          chatId,
          '❌ Search not found. It may have expired.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      await this.executeSearch(chatId, userId, {
        from: search.from_city,
        to: search.to_city,
        date: search.travel_date,
        passengers: search.passengers || 1,
        currency: search.currency || 'ZAR'
      });
      
    } catch (error) {
      logger.error('Re-run search error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Handle booking callback
   */
  async handleBooking(chatId, routeId, provider, userId) {
    try {
      // In production, you'd retrieve the actual route details
      const bookingMessage = 
        `🛫 *Redirecting to ${provider}...*\n\n` +
        `You'll be taken to the booking page to complete your purchase.\n\n` +
        `*Important:*\n` +
        `• Verify all flight details\n` +
        `• Check baggage allowances\n` +
        `• Save your confirmation\n` +
        `• Check visa requirements\n\n` +
        `Booking ID: ${routeId.substring(0, 8)}...`;
      
      await this.bot.sendMessage(chatId, bookingMessage, { parse_mode: 'Markdown' });
      
      // Track affiliate click
      logger.affiliateClick(userId, provider, routeId, 0);
      
    } catch (error) {
      logger.error('Booking callback error:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  /**
   * Handle feedback
   */
  async handleFeedback(chatId, feedbackType) {
    const response = feedbackType === 'helpful' ? 'Great! Thanks for your feedback! 🎉' : 'Sorry to hear that! We\'ll try to improve. 📝';
    await this.bot.sendMessage(chatId, response);
  }
}

// Create singleton instance
const botCommands = new BotCommands();

module.exports = botCommands;
