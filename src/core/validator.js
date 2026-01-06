'use strict';

const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');

/**
 * Route validation engine
 */

class RouteValidator {
  constructor() {
    // Minimum connection times by airport type (in minutes)
    this.minConnectionTimes = {
      default: 60, // 1 hour for domestic
      international: 90, // 1.5 hours for international
      large_hub: 120, // 2 hours for large hubs
      self_transfer: 180, // 3 hours for self-transfer
      virtual_interline: 240 // 4 hours for virtual interline
    };
    
    // Maximum connection times (in minutes)
    this.maxConnectionTimes = {
      default: 1440, // 24 hours
      visa_free: 720, // 12 hours for visa-free transit
      visa_required: 480 // 8 hours if visa required
    };
    
    // Visa requirements by country (simplified)
    this.visaRequirements = {
      // Visa-free or visa-on-arrival for many Africans
      'ZA': { // South Africa
        'KE': 'visa_free', // Kenya
        'ET': 'visa_on_arrival', // Ethiopia
        'EG': 'visa_required', // Egypt
        'GH': 'visa_free', // Ghana
        'NG': 'visa_required' // Nigeria
      },
      'KE': { // Kenya
        'ZA': 'visa_free',
        'ET': 'visa_free',
        'TZ': 'visa_free'
      },
      // Add more country pairs as needed
    };
  }

  /**
   * Validate a complete route
   */
  validateRoute(route, minConnectionTimeMs, maxConnectionTimeMs) {
    if (!route || !route.segments || route.segments.length === 0) {
      return false;
    }
    
    try {
      // 1. Validate individual segments
      for (const segment of route.segments) {
        if (!this.validateSegment(segment)) {
          return false;
        }
      }
      
      // 2. Validate connections between segments
      for (let i = 0; i < route.segments.length - 1; i++) {
        const currentSegment = route.segments[i];
        const nextSegment = route.segments[i + 1];
        
        const connectionValid = this.validateConnection(
          currentSegment,
          nextSegment,
          minConnectionTimeMs,
          maxConnectionTimeMs,
          route.virtualInterline || false
        );
        
        if (!connectionValid.valid) {
          logger.debug(`Invalid connection: ${connectionValid.reason}`);
          return false;
        }
      }
      
      // 3. Validate visa requirements if international
      const visaCheck = this.validateVisaRequirements(route.segments);
      if (!visaCheck.valid) {
        logger.debug(`Visa requirement failed: ${visaCheck.reason}`);
        return false;
      }
      
      // 4. Validate airport changes
      const airportChangeCheck = this.validateAirportChanges(route.segments);
      if (!airportChangeCheck.valid) {
        logger.debug(`Airport change failed: ${airportChangeCheck.reason}`);
        return false;
      }
      
      // 5. Validate total duration
      const durationCheck = this.validateTotalDuration(route);
      if (!durationCheck.valid) {
        logger.debug(`Duration check failed: ${durationCheck.reason}`);
        return false;
      }
      
      return true;
      
    } catch (error) {
      logger.error('Route validation error:', error);
      return false;
    }
  }

  /**
   * Validate individual flight segment
   */
  validateSegment(segment) {
    if (!segment) {
      return false;
    }
    
    // Check required fields
    if (!segment.from || !segment.to || !segment.departure || !segment.arrival) {
      return false;
    }
    
    // Check airport codes are 3 letters
    if (!/^[A-Z]{3}$/.test(segment.from) || !/^[A-Z]{3}$/.test(segment.to)) {
      return false;
    }
    
    // Check dates are valid
    const departure = new Date(segment.departure);
    const arrival = new Date(segment.arrival);
    
    if (isNaN(departure.getTime()) || isNaN(arrival.getTime())) {
      return false;
    }
    
    // Check departure is before arrival
    if (departure >= arrival) {
      return false;
    }
    
    // Check flight duration is reasonable (max 20 hours for single segment)
    const durationMs = arrival - departure;
    const maxDurationMs = 20 * 60 * 60 * 1000; // 20 hours
    
    if (durationMs > maxDurationMs) {
      return false;
    }
    
    // Check if same airport (invalid)
    if (segment.from === segment.to) {
      return false;
    }
    
    return true;
  }

