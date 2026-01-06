'use strict';

const winston = require('winston');
const path = require('path');
const config = require('../../config/config');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Create transports array
const transports = [];

// Console transport for all environments
transports.push(
  new winston.transports.Console({
    format: consoleFormat,
    level: config.logging.level,
  })
);

// File transport for production
if (config.logging.fileEnabled && config.isProduction) {
  const logsDir = config.paths.logs;
  
  // Ensure logs directory exists
  require('fs').mkdirSync(logsDir, { recursive: true });
  
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
  
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { service: 'telegram-travel-bot' },
  transports,
  exceptionHandlers: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    ...(config.logging.fileEnabled ? [
      new winston.transports.File({
        filename: path.join(config.paths.logs, 'exceptions.log'),
      })
    ] : []),
  ],
  rejectionHandlers: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    ...(config.logging.fileEnabled ? [
      new winston.transports.File({
        filename: path.join(config.paths.logs, 'rejections.log'),
      })
    ] : []),
  ],
  exitOnError: false,
});

// Add a custom method for API logging
logger.api = (method, endpoint, status, duration, metadata = {}) => {
  logger.info(`API ${method} ${endpoint} ${status} ${duration}ms`, {
    type: 'api',
    method,
    endpoint,
    status,
    duration,
    ...metadata,
  });
};

// Add a custom method for search logging
logger.search = (userId, from, to, date, resultCount, metadata = {}) => {
  logger.info(`SEARCH ${from}->${to} ${date} results:${resultCount}`, {
    type: 'search',
    userId,
    from,
    to,
    date,
    resultCount,
    ...metadata,
  });
};

// Add a custom method for affiliate click logging
logger.affiliateClick = (userId, provider, routeId, revenue, metadata = {}) => {
  logger.info(`AFFILIATE CLICK ${provider} ${routeId} revenue:${revenue}`, {
    type: 'affiliate',
    userId,
    provider,
    routeId,
    revenue,
    ...metadata,
  });
};

// Add a custom method for error with context
logger.errorWithContext = (error, context = {}) => {
  logger.error(error.message, {
    type: 'error',
    stack: error.stack,
    ...context,
  });
};

// Morgan-like HTTP request logger middleware
logger.httpLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.api(req.method, req.originalUrl, res.statusCode, duration, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user ? req.user.id : null,
    });
  });
  
  next();
};

module.exports = logger;
