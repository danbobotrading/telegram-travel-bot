'use strict';

/**
 * Airport codes and helper functions for African airports
 */

const africanAirports = {
  // South Africa
  'JNB': { name: 'O.R. Tambo International Airport', city: 'Johannesburg', country: 'ZA', latitude: -26.1392, longitude: 28.246, hub: true },
  'CPT': { name: 'Cape Town International Airport', city: 'Cape Town', country: 'ZA', latitude: -33.9694, longitude: 18.5989, hub: true },
  'DUR': { name: 'King Shaka International Airport', city: 'Durban', country: 'ZA', latitude: -29.6144, longitude: 31.1197, hub: true },
  'GRJ': { name: 'George Airport', city: 'George', country: 'ZA', latitude: -34.0056, longitude: 22.3789, hub: false },
  'PLZ': { name: 'Port Elizabeth Airport', city: 'Gqeberha', country: 'ZA', latitude: -33.9849, longitude: 25.6173, hub: false },
  'BFN': { name: 'Bram Fischer International Airport', city: 'Bloemfontein', country: 'ZA', latitude: -29.0925, longitude: 26.3025, hub: false },

  // Nigeria
  'LOS': { name: 'Murtala Muhammed International Airport', city: 'Lagos', country: 'NG', latitude: 6.5774, longitude: 3.321, hub: true },
  'ABV': { name: 'Nnamdi Azikiwe International Airport', city: 'Abuja', country: 'NG', latitude: 9.0068, longitude: 7.2632, hub: true },
  'PHC': { name: 'Port Harcourt International Airport', city: 'Port Harcourt', country: 'NG', latitude: 5.0155, longitude: 6.9496, hub: false },
  'KAN': { name: 'Mallam Aminu Kano International Airport', city: 'Kano', country: 'NG', latitude: 12.0476, longitude: 8.5247, hub: false },

  // Kenya
  'NBO': { name: 'Jomo Kenyatta International Airport', city: 'Nairobi', country: 'KE', latitude: -1.3192, longitude: 36.9275, hub: true },
  'MBA': { name: 'Moi International Airport', city: 'Mombasa', country: 'KE', latitude: -4.0347, longitude: 39.5942, hub: false },

  // Ethiopia
  'ADD': { name: 'Addis Ababa Bole International Airport', city: 'Addis Ababa', country: 'ET', latitude: 8.9779, longitude: 38.7993, hub: true },

  // Egypt
  'CAI': { name: 'Cairo International Airport', city: 'Cairo', country: 'EG', latitude: 30.1219, longitude: 31.4056, hub: true },
  'HRG': { name: 'Hurghada International Airport', city: 'Hurghada', country: 'EG', latitude: 27.1783, longitude: 33.7994, hub: false },
  'LXR': { name: 'Luxor International Airport', city: 'Luxor', country: 'EG', latitude: 25.6710, longitude: 32.7066, hub: false },

  // Ghana
  'ACC': { name: 'Kotoka International Airport', city: 'Accra', country: 'GH', latitude: 5.6052, longitude: -0.1668, hub: true },

  // Tanzania
  'DAR': { name: 'Julius Nyerere International Airport', city: 'Dar es Salaam', country: 'TZ', latitude: -6.8781, longitude: 39.2026, hub: true },
  'JRO': { name: 'Kilimanjaro International Airport', city: 'Arusha', country: 'TZ', latitude: -3.4294, longitude: 37.0745, hub: false },
  'ZNZ': { name: 'Abeid Amani Karume International Airport', city: 'Zanzibar', country: 'TZ', latitude: -6.2220, longitude: 39.2249, hub: false },

  // Morocco
  'CMN': { name: 'Mohammed V International Airport', city: 'Casablanca', country: 'MA', latitude: 33.3675, longitude: -7.5898, hub: true },
  'RAK': { name: 'Marrakesh Menara Airport', city: 'Marrakesh', country: 'MA', latitude: 31.6069, longitude: -8.0363, hub: false },

  // Algeria
  'ALG': { name: 'Houari Boumediene Airport', city: 'Algiers', country: 'DZ', latitude: 36.6910, longitude: 3.2154, hub: true },

  // Tunisia
  'TUN': { name: 'Tunis–Carthage International Airport', city: 'Tunis', country: 'TN', latitude: 36.8510, longitude: 10.2272, hub: true },

  // Senegal
  'DKR': { name: 'Blaise Diagne International Airport', city: 'Dakar', country: 'SN', latitude: 14.7397, longitude: -17.4902, hub: true },

  // Ivory Coast
  'ABJ': { name: 'Félix-Houphouët-Boigny International Airport', city: 'Abidjan', country: 'CI', latitude: 5.2614, longitude: -3.9263, hub: true },

  // Uganda
  'EBB': { name: 'Entebbe International Airport', city: 'Entebbe', country: 'UG', latitude: 0.0424, longitude: 32.4435, hub: true },

  // Rwanda
  'KGL': { name: 'Kigali International Airport', city: 'Kigali', country: 'RW', latitude: -1.9686, longitude: 30.1394, hub: true },

  // Mauritius
  'MRU': { name: 'Sir Seewoosagur Ramgoolam International Airport', city: 'Plaine Magnien', country: 'MU', latitude: -20.4302, longitude: 57.6836, hub: true },

  // Seychelles
  'SEZ': { name: 'Seychelles International Airport', city: 'Victoria', country: 'SC', latitude: -4.6743, longitude: 55.5218, hub: true },

  // Zambia
  'LUN': { name: 'Kenneth Kaunda International Airport', city: 'Lusaka', country: 'ZM', latitude: -15.3308, longitude: 28.4526, hub: true },

  // Zimbabwe
  'HRE': { name: 'Robert Gabriel Mugabe International Airport', city: 'Harare', country: 'ZW', latitude: -17.9318, longitude: 31.0928, hub: true },

  // Mozambique
  'MPM': { name: 'Maputo International Airport', city: 'Maputo', country: 'MZ', latitude: -25.9208, longitude: 32.5726, hub: true },

  // Botswana
  'GBE': { name: 'Sir Seretse Khama International Airport', city: 'Gaborone', country: 'BW', latitude: -24.5552, longitude: 25.9182, hub: true },

  // Namibia
  'WDH': { name: 'Hosea Kutako International Airport', city: 'Windhoek', country: 'NA', latitude: -22.4799, longitude: 17.4709, hub: true },

  // Angola
  'LAD': { name: 'Quatro de Fevereiro Airport', city: 'Luanda', country: 'AO', latitude: -8.8584, longitude: 13.2312, hub: true },

  // Cameroon
  'DLA': { name: 'Douala International Airport', city: 'Douala', country: 'CM', latitude: 4.0061, longitude: 9.7195, hub: true },
  'YAO': { name: 'Yaoundé Nsimalen International Airport', city: 'Yaoundé', country: 'CM', latitude: 3.8360, longitude: 11.5235, hub: false },

  // Congo
  'BZV': { name: 'Maya-Maya Airport', city: 'Brazzaville', country: 'CG', latitude: -4.2517, longitude: 15.2530, hub: true },

  // DRC
  'FIH': { name: 'N'djili Airport', city: 'Kinshasa', country: 'CD', latitude: -4.3858, longitude: 15.4446, hub: true },

  // Sudan
  'KRT': { name: 'Khartoum International Airport', city: 'Khartoum', country: 'SD', latitude: 15.5895, longitude: 32.5532, hub: true },

  // Libya
  'TIP': { name: 'Tripoli International Airport', city: 'Tripoli', country: 'LY', latitude: 32.6635, longitude: 13.1590, hub: true },
};

// Middle Eastern hubs (common connections for Africa)
const middleEasternHubs = {
  'DXB': { name: 'Dubai International Airport', city: 'Dubai', country: 'AE', latitude: 25.2532, longitude: 55.3657, hub: true },
  'AUH': { name: 'Abu Dhabi International Airport', city: 'Abu Dhabi', country: 'AE', latitude: 24.4330, longitude: 54.6511, hub: false },
  'DOH': { name: 'Hamad International Airport', city: 'Doha', country: 'QA', latitude: 25.2609, longitude: 51.6138, hub: true },
  'RUH': { name: 'King Khalid International Airport', city: 'Riyadh', country: 'SA', latitude: 24.9576, longitude: 46.6988, hub: false },
  'JED': { name: 'King Abdulaziz International Airport', city: 'Jeddah', country: 'SA', latitude: 21.6796, longitude: 39.1565, hub: false },
};

// European hubs (common connections for Africa)
const europeanHubs = {
  'LHR': { name: 'Heathrow Airport', city: 'London', country: 'GB', latitude: 51.4700, longitude: -0.4543, hub: true },
  'CDG': { name: 'Charles de Gaulle Airport', city: 'Paris', country: 'FR', latitude: 49.0097, longitude: 2.5479, hub: true },
  'AMS': { name: 'Amsterdam Airport Schiphol', city: 'Amsterdam', country: 'NL', latitude: 52.3081, longitude: 4.7642, hub: true },
  'FRA': { name: 'Frankfurt Airport', city: 'Frankfurt', country: 'DE', latitude: 50.0379, longitude: 8.5622, hub: true },
  'IST': { name: 'Istanbul Airport', city: 'Istanbul', country: 'TR', latitude: 41.2753, longitude: 28.7519, hub: true },
  'MAD': { name: 'Adolfo Suárez Madrid–Barajas Airport', city: 'Madrid', country: 'ES', latitude: 40.4719, longitude: -3.5626, hub: true },
  'BRU': { name: 'Brussels Airport', city: 'Brussels', country: 'BE', latitude: 50.9010, longitude: 4.4844, hub: false },
};

// Major airports worldwide
const majorAirports = {
  'JFK': { name: 'John F. Kennedy International Airport', city: 'New York', country: 'US', latitude: 40.6413, longitude: -73.7781, hub: true },
  'LAX': { name: 'Los Angeles International Airport', city: 'Los Angeles', country: 'US', latitude: 33.9416, longitude: -118.4085, hub: true },
  'ORD': { name: 'O'Hare International Airport', city: 'Chicago', country: 'US', latitude: 41.9742, longitude: -87.9073, hub: true },
  'HKG': { name: 'Hong Kong International Airport', city: 'Hong Kong', country: 'HK', latitude: 22.3080, longitude: 113.9185, hub: true },
  'SIN': { name: 'Singapore Changi Airport', city: 'Singapore', country: 'SG', latitude: 1.3644, longitude: 103.9915, hub: true },
  'BKK': { name: 'Suvarnabhumi Airport', city: 'Bangkok', country: 'TH', latitude: 13.6811, longitude: 100.7475, hub: true },
  'SYD': { name: 'Sydney Kingsford Smith Airport', city: 'Sydney', country: 'AU', latitude: -33.9399, longitude: 151.1753, hub: true },
};

// Combine all airports
const allAirports = {
  ...africanAirports,
  ...middleEasternHubs,
  ...europeanHubs,
  ...majorAirports,
};

// Helper functions
class AirportUtils {
  /**
   * Get airport information by IATA code
   */
  static getAirport(code) {
    if (!code) return null;
    return allAirports[code.toUpperCase()] || null;
  }

  /**
   * Check if airport is a major hub
   */
  static isHub(code) {
    const airport = this.getAirport(code);
    return airport ? airport.hub : false;
  }

  /**
   * Get all African airports
   */
  static getAfricanAirports() {
    return africanAirports;
  }

  /**
   * Get airports by country
   */
  static getAirportsByCountry(countryCode) {
    return Object.entries(allAirports)
      .filter(([_, airport]) => airport.country === countryCode)
      .reduce((acc, [code, airport]) => {
        acc[code] = airport;
        return acc;
      }, {});
  }

  /**
   * Find nearest airport by coordinates
   */
  static findNearestAirport(lat, lon, limit = 5) {
    if (!lat || !lon) return [];
    
    const airportsWithDistance = Object.entries(allAirports).map(([code, airport]) => {
      const distance = this.calculateDistance(lat, lon, airport.latitude, airport.longitude);
      return { code, ...airport, distance };
    });
    
    return airportsWithDistance
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  static toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Get airport name with city
   */
  static getAirportDisplayName(code) {
    const airport = this.getAirport(code);
    if (!airport) return code;
    return `${airport.city} (${code})`;
  }

  /**
   * Get country name from code
   */
  static getCountryName(countryCode) {
    const countries = {
      'ZA': 'South Africa',
      'NG': 'Nigeria',
      'KE': 'Kenya',
      'ET': 'Ethiopia',
      'EG': 'Egypt',
      'GH': 'Ghana',
      'TZ': 'Tanzania',
      'MA': 'Morocco',
      'DZ': 'Algeria',
      'TN': 'Tunisia',
      'SN': 'Senegal',
      'CI': 'Ivory Coast',
      'UG': 'Uganda',
      'RW': 'Rwanda',
      'MU': 'Mauritius',
      'SC': 'Seychelles',
      'ZM': 'Zambia',
      'ZW': 'Zimbabwe',
      'MZ': 'Mozambique',
      'BW': 'Botswana',
      'NA': 'Namibia',
      'AO': 'Angola',
      'CM': 'Cameroon',
      'CG': 'Congo',
      'CD': 'DR Congo',
      'SD': 'Sudan',
      'LY': 'Libya',
      'AE': 'United Arab Emirates',
      'QA': 'Qatar',
      'SA': 'Saudi Arabia',
      'GB': 'United Kingdom',
      'FR': 'France',
      'NL': 'Netherlands',
      'DE': 'Germany',
      'TR': 'Turkey',
      'ES': 'Spain',
      'BE': 'Belgium',
      'US': 'United States',
      'HK': 'Hong Kong',
      'SG': 'Singapore',
      'TH': 'Thailand',
      'AU': 'Australia',
    };
    
    return countries[countryCode] || countryCode;
  }

  /**
   * Get timezone for airport
   */
  static getAirportTimezone(code) {
    // Simplified timezone mapping
    const timezones = {
      // South Africa
      'JNB': 'Africa/Johannesburg',
     
