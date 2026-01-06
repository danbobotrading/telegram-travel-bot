'use strict';

const axios = require('axios');
const config = require('../../config/config');
const logger = require('../utils/logger');
const redisClient = require('../database/redis-client');

/**
 * Exchange Rate API integration for currency conversion
 */

class ExchangeRateAPI {
  constructor() {
    this.baseUrl = config.apis.exchangeRate.baseUrl;
    this.apiKey = config.apis.exchangeRate.apiKey;
    this.timeout = 10000;
    this.maxRetries = 3;
    
    // Create axios instance
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Exchange Rate API ${response.config.url} - ${response.status}`);
        return response;
      },
      (error) => {
        logger.error(`Exchange Rate API error: ${error.message}`, {
          url: error.config?.url,
          status: error.response?.status
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get latest exchange rates
   */
  async getLatestRates(baseCurrency = 'ZAR') {
    const cacheKey = `exchange_rates:latest:${baseCurrency}`;
    
    // Try cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.debug('Returning cached exchange rates');
      return cached;
    }
    
    try {
      const url = this.apiKey 
        ? `/latest/${this.apiKey}/latest/${baseCurrency}`
        : `/latest/${baseCurrency}`;
      
      const response = await this.client.get(url);
      
      const rates = {
        base: response.data.base_code || baseCurrency,
        rates: response.data.conversion_rates || {},
        lastUpdated: new Date().toISOString(),
        timestamp: response.data.time_last_update_unix || Date.now()
      };
      
      // Cache for 1 hour
      await redisClient.set(cacheKey, rates, config.cache.exchangeRateTtl);
      
      return rates;
      
    } catch (error) {
      logger.error('Failed to fetch exchange rates:', error.message);
      
      // Return cached rates even if expired, or default rates
      const expiredCache = await redisClient.get(cacheKey);
      if (expiredCache) {
        logger.warn('Using expired exchange rates');
        return expiredCache;
      }
      
      // Fallback to hardcoded rates if API fails
      return this.getFallbackRates(baseCurrency);
    }
  }

  /**
   * Convert amount between currencies
   */
  async convert(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
      return amount;
    }
    
    try {
      const rates = await this.getLatestRates(fromCurrency);
      
      if (rates.rates[toCurrency]) {
        return amount * rates.rates[toCurrency];
      }
      
      // If direct conversion not available, try via USD
      if (rates.rates.USD && fromCurrency !== 'USD') {
        const usdAmount = amount * rates.rates.USD;
        const usdRates = await this.getLatestRates('USD');
        
        if (usdRates.rates[toCurrency]) {
          return usdAmount * usdRates.rates[toCurrency];
        }
      }
      
      logger.warn(`No conversion rate found from ${fromCurrency} to ${toCurrency}`);
      return amount;
      
    } catch (error) {
      logger.error('Currency conversion error:', error.message);
      return amount;
    }
  }

  /**
   * Convert multiple amounts at once
   */
  async convertMultiple(conversions) {
    const results = [];
    
    for (const conversion of conversions) {
      const { amount, fromCurrency, toCurrency } = conversion;
      
      try {
        const converted = await this.convert(amount, fromCurrency, toCurrency);
        results.push({
          ...conversion,
          convertedAmount: converted,
          success: true
        });
      } catch (error) {
        results.push({
          ...conversion,
          convertedAmount: amount, // Return original on error
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * Get historical exchange rates
   */
  async getHistoricalRates(date, baseCurrency = 'ZAR') {
    const cacheKey = `exchange_rates:historical:${date}:${baseCurrency}`;
    
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const formattedDate = new Date(date).toISOString().split('T')[0];
      const url = this.apiKey
        ? `/historical/${this.apiKey}/${formattedDate}/${baseCurrency}`
        : `/historical/${formattedDate}/${baseCurrency}`;
      
      const response = await this.client.get(url);
      
      const rates = {
        date: formattedDate,
        base: response.data.base_code || baseCurrency,
        rates: response.data.conversion_rates || {},
        lastUpdated: new Date().toISOString()
      };
      
      // Cache for 30 days (historical rates don't change)
      await redisClient.set(cacheKey, rates, 2592000);
      
      return rates;
      
    } catch (error) {
      logger.error('Failed to fetch historical rates:', error.message);
      return null;
    }
  }

  /**
   * Get time-series data for rate analysis
   */
  async getTimeSeries(startDate, endDate, baseCurrency = 'ZAR', targetCurrency) {
    try {
      const start = new Date(startDate).toISOString().split('T')[0];
      const end = new Date(endDate).toISOString().split('T')[0];
      
      // For free tier, we'll simulate by fetching each day
      const days = Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24));
      
      if (days > 30) {
        logger.warn('Time series limited to 30 days for free tier');
        // Adjust end date
        endDate = new Date(start);
        endDate.setDate(endDate.getDate() + 29);
        end = endDate.toISOString().split('T')[0];
      }
      
      const timeSeries = [];
      let currentDate = new Date(start);
      const endDateObj = new Date(end);
      
      while (currentDate <= endDateObj) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const rates = await this.getHistoricalRates(dateStr, baseCurrency);
        
        if (rates) {
          timeSeries.push({
            date: dateStr,
            rate: targetCurrency ? rates.rates[targetCurrency] : rates.rates
          });
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      return timeSeries;
      
    } catch (error) {
      logger.error('Failed to fetch time series:', error.message);
      return [];
    }
  }

  /**
   * Get supported currencies
   */
  async getSupportedCurrencies() {
    const cacheKey = 'exchange_rates:supported_currencies';
    
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const url = this.apiKey
        ? `/latest/${this.apiKey}/codes`
        : '/codes';
      
      const response = await this.client.get(url);
      
      const currencies = response.data.supported_codes || [];
      
      // Cache for 7 days
      await redisClient.set(cacheKey, currencies, 604800);
      
      return currencies;
      
    } catch (error) {
      logger.error('Failed to fetch supported currencies:', error.message);
      return this.getFallbackCurrencies();
    }
  }

  /**
   * Get currency information
   */
  async getCurrencyInfo(currencyCode) {
    const cacheKey = `exchange_rates:currency_info:${currencyCode}`;
    
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const allCurrencies = await this.getSupportedCurrencies();
      const currency = allCurrencies.find(c => c[0] === currencyCode);
      
      if (!currency) {
        return null;
      }
      
      const info = {
        code: currency[0],
        name: currency[1],
        symbol: this.getCurrencySymbol(currency[0])
      };
      
      // Cache for 30 days
      await redisClient.set(cacheKey, info, 2592000);
      
      return info;
      
    } catch (error) {
      logger.error('Failed to fetch currency info:', error.message);
      return null;
    }
  }

  /**
   * Get fallback rates when API fails
   */
  getFallbackRates(baseCurrency = 'ZAR') {
    // Hardcoded rates as fallback (approximate values)
    const fallbackRates = {
      ZAR: {
        USD: 0.054,
        EUR: 0.050,
        GBP: 0.043,
        KES: 7.85,
        NGN: 49.50,
        EGP: 1.67,
        GHS: 0.65,
        AED: 0.20,
        QAR: 0.20,
        AUD: 0.082,
        CAD: 0.074,
        CHF: 0.049,
        JPY: 8.10,
        CNY: 0.39,
        INR: 4.50
      },
      USD: {
        ZAR: 18.50,
        EUR: 0.92,
        GBP: 0.79,
        KES: 145.00,
        NGN: 915.00
      },
      EUR: {
        ZAR: 20.00,
        USD: 1.08,
        GBP: 0.86,
        KES: 157.00
      },
      GBP: {
        ZAR: 23.26,
        USD: 1.26,
        EUR: 1.16,
        KES: 182.00
      }
    };
    
    const rates = fallbackRates[baseCurrency] || fallbackRates.ZAR;
    
    return {
      base: baseCurrency,
      rates: {
        ...rates,
        [baseCurrency]: 1 // Add base currency with rate 1
      },
      lastUpdated: new Date().toISOString(),
      timestamp: Date.now(),
      isFallback: true
    };
  }

  /**
   * Get fallback currencies list
   */
  getFallbackCurrencies() {
    return [
      ['ZAR', 'South African Rand'],
      ['USD', 'US Dollar'],
      ['EUR', 'Euro'],
      ['GBP', 'British Pound'],
      ['KES', 'Kenyan Shilling'],
      ['NGN', 'Nigerian Naira'],
      ['EGP', 'Egyptian Pound'],
      ['GHS', 'Ghanaian Cedi'],
      ['AED', 'UAE Dirham'],
      ['QAR', 'Qatari Riyal'],
      ['AUD', 'Australian Dollar'],
      ['CAD', 'Canadian Dollar'],
      ['CHF', 'Swiss Franc'],
      ['JPY', 'Japanese Yen'],
      ['CNY', 'Chinese Yuan'],
      ['INR', 'Indian Rupee']
    ];
  }

  /**
   * Get currency symbol
   */
  getCurrencySymbol(currencyCode) {
    const symbols = {
      'ZAR': 'R',
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'KES': 'KSh',
      'NGN': '₦',
      'EGP': 'E£',
      'GHS': 'GH₵',
      'AED': 'د.إ',
      'QAR': 'ر.ق',
      'AUD': 'A$',
      'CAD': 'C$',
      'CHF': 'CHF',
      'JPY': '¥',
      'CNY': '¥',
      'INR': '₹'
    };
    
    return symbols[currencyCode] || currencyCode;
  }

  /**
   * Format currency amount
   */
  formatCurrency(amount, currencyCode) {
    const symbol = this.getCurrencySymbol(currencyCode);
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
    
    // Place symbol based on currency
    if (['R', '$', '€', '£', 'A$', 'C$'].includes(symbol)) {
      return `${symbol}${formatted}`;
    }
    
    return `${formatted} ${symbol}`;
  }

  /**
   * Calculate percentage change between two amounts
   */
  calculatePercentageChange(oldAmount, newAmount) {
    if (!oldAmount || oldAmount === 0) {
      return newAmount > 0 ? 100 : 0;
    }
    
    return ((newAmount - oldAmount) / oldAmount) * 100;
  }

  /**
   * Get best conversion rate among multiple currencies
   */
  async findBestConversion(amount, fromCurrency, targetCurrencies) {
    const conversions = [];
    
    for (const targetCurrency of targetCurrencies) {
      try {
        const converted = await this.convert(amount, fromCurrency, targetCurrency);
        conversions.push({
          currency: targetCurrency,
          amount: converted,
          formatted: this.formatCurrency(converted, targetCurrency)
        });
      } catch (error) {
        // Skip failed conversions
        continue;
      }
    }
    
    // Sort by amount (descending)
    conversions.sort((a, b) => b.amount - a.amount);
    
    return conversions;
  }

  /**
   * Get exchange rate volatility
   */
  async getVolatility(baseCurrency, targetCurrency, days = 30) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const timeSeries = await this.getTimeSeries(
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0],
        baseCurrency,
        targetCurrency
      );
      
      if (timeSeries.length < 2) {
        return null;
      }
      
      const rates = timeSeries.map(item => item.rate).filter(rate => rate);
      const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
      
      // Calculate standard deviation
      const squaredDiffs = rates.map(rate => Math.pow(rate - mean, 2));
      const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / rates.length;
      const stdDev = Math.sqrt(variance);
      
      // Calculate volatility as percentage of mean
      const volatility = (stdDev / mean) * 100;
      
      return {
        baseCurrency,
        targetCurrency,
        periodDays: days,
        meanRate: mean,
        standardDeviation: stdDev,
        volatilityPercentage: volatility,
        minRate: Math.min(...rates),
        maxRate: Math.max(...rates),
        currentRate: rates[rates.length - 1],
        dataPoints: rates.length
      };
      
    } catch (error) {
      logger.error('Failed to calculate volatility:', error.message);
      return null;
    }
  }

  /**
   * Test API connectivity
   */
  async testConnection() {
    try {
      const rates = await this.getLatestRates('ZAR');
      
      return {
        connected: true,
        message: 'Exchange Rate API connection successful',
        baseCurrency: rates.base,
        ratesCount: Object.keys(rates.rates).length,
        isFallback: rates.isFallback || false
      };
    } catch (error) {
      return {
        connected: false,
        message: `Exchange Rate API connection failed: ${error.message}`,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Update rates in Redis cache (for cron job)
   */
  async updateRatesCache() {
    try {
      const majorCurrencies = ['ZAR', 'USD', 'EUR', 'GBP'];
      
      for (const currency of majorCurrencies) {
        await this.getLatestRates(currency);
        logger.info(`Updated exchange rates for ${currency}`);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to update rates cache:', error.message);
      return false;
    }
  }
}

// Create singleton instance
const exchangeRateAPI = new ExchangeRateAPI();

module.exports = exchangeRateAPI;
