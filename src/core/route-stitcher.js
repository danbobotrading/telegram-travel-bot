'use strict';

const config = require('../../config/config');
const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');
const priceNormalizer = require('./price-normalizer');
const validator = require('./validator');
const kiwiAPI = require('../api/kiwi-api');
const travelpayoutsAPI = require('../api/travelpayouts-api');
const skyscannerAPI = require('../api/skyscanner-api');
const redisClient = require('../database/redis-client');

/**
 * Virtual interlining engine - Stitches together separate tickets
 */

class RouteStitcher {
  constructor() {
    this.minConnectionTime = config.limits.minConnectionTime; // 2 hours in milliseconds
    this.maxConnectionTime = config.limits.maxConnectionTime; // 24 hours
    this.maxStitchedRoutes = config.limits.maxStitchedRoutes;
    this.maxRoutesPerSearch = config.limits.maxRoutesPerSearch;
  }

  /**
   * Main function to find cheapest routes with virtual interlining
   */
  async findCheapestRoutes(searchParams) {
    const {
      from,
      to,
      date,
      returnDate = null,
      passengers = 1,
      bags = 0,
      cabinClass = 'M',
      currency = 'ZAR',
      tripType = 'oneway'
    } = searchParams;

    // Generate cache key
    const cacheKey = Helpers.generateCacheKey(searchParams);
    
    // Try cache first
    if (config.cache.enabled) {
      const cached = await redisClient.getCachedSearchResults(cacheKey);
      if (cached) {
        logger.debug('Returning cached routes');
        return cached;
      }
    }

    logger.search(
      searchParams.userId || 'anonymous',
      from,
      to,
      date,
      0, // results count unknown yet
      searchParams
    );

    try {
      // 1. Query all APIs in parallel
      const [kiwiResults, travelpayoutsResults, skyscannerResults] = await Promise.allSettled([
        this.searchKiwi(searchParams),
        this.searchTravelpayouts(searchParams),
        this.searchSkyscanner(searchParams)
      ]);

      // 2. Extract successful results
      const allDirectRoutes = [];
      
      if (kiwiResults.status === 'fulfilled') {
        allDirectRoutes.push(...kiwiResults.value);
      } else {
        logger.error('Kiwi API search failed:', kiwiResults.reason);
      }
      
      if (travelpayoutsResults.status === 'fulfilled') {
        allDirectRoutes.push(...travelpayoutsResults.value);
      } else {
        logger.error('Travelpayouts API search failed:', travelpayoutsResults.reason);
      }
      
      if (skyscannerResults.status === 'fulfilled') {
        allDirectRoutes.push(...skyscannerResults.value);
      } else {
        logger.error('Skyscanner API search failed:', skyscannerResults.reason);
      }

      // 3. Generate virtual interlining routes if enabled
      let allRoutes = [...allDirectRoutes];
      
      if (config.features.virtualInterlining && allDirectRoutes.length > 0) {
        const stitchedRoutes = await this.generateStitchedRoutes(
          allDirectRoutes,
          from,
          to,
          date,
          searchParams
        );
        
        allRoutes = [...allRoutes, ...stitchedRoutes];
      }

      // 4. Remove duplicates
      allRoutes = this.deduplicateRoutes(allRoutes);

      // 5. Validate all routes
      allRoutes = allRoutes.filter(route => 
        validator.validateRoute(route, this.minConnectionTime, this.maxConnectionTime)
      );

      // 6. Add fees and normalize prices to ZAR
      const normalizedRoutes = await priceNormalizer.normalizeRoutes(
        allRoutes,
        { passengers, bags, cabinClass }
      );

      // 7. Sort by final price
      const sortedRoutes = priceNormalizer.sortByPrice(normalizedRoutes);

      // 8. Take top results (limit for performance)
      const topRoutes = sortedRoutes.slice(0, this.maxRoutesPerSearch);

      // 9. Add affiliate links
      const finalRoutes = await this.addAffiliateLinks(topRoutes);

      // 10. Cache results
      if (config.cache.enabled && finalRoutes.length > 0) {
        await redisClient.cacheSearchResults(cacheKey, finalRoutes, searchParams);
      }

      logger.search(
        searchParams.userId || 'anonymous',
        from,
        to,
        date,
        finalRoutes.length,
        { ...searchParams, hasVirtualInterlining: finalRoutes.some(r => r.virtualInterline) }
      );

      return finalRoutes;

    } catch (error) {
      logger.errorWithContext(error, {
        operation: 'findCheapestRoutes',
        searchParams
      });
      
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  /**
   * Search Kiwi API
   */
  async searchKiwi(params) {
    try {
      const kiwiParams = {
        from: params.from,
        to: params.to,
        date: params.date,
        returnDate: params.returnDate,
        adults: params.passengers,
        cabinClass: params.cabinClass,
        currency: params.currency,
        maxStops: 3
      };

      const results = await kiwiAPI.searchFlights(kiwiParams);
      
      return results.map(result => ({
        ...result,
        source: 'kiwi',
        bookingEngine: 'kiwi'
      }));
      
    } catch (error) {
      logger.error('Kiwi search error:', error);
      return [];
    }
  }

  /**
   * Search Travelpayouts API
   */
  async searchTravelpayouts(params) {
    try {
      const tpParams = {
        from: params.from,
        to: params.to,
        date: params.date,
        returnDate: params.returnDate,
        adults: params.passengers,
        cabinClass: params.cabinClass === 'M' ? 'economy' : params.cabinClass,
        currency: params.currency,
        tripType: params.tripType
      };

      const results = await travelpayoutsAPI.searchFlights(tpParams);
      
      return results.map(result => ({
        ...result,
        source: 'travelpayouts',
        bookingEngine: 'travelpayouts'
      }));
      
    } catch (error) {
      logger.error('Travelpayouts search error:', error);
      return [];
    }
  }

  /**
   * Search Skyscanner API
   */
  async searchSkyscanner(params) {
    try {
      const ssParams = {
        from: params.from,
        to: params.to,
        date: params.date,
        returnDate: params.returnDate,
        adults: params.passengers,
        cabinClass: params.cabinClass === 'M' ? 'economy' : params.cabinClass,
        currency: params.currency,
        market: 'ZA'
      };

      const results = await skyscannerAPI.searchFlights(ssParams);
      
      return results.map(result => ({
        ...result,
        source: 'skyscanner',
        bookingEngine: 'skyscanner'
      }));
      
    } catch (error) {
      logger.error('Skyscanner search error:', error);
      return [];
    }
  }

  /**
   * Generate stitched routes (virtual interlining)
   */
  async generateStitchedRoutes(directRoutes, from, to, date, searchParams) {
    const stitchedRoutes = [];
    
    try {
      // 1. Identify potential hub airports
      const hubAirports = this.identifyHubAirports(directRoutes, from, to);
      
      // 2. Group routes by hub
      const routesByHub = this.groupRoutesByHub(directRoutes, hubAirports, from, to);
      
      // 3. Generate stitched combinations
      for (const hub of hubAirports) {
        const hubRoutes = routesByHub[hub];
        if (!hubRoutes || !hubRoutes.toHub || !hubRoutes.fromHub) {
          continue;
        }
        
        const combinations = this.generateCombinations(
          hubRoutes.toHub,
          hubRoutes.fromHub,
          this.maxStitchedRoutes
        );
        
        for (const combination of combinations) {
          const stitchedRoute = this.stitchTwoRoutes(combination.firstLeg, combination.secondLeg);
          if (stitchedRoute) {
            stitchedRoutes.push(stitchedRoute);
          }
        }
      }
      
      // 4. Generate multi-hub routes (e.g., JNB -> ADD -> DXB -> LHR)
      const multiHubRoutes = await this.generateMultiHubRoutes(
        directRoutes,
        from,
        to,
        date,
        searchParams
      );
      
      stitchedRoutes.push(...multiHubRoutes);
      
      return stitchedRoutes;
      
    } catch (error) {
      logger.error('Error generating stitched routes:', error);
      return [];
    }
  }

  /**
   * Identify hub airports from available routes
   */
  identifyHubAirports(routes, from, to) {
    const airportFrequency = {};
    
    // Count airport appearances in routes
    for (const route of routes) {
      if (route.segments) {
        for (const segment of route.segments) {
          if (segment.from && segment.from !== from && segment.from !== to) {
            airportFrequency[segment.from] = (airportFrequency[segment.from] || 0) + 1;
          }
          if (segment.to && segment.to !== from && segment.to !== to) {
            airportFrequency[segment.to] = (airportFrequency[segment.to] || 0) + 1;
          }
        }
      }
    }
    
    // Sort airports by frequency
    const sortedAirports = Object.entries(airportFrequency)
      .sort(([,a], [,b]) => b - a)
      .map(([airport]) => airport);
    
    // Filter to known hubs
    const knownHubs = config.africa.hubAirports;
    const hubs = sortedAirports.filter(airport => 
      knownHubs.includes(airport) || airportFrequency[airport] >= 3
    );
    
    // Return top 10 hubs
    return hubs.slice(0, 10);
  }

  /**
   * Group routes by hub airport
   */
  groupRoutesByHub(routes, hubs, from, to) {
    const grouped = {};
    
    for (const route of routes) {
      if (!route.segments || route.segments.length === 0) {
        continue;
      }
      
      const firstSegment = route.segments[0];
      const lastSegment = route.segments[route.segments.length - 1];
      
      // Check if route goes to a hub
      for (const hub of hubs) {
        // Route from origin to hub
        if (firstSegment.from === from && lastSegment.to === hub) {
          if (!grouped[hub]) grouped[hub] = { toHub: [], fromHub: [] };
          grouped[hub].toHub.push(route);
        }
        
        // Route from hub to destination
        if (firstSegment.from === hub && lastSegment.to === to) {
          if (!grouped[hub]) grouped[hub] = { toHub: [], fromHub: [] };
          grouped[hub].fromHub.push(route);
        }
      }
    }
    
    return grouped;
  }

  /**
   * Generate combinations of routes
   */
  generateCombinations(routesA, routesB, maxCombinations = 50) {
    const combinations = [];
    const maxPerRoute = Math.ceil(maxCombinations / Math.max(routesA.length, routesB.length));
    
    for (let i = 0; i < Math.min(routesA.length, maxPerRoute); i++) {
      for (let j = 0; j < Math.min(routesB.length, maxPerRoute); j++) {
        combinations.push({
          firstLeg: routesA[i],
          secondLeg: routesB[j]
        });
      }
    }
    
    return combinations;
  }

  /**
   * Stitch two routes together
   */
  stitchTwoRoutes(firstLeg, secondLeg) {
    if (!firstLeg || !secondLeg || 
        !firstLeg.segments || firstLeg.segments.length === 0 ||
        !secondLeg.segments || secondLeg.segments.length === 0) {
      return null;
    }
    
    const lastSegmentFirst = firstLeg.segments[firstLeg.segments.length - 1];
    const firstSegmentSecond = secondLeg.segments[0];
    
    // Check if airports match
    if (lastSegmentFirst.to !== firstSegmentSecond.from) {
      return null;
    }
    
    // Calculate connection time
    const connectionTime = new Date(firstSegmentSecond.departure) - new Date(lastSegmentFirst.arrival);
    
    // Validate connection time
    if (connectionTime < this.minConnectionTime || connectionTime > this.maxConnectionTime) {
      return null;
    }
    
    // Ensure not same flight (avoid stitching with itself)
    if (firstLeg.id === secondLeg.id) {
      return null;
    }
    
    // Combine segments
    const combinedSegments = [...firstLeg.segments, ...secondLeg.segments];
    
    // Combine airlines
    const combinedAirlines = [
      ...new Set([...(firstLeg.airlines || []), ...(secondLeg.airlines || [])])
    ];
    
    // Calculate total duration
    const firstDeparture = new Date(combinedSegments[0].departure);
    const lastArrival = new Date(combinedSegments[combinedSegments.length - 1].arrival);
    const totalDuration = (lastArrival - firstDeparture) / (1000 * 60); // minutes
    
    // Calculate total price
    const totalPrice = (firstLeg.totalPrice || 0) + (secondLeg.totalPrice || 0);
    
    // Generate route ID
    const routeId = Helpers.generateRouteId(combinedSegments);
    
    return {
      id: routeId,
      airlines: combinedAirlines,
      segments: combinedSegments,
      totalPrice,
      currency: firstLeg.currency || 'ZAR',
      totalDuration,
      virtualInterline: true,
      separateTickets: true,
      bookingEngine: 'virtual-interline',
      source: 'stitched',
      connectionAirport: lastSegmentFirst.to,
      connectionTime: connectionTime / (1000 * 60 * 60), // hours
      originalRoutes: [firstLeg.id, secondLeg.id],
      // Copy metadata for price normalization
      distance: (firstLeg.distance || 0) + (secondLeg.distance || 0),
      transferCount: (firstLeg.transferCount || 0) + (secondLeg.transferCount || 0) + 1,
      // Store for affiliate link generation
      components: [
        { route: firstLeg, type: 'firstLeg' },
        { route: secondLeg, type: 'secondLeg' }
      ]
    };
  }

  /**
   * Generate multi-hub routes (more than 1 connection)
   */
  async generateMultiHubRoutes(routes, from, to, date, searchParams) {
    const multiHubRoutes = [];
    
    try {
      // Get all unique airports from routes
      const allAirports = new Set();
      for (const route of routes) {
        if (route.segments) {
          route.segments.forEach(segment => {
            allAirports.add(segment.from);
            allAirports.add(segment.to);
          });
        }
      }
      
      // Convert to array and filter
      const airports = Array.from(allAirports)
        .filter(airport => airport !== from && airport !== to);
      
      // Find potential 2-hub routes
      for (let i = 0; i < Math.min(airports.length, 5); i++) {
        for (let j = 0; j < Math.min(airports.length, 5); j++) {
          if (i === j) continue;
          
          const hub1 = airports[i];
          const hub2 = airports[j];
          
          // Find routes: from -> hub1, hub1 -> hub2, hub2 -> to
          const leg1Routes = routes.filter(route => 
            route.segments && 
            route.segments[0].from === from && 
            route.segments[route.segments.length - 1].to === hub1
          );
          
          const leg2Routes = routes.filter(route => 
            route.segments && 
            route.segments[0].from === hub1 && 
            route.segments[route.segments.length - 1].to === hub2
          );
          
          const leg3Routes = routes.filter(route => 
            route.segments && 
            route.segments[0].from === hub2 && 
            route.segments[route.segments.length - 1].to === to
          );
          
          if (leg1Routes.length > 0 && leg2Routes.length > 0 && leg3Routes.length > 0) {
            // Try a few combinations
            const maxCombos = Math.min(3, leg1Routes.length, leg2Routes.length, leg3Routes.length);
            
            for (let a = 0; a < maxCombos; a++) {
              for (let b = 0; b < maxCombos; b++) {
                for (let c = 0; c < maxCombos; c++) {
                  const route1 = leg1Routes[a];
                  const route2 = leg2Routes[b];
                  const route3 = leg3Routes[c];
                  
                  // Stitch route1 and route2
                  const partial = this.stitchTwoRoutes(route1, route2);
                  if (!partial) continue;
                  
                  // Create a route object from partial for stitching with route3
                  const partialRoute = {
                    id: partial.id,
                    airlines: partial.airlines,
                    segments: partial.segments,
                    totalPrice: partial.totalPrice,
                    currency: partial.currency,
                    totalDuration: partial.totalDuration
                  };
                  
                  // Stitch partial with route3
                  const finalRoute = this.stitchTwoRoutes(partialRoute, route3);
                  if (finalRoute) {
                    finalRoute.multiHub = true;
                    finalRoute.hubs = [hub1, hub2];
                    multiHubRoutes.push(finalRoute);
                    
                    if (multiHubRoutes.length >= 10) {
                      return multiHubRoutes;
                    }
                  }
                }
              }
            }
          }
        }
      }
      
    } catch (error) {
      logger.error('Error generating multi-hub routes:', error);
    }
    
    return multiHubRoutes;
  }

  /**
   * Remove duplicate routes
   */
  deduplicateRoutes(routes) {
    const seen = new Set();
    const uniqueRoutes = [];
    
    for (const route of routes) {
      // Create a signature for the route
      let signature = '';
      
      if (route.segments && route.segments.length > 0) {
        signature = route.segments
          .map(s => `${s.airline || ''}${s.flightNumber || ''}${s.from}${s.to}`)
          .join('_');
      } else {
        signature = route.id || Math.random().toString();
      }
      
      // Add price and duration to signature to differentiate similar routes with different prices
      signature += `_${route.totalPrice || 0}_${route.totalDuration || 0}`;
      
      if (!seen.has(signature)) {
        seen.add(signature);
        uniqueRoutes.push(route);
      }
    }
    
    return uniqueRoutes;
  }

  /**
   * Add affiliate links to routes
   */
  async addAffiliateLinks(routes) {
    const routesWithLinks = [];
    
    for (const route of routes) {
      try {
        let affiliateLink = null;
        
        if (route.virtualInterline) {
          // For virtual interlining, use Kiwi if available
          affiliateLink = await this.generateVirtualInterlineLink(route);
        } else {
          // Use the appropriate booking engine
          switch (route.bookingEngine) {
            case 'kiwi':
              affiliateLink = kiwiAPI.generateAffiliateLink(route);
              break;
            case 'travelpayouts':
              affiliateLink = travelpayoutsAPI.generateAffiliateLink(route);
              break;
            case 'skyscanner':
              affiliateLink = skyscannerAPI.generateAffiliateLink(route);
              break;
            default:
              affiliateLink = travelpayoutsAPI.generateAffiliateLink(route);
          }
        }
        
        // Fallback to deep link if affiliate link not available
        if (!affiliateLink && route.deepLink) {
          affiliateLink = route.deepLink;
        }
        
        routesWithLinks.push({
          ...route,
          affiliateLink,
          displayPrice: Helpers.formatPrice(
            route.finalPriceZAR || route.totalPriceZAR || route.totalPrice || 0,
            'ZAR'
          )
        });
        
      } catch (error) {
        logger.error('Error adding affiliate link:', error);
        // Add route without affiliate link
        routesWithLinks.push({
          ...route,
          affiliateLink: null,
          displayPrice: Helpers.formatPrice(
            route.finalPriceZAR || route.totalPriceZAR || route.totalPrice || 0,
            'ZAR'
          )
        });
      }
    }
    
    return routesWithLinks;
  }

  /**
   * Generate link for virtual interline routes
   */
  async generateVirtualInterlineLink(route) {
    if (!route.components || route.components.length < 2) {
      return null;
    }
    
    try {
      // Try to use Kiwi for multi-city booking
      const segments = [];
      
      for (const component of route.components) {
        if (component.route && component.route.segments) {
          const componentSegments = component.route.segments;
          
          // Add each segment from the component
          for (const segment of componentSegments) {
            segments.push({
              from: segment.from,
              to: segment.to,
              date: segment.departure.toISOString().split('T')[0]
            });
          }
        }
      }
      
      if (segments.length >= 2) {
        // Use Kiwi multi-city search
        const multiCityParams = {
          segments,
          passengers: 1, // Default, should come from search params
          cabinClass: 'M',
          currency: 'ZAR'
        };
        
        // Note: In production, you'd generate the link differently
        // This is a simplified example
        const kiwiBaseUrl = 'https://www.kiwi.com/en/booking/multi';
        const queryParams = new URLSearchParams();
        
        queryParams.set('segments', JSON.stringify(segments));
        queryParams.set('currency', 'ZAR');
        
        if (config.apis.kiwi.affiliateId) {
          queryParams.set('affilid', config.apis.kiwi.affiliateId);
        }
        
        return `${kiwiBaseUrl}?${queryParams.toString()}`;
      }
      
      return null;
      
    } catch (error) {
      logger.error('Error generating virtual interline link:', error);
      return null;
    }
  }

  /**
   * Find alternative airports for a search
   */
  async findAlternativeAirports(from, to, date, passengers = 1) {
    try {
      // Get nearby airports for origin
      const fromAlternatives = await this.getNearbyAirports(from, 100); // 100km radius
      
      // Get nearby airports for destination
      const toAlternatives = await this.getNearbyAirports(to, 100);
      
      const alternativeSearches = [];
      
      // Generate search combinations
      for (const altFrom of fromAlternatives.slice(0, 3)) {
        for (const altTo of toAlternatives.slice(0, 3)) {
          if (altFrom.code === from && altTo.code === to) {
            continue; // Skip original combination
          }
          
          alternativeSearches.push({
            from: altFrom.code,
            to: altTo.code,
            date,
            passengers,
            reason: `Alternative: ${altFrom.name} → ${altTo.name}`,
            distanceFromOriginal: altFrom.distance + altTo.distance
          });
        }
      }
      
      // Sort by total distance from original airports
      alternativeSearches.sort((a, b) => a.distanceFromOriginal - b.distanceFromOriginal);
      
      return alternativeSearches.slice(0, 5); // Return top 5 alternatives
      
    } catch (error) {
      logger.error('Error finding alternative airports:', error);
      return [];
    }
  }

  /**
   * Get airports within radius
   */
  async getNearbyAirports(airportCode, radiusKm) {
    // Simplified - in production, use proper airport database with coordinates
    const nearbyAirports = {
      'JNB': [{ code: 'JNB', name: 'O.R. Tambo', distance: 0 }],
      'CPT': [{ code: 'CPT', name: 'Cape Town', distance: 0 }],
      'LHR': [
        { code: 'LHR', name: 'Heathrow', distance: 0 },
        { code: 'LGW', name: 'Gatwick', distance: 45 },
        { code: 'STN', name: 'Stansted', distance: 60 }
      ],
      'JFK': [
        { code: 'JFK', name: 'JFK', distance: 0 },
        { code: 'EWR', name: 'Newark', distance: 25 },
        { code: 'LGA', name: 'LaGuardia', distance: 15 }
      ]
      // Add more airports as needed
    };
    
    return nearbyAirports[airportCode] || [{ code: airportCode, name: airportCode, distance: 0 }];
  }

  /**
   * Validate if a stitched route is bookable
   */
  async validateBookability(route) {
    if (!route.virtualInterline) {
      return { bookable: true, reason: 'Direct route' };
    }
    
    try {
      // Check each component
      for (const component of route.components || []) {
        if (component.route && component.route.bookingEngine === 'kiwi') {
          // Validate Kiwi route
          const validation = await kiwiAPI.validateRoute(component.route);
          if (!validation.valid) {
            return {
              bookable: false,
              reason: `Component ${component.type} not available: ${validation.error}`,
              component: component.type
            };
          }
        }
      }
      
      return { bookable: true, reason: 'All components available' };
      
    } catch (error) {
      logger.error('Error validating bookability:', error);
      return { bookable: false, reason: `Validation error: ${error.message}` };
    }
  }

  /**
   * Estimate baggage transfer for virtual interline
   */
  estimateBaggageTransfer(route) {
    if (!route.virtualInterline) {
      return { selfTransfer: false, instructions: 'Checked through to destination' };
    }
    
    const connectionAirport = route.connectionAirport;
    const connectionTime = route.connectionTime || 0;
    
    if (connectionTime < 4) {
      return {
        selfTransfer: true,
        instructions: `Collect baggage at ${connectionAirport} and re-check for next flight`,
        minimumTime: '4 hours recommended',
        risk: 'High - tight connection'
      };
    } else if (connectionTime < 8) {
      return {
        selfTransfer: true,
        instructions: `Collect baggage at ${connectionAirport} and re-check for next flight`,
        minimumTime: 'Adequate',
        risk: 'Medium'
      };
    } else {
      return {
        selfTransfer: true,
        instructions: `Collect baggage at ${connectionAirport} and re-check for next flight`,
        minimumTime: 'Comfortable',
        risk: 'Low'
      };
    }
  }

  /**
   * Calculate savings compared to direct routes
   */
  calculateSavings(stitchedRoute, directRoutes) {
    if (directRoutes.length === 0) {
      return null;
    }
    
    // Find cheapest direct route
    const cheapestDirect = directRoutes.reduce((cheapest, current) => {
      const cheapestPrice = cheapest.finalPriceZAR || cheapest.totalPriceZAR || cheapest.totalPrice || Infinity;
      const currentPrice = current.finalPriceZAR || current.totalPriceZAR || current.totalPrice || Infinity;
      return currentPrice < cheapestPrice ? current : cheapest;
    }, directRoutes[0]);
    
    const stitchedPrice = stitchedRoute.finalPriceZAR || stitchedRoute.totalPriceZAR || stitchedRoute.totalPrice || 0;
    const directPrice = cheapestDirect.finalPriceZAR || cheapestDirect.totalPriceZAR || cheapestDirect.totalPrice || 0;
    
    if (directPrice === 0) {
      return null;
    }
    
    const savings = directPrice - stitchedPrice;
    const savingsPercentage = (savings / directPrice) * 100;
    
    return {
      savingsAmount: savings,
      savingsPercentage,
      isCheaper: savings > 0,
      directRoute: cheapestDirect,
      comparison: {
        stitchedPrice,
        directPrice,
        priceDifference: Math.abs(savings),
        stitchedDuration: stitchedRoute.totalDuration || 0,
        directDuration: cheapestDirect.totalDuration || 0,
        durationDifference: (stitchedRoute.totalDuration || 0) - (cheapestDirect.totalDuration || 0)
      }
    };
  }
}

// Create singleton instance
const routeStitcher = new RouteStitcher();

module.exports = routeStitcher;