  /**
   * Validate connection between two segments
   */
  validateConnection(segmentA, segmentB, minConnectionTimeMs, maxConnectionTimeMs, isVirtualInterline = false) {
    if (!segmentA || !segmentB) {
      return { valid: false, reason: 'Missing segments' };
    }
    
    // Check airports match
    if (segmentA.to !== segmentB.from) {
      return { 
        valid: false, 
        reason: `Airport mismatch: ${segmentA.to} != ${segmentB.from}` 
      };
    }
    
    // Calculate connection time
    const arrivalA = new Date(segmentA.arrival);
    const departureB = new Date(segmentB.departure);
    const connectionTimeMs = departureB - arrivalA;
    
    // Check connection time is positive
    if (connectionTimeMs < 0) {
      return { 
        valid: false, 
        reason: 'Backward connection time' 
      };
    }
    
    // Determine minimum required connection time
    let requiredMinTimeMs = minConnectionTimeMs;
    
    if (isVirtualInterline) {
      // Virtual interline requires more time for baggage collection/re-check
      requiredMinTimeMs = this.minConnectionTimes.virtual_interline * 60 * 1000;
    } else {
      // Check if international connection
      const isInternational = this.isInternationalConnection(segmentA, segmentB);
      const isLargeHub = this.isLargeHub(segmentA.to);
      
      if (isLargeHub) {
        requiredMinTimeMs = this.minConnectionTimes.large_hub * 60 * 1000;
      } else if (isInternational) {
        requiredMinTimeMs = this.minConnectionTimes.international * 60 * 1000;
      } else {
        requiredMinTimeMs = this.minConnectionTimes.default * 60 * 1000;
      }
    }
    
    // Check minimum connection time
    if (connectionTimeMs < requiredMinTimeMs) {
      return { 
        valid: false, 
        reason: `Connection too short: ${Helpers.formatDuration(connectionTimeMs / (1000 * 60))} < ${Helpers.formatDuration(requiredMinTimeMs / (1000 * 60))}` 
      };
    }
    
    // Check maximum connection time
    const maxTimeMs = maxConnectionTimeMs || (this.maxConnectionTimes.default * 60 * 1000);
    
    if (connectionTimeMs > maxTimeMs) {
      return { 
        valid: false, 
        reason: `Connection too long: ${Helpers.formatDuration(connectionTimeMs / (1000 * 60))} > ${Helpers.formatDuration(maxTimeMs / (1000 * 60))}` 
      };
    }
    
    // Check for same terminal/airport change
    const airportChange = this.checkAirportChange(segmentA, segmentB);
    if (airportChange.requiresChange && connectionTimeMs < (180 * 60 * 1000)) {
      return {
        valid: false,
        reason: `Insufficient time for airport change: ${airportChange.details}`
      };
    }
    
    return { 
      valid: true, 
      connectionTime: connectionTimeMs / (1000 * 60), // minutes
      connectionTimeFormatted: Helpers.formatDuration(connectionTimeMs / (1000 * 60))
    };
  }

  /**
   * Check if connection is international
   */
  isInternationalConnection(segmentA, segmentB) {
    // Simplified check - in production, use airport database
    const countryA = this.getCountryFromAirport(segmentA.from);
    const countryB = this.getCountryFromAirport(segmentB.to);
    
    return countryA !== countryB;
  }

  /**
   * Check if airport is a large hub
   */
  isLargeHub(airportCode) {
    const largeHubs = [
      'JNB', 'CPT', 'LOS', 'NBO', 'ADD', 'CAI', 'ACC', 'DXB', 'DOH',
      'LHR', 'CDG', 'AMS', 'FRA', 'IST', 'JFK', 'LAX', 'HKG', 'SIN'
    ];
    
    return largeHubs.includes(airportCode);
  }

