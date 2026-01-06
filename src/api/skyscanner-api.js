'use strict';

const axios = require('axios');
const config = require('../../config/config');
const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');
const redisClient = require('../database/redis-client');

/**
 * Skyscanner API integration for flight searches
 */

class SkyscannerAPI {
  constructor() {
    this.baseUrl = 'https://skyscanner-api.p.rapidapi.com';
    this.apiKey = config.apis.skyscanner.apiKey;
    this.affiliateId = config.apis.skyscanner.affiliateId;
    this.timeout = 30000;
    this.maxRetries = 2;
    
    // Create axios instance with RapidAPI headers
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'X-RapidAPI-Key': this.apiKey,
        'X-RapidAPI-Host': 'skyscanner-api.p.rapidapi.com',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Skyscanner API ${response.config.method.toUpperCase()} ${response.config.url} - ${response.status}`);
        return response;
      },
      (error) => {
        logger.error(`Skyscanner API error: ${error.message}`, {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Create a search session
   */
  async createSearchSession(params) {
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
      market = 'ZA',
      locale = 'en-GB'
    } = params;
    
    try {
      const requestBody = {
        query: {
          market,
          locale,
          currency,
          query_legs: [
            {
              origin_place_id: { iata: from },
              destination_place_id: { iata: to },
              date: {
                year: new Date(date).getFullYear(),
                month: new Date(date).getMonth() + 1,
                day: new Date(date).getDate()
              }
            }
          ],
          adults,
          children,
          infants,
          cabin_class: cabinClass
        }
      };
      
      // Add return leg if provided
      if (returnDate) {
        requestBody.query.query_legs.push({
          origin_place_id: { iata: to },
          destination_place_id: { iata: from },
          date: {
            year: new Date(returnDate).getFullYear(),
            month: new Date(returnDate).getMonth() + 1,
            day: new Date(returnDate).getDate()
          }
        });
      }
      
      const response = await this.client.post('/v3e/flights/live/search/create', requestBody);
      
      return {
        sessionToken: response.data.sessionToken,
        status: response.data.status
      };
      
    } catch (error) {
      logger.error('Skyscanner create session error:', error.message);
      throw error;
    }
  }

  /**
   * Poll search results
   */
  async pollSearchResults(sessionToken) {
    try {
      const response = await this.client.post('/v3e/flights/live/search/poll', {
        sessionToken
      });
      
      return response.data;
      
    } catch (error) {
      logger.error('Skyscanner poll results error:', error.message);
      throw error;
    }
  }

  /**
   * Search for flights (simplified wrapper)
   */
  async searchFlights(params) {
    const cacheKey = `skyscanner:search:${Helpers.generateCacheKey(params)}`;
    
    // Try cache first
    if (config.cache.enabled) {
      const cached = await redisClient.getCachedSearchResults(cacheKey);
      if (cached) {
        logger.debug('Returning cached Skyscanner results');
        return cached;
      }
    }
    
    try {
      // Create search session
      const session = await this.createSearchSession(params);
      
      if (!session.sessionToken) {
        throw new Error('Failed to create search session');
      }
      
      // Poll for results with retries
      let results = null;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts && !results) {
        attempts++;
        
        try {
          const pollResponse = await this.pollSearchResults(session.sessionToken);
          
          if (pollResponse.status === 'RESULT_STATUS_COMPLETE') {
            results = pollResponse;
            break;
          }
          
          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          logger.error(`Poll attempt ${attempts} failed:`, error.message);
          
          if (attempts >= maxAttempts) {
            throw error;
          }
          
          // Wait longer on error
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      if (!results) {
        throw new Error('Search timed out');
      }
      
      const normalizedResults = this.normalizeResults(results, params);
      
      // Cache results
      if (config.cache.enabled && normalizedResults.length > 0) {
        await redisClient.cacheSearchResults(cacheKey, normalizedResults, params);
      }
      
      // Track popular search
      await redisClient.trackPopularSearch(params.from, params.to);
      
      return normalizedResults;
      
    } catch (error) {
      logger.error('Skyscanner search error:', {
        params,
        error: error.message
      });
      
      return [];
    }
  }

  /**
   * Autocomplete places (airports, cities)
   */
  async autocompletePlaces(query, market = 'ZA', locale = 'en-GB') {
    const cacheKey = `skyscanner:autocomplete:${query}:${market}:${locale}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const params = {
        query,
        market,
        locale
      };
      
      const response = await this.client.get('/v3/autosuggest/flights', { params });
      
      const places = response.data.places.map(place => ({
        id: place.placeId,
        name: place.placeName,
        city: place.cityName,
        country: place.countryName,
        type: place.placeType,
        iata: place.iata || place.skyscannerCode,
        coordinates: {
          lat: place.coordinates?.latitude,
          lon: place.coordinates?.longitude
        }
      }));
      
      // Cache for 24 hours
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, places, 86400);
      }
      
      return places;
      
    } catch (error) {
      logger.error('Skyscanner autocomplete error:', error.message);
      return [];
    }
  }

  /**
   * Browse quotes (for inspiration)
   */
  async browseQuotes(from, to, date, market = 'ZA', currency = 'ZAR') {
    const cacheKey = `skyscanner:browse:${from}:${to}:${date}:${market}:${currency}`;
    
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
        departureDate: date,
        market,
        currency
      };
      
      const response = await this.client.get('/v1/browsedates/v1.0/ZA/ZAR/en-GB', { params });
      
      const quotes = response.data.Quotes.map(quote => ({
        quoteId: quote.QuoteId,
        minPrice: quote.MinPrice,
        direct: quote.Direct,
        outboundCarriers: quote.OutboundLeg?.CarrierIds || [],
        inboundCarriers: quote.InboundLeg?.CarrierIds || [],
        quoteDateTime: quote.QuoteDateTime
      }));
      
      // Cache for 6 hours
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, quotes, 21600);
      }
      
      return quotes;
      
    } catch (error) {
      logger.error('Skyscanner browse quotes error:', error.message);
      return [];
    }
  }

  /**
   * Get carrier information
   */
  async getCarrierInfo(carrierId) {
    const cacheKey = `skyscanner:carrier:${carrierId}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const response = await this.client.get('/v1/carriers/v1.0/ZA/ZAR/en-GB');
      
      const carriers = response.data.Carriers;
      const carrier = carriers.find(c => c.CarrierId === carrierId);
      
      if (carrier) {
        const result = {
          id: carrier.CarrierId,
          name: carrier.Name,
          code: carrier.Code,
          displayCode: carrier.DisplayCode,
          isLowCost: carrier.IsLowCost || false
        };
        
        // Cache for 30 days
        if (config.cache.enabled) {
          await redisClient.set(cacheKey, result, 2592000);
        }
        
        return result;
      }
      
      return null;
      
    } catch (error) {
      logger.error('Skyscanner carrier info error:', error.message);
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
    
    const { from, to, date, returnDate, adults, currency = 'ZAR' } = route.searchParams;
    
    const baseUrl = 'https://www.skyscanner.net/transport/flights';
    let path = `/${from}/${to}/${date}`;
    
    if (returnDate) {
      path += `/${returnDate}`;
    }
    
    const params = {
      adults: adults || 1,
      currency,
      locale: 'en-GB',
      market: 'ZA'
    };
    
    // Add affiliate ID if available
    if (this.affiliateId) {
      params.partner = this.affiliateId;
    }
    
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    
    return `${baseUrl}${path}?${queryString}`;
  }

  /**
   * Normalize Skyscanner results to common format
   */
  normalizeResults(skyscannerData, searchParams) {
    if (!skyscannerData || !skyscannerData.content) {
      return [];
    }
    
    const { results, itineraries, legs, segments, carriers } = skyscannerData.content;
    
    if (!results || !results.itineraries) {
      return [];
    }
    
    const normalizedResults = [];
    
    // Get top itineraries by price
    const sortedItineraries = Object.values(results.itineraries)
      .sort((a, b) => a.pricing_options[0]?.price?.amount - b.pricing_options[0]?.price?.amount)
      .slice(0, 50); // Limit to top 50
    
    for (const itinerary of sortedItineraries) {
      try {
        const itineraryDetails = itineraries[itinerary.itineraryId];
        
        if (!itineraryDetails || !itineraryDetails.legIds || itineraryDetails.legIds.length === 0) {
          continue;
        }
        
        // Get legs
        const legDetails = itineraryDetails.legIds.map(legId => legs[legId]);
        
        // Extract segments
        const allSegments = [];
        const allAirlines = new Set();
        
        for (const leg of legDetails) {
          if (leg.segmentIds && Array.isArray(leg.segmentIds)) {
            for (const segmentId of leg.segmentIds) {
              const segment = segments[segmentId];
              
              if (segment) {
                // Get carrier info
                const carrier = carriers[segment.marketingCarrierId];
                const airlineCode = carrier?.code || segment.marketingCarrierId;
                
                allSegments.push({
                  airline: airlineCode,
                  flightNumber: segment.flightNumber,
                  from: segment.originPlaceId,
                  to: segment.destinationPlaceId,
                  departure: new Date(segment.departureDateTime),
                  arrival: new Date(segment.arrivalDateTime),
                  duration: segment.durationInMinutes,
                  aircraft: segment.aircraft,
                  operatingAirline: segment.operatingCarrierId
                });
                
                if (airlineCode) {
                  allAirlines.add(airlineCode);
                }
              }
            }
          }
        }
        
        if (allSegments.length === 0) {
          continue;
        }
        
        // Get pricing
        const pricingOption = itinerary.pricing_options[0];
        if (!pricingOption || !pricingOption.price) {
          continue;
        }
        
        // Calculate total duration
        const firstSegment = allSegments[0];
        const lastSegment = allSegments[allSegments.length - 1];
        const totalDuration = lastSegment.arrival - firstSegment.departure;
        
        normalizedResults.push({
          id: itinerary.itineraryId,
          airlines: Array.from(allAirlines),
          segments: allSegments,
          totalPrice: pricingOption.price.amount,
          totalPriceZAR: pricingOption.price.amount, // Already in ZAR
          currency: pricingOption.price.unit || searchParams.currency || 'ZAR',
          totalDuration: totalDuration / (1000 * 60), // Convert to minutes
          deepLink: pricingOption.items[0]?.deep_link,
          bookingEngine: 'skyscanner',
          source: 'skyscanner',
          // Additional metadata
          agent: pricingOption.agents?.[0],
          transferCount: allSegments.length - 1,
          // Store search params for affiliate link generation
          searchParams
        });
        
      } catch (error) {
        logger.error('Error normalizing Skyscanner itinerary:', error);
        continue;
      }
    }
    
    return normalizedResults;
  }

  /**
   * Get cheapest flights by month (calendar)
   */
  async getCheapestByMonth(from, to, year, month, currency = 'ZAR') {
    const cacheKey = `skyscanner:cheapest:${from}:${to}:${year}:${month}:${currency}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-28`; // Use 28 to be safe
      
      const params = {
        origin: from,
        destination: to,
        departureDate: startDate,
        returnDate: endDate,
        market: 'ZA',
        currency,
        locale: 'en-GB'
      };
      
      const response = await this.client.get('/v1/browsedates/v1.0/ZA/ZAR/en-GB', { params });
      
      const results = response.data.Quotes.map(quote => ({
        date: quote.OutboundLeg?.DepartureDate,
        price: quote.MinPrice,
        direct: quote.Direct,
        quoteId: quote.QuoteId
      }));
      
      // Cache for 12 hours
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, results, 43200);
      }
      
      return results;
      
    } catch (error) {
      logger.error('Skyscanner cheapest by month error:', error.message);
      return [];
    }
  }

  /**
   * Get flight inspiration (places to go from an origin)
   */
  async getInspiration(origin, currency = 'ZAR', maxPrice = null) {
    const cacheKey = `skyscanner:inspiration:${origin}:${currency}:${maxPrice}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      // Get current date and date 6 months from now
      const today = new Date();
      const future = new Date();
      future.setMonth(future.getMonth() + 6);
      
      const formatDate = (date) => date.toISOString().split('T')[0];
      
      const params = {
        origin,
        departureDate: formatDate(today),
        returnDate: formatDate(future),
        market: 'ZA',
        currency,
        locale: 'en-GB'
      };
      
      if (maxPrice) {
        params.maxPrice = maxPrice;
      }
      
      const response = await this.client.get('/v1/browsequotes/v1.0/ZA/ZAR/en-GB', { params });
      
      const inspiration = response.data.Quotes.map(quote => ({
        destination: quote.OutboundLeg?.DestinationId,
        price: quote.MinPrice,
        direct: quote.Direct,
        departureDate: quote.OutboundLeg?.DepartureDate,
        carriers: quote.OutboundLeg?.CarrierIds || []
      }));
      
      // Cache for 24 hours
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, inspiration, 86400);
      }
      
      return inspiration;
      
    } catch (error) {
      logger.error('Skyscanner inspiration error:', error.message);
      return [];
    }
  }

  /**
   * Test API connectivity
   */
  async testConnection() {
    try {
      // Try to autocomplete for a known airport
      const response = await this.autocompletePlaces('JNB', 'ZA', 'en-GB');
      
      return {
        connected: true,
        message: 'Skyscanner API connection successful',
        data: response
      };
    } catch (error) {
      return {
        connected: false,
        message: `Skyscanner API connection failed: ${error.message}`,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Get place details
   */
  async getPlaceDetails(placeId) {
    const cacheKey = `skyscanner:place:${placeId}`;
    
    if (config.cache.enabled) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    try {
      const response = await this.client.get('/v3/places/id', {
        params: {
          id: placeId,
          market: 'ZA',
          locale: 'en-GB'
        }
      });
      
      const place = {
        id: response.data.placeId,
        name: response.data.placeName,
        city: response.data.cityName,
        country: response.data.countryName,
        type: response.data.type,
        iata: response.data.iata,
        coordinates: {
          lat: response.data.coordinates?.latitude,
          lon: response.data.coordinates?.longitude
        }
      };
      
      // Cache for 30 days
      if (config.cache.enabled) {
        await redisClient.set(cacheKey, place, 2592000);
      }
      
      return place;
      
    } catch (error) {
      logger.error('Skyscanner place details error:', error.message);
      return null;
    }
  }
}

// Create singleton instance
const skyscannerAPI = new SkyscannerAPI();

module.exports = skyscannerAPI;
