#!/usr/bin/env node

require('dotenv').config();
const exchangeRateAPI = require('../src/api/exchange-rate-api');
const redisClient = require('../src/database/redis-client');
const logger = require('../src/utils/logger');

async function updateExchangeRates() {
    try {
        logger.info('Starting exchange rate update...');
        
        await redisClient.initialize();
        
        // Update major currencies
        const currencies = ['ZAR', 'USD', 'EUR', 'GBP', 'KES', 'NGN', 'EGP', 'GHS'];
        
        for (const currency of currencies) {
            try {
                const rates = await exchangeRateAPI.getLatestRates(currency);
                logger.info(`Updated rates for ${currency}: ${Object.keys(rates.rates).length} currencies`);
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                logger.error(`Failed to update ${currency}:`, error.message);
            }
        }
        
        logger.info('Exchange rate update completed');
        process.exit(0);
        
    } catch (error) {
        logger.error('Exchange rate update failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    updateExchangeRates();
}

module.exports = updateExchangeRates;