  /**
   * Check if airport change is required
   */
  checkAirportChange(segmentA, segmentB) {
    const airport = segmentA.to;
    
    // Known multi-airport cities
    const multiAirportCities = {
      'LON': ['LHR', 'LGW', 'STN', 'LTN'],
      'NYC': ['JFK', 'EWR', 'LGA'],
      'PAR': ['CDG', 'ORY'],
      'TYO': ['HND', 'NRT'],
      'CHI': ['ORD', 'MDW'],
      'LAX': ['LAX', 'BUR', 'SNA', 'ONT', 'LGB']
    };
    
    // Check if both airports are in same multi-airport city
    for (const [city, airports] of Object.entries(multiAirportCities)) {
      if (airports.includes(segmentA.to) && airports.includes(segmentB.from)) {
        if (segmentA.to !== segmentB.from) {
          return {
            requiresChange: true,
            details: `Change airports in ${city}: ${segmentA.to} to ${segmentB.from}`,
            distance: 'Varies',
            estimatedTransferTime: '60-120 minutes'
          };
        }
      }
    }
    
    return { requiresChange: false };
  }

  /**
   * Validate visa requirements for entire route
   */
  validateVisaRequirements(segments) {
    if (!segments || segments.length === 0) {
      return { valid: true, reason: 'No segments' };
    }
    
    // For simplicity, we'll check major transit points
    const transitAirports = [];
    
    for (let i = 0; i < segments.length - 1; i++) {
      const transitAirport = segments[i].to;
      const nextDepartureAirport = segments[i + 1].from;
      
      if (transitAirport === nextDepartureAirport) {
        transitAirports.push(transitAirport);
      }
    }
    
    // Check common transit points that require visas
    const visaRequiredTransits = ['US', 'UK', 'CA', 'AU', 'NZ'];
    const transitCountries = transitAirports.map(airport => 
      this.getCountryFromAirport(airport)
    );
    
    for (const country of transitCountries) {
      if (visaRequiredTransits.includes(country)) {
        // Check if transit visa might be required
        // This is simplified - actual visa rules are complex
        return {
          valid: false,
          reason: `Transit visa may be required for ${country}`,
          details: 'Check with embassy for transit requirements'
        };
      }
    }
    
    return { valid: true, reason: 'No visa issues detected' };
  }

  /**
   * Validate airport changes within route
   */
  validateAirportChanges(segments) {
    // Check for unreasonable airport changes (e.g., JNB-CPT-JNB in same trip)
    const visitedAirports = new Set();
    
    for (const segment of segments) {
      // Check for backtracking
      if (visitedAirports.has(segment.to) && segment.to !== segments[segments.length - 1].to) {
        return {
          valid: false,
          reason: `Unreasonable backtracking to ${segment.to}`,
          details: 'Route revisits airport unnecessarily'
        };
      }
      
      visitedAirports.add(segment.from);
      visitedAirports.add(segment.to);
    }
    
    return { valid: true, reason: 'No unreasonable airport changes' };
  }

  /**
   * Validate total route duration
   */
  validateTotalDuration(route) {
    if (!route.segments || route.segments.length === 0) {
      return { valid: false, reason: 'No segments' };
    }
    
    const firstDeparture = new Date(route.segments[0].departure);
    const lastArrival = new Date(route.segments[route.segments.length - 1].arrival);
    const totalDurationMs = lastArrival - firstDeparture;
    const totalDurationHours = totalDurationMs / (1000 * 60 * 60);
    
    // Maximum reasonable total duration: 48 hours
    if (totalDurationHours > 48) {
      return {
        valid: false,
        reason: `Total duration too long: ${totalDurationHours.toFixed(1)} hours`,
        maxAllowed: '48 hours'
      };
    }
    
    // Minimum reasonable duration based on distance
    const totalDistance = route.distance || this.estimateTotalDistance(route.segments);
    const estimatedFlightTime = totalDistance / 800; // hours at 800 km/h
    const estimatedTotalTime = estimatedFlightTime + (route.segments.length * 1.5); // +1.5h per segment for ground time
    
    if (totalDurationHours < estimatedTotalTime * 0.5) {
      // Duration seems too short for the distance
      return {
        valid: false,
        reason: `Duration seems too short for distance: ${totalDurationHours.toFixed(1)} hours for ~${Math.round(totalDistance)} km`,
        estimatedMinimum: `${estimatedTotalTime.toFixed(1)} hours`
      };
    }
    
    return { 
      valid: true, 
      totalDuration: totalDurationHours,
      totalDurationFormatted: Helpers.formatDuration(totalDurationMs / (1000 * 60))
    };
  }

