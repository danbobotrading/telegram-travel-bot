#!/usr/bin/env node

require('dotenv').config();
const config = require('../config/config');
const logger = require('../src/utils/logger');
const redisClient = require('../src/database/redis-client');
const routeStitcher = require('../src/core/route-stitcher');

const POPULAR_ROUTES = [
    { from: 'JNB', to: 'CPT', name: 'Johannesburg to Cape Town' },
    { from: 'JNB', to: 'DUR', name: 'Johannesburg to Durban' },
    { from: 'JNB', to: 'NBO', name: 'Johannesburg to Nairobi' },
    { from: 'JNB', to: 'LON', name: 'Johannesburg to London' },
    { from: 'CPT', to: 'JNB', name: 'Cape Town to Johannesburg' },
    { from: 'CPT', to: 'LON', name: 'Cape Town to London' },
    { from: 'LOS', to: 'LON', name: 'Lagos to London' },
    { from: 'LOS', to: 'JNB', name: 'Lagos to Johannesburg' },
    { from: 'ACC', to: 'LON', name: 'Accra to London' },
    { from: 'ACC', to: 'JFK', name: 'Accra to New York' },
    { from: 'NBO', to: 'DXB', name: 'Nairobi to Dubai' },
    { from: 'NBO', to: 'JNB', name: 'Nairobi to Johannesburg' },
    { from: 'ADD', to: 'DXB', name: 'Addis Ababa to Dubai' },
    { from: 'ADD', to: 'LON', name: 'Addis Ababa to London' },
    { from: 'CAI', to: 'DXB', name: 'Cairo to Dubai' },
    { from: 'CAI', to: 'LON', name: 'Cairo to London' }
];

async function warmupCache() {
    try {
        logger.info('Starting cache warmup...');
        
        await redisClient.initialize();
        
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0];
        
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextWeekStr = nextWeek.toISOString().split('T')[0];
        
        let successCount = 0;
        let failCount = 0;
        
        for (const route of POPULAR_ROUTES) {
            try {
                logger.info(`Warming up: ${route.from} → ${route.to}`);
                
                // Search for tomorrow
                const results = await routeStitcher.findCheapestRoutes({
                    from: route.from,
                    to: route.to,
                    date: dateStr,
                    passengers: 1,
                    currency: 'ZAR'
                });
                
                if (results && results.length > 0) {
                    successCount++;
                    logger.info(`✓ Cached ${route.from}→${route.to}: ${results.length} routes`);
                } else {
                    failCount++;
                    logger.warn(`✗ No results for ${route.from}→${route.to}`);
                }
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                failCount++;
                logger.error(`Error warming up ${route.from}→${route.to}:`, error.message);
            }
        }
        
        logger.info(`Cache warmup completed: ${successCount} successful, ${failCount} failed`);
        process.exit(0);
        
    } catch (error) {
        logger.error('Cache warmup failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    warmupCache();
}

module.exports = warmupCache;
