'use strict';

const axios = require('axios');
const config = require('../../config/config');
const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');
const redisClient = require('../database/redis-client');

/**
 * Kiwi.com Tequila API integration for virtual interlining
 */

class KiwiAPI {
  constructor() {
    this.baseUrl = config.apis.kiwi.baseUrl;
    this.apiKey = config.apis.kiwi.apiKey;
    this.affiliateId = config.apis.kiwi.affiliateId;
    this.timeout = 30000; // 30 seconds
    this.maxRetries = 3;
    
    // Create axios instance with default headers
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'apikey': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Kiwi API ${response.config.method.toUpperCase()} ${response.config.url} - ${response.status}`);
        return response;
      },
      (error) => {
        logger.error(`Kiwi API error: ${error.message}`, {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Search for flights using Kiwi API
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
      cabinClass = 'M',
      currency = 'ZAR',
      maxStops = 2,
      sort = 'price',
      limit = 100
    } = params;
    
    const cacheKey = `kiwi:search:${Helpers.generateCacheKey({ from, to, date, returnDate, adults, children, infants, cabinClass, currency })}`;
    
    // Try cache first
    if (config.cache.enabled) {
      const cached = await redisClient.getCachedSearchResults(cacheKey);
      if (cached) {
        logger.debug('Returning cached Kiwi results');
        return cached;
      }
    }
    
    try {
      const searchParams = {
        fly_from: from,
        fly_to: to,
        date_from: this.formatDate(date),
        date_to: this.formatDate(date),
        return_from: returnDate ? this.formatDate(returnDate) : undefined,
        return_to: returnDate ? this.formatDate(returnDate) : undefined,
        adults,
        children,
        infants,
        selected_cabins: cabinClass,
        curr: currency,
        max_stopovers: maxStops,
        sort,
        limit,
        partner_market: 'za',
        locale: 'en',
        vehicle_type: 'aircraft', // Only flights
        one_for_city: 0,
        one_per_date: 0,
        ret_from_diff_city: true,
        ret_to_diff_city: true,
        // Virtual interlining parameters
        enable_vi: 1, // Enable virtual interlining
        fly_days_type: 'departure',
        ret_fly_days_type: 'departure'
      };
      
      // Remove undefined parameters
      Object.keys(searchParams).forEach(key => 
        searchParams[key] === undefined && delete searchParams[key]
      );
      
      const response = await Helpers.retryWithBackoff(
        () => this.client.get('/v2/search', { params: searchParams }),
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
      logger.error('Kiwi API search error:', {
        params,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      // Return empty array instead of throwing for better UX
      return [];
    }
  }

  /**
   * Get locations (airports, cities) from Kiwi
   */
  async getLocations(query, locationTypes = 'airport', limit = 10) {
    const cacheKey = `kiwi:locations:${query}:${locationTypes}:${limit}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const params = {
        term: query,
        location_types: locationTypes,
        limit,
        locale: 'en',
        active_only: true
      };
      
      const response = await this.client.get('/locations/query', { params });
      
      const locations = response.data.locations.map(loc => ({
        id: loc.id,
        name: loc.name,
        code: loc.code,
        type: loc.type,
        country: loc.country?.name,
        countryCode: loc.country?.code,
        city: loc.city?.name,
        cityCode: loc.city?.code,
        coordinates: {
          lat: loc.location?.lat,
          lon: loc.location?.lon
        }
      }));
      
      // Cache for 24 hours
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, locations, 86400);
      }
      
      return locations;
      
    } catch (error) {
      logger.error('Kiwi locations error:', error.message);
      return [];
    }
  }

  /**
   * Check flights (for booking validation)
   */
  async checkFlights(bookingToken, bags = 0, passengers = 1) {
    try {
      const params = {
        bnum: passengers,
        pnum: passengers,
        bags,
        currency: 'ZAR',
        booking_token: bookingToken
      };
      
      const response = await this.client.get('/v2/check_flights', { params });
      
      return {
        valid: response.data.flights_checked,
        price: response.data.total,
        currency: response.data.currency,
        flightsInbound: response.data.flights_inbound,
        flightsOutbound: response.data.flights_outbound
      };
      
    } catch (error) {
      logger.error('Kiwi check flights error:', error.message);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Generate affiliate/deep link for booking
   */
  generateAffiliateLink(route) {
    if (!route || !route.bookingToken) {
      return null;
    }
    
    const baseUrl = 'https://www.kiwi.com/en/booking';
    const params = {
      token: route.bookingToken,
      currency: route.currency || 'ZAR',
      passengers: route.passengers || 1,
      bags: route.bags || 0,
      lang: 'en'
    };
    
    // Add affiliate ID if available
    if (this.affiliateId) {
      params.affilid = this.affiliateId;
    }
    
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    
    return `${baseUrl}?${queryString}`;
  }

  /**
   * Get multi-city/virtual interlining routes
   */
  async getMultiCityRoutes(params) {
    const { segments, passengers = 1, cabinClass = 'M', currency = 'ZAR' } = params;
    
    if (!segments || segments.length < 2) {
      return [];
    }
    
    try {
      const searchParams = {
        requests: segments.map((segment, index) => ({
          to: segment.to,
          from: segment.from,
          date: this.formatDate(segment.date),
          return_date: segment.returnDate ? this.formatDate(segment.returnDate) : undefined
        })),
        adults: passengers,
        children: 0,
        infants: 0,
        cabin_class: cabinClass,
        curr: currency,
        partner_market: 'za',
        locale: 'en',
        enable_vi: 1
      };
      
      const response = await this.client.post('/v2/flights_multi', searchParams);
      
      return this.normalizeMultiCityResults(response.data.data, params);
      
    } catch (error) {
      logger.error('Kiwi multi-city error:', error.message);
      return [];
    }
  }

  /**
   * Normalize Kiwi API results to common format
   */
  normalizeResults(kiwiResults, searchParams) {
    if (!kiwiResults || !Array.isArray(kiwiResults)) {
      return [];
    }
    
    return kiwiResults.map(result => {
      // Extract segments
      const segments = [];
      let virtualInterline = false;
      
      if (result.route && Array.isArray(result.route)) {
        result.route.forEach(segment => {
          segments.push({
            airline: segment.airline,
            flightNumber: segment.flight_no,
            from: segment.flyFrom,
            to: segment.flyTo,
            departure: new Date(segment.dTime * 1000),
            arrival: new Date(segment.aTime * 1000),
            duration: segment.duration?.departure || 0,
            equipment: segment.equipment,
            operatingAirline: segment.operating_carrier,
            cabinClass: searchParams.cabinClass
          });
          
          // Check if this is virtual interline
          if (segment.virtual_interlining) {
            virtualInterline = true;
          }
        });
      }
      
      // Calculate total duration
      const totalDuration = result.duration?.total || 0;
      
      // Get airlines
      const airlines = result.airlines || [];
      
      return {
        id: result.id,
        airlines,
        segments,
        totalPrice: result.price,
        totalPriceZAR: result.conversion?.ZAR || result.price,
        currency: result.conversion?.currency || 'EUR',
        totalDuration,
        bookingToken: result.booking_token,
        deepLink: result.deep_link,
        hasAirportChange: result.has_airport_change,
        technicalStops: result.technical_stops,
        virtualInterline,
        separateTickets: virtualInterline,
        bookingEngine: 'kiwi',
        source: 'kiwi',
        bagsPrice: result.bags_price,
        bagLimit: result.baglimit,
        // Additional metadata
        quality: result.quality,
        distance: result.distance,
        nightsInDest: result.nightsInDest,
        pnrCount: result.pnr_count,
        transferCount: segments.length - 1,
        pricePerKm: result.distance ? result.price / result.distance : 0
      };
    });
  }

  /**
   * Normalize multi-city results
   */
  normalizeMultiCityResults(multiResults, searchParams) {
    if (!multiResults || !Array.isArray(multiResults)) {
      return [];
    }
    
    return multiResults.map(result => {
      const segments = [];
      let allAirlines = new Set();
      
      if (result.route && Array.isArray(result.route)) {
        result.route.forEach(segment => {
          segments.push({
            airline: segment.airline,
            flightNumber: segment.flight_no,
            from: segment.flyFrom,
            to: segment.flyTo,
            departure: new Date(segment.dTime * 1000),
            arrival: new Date(segment.aTime * 1000),
            duration: segment.duration?.departure || 0,
            cabinClass: searchParams.cabinClass
          });
          
          if (segment.airline) {
            allAirlines.add(segment.airline);
          }
        });
      }
      
      return {
        id: result.id,
        airlines: Array.from(allAirlines),
        segments,
        totalPrice: result.price,
        totalPriceZAR: result.conversion?.ZAR || result.price,
        currency: result.conversion?.currency || 'EUR',
        totalDuration: result.duration?.total || 0,
        bookingToken: result.booking_token,
        deepLink: result.deep_link,
        virtualInterline: true,
        separateTickets: true,
        bookingEngine: 'kiwi',
        source: 'kiwi-multi',
        isMultiCity: true,
        segmentCount: segments.length
      };
    });
  }

  /**
   * Format date for Kiwi API (DD/MM/YYYY)
   */
  formatDate(dateString) {
    if (!dateString) return undefined;
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return undefined;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
  }

  /**
   * Get cheapest routes between two cities for a date range
   */
  async getCheapestRoutesByMonth(from, to, year, month, currency = 'ZAR') {
    const cacheKey = `kiwi:monthly:${from}:${to}:${year}:${month}:${currency}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const params = {
        fly_from: from,
        fly_to: to,
        date_from: `${year}-${String(month).padStart(2, '0')}-01`,
        date_to: `${year}-${String(month).padStart(2, '0')}-31`,
        curr: currency,
        sort: 'price',
        limit: 31, // One per day
        partner_market: 'za',
        locale: 'en',
        one_for_city: 0,
        one_per_date: 1, // Only one result per date
        max_stopovers: 2
      };
      
      const response = await this.client.get('/v2/search', { params });
      
      const results = response.data.data.map(flight => ({
        date: new Date(flight.dTime * 1000).toISOString().split('T')[0],
        price: flight.price,
        priceZAR: flight.conversion?.ZAR || flight.price,
        airlines: flight.airlines,
        duration: flight.duration?.total || 0,
        stops: flight.route?.length - 1 || 0,
        bookingToken: flight.booking_token
      }));
      
      // Cache for 12 hours
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, results, 43200);
      }
      
      return results;
      
    } catch (error) {
      logger.error('Kiwi monthly search error:', error.message);
      return [];
    }
  }

  /**
   * Validate if a route can be booked
   */
  async validateRoute(route) {
    if (!route || !route.bookingToken) {
      return { valid: false, error: 'Missing booking token' };
    }
    
    try {
      const check = await this.checkFlights(
        route.bookingToken,
        route.bags || 0,
        route.passengers || 1
      );
      
      return {
        valid: check.valid,
        price: check.price,
        currency: check.currency,
        details: check
      };
      
    } catch (error) {
      logger.error('Route validation error:', error.message);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Get airport/city information
   */
  async getLocationInfo(code) {
    const cacheKey = `kiwi:location:${code}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const locations = await this.getLocations(code, 'airport', 1);
      
      if (locations.length === 0) {
        return null;
      }
      
      const location = locations[0];
      
      // Cache for 7 days
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, location, 604800);
      }
      
      return location;
      
    } catch (error) {
      logger.error('Get location info error:', error.message);
      return null;
    }
  }

  /**
   * Test API connectivity
   */
  async testConnection() {
    try {
      const response = await this.client.get('/locations/query', {
        params: { term: 'JNB', limit: 1 }
      });
      
      return {
        connected: true,
        message: 'Kiwi API connection successful',
        data: response.data
      };
    } catch (error) {
      return {
        connected: false,
        message: `Kiwi API connection failed: ${error.message}`,
        error: error.response?.data || error.message
      };
    }
  }
}

// Create singleton instance
const kiwiAPI = new KiwiAPI();

module.exports = kiwiAPI;