  /**
   * Estimate total distance of route
   */
  estimateTotalDistance(segments) {
    let totalDistance = 0;
    
    for (const segment of segments) {
      // Simplified distance estimation
      const distance = this.estimateSegmentDistance(segment.from, segment.to);
      totalDistance += distance;
    }
    
    return totalDistance;
  }

  /**
   * Estimate distance between two airports
   */
  estimateSegmentDistance(from, to) {
    // Common distances (km) - simplified
    const distances = {
      'JNB-CPT': 1273,
      'JNB-DUR': 523,
      'JNB-LOS': 4546,
      'JNB-NBO': 2985,
      'LOS-ACC': 481,
      'LOS-LHR': 5103,
      'NBO-DXB': 3274,
      'ACC-JFK': 8543,
      'CPT-LHR': 9645,
      'ADD-IST': 3347,
      'CAI-DXB': 2222,
      'DXB-LHR': 5567,
      'JNB-SIN': 8765,
      'CPT-GRJ': 360
    };
    
    const key = `${from}-${to}`;
    const reverseKey = `${to}-${from}`;
    
    return distances[key] || distances[reverseKey] || 1000; // Default 1000km
  }

  /**
   * Get country from airport code (simplified)
   */
  getCountryFromAirport(airportCode) {
    // Simplified mapping
    const airportCountries = {
      // South Africa
      'JNB': 'ZA', 'CPT': 'ZA', 'DUR': 'ZA', 'GRJ': 'ZA', 'PLZ': 'ZA',
      // Nigeria
      'LOS': 'NG', 'ABV': 'NG', 'PHC': 'NG',
      // Kenya
      'NBO': 'KE', 'MBA': 'KE',
      // Ethiopia
      'ADD': 'ET',
      // Egypt
      'CAI': 'EG', 'HRG': 'EG',
      // Ghana
      'ACC': 'GH',
      // UAE
      'DXB': 'AE', 'AUH': 'AE',
      // Qatar
      'DOH': 'QA',
      // UK
      'LHR': 'GB', 'LGW': 'GB',
      // USA
      'JFK': 'US', 'LAX': 'US',
      // France
      'CDG': 'FR',
      // Netherlands
      'AMS': 'NL',
      // Germany
      'FRA': 'DE',
      // Turkey
      'IST': 'TR'
    };
    
    return airportCountries[airportCode] || 'Unknown';
  }

  /**
   * Validate baggage allowance for route
   */
  validateBaggage(route, passengerBags = 1) {
    if (!route.virtualInterline) {
      return { valid: true, reason: 'Direct route - baggage checked through' };
    }
    
    const issues = [];
    
    // Check if any component has restrictive baggage policies
    for (let i = 0; i < route.segments.length; i++) {
      const segment = route.segments[i];
      
      // Check for low-cost carriers with strict baggage policies
      const restrictiveAirlines = ['FR', 'U2', 'W6', 'FA', 'S8']; // Ryanair, easyJet, Wizz, FlySafair, SmartWings
      
      if (restrictiveAirlines.includes(segment.airline)) {
        issues.push({
          segment: i + 1,
          airline: segment.airline,
          issue: 'Low-cost carrier - strict baggage fees apply',
          recommendation: 'Check airline website for baggage fees'
        });
      }
    }
    
    if (issues.length > 0) {
      return {
        valid: true, // Still valid, but with warnings
        warnings: issues,
        summary: 'Baggage fees may apply on some segments'
      };
    }
    
    return { valid: true, reason: 'No baggage issues detected' };
  }

  /**
   * Validate route for specific passenger types
   */
  validateForPassengerType(route, passengerType = 'adult') {
    const issues = [];
    
    switch (passengerType) {
      case 'child':
        // Check for unaccompanied minor policies
        if (route.virtualInterline) {
          issues.push({
            type: 'warning',
            message: 'Virtual interline may not be suitable for unaccompanied minors',
            details: 'Check airline policies for each segment'
          });
        }
        break;
        
      case 'infant':
        // Check infant policies
        if (route.segments.length > 2) {
          issues.push({
            type: 'warning',
            message: 'Multiple segments may be challenging with an infant',
            details: 'Consider direct flights if available'
          });
        }
        break;
        
      case 'disabled':
        // Check accessibility
        for (const segment of route.segments) {
          // Some airports may have better facilities
          const largeAirports = ['JNB', 'CPT', 'LHR', 'CDG', 'DXB', 'JFK'];
          if (!largeAirports.includes(segment.to) && !largeAirports.includes(segment.from)) {
            issues.push({
              type: 'info',
              message: `Airport ${segment.to} may have limited accessibility facilities`,
              details: 'Contact airport in advance'
            });
          }
        }
        break;
    }
    
    if (issues.length > 0) {
      return {
        valid: true,
        warnings: issues
      };
    }
    
    return { valid: true, reason: 'No passenger-specific issues' };
  }

