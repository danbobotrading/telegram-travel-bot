'use strict';

const path = require('path');
const Joi = require('joi');

// Environment validation schema
const envSchema = Joi.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: Joi.string().required().description('Telegram Bot Token'),
  TELEGRAM_WEBHOOK_URL: Joi.string().uri().optional().default(''),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().optional().default(''),
  ADMIN_TELEGRAM_IDS: Joi.string().optional().default('').custom((value) => 
    value.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !Number.isNaN(id))
  ),

  // API Keys
  KIWI_API_KEY: Joi.string().required().description('Kiwi Tequila API Key'),
  KIWI_API_URL: Joi.string().uri().default('https://api.tequila.kiwi.com'),
  KIWI_AFFILIATE_ID: Joi.string().optional().default(''),
  
  TRAVELPAYOUTS_API_KEY: Joi.string().required().description('Travelpayouts API Key'),
  TRAVELPAYOUTS_MARKER: Joi.string().optional().default(''),
  TRAVELPAYOUTS_AFFILIATE_ID: Joi.string().optional().default(''),
  
  SKYSCANNER_API_KEY: Joi.string().required().description('Skyscanner API Key'),
  SKYSCANNER_AFFILIATE_ID: Joi.string().optional().default(''),
  
  EXCHANGE_RATE_API_KEY: Joi.string().required().description('Exchange Rate API Key'),
  EXCHANGE_RATE_API_URL: Joi.string().uri().default('https://api.exchangerate-api.com/v4'),

  // Database
  DATABASE_URL: Joi.string().required().description('PostgreSQL Database URL'),
  DATABASE_SSL: Joi.boolean().default(false),
  
  REDIS_URL: Joi.string().required().description('Redis URL'),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_TLS: Joi.boolean().default(false),

  // Server
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  HOST: Joi.string().hostname().default('0.0.0.0'),
  TRUST_PROXY: Joi.number().default(1),

  // Caching
  CACHE_TTL: Joi.number().default(3600),
  CACHE_ENABLED: Joi.boolean().default(true),
  EXCHANGE_RATE_TTL: Joi.number().default(3600),
  ROUTE_CACHE_TTL: Joi.number().default(7200),

  // Rate Limiting
  RATE_LIMIT_WINDOW: Joi.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(30),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FILE_ENABLED: Joi.boolean().default(true),
  LOG_FILE_PATH: Joi.string().default('logs/travel-bot.log'),

  // Features
  ENABLE_VIRTUAL_INTERLINING: Joi.boolean().default(true),
  ENABLE_AFFILIATE_LINKS: Joi.boolean().default(true),
  ENABLE_SEARCH_HISTORY: Joi.boolean().default(true),
  ENABLE_PRICE_ALERTS: Joi.boolean().default(false),

  // Africa Focus
  DEFAULT_CURRENCY: Joi.string().default('ZAR'),
  DEFAULT_COUNTRY: Joi.string().default('ZA'),
  POPULAR_AIRPORTS: Joi.string().default('JNB,CPT,DUR,LOS,ACC,NBO,ADD,CAI,DXB,DOH')
    .custom((value) => value.split(',')),

  // Security
  SESSION_SECRET: Joi.string().default('travel-bot-secret-change-in-production'),
  ENCRYPTION_KEY: Joi.string().length(32).default('12345678901234567890123456789012'),
  JWT_SECRET: Joi.string().default('jwt-secret-change-in-production'),

}).unknown().required();

