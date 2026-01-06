'use strict';

/**
 * Constants for Telegram Travel Bot
 */

module.exports = {
  // Time constants (in milliseconds)
  TIME: {
    MINUTE: 60 * 1000,
    HOUR: 60 * 60 * 1000,
    DAY: 24 * 60 * 60 * 1000,
    WEEK: 7 * 24 * 60 * 60 * 1000,
  },

  // Airline codes and names
  AIRLINES: {
    // African Airlines
    'SA': { name: 'South African Airways', iata: 'SA', icao: 'SAA', country: 'ZA' },
    'FA': { name: 'FlySafair', iata: 'FA', icao: 'SFR', country: 'ZA' },
    'ET': { name: 'Ethiopian Airlines', iata: 'ET', icao: 'ETH', country: 'ET' },
    'KQ': { name: 'Kenya Airways', iata: 'KQ', icao: 'KQA', country: 'KE' },
    'WB': { name: 'RwandAir', iata: 'WB', icao: 'RWD', country: 'RW' },
    'UL': { name: 'Air Tanzania', iata: 'TC', icao: 'ATC', country: 'TZ' },
    'AR': { name: 'Arik Air', iata: 'W3', icao: 'ARA', country: 'NG' },
    'VK': { name: 'Air Peace', iata: 'P4', icao: 'APK', country: 'NG' },
    'MS': { name: 'EgyptAir', iata: 'MS', icao: 'MSR', country: 'EG' },
    'AT': { name: 'Royal Air Maroc', iata: 'AT', icao: 'RAM', country: 'MA' },
    
    // Major International Airlines
    'EK': { name: 'Emirates', iata: 'EK', icao: 'UAE', country: 'AE' },
    'QR': { name: 'Qatar Airways', iata: 'QR', icao: 'QTR', country: 'QA' },
    'TK': { name: 'Turkish Airlines', iata: 'TK', icao: 'THY', country: 'TR' },
    'LH': { name: 'Lufthansa', iata: 'LH', icao: 'DLH', country: 'DE' },
    'BA': { name: 'British Airways', iata: 'BA', icao: 'BAW', country: 'GB' },
    'AF': { name: 'Air France', iata: 'AF', icao: 'AFR', country: 'FR' },
    'KL': { name: 'KLM', iata: 'KL', icao: 'KLM', country: 'NL' },
    'AA': { name: 'American Airlines', iata: 'AA', icao: 'AAL', country: 'US' },
    'DL': { name: 'Delta Air Lines', iata: 'DL', icao: 'DAL', country: 'US' },
    'UA': { name: 'United Airlines', iata: 'UA', icao: 'UAL', country: 'US' },
    
    // Low-cost carriers
    'FR': { name: 'Ryanair', iata: 'FR', icao: 'RYR', country: 'IE' },
    'U2': { name: 'easyJet', iata: 'U2', icao: 'EZY', country: 'GB' },
    'W6': { name: 'Wizz Air', iata: 'W6', icao: 'WZZ', country: 'HU' },
  },

  // Major African airports
  AIRPORTS: {
    // South Africa
    'JNB': { name: 'O.R. Tambo International Airport', city: 'Johannesburg', country: 'ZA', hub: true },
    'CPT': { name: 'Cape Town International Airport', city: 'Cape Town', country: 'ZA', hub: true },
    'DUR': { name: 'King Shaka International Airport', city: 'Durban', country: 'ZA', hub: false },
    
    // Nigeria
    'LOS': { name: 'Murtala Muhammed International Airport', city: 'Lagos', country: 'NG', hub: true },
    'ABV': { name: 'Nnamdi Azikiwe International Airport', city: 'Abuja', country: 'NG', hub: false },
    
    // Kenya
    'NBO': { name: 'Jomo Kenyatta International Airport', city: 'Nairobi', country: 'KE', hub: true },
    
    // Ethiopia
    'ADD': { name: 'Addis Ababa Bole International Airport', city: 'Addis Ababa', country: 'ET', hub: true },
    
    // Egypt
    'CAI': { name: 'Cairo International Airport', city: 'Cairo', country: 'EG', hub: true },
    
    // Ghana
    'ACC': { name: 'Kotoka International Airport', city: 'Accra', country: 'GH', hub: true },
    
    // Tanzania
    'DAR': { name: 'Julius Nyerere International Airport', city: 'Dar es Salaam', country: 'TZ', hub: false },
    
    // Morocco
    'CMN': { name: 'Mohammed V International Airport', city: 'Casablanca', country: 'MA', hub: true },
    
    // UAE (Common connection point)
    'DXB': { name: 'Dubai International Airport', city: 'Dubai', country: 'AE', hub: true },
    'AUH': { name: 'Abu Dhabi International Airport', city: 'Abu Dhabi', country: 'AE', hub: false },
    
    // Qatar
    'DOH': { name: 'Hamad International Airport', city: 'Doha', country: 'QA', hub: true },
    
    // Turkey
    'IST': { name: 'Istanbul Airport', city: 'Istanbul', country: 'TR', hub: true },
    
    // Europe
    'LHR': { name: 'Heathrow Airport', city: 'London', country: 'GB', hub: true },
    'CDG': { name: 'Charles de Gaulle Airport', city: 'Paris', country: 'FR', hub: true },
    'AMS': { name: 'Amsterdam Airport Schiphol', city: 'Amsterdam', country: 'NL', hub: true },
    'FRA': { name: 'Frankfurt Airport', city: 'Frankfurt', country: 'DE', hub: true },
    
    // USA
    'JFK': { name: 'John F. Kennedy International Airport', city: 'New York', country: 'US', hub: true },
    'LAX': { name: 'Los Angeles International Airport', city: 'Los Angeles', country: 'US', hub: true },
  },

  // Currency codes
  CURRENCIES: {
    'ZAR': { name: 'South African Rand', symbol: 'R', decimalDigits: 2 },
    'USD': { name: 'US Dollar', symbol: '$', decimalDigits: 2 },
    'EUR': { name: 'Euro', symbol: '€', decimalDigits: 2 },
    'GBP': { name: 'British Pound', symbol: '£', decimalDigits: 2 },
    'KES': { name: 'Kenyan Shilling', symbol: 'KSh', decimalDigits: 2 },
    'NGN': { name: 'Nigerian Naira', symbol: '₦', decimalDigits: 2 },
    'EGP': { name: 'Egyptian Pound', symbol: 'E£', decimalDigits: 2 },
    'GHS': { name: 'Ghanaian Cedi', symbol: 'GH₵', decimalDigits: 2 },
    'AED': { name: 'UAE Dirham', symbol: 'د.إ', decimalDigits: 2 },
    'QAR': { name: 'Qatari Riyal', symbol: 'ر.ق', decimalDigits: 2 },
  },

  // Search parameters
  SEARCH: {
    MAX_PASSENGERS: 9,
    MAX_INFANTS: 8,
    MAX_CHILDREN: 8,
    MAX_STOPS: 4,
    MAX_DURATION: 48, // hours
    DEFAULT_ADULTS: 1,
    DEFAULT_CHILDREN: 0,
    DEFAULT_INFANTS: 0,
  },

  // Booking classes
  CABIN_CLASSES: {
    'M': 'Economy',
    'W': 'Premium Economy',
    'C': 'Business',
    'F': 'First',
    'Y': 'Economy (Full Fare)',
  },

  // Baggage allowances (in kg)
  BAGGAGE: {
    ECONOMY: 20,
    PREMIUM_ECONOMY: 30,
    BUSINESS: 40,
    FIRST: 50,
  },

  // API rate limits
  API_RATE_LIMITS: {
    KIWI: 100, // requests per minute
    TRAVELPAYOUTS: 50,
    SKYSCANNER: 30,
  },

  // Emojis for Telegram messages
  EMOJIS: {
    AIRPLANE: '✈️',
    MONEY: '💰',
    CLOCK: '⏱️',
    TICKET: '🎫',
    LINK: '🔗',
    SEARCH: '🔍',
    LOCATION: '📍',
    CALENDAR: '📅',
    PERSON: '👤',
    BAG: '🎒',
    WARNING: '⚠️',
    SUCCESS: '✅',
    ERROR: '❌',
    INFO: 'ℹ️',
    STAR: '⭐',
    FIRE: '🔥',
    THUMBS_UP: '👍',
    FLAGS: {
      ZA: '🇿🇦',
      NG: '🇳🇬',
      KE: '🇰🇪',
      ET: '🇪🇹',
      EG: '🇪🇬',
      GH: '🇬🇭',
      AE: '🇦🇪',
      QA: '🇶🇦',
      GB: '🇬🇧',
      US: '🇺🇸',
      FR: '🇫🇷',
      DE: '🇩🇪',
    },
  },

  // Error messages
  ERRORS: {
    NO_RESULTS: 'No flights found for your search. Try different dates or airports.',
    INVALID_AIRPORT: 'Invalid airport code. Please use IATA codes like JNB, CPT, LOS.',
    DATE_PAST: 'Travel date cannot be in the past.',
    DATE_TOO_FAR: 'Travel date is too far in the future (max 1 year).',
    API_ERROR: 'Temporary search error. Please try again in a few minutes.',
    RATE_LIMIT: 'Too many requests. Please wait a moment.',
    INVALID_PASSENGERS: 'Invalid number of passengers. Maximum is 9.',
  },

  // Success messages
  SUCCESS: {
    SEARCH_STARTED: 'Searching for the best routes...',
    RESULTS_FOUND: 'Found {count} route(s) for you!',
    SEARCH_SAVED: 'Search saved to your history.',
    ALERT_SET: 'Price alert set successfully.',
  },

  // Cache keys
  CACHE_KEYS: {
    EXCHANGE_RATES: 'exchange_rates',
    AIRPORT_INFO: 'airport:{code}',
    AIRLINE_INFO: 'airline:{code}',
    POPULAR_ROUTES: 'popular_routes:{from}:{to}',
    USER_SEARCHES: 'user_searches:{userId}',
  },

  // Database tables
  TABLES: {
    USERS: 'users',
    SEARCHES: 'searches',
    AFFILIATE_CLICKS: 'affiliate_clicks',
    CACHED_ROUTES: 'cached_routes',
    PRICE_ALERTS: 'price_alerts',
    USER_SESSIONS: 'user_sessions',
  },

  // Feature flags (can be toggled via environment)
  FEATURES: {
    VIRTUAL_INTERLINING: 'virtual_interlining',
    MULTI_CITY: 'multi_city',
    PRICE_ALERTS: 'price_alerts',
    SEARCH_HISTORY: 'search_history',
    AFFILIATE_TRACKING: 'affiliate_tracking',
    ADMIN_DASHBOARD: 'admin_dashboard',
  },

  // Date formats
  DATE_FORMATS: {
    DISPLAY: 'DD MMM YYYY',
    DISPLAY_WITH_DAY: 'ddd, DD MMM YYYY',
    DISPLAY_FULL: 'dddd, DD MMMM YYYY',
    API: 'YYYY-MM-DD',
    TIME: 'HH:mm',
    DATETIME: 'YYYY-MM-DD HH:mm:ss',
  },

  // Default values
  DEFAULTS: {
    CURRENCY: 'ZAR',
    COUNTRY: 'ZA',
    LANGUAGE: 'en',
    TIMEZONE: 'Africa/Johannesburg',
    ADULTS: 1,
    CHILDREN: 0,
    INFANTS: 0,
    CABIN_CLASS: 'M',
    TRIP_TYPE: 'oneway',
    SORT_BY: 'price',
    ORDER: 'asc',
  },
};
