const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const config = require('./config/config');
const logger = require('./src/utils/logger');
const { initializeDatabase } = require('./src/database/models');
const { initializeRedis } = require('./src/database/redis-client');
const botCommands = require('./src/telegram/commands');
const routeEngine = require('./src/core/route-stitcher');

class TravelBot {
    constructor() {
        this.app = express();
        this.bot = null;
        this.port = config.port || 3000;
    }

    async initialize() {
        try {
            logger.info('Initializing Travel Bot...');
            
            // 1. Initialize services
            await this.initializeServices();
            
            // 2. Setup Telegram bot
            this.setupTelegramBot();
            
            // 3. Setup Express server for webhooks
            this.setupExpress();
            
            // 4. Start cron jobs
            this.startCronJobs();
            
            logger.info('Travel Bot initialized successfully!');
            
        } catch (error) {
            logger.error('Failed to initialize bot:', error);
            process.exit(1);
        }
    }

    async initializeServices() {
        // Initialize database
        await initializeDatabase();
        logger.info('Database initialized');
        
        // Initialize Redis
        await initializeRedis();
        logger.info('Redis initialized');
        
        // Test API connections
        await this.testAPIConnections();
    }

    async testAPIConnections() {
        const apis = ['kiwi', 'travelpayouts', 'skyscanner'];
        for (const api of apis) {
            try {
                // Test each API (implement in respective API files)
                logger.info(`Testing ${api} API connection...`);
                // Add actual test calls here
            } catch (error) {
                logger.warn(`Could not connect to ${api} API:`, error.message);
            }
        }
    }

    setupTelegramBot() {
        // Use webhook in production, polling in development
        if (config.nodeEnv === 'production' && config.telegram.webhookUrl) {
            this.bot = new TelegramBot(config.telegram.token);
            this.bot.setWebHook(`${config.telegram.webhookUrl}/bot${config.telegram.token}`);
            logger.info('Webhook mode enabled');
        } else {
            this.bot = new TelegramBot(config.telegram.token, { polling: true });
            logger.info('Polling mode enabled');
        }

        // Setup command handlers
        botCommands.setup(this.bot);
    }

    setupExpress() {
        // Middleware
        this.app.use(express.json());
        
        // Webhook endpoint for Telegram
        this.app.post(`/webhook/${config.telegram.token}`, (req, res) => {
            this.bot.processUpdate(req.body);
            res.sendStatus(200);
        });

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                timestamp: new Date().toISOString(),
                service: 'telegram-travel-bot'
            });
        });

        // Search endpoint (for future web interface)
        this.app.post('/api/search', async (req, res) => {
            try {
                const { from, to, date, returnDate, passengers } = req.body;
                const results = await routeEngine.findCheapestRoutes(from, to, date, returnDate, passengers);
                res.json(results);
            } catch (error) {
                logger.error('Search error:', error);
                res.status(500).json({ error: 'Search failed' });
            }
        });

        // Start server
        this.app.listen(this.port, () => {
            logger.info(`Server running on port ${this.port}`);
        });
    }

    startCronJobs() {
        // Update exchange rates every hour
        const { CronJob } = require('cron');
        
        // Exchange rate updates
        new CronJob('0 * * * *', async () => {
            logger.info('Updating exchange rates...');
            // Implement exchange rate update
        }, null, true, 'Africa/Johannesburg');

        // Cache warmup for popular African routes
        new CronJob('0 4 * * *', async () => {
            logger.info('Running cache warmup...');
            // Implement cache warmup
        }, null, true, 'Africa/Johannesburg');
    }
}

// Start the bot
if (require.main === module) {
    const bot = new TravelBot();
    bot.initialize().catch(error => {
        logger.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = TravelBot;