  /**
   * Get validation report for a route
   */
  getValidationReport(route, options = {}) {
    const report = {
      routeId: route.id,
      isValid: false,
      checks: [],
      warnings: [],
      errors: []
    };
    
    try {
      // 1. Basic segment validation
      for (let i = 0; i < route.segments.length; i++) {
        const segment = route.segments[i];
        const segmentValid = this.validateSegment(segment);
        
        report.checks.push({
          check: `Segment ${i + 1} validity`,
          valid: segmentValid,
          details: segmentValid ? 'OK' : 'Invalid segment data'
        });
        
        if (!segmentValid) {
          report.errors.push(`Segment ${i + 1} is invalid`);
        }
      }
      
      // 2. Connection validation
      for (let i = 0; i < route.segments.length - 1; i++) {
        const connection = this.validateConnection(
          route.segments[i],
          route.segments[i + 1],
          options.minConnectionTime || 120 * 60 * 1000, // 2 hours default
          options.maxConnectionTime || 24 * 60 * 60 * 1000, // 24 hours default
          route.virtualInterline || false
        );
        
        report.checks.push({
          check: `Connection ${i + 1} (${route.segments[i].to})`,
          valid: connection.valid,
          details: connection.valid ? 
            `${connection.connectionTimeFormatted} connection` : 
            connection.reason
        });
        
        if (!connection.valid) {
          report.errors.push(connection.reason);
        }
      }
      
      // 3. Visa check
      const visaCheck = this.validateVisaRequirements(route.segments);
      report.checks.push({
        check: 'Visa requirements',
        valid: visaCheck.valid,
        details: visaCheck.reason
      });
      
      if (!visaCheck.valid) {
        report.warnings.push(visaCheck.reason);
      }
      
      // 4. Duration check
      const durationCheck = this.validateTotalDuration(route);
      report.checks.push({
        check: 'Total duration',
        valid: durationCheck.valid,
        details: durationCheck.valid ? 
          durationCheck.totalDurationFormatted : 
          durationCheck.reason
      });
      
      if (!durationCheck.valid) {
        report.errors.push(durationCheck.reason);
      }
      
      // 5. Baggage check if requested
      if (options.checkBaggage) {
        const baggageCheck = this.validateBaggage(route, options.passengerBags || 1);
        report.checks.push({
          check: 'Baggage',
          valid: baggageCheck.valid,
          details: baggageCheck.reason
        });
        
        if (baggageCheck.warnings) {
          report.warnings.push(...baggageCheck.warnings.map(w => w.issue));
        }
      }
      
      // 6. Passenger type check if specified
      if (options.passengerType) {
        const passengerCheck = this.validateForPassengerType(route, options.passengerType);
        report.checks.push({
          check: `Passenger type: ${options.passengerType}`,
          valid: passengerCheck.valid,
          details: passengerCheck.reason
        });
        
        if (passengerCheck.warnings) {
          report.warnings.push(...passengerCheck.warnings.map(w => w.message));
        }
      }
      
      // Determine overall validity
      report.isValid = report.errors.length === 0;
      report.summary = report.isValid ? 
        'Route is valid' : 
        `Route has ${report.errors.length} error(s)`;
      
      // Add route summary
      report.routeSummary = {
        segments: route.segments.length,
        airlines: route.airlines || [],
        totalPrice: route.totalPrice,
        currency: route.currency,
        virtualInterline: route.virtualInterline || false,
        separateTickets: route.separateTickets || false
      };
      
    } catch (error) {
      report.isValid = false;
      report.errors.push(`Validation error: ${error.message}`);
    }
    
    return report;
  }
}

// Create singleton instance
const routeValidator = new RouteValidator();

module.exports = routeValidator;
