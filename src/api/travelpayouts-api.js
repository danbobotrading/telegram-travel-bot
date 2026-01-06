'use strict';

const axios = require('axios');
const config = require('../../config/config');
const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');
const redisClient = require('../database/redis-client');

/**
 * Travelpayouts API integration for flight searches
 */

class TravelpayoutsAPI {
  constructor() {
    this.baseUrl = 'https://api.travelpayouts.com';
    this.apiKey = config.apis.travelpayouts.apiKey;
    this.marker = config.apis.travelpayouts.marker;
    this.affiliateId = config.apis.travelpayouts.affiliateId;
    this.timeout = 30000;
    this.maxRetries = 2;
    
    // Create axios instance
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'X-Access-Token': this.apiKey,
        'Accept': 'application/json'
      }
    });
    
    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Travelpayouts API ${response.config.method.toUpperCase()} ${response.config.url} - ${response.status}`);
        return response;
      },
      (error) => {
        logger.error(`Travelpayouts API error: ${error.message}`, {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Search for flights
   */
  async searchFlights(params) {
    const {
      from,
      to,
      date,
      returnDate = null,
      adults = 1,
      children = 0,
      infants = 0,
      cabinClass = 'economy',
      currency = 'ZAR',
      tripType = 'oneway'
    } = params;
    
    const cacheKey = `travelpayouts:search:${Helpers.generateCacheKey({ from, to, date, returnDate, adults, children, infants, cabinClass, currency, tripType })}`;
    
    // Try cache first
    if (config.cache.enabled) {
      const cached = await redisClient.getCachedSearchResults(cacheKey);
      if (cached) {
        logger.debug('Returning cached Travelpayouts results');
        return cached;
      }
    }
    
    try {
      const searchParams = {
        origin: from,
        destination: to,
        depart_date: date,
        return_date: returnDate,
        adults,
        children,
        infants,
        trip_class: cabinClass,
        currency,
        locale: 'en',
        token: this.apiKey
      };
      
      // For one-way trips, remove return date
      if (tripType === 'oneway') {
        delete searchParams.return_date;
      }
      
      const response = await Helpers.retryWithBackoff(
        () => this.client.get('/v2/prices/latest', { params: searchParams }),
        this.maxRetries,
        1000
      );
      
      const results = this.normalizeResults(response.data.data, params);
      
      // Cache results
      if (config.cache.enabled && results.length > 0) {
        await redisClient.cacheSearchResults(cacheKey, results, params);
      }
      
      // Track popular search
      await redisClient.trackPopularSearch(from, to);
      
      return results;
      
    } catch (error) {
      logger.error('Travelpayouts API search error:', {
        params,
        error: error.message
      });
      
      return [];
    }
  }

  /**
   * Get month prices (calendar view)
   */
  async getMonthPrices(from, to, year, month, currency = 'ZAR') {
    const cacheKey = `travelpayouts:calendar:${from}:${to}:${year}:${month}:${currency}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const params = {
        origin: from,
        destination: to,
        depart_date: `${year}-${String(month).padStart(2, '0')}`,
        currency,
        token: this.apiKey
      };
      
      const response = await this.client.get('/v2/prices/month-matrix', { params });
      
      const results = response.data.data.map(day => ({
        date: day.depart_date,
        price: day.value,
        foundAt: day.actual_at,
        gate: day.gate
      }));
      
      // Cache for 6 hours
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, results, 21600);
      }
      
      return results;
      
    } catch (error) {
      logger.error('Travelpayouts calendar error:', error.message);
      return [];
    }
  }

  /**
   * Get airline information
   */
  async getAirlineInfo(iataCode) {
    const cacheKey = `travelpayouts:airline:${iataCode}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      // First try to get from Travelpayouts airlines endpoint
      const response = await this.client.get('/data/en/airlines.json');
      const airlines = response.data;
      
      const airline = airlines.find(a => a.code === iataCode || a.iata === iataCode);
      
      if (airline) {
        const result = {
          name: airline.name,
          code: airline.code,
          iata: airline.iata,
          icao: airline.icao,
          country: airline.country_code,
          isLowCost: airline.is_lowcost
        };
        
        // Cache for 30 days
        if (config.cache.enabled) {
          await redisClient.set(cacheKey, result, 2592000);
        }
        
        return result;
      }
      
      return null;
      
    } catch (error) {
      logger.error('Travelpayouts airline info error:', error.message);
      return null;
    }
  }

  /**
   * Get airport information
   */
  async getAirportInfo(iataCode) {
    const cacheKey = `travelpayouts:airport:${iataCode}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const response = await this.client.get('/data/en/airports.json');
      const airports = response.data;
      
      const airport = airports.find(a => a.code === iataCode);
      
      if (airport) {
        const result = {
          name: airport.name,
          code: airport.code,
          city: airport.city_code,
          country: airport.country_code,
          coordinates: {
            lat: airport.coordinates?.lat,
            lon: airport.coordinates?.lon
          },
          timezone: airport.time_zone
        };
        
        // Cache for 30 days
        if (config.cache.enabled) {
          await redisClient.set(cacheKey, result, 2592000);
        }
        
        return result;
      }
      
      return null;
      
    } catch (error) {
      logger.error('Travelpayouts airport info error:', error.message);
      return null;
    }
  }

  /**
   * Generate affiliate link
   */
  generateAffiliateLink(route) {
    if (!route || !route.searchParams) {
      return null;
    }
    
    const { from, to, date, returnDate, adults, currency } = route.searchParams;
    
    let baseUrl = 'https://www.aviasales.com';
    let params = {
      origin: from,
      destination: to,
      depart_date: date,
      adults: adults || 1,
      currency: currency || 'ZAR',
      locale: 'en'
    };
    
    if (returnDate) {
      params.return_date = returnDate;
    }
    
    // Add marker/affiliate ID
    if (this.marker) {
      params.market = this.marker;
    }
    
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    
    return `${baseUrl}/search?${queryString}`;
  }

  /**
   * Generate direct booking link for a specific flight
   */
  generateDirectBookingLink(route) {
    if (!route || !route.link) {
      return this.generateAffiliateLink(route);
    }
    
    // Add affiliate parameters to existing link
    const url = new URL(route.link);
    
    if (this.marker) {
      url.searchParams.set('marker', this.marker);
    }
    
    if (this.affiliateId) {
      url.searchParams.set('affiliate_id', this.affiliateId);
    }
    
    return url.toString();
  }

  /**
   * Normalize Travelpayouts results to common format
   */
  normalizeResults(tpResults, searchParams) {
    if (!tpResults || !Array.isArray(tpResults)) {
      return [];
    }
    
    return tpResults.map(result => {
      // Parse route information
      const segments = [];
      const airlines = new Set();
      
      if (result.itineraries && Array.isArray(result.itineraries)) {
        result.itineraries.forEach(itinerary => {
          if (itinerary.segments && Array.isArray(itinerary.segments)) {
            itinerary.segments.forEach(segment => {
              segments.push({
                airline: segment.airline,
                flightNumber: segment.flight_number,
                from: segment.departure?.iata,
                to: segment.arrival?.iata,
                departure: new Date(segment.departure?.at),
                arrival: new Date(segment.arrival?.at),
                duration: segment.duration,
                aircraft: segment.aircraft,
                operatingAirline: segment.operating_carrier?.iata
              });
              
              if (segment.airline) {
                airlines.add(segment.airline);
              }
            });
          }
        });
      }
      
      // Calculate total duration
      const totalDuration = segments.reduce((total, segment) => total + (segment.duration || 0), 0);
      
      return {
        id: result.id || `tp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        airlines: Array.from(airlines),
        segments,
        totalPrice: result.price,
        totalPriceZAR: result.price, // Already in ZAR from API
        currency: searchParams.currency || 'ZAR',
        totalDuration,
        link: result.link,
        bookingEngine: 'travelpayouts',
        source: 'travelpayouts',
        // Additional metadata
        transferCount: segments.length - 1,
        priceDetails: {
          total: result.price,
          base: result.base_price,
          fees: result.fees,
          taxes: result.taxes
        },
        // Store search params for affiliate link generation
        searchParams
      };
    });
  }

  /**
   * Get cheapest flights for tomorrow (for notifications)
   */
  async getCheapestTomorrow(from, to, currency = 'ZAR') {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];
      
      const params = {
        origin: from,
        destination: to,
        depart_date: dateStr,
        currency,
        token: this.apiKey,
        limit: 5,
        sorting: 'price'
      };
      
      const response = await this.client.get('/v2/prices/latest', { params });
      
      return this.normalizeResults(response.data.data.slice(0, 3), {
        from, to, date: dateStr, currency
      });
      
    } catch (error) {
      logger.error('Travelpayouts tomorrow error:', error.message);
      return [];
    }
  }

  /**
   * Get popular routes from an origin
   */
  async getPopularRoutesFrom(origin, limit = 10) {
    const cacheKey = `travelpayouts:popular:${origin}:${limit}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const params = {
        origin,
        token: this.apiKey
      };
      
      const response = await this.client.get('/v1/city-directions', { params });
      
      const routes = Object.entries(response.data.data || {})
        .map(([destination, data]) => ({
          destination,
          price: data.price,
          airline: data.airline,
          flightNumber: data.flight_number,
          departureAt: data.departure_at
        }))
        .sort((a, b) => a.price - b.price)
        .slice(0, limit);
      
      // Cache for 24 hours
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, routes, 86400);
      }
      
      return routes;
      
    } catch (error) {
      logger.error('Travelpayouts popular routes error:', error.message);
      return [];
    }
  }

  /**
   * Search for special offers/discounts
   */
  async getSpecialOffers(origin = null, destination = null, limit = 20) {
    try {
      const params = {
        origin_iata: origin,
        destination_iata: destination,
        token: this.apiKey,
        limit
      };
      
      // Remove null/undefined parameters
      Object.keys(params).forEach(key => 
        params[key] === null && delete params[key]
      );
      
      const response = await this.client.get('/v1/prices/special-offers', { params });
      
      return response.data.data.map(offer => ({
        origin: offer.origin,
        destination: offer.destination,
        price: offer.value,
        foundAt: offer.actual_at,
        distance: offer.distance,
        duration: offer.duration,
        airline: offer.airline,
        flightNumber: offer.flight_number,
        departureAt: offer.departure_at
      }));
      
    } catch (error) {
      logger.error('Travelpayouts special offers error:', error.message);
      return [];
    }
  }

  /**
   * Test API connectivity
   */
  async testConnection() {
    try {
      const response = await this.client.get('/v2/prices/latest', {
        params: {
          origin: 'JNB',
          destination: 'CPT',
          depart_date: new Date().toISOString().split('T')[0],
          token: this.apiKey,
          limit: 1
        }
      });
      
      return {
        connected: true,
        message: 'Travelpayouts API connection successful',
        data: response.data
      };
    } catch (error) {
      return {
        connected: false,
        message: `Travelpayouts API connection failed: ${error.message}`,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Get currency exchange rates
   */
  async getExchangeRates(baseCurrency = 'ZAR') {
    const cacheKey = `travelpayouts:rates:${baseCurrency}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const response = await this.client.get('/v2/currency', {
        params: {
          base: baseCurrency,
          token: this.apiKey
        }
      });
      
      const rates = response.data.rates || {};
      
      // Cache for 1 hour
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, rates, 3600);
      }
      
      return rates;
      
    } catch (error) {
      logger.error('Travelpayouts exchange rates error:', error.message);
      return {};
    }
  }

  /**
   * Convert currency using Travelpayouts rates
   */
  async convertCurrency(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
      return amount;
    }
    
    try {
      const rates = await this.getExchangeRates(fromCurrency);
      
      if (rates[toCurrency]) {
        return amount * rates[toCurrency];
      }
      
      // If direct conversion not available, try via USD
      if (rates.USD && fromCurrency !== 'USD') {
        const usdAmount = amount * rates.USD;
        const usdRates = await this.getExchangeRates('USD');
        
        if (usdRates[toCurrency]) {
          return usdAmount * usdRates[toCurrency];
        }
      }
      
      return amount; // Return original if conversion fails
      
    } catch (error) {
      logger.error('Currency conversion error:', error.message);
      return amount;
    }
  }
}

// Create singleton instance
const travelpayoutsAPI = new TravelpayoutsAPI();

module.exports = travelpayoutsAPI;
