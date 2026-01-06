const kiwiAPI = require('../api/kiwi-api');
const travelpayoutsAPI = require('../api/travelpayouts-api');
const skyscannerAPI = require('../api/skyscanner-api');
const priceNormalizer = require('./price-normalizer');
const validator = require('./validator');
const logger = require('../utils/logger');
const redis = require('../database/redis-client');

class RouteStitcher {
    constructor() {
        this.minConnectionTime = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
        this.maxConnectionTime = 24 * 60 * 60 * 1000; // 24 hours
    }

    async findCheapestRoutes(from, to, date, returnDate = null, passengers = 1) {
        const cacheKey = `search:${from}:${to}:${date}:${returnDate}:${passengers}`;
        
        // Check cache first
        const cached = await redis.get(cacheKey);
        if (cached) {
            logger.debug('Returning cached results');
            return JSON.parse(cached);
        }

        try {
            // 1. Query all APIs in parallel
            const [kiwiResults, travelpayoutsResults, skyscannerResults] = await Promise.all([
                kiwiAPI.searchFlights(from, to, date, returnDate, passengers),
                travelpayoutsAPI.searchFlights(from, to, date, returnDate, passengers),
                skyscannerAPI.searchFlights(from, to, date, returnDate, passengers)
            ]);

            // 2. Normalize all results to common format
            let allRoutes = this.normalizeRoutes([
                ...kiwiResults,
                ...travelpayoutsResults,
                ...skyscannerResults
            ]);

            // 3. Generate virtual interlining combinations
            const stitchedRoutes = await this.generateStitchedRoutes(allRoutes, from, to, date);
            allRoutes = [...allRoutes, ...stitchedRoutes];

            // 4. Remove duplicates
            allRoutes = this.deduplicateRoutes(allRoutes);

            // 5. Validate connections
            allRoutes = allRoutes.filter(route => 
                validator.validateConnections(route, this.minConnectionTime, this.maxConnectionTime)
            );

            // 6. Add all fees and convert to ZAR
            allRoutes = await Promise.all(
                allRoutes.map(async route => 
                    await priceNormalizer.addAllFees(route)
                )
            );

            // 7. Sort by total price
            allRoutes.sort((a, b) => a.totalPriceZAR - b.totalPriceZAR);

            // 8. Take top 3
            const topRoutes = allRoutes.slice(0, 3);

            // 9. Generate affiliate links
            const finalRoutes = await this.addAffiliateLinks(topRoutes);

            // Cache results for 1 hour
            await redis.setex(cacheKey, 3600, JSON.stringify(finalRoutes));

            return finalRoutes;

        } catch (error) {
            logger.error('Error finding cheapest routes:', error);
            throw new Error('Failed to search for flights');
        }
    }

    normalizeRoutes(routes) {
        return routes.map(route => ({
            id: this.generateRouteId(route),
            airlines: route.airlines || [],
            segments: route.segments.map(segment => ({
                airline: segment.airline,
                flightNumber: segment.flightNumber,
                from: segment.from,
                to: segment.to,
                departure: new Date(segment.departure),
                arrival: new Date(segment.arrival),
                duration: segment.duration,
                price: segment.price,
                currency: segment.currency
            })),
            totalPrice: route.totalPrice,
            totalDuration: route.totalDuration,
            currency: route.currency,
            bookingEngine: route.bookingEngine,
            separateTickets: route.separateTickets || false,
            virtualInterline: route.virtualInterline || false
        }));
    }

    async generateStitchedRoutes(allRoutes, from, to, date) {
        const stitchedRoutes = [];
        
        // Get all unique airports in the results
        const airports = new Set();
        allRoutes.forEach(route => {
            route.segments.forEach(segment => {
                airports.add(segment.from);
                airports.add(segment.to);
            });
        });

        // Find possible hub airports for stitching
        const hubAirports = this.identifyHubAirports(Array.from(airports));

        // Try to create stitched routes through hubs
        for (const hub of hubAirports) {
            // Find routes from origin to hub
            const toHubRoutes = allRoutes.filter(route => 
                route.segments[0].from === from && 
                route.segments[route.segments.length - 1].to === hub
            );

            // Find routes from hub to destination
            const fromHubRoutes = allRoutes.filter(route => 
                route.segments[0].from === hub && 
                route.segments[route.segments.length - 1].to === to
            );

            // Create combinations
            for (const firstLeg of toHubRoutes) {
                for (const secondLeg of fromHubRoutes) {
                    const stitchedRoute = this.stitchTwoRoutes(firstLeg, secondLeg);
                    if (stitchedRoute) {
                        stitchedRoutes.push(stitchedRoute);
                    }
                }
            }
        }

        return stitchedRoutes;
    }

    stitchTwoRoutes(firstLeg, secondLeg) {
        const lastSegment = firstLeg.segments[firstLeg.segments.length - 1];
        const firstSegment = secondLeg.segments[0];
        
        // Check if connection is valid
        const connectionTime = new Date(firstSegment.departure) - new Date(lastSegment.arrival);
        
        if (connectionTime < this.minConnectionTime || connectionTime > this.maxConnectionTime) {
            return null;
        }

        // Ensure different airports (no backtracking)
        if (lastSegment.to !== firstSegment.from) {
            return null;
        }

        return {
            id: this.generateRouteId({ segments: [...firstLeg.segments, ...secondLeg.segments] }),
            airlines: [...firstLeg.airlines, ...secondLeg.airlines],
            segments: [...firstLeg.segments, ...secondLeg.segments],
            totalPrice: firstLeg.totalPrice + secondLeg.totalPrice,
            totalDuration: firstLeg.totalDuration + secondLeg.totalDuration + (connectionTime / (1000 * 60)), // in minutes
            currency: firstLeg.currency, // Assume same currency
            bookingEngine: 'virtual-interline',
            separateTickets: true,
            virtualInterline: true,
            connectionAirport: lastSegment.to
        };
    }

    identifyHubAirports(airports) {
        // Common African and international hubs
        const commonHubs = [
            'JNB', // Johannesburg
            'CPT', // Cape Town
            'ADD', // Addis Ababa
            'NBO', // Nairobi
            'LOS', // Lagos
            'ACC', // Accra
            'CAI', // Cairo
            'DXB', // Dubai
            'DOH', // Doha
            'IST', // Istanbul
            'CDG', // Paris
            'LHR', // London
            'AMS'  // Amsterdam
        ];

        return commonHubs.filter(hub => airports.includes(hub));
    }

    deduplicateRoutes(routes) {
        const seen = new Set();
        return routes.filter(route => {
            const key = `${route.segments.map(s => `${s.from}${s.to}${s.flightNumber}`).join('_')}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    generateRouteId(route) {
        return route.segments
            .map(s => `${s.airline}${s.flightNumber}${s.from}${s.to}`)
            .join('-')
            .toLowerCase()
            .replace(/\s/g, '');
    }

    async addAffiliateLinks(routes) {
        return routes.map(route => {
            let affiliateLink = '';
            
            if (route.virtualInterline) {
                // Use Kiwi for virtual interlining
                affiliateLink = kiwiAPI.generateAffiliateLink(route);
            } else {
                // Use respective booking engine
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

            return {
                ...route,
                affiliateLink,
                displayPrice: `R${Math.round(route.totalPriceZAR).toLocaleString()}`
            };
        });
    }
}

module.exports = new RouteStitcher();