// Validate environment variables
const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Build configuration object
const config = {
  // Environment
  env: envVars.NODE_ENV,
  isDevelopment: envVars.NODE_ENV === 'development',
  isProduction: envVars.NODE_ENV === 'production',
  isTest: envVars.NODE_ENV === 'test',

  // Server
  server: {
    port: envVars.PORT,
    host: envVars.HOST,
    trustProxy: envVars.TRUST_PROXY,
    baseUrl: envVars.TELEGRAM_WEBHOOK_URL || `http://localhost:${envVars.PORT}`,
  },

  // Telegram
  telegram: {
    token: envVars.TELEGRAM_BOT_TOKEN,
    webhookUrl: envVars.TELEGRAM_WEBHOOK_URL,
    webhookSecret: envVars.TELEGRAM_WEBHOOK_SECRET,
    adminIds: envVars.ADMIN_TELEGRAM_IDS,
    options: {
      polling: !envVars.TELEGRAM_WEBHOOK_URL,
      webHook: envVars.TELEGRAM_WEBHOOK_URL ? {
        host: envVars.HOST,
        port: envVars.PORT,
      } : false,
    },
  },

  // APIs
  apis: {
    kiwi: {
      apiKey: envVars.KIWI_API_KEY,
      baseUrl: envVars.KIWI_API_URL,
      affiliateId: envVars.KIWI_AFFILIATE_ID,
    },
    travelpayouts: {
      apiKey: envVars.TRAVELPAYOUTS_API_KEY,
      marker: envVars.TRAVELPAYOUTS_MARKER,
      affiliateId: envVars.TRAVELPAYOUTS_AFFILIATE_ID,
    },
    skyscanner: {
      apiKey: envVars.SKYSCANNER_API_KEY,
      affiliateId: envVars.SKYSCANNER_AFFILIATE_ID,
    },
    exchangeRate: {
      apiKey: envVars.EXCHANGE_RATE_API_KEY,
      baseUrl: envVars.EXCHANGE_RATE_API_URL,
    },
  },

  // Database
  database: {
    url: envVars.DATABASE_URL,
    ssl: envVars.DATABASE_SSL,
    pool: {
      min: 2,
      max: 10,
    },
  },

  // Redis
  redis: {
    url: envVars.REDIS_URL,
    password: envVars.REDIS_PASSWORD || undefined,
    tls: envVars.REDIS_TLS,
  },

  // Caching
  cache: {
    enabled: envVars.CACHE_ENABLED,
    ttl: envVars.CACHE_TTL,
    routeTtl: envVars.ROUTE_CACHE_TTL,
    exchangeRateTtl: envVars.EXCHANGE_RATE_TTL,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW,
    max: envVars.RATE_LIMIT_MAX_REQUESTS,
  },

  // Logging
  logging: {
    level: envVars.LOG_LEVEL,
    fileEnabled: envVars.LOG_FILE_ENABLED,
    filePath: envVars.LOG_FILE_PATH,
  },

  // Features
  features: {
    virtualInterlining: envVars.ENABLE_VIRTUAL_INTERLINING,
    affiliateLinks: envVars.ENABLE_AFFILIATE_LINKS,
    searchHistory: envVars.ENABLE_SEARCH_HISTORY,
    priceAlerts: envVars.ENABLE_PRICE_ALERTS,
  },

  // Africa Configuration
  africa: {
    defaultCurrency: envVars.DEFAULT_CURRENCY,
    defaultCountry: envVars.DEFAULT_COUNTRY,
    popularAirports: envVars.POPULAR_AIRPORTS,
    hubAirports: ['JNB', 'CPT', 'ADD', 'NBO', 'LOS', 'ACC', 'CAI', 'DXB', 'DOH', 'IST'],
  },

  // Security
  security: {
    sessionSecret: envVars.SESSION_SECRET,
    encryptionKey: envVars.ENCRYPTION_KEY,
    jwtSecret: envVars.JWT_SECRET,
  },

  // Connection Limits
  limits: {
    maxApiRetries: 3,
    apiTimeout: 10000, // 10 seconds
    maxRoutesPerSearch: 1000,
    maxStitchedRoutes: 50,
    minConnectionTime: 2 * 60 * 60 * 1000, // 2 hours
    maxConnectionTime: 24 * 60 * 60 * 1000, // 24 hours
  },

  // Paths
  paths: {
    root: path.resolve(__dirname, '..'),
    src: path.resolve(__dirname, '..', 'src'),
    logs: path.resolve(__dirname, '..', 'logs'),
    scripts: path.resolve(__dirname, '..', 'scripts'),
    tests: path.resolve(__dirname, '..', 'tests'),
  },
};

module.exports = config;
