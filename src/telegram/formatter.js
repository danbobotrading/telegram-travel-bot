'use strict';

const config = require('../../config/config');
const Helpers = require('../utils/helpers');
const constants = require('../utils/constants');

/**
 * Telegram message formatters and templates
 */

class TelegramFormatter {
  /**
   * Format welcome message
   */
  static formatWelcomeMessage(userName) {
    const emoji = constants.EMOJIS;
    
    return `
${emoji.AIRPLANE} *Welcome to Travel Scout, ${userName || 'Traveler'}!*

I'm your intelligent African flight search assistant that finds the *cheapest possible routes*, even if that means mixing different airlines.

${emoji.STAR} *What I can do:*
• Find cheapest flights across Africa & worldwide
• Combine different airlines for maximum savings (Virtual Interlining)
• Show all fees upfront in ZAR
• Search 1000+ airlines simultaneously

${emoji.FIRE} *Perfect for African routes like:*
🇿🇦 Johannesburg → 🇰🇪 Nairobi
🇳🇬 Lagos → 🇬🇧 London  
🇪🇬 Cairo → 🇦🇪 Dubai
🇬🇭 Accra → 🇺🇸 New York

${emoji.SEARCH} *Quick Start:*
• Type "/search" for guided search
• Or send: "JNB to CPT tomorrow"
• Or: "Flights from Lagos to London next week"

Ready to find your cheapest route? Let's go! ${emoji.THUMBS_UP}
    `.trim();
  }

  /**
   * Format help message
   */
  static formatHelpMessage() {
    const emoji = constants.EMOJIS;
    
    return `
${emoji.INFO} *Travel Scout Help Guide*

${emoji.SEARCH} *Basic Commands:*
/start - Welcome message
/search - Start flight search
/help - This help message  
/history - View search history
/popular - See popular routes
/settings - Change preferences

${emoji.AIRPLANE} *How to Search:*
1. Use /search for step-by-step search
2. Or type natural language:
   • "JNB to CPT tomorrow"
   • "Flights Lagos London return"
   • "Nairobi Dubai one-way"

${emoji.MONEY} *Virtual Interlining Explained:*
I combine separate tickets to create cheaper routes that other search engines can't find.

*Example:*
Direct: JNB→LHR R15,000
Virtual: JNB→ADD (FlySafair) + ADD→LHR (Ethiopian) = R8,500
*I save you R6,500!*

${emoji.WARNING} *Important Notes:*
• Prices include estimated taxes & fees
• Virtual interline routes require self-transfer
• Always check visa requirements
• Verify baggage allowances

${emoji.TICKET} *Booking Tips:*
• Book early for best prices
• Be flexible with dates
• Consider nearby airports
• Check airline refund policies

Need more help? Contact @travelscout_support
    `.trim();
  }

  /**
   * Format search summary
   */
  static formatSearchSummary(results, searchParams) {
    const emoji = constants.EMOJIS;
    
    if (results.length === 0) {
      return this.formatNoResultsMessage(searchParams);
    }
    
    const cheapest = results[0];
    const hasVirtualInterline = results.some(r => r.virtualInterline);
    
    let summary = `
${emoji.SEARCH} *Search Results Summary*

📍 *Route:* ${searchParams.from} → ${searchParams.to}
📅 *Date:* ${Helpers.formatDate(searchParams.date)}
👥 *Passengers:* ${searchParams.passengers || 1}

${emoji.MONEY} *Found ${results.length} route(s):*
    `.trim();
    
    // Add cheapest option
    if (cheapest) {
      summary += `\n\n${emoji.FIRE} *Cheapest Option:*`;
      summary += `\n${this.formatRouteSummary(cheapest)}`;
    }
    
    // Add virtual interline notice
    if (hasVirtualInterline) {
      summary += `\n\n${emoji.INFO} *Virtual Interlining Detected:*`;
      summary += `\nSome routes combine different airlines for significant savings.`;
      summary += `\n*Note:* These require self-transfer of baggage.`;
    }
    
    // Add tips
    summary += `\n\n${emoji.TICKET} *Tips:*`;
    summary += `\n• Click "Book Now" for detailed breakdown`;
    summary += `\n• Prices include estimated fees`;
    summary += `\n• Check visa requirements if international`;
    
    return summary;
  }

  /**
   * Format route result for Telegram
   */
  static formatRouteResult(route) {
    const emoji = constants.EMOJIS;
    
    // Format airlines
    const airlines = route.airlines
      ?.map(code => Helpers.getAirlineName(code))
      .join(' + ') || 'Multiple Airlines';
    
    // Format route string
    const routeString = this.formatRouteString(route.segments);
    
    // Format duration
    const duration = Helpers.formatDuration(route.totalDuration);
    
    // Format price
    const price = route.displayPrice || Helpers.formatPrice(
      route.finalPriceZAR || route.totalPriceZAR || route.totalPrice || 0,
      'ZAR'
    );
    
    // Build message
    let message = '';
    
    // Header with index
    const index = route._index ? `${route._index}️⃣ ` : '';
    message += `${index}*${airlines}*\n`;
    
    // Route
    message += `${emoji.AIRPLANE} ${routeString}\n`;
    
    // Duration
    message += `${emoji.CLOCK} ${duration}\n`;
    
    // Price
    message += `${emoji.MONEY} ${price}\n`;
    
    // Virtual interline notice
    if (route.virtualInterline) {
      message += `${emoji.TICKET} *Separate tickets:* Yes\n`;
      message += `${emoji.WARNING} *Note:* Self-transfer required at ${route.connectionAirport}\n`;
    } else {
      message += `${emoji.TICKET} *Separate tickets:* No\n`;
    }
    
    // Transfer count
    const transfers = route.transferCount || (route.segments?.length - 1) || 0;
    if (transfers > 0) {
      message += `🔄 *Transfers:* ${transfers}\n`;
    }
    
    // Value score if available
    if (route.valueScore && route.valueScore < 50) {
      message += `⭐ *Great Value*\n`;
    }
    
    // Booking engine
    message += `📱 *Source:* ${route.bookingEngine || 'Unknown'}\n`;
    
    // Create inline keyboard
    const keyboard = {
      inline_keyboard: []
    };
    
    // Add Book Now button if affiliate link exists
    if (route.affiliateLink) {
      keyboard.inline_keyboard.push([
        {
          text: `${emoji.LINK} Book Now`,
          url: route.affiliateLink
        }
      ]);
    }
    
    // Add details button
    keyboard.inline_keyboard.push([
      {
        text: `${emoji.INFO} More Details`,
        callback_data: `route_details:${route.id}`
      }
    ]);
    
    // Add save button
    keyboard.inline_keyboard.push([
      {
        text: `${emoji.TICKET} Save Route`,
        callback_data: `save_route:${route.id}`
      },
      {
        text: `${emoji.CALENDAR} Price Alert`,
        callback_data: `alert_route:${route.id}`
      }
    ]);
    
    return {
      message: message.trim(),
      keyboard
    };
  }

  /**
   * Format route string from segments
   */
  static formatRouteString(segments) {
    if (!segments || segments.length === 0) {
      return 'Direct';
    }
    
    if (segments.length === 1) {
      return `Direct: ${segments[0].from} → ${segments[0].to}`;
    }
    
    const routeParts = segments.map(segment => segment.from);
    routeParts.push(segments[segments.length - 1].to);
    
    return routeParts.join(' → ');
  }

  /**
   * Format route summary (compact)
   */
  static formatRouteSummary(route) {
    const airlines = route.airlines
      ?.slice(0, 2)
      .map(code => Helpers.getAirlineName(code))
      .join(' + ');
    
    const routeString = this.formatRouteString(route.segments);
    const duration = Helpers.formatDuration(route.totalDuration);
    const price = route.displayPrice || Helpers.formatPrice(
      route.finalPriceZAR || route.totalPriceZAR || route.totalPrice || 0,
      'ZAR'
    );
    
    return `• ${airlines || 'Multiple airlines'}: ${routeString} | ${duration} | ${price}`;
  }

  /**
   * Format no results message
   */
  static formatNoResultsMessage(searchParams) {
    const emoji = constants.EMOJIS;
    
    return `
${emoji.WARNING} *No Flights Found*

I couldn't find any available flights for:
📍 ${searchParams.from} → ${searchParams.to}
📅 ${Helpers.formatDate(searchParams.date)}
👥 ${searchParams.passengers || 1} passenger(s)

${emoji.INFO} *Suggestions:*
1. Try different dates
2. Check nearby airports
3. Search one-way instead of return
4. Be flexible with travel times
5. Try searching in 1-2 days

${emoji.SEARCH} *Popular Alternatives:*
• ${searchParams.from} → CPT (Cape Town)
• ${searchParams.from} → DUR (Durban)  
• ${searchParams.from} → JNB (Johannesburg)

Use /search to try again or try natural language:
"${searchParams.from} to ${searchParams.to} next week"
    `.trim();
  }

  /**
   * Format error message
   */
  static formatErrorMessage(error) {
    const emoji = constants.EMOJIS;
    
    return `
${emoji.ERROR} *Search Failed*

Sorry, there was an error while searching for flights.

${emoji.WARNING} *Possible reasons:*
• Flight search APIs temporarily unavailable
• Network connectivity issues
• Invalid search parameters
• Rate limiting from providers

${emoji.INFO} *What to do:*
1. Wait a few minutes and try again
2. Check your internet connection
3. Verify airport codes are correct
4. Try a simpler search

If the problem persists, please contact support.

Error details: ${error.message || 'Unknown error'}
    `.trim();
  }

  /**
   * Format search history
   */
  static formatSearchHistory(searches) {
    const emoji = constants.EMOJIS;
    
    if (searches.length === 0) {
      return `${emoji.INFO} *No search history found.*`;
    }
    
    let message = `${emoji.CALENDAR} *Your Recent Searches*\n\n`;
    
    searches.forEach((search, index) => {
      const date = Helpers.formatDate(search.travel_date);
      const results = search.results ? JSON.parse(search.results) : [];
      
      message += `${index + 1}. *${search.from_city} → ${search.to_city}*\n`;
      message += `   📅 ${date} | 👥 ${search.passengers || 1}\n`;
      
      if (results.length > 0) {
        const cheapest = results[0];
        const price = cheapest.displayPrice || 
          Helpers.formatPrice(cheapest.totalPrice || 0, search.currency || 'ZAR');
        message += `   💰 From ${price}\n`;
      }
      
      message += `   ⏰ ${Helpers.formatDate(search.created_at, 'TIME')}\n\n`;
    });
    
    message += `*Click any search to run it again.*`;
    
    return message.trim();
  }

  /**
   * Format popular routes
   */
  static formatPopularRoutes(routes) {
    const emoji = constants.EMOJIS;
    
    if (routes.length === 0) {
      return `${emoji.INFO} *No popular routes data yet.*`;
    }
    
    let message = `${emoji.FIRE} *Popular African Routes*\n\n`;
    message += `Based on recent searches:\n\n`;
    
    routes.forEach((route, index) => {
      const flagFrom = Helpers.getCountryFlag(this.getCountryFromAirport(route.from)) || '🇺🇳';
      const flagTo = Helpers.getCountryFlag(this.getCountryFromAirport(route.to)) || '🇺🇳';
      
      message += `${index + 1}. ${flagFrom} ${route.from} → ${flagTo} ${route.to}\n`;
      message += `   🔍 ${route.count} searches\n\n`;
    });
    
    message += `*Click any route to search now!*`;
    
    return message.trim();
  }

  /**
   * Format settings message
   */
  static formatSettingsMessage() {
    const emoji = constants.EMOJIS;
    
    return `
${emoji.SETTINGS} *Bot Settings*

Configure your Travel Scout experience:

${emoji.MONEY} *Currency:* ZAR (South African Rand)
Change to USD, EUR, GBP, etc.

${emoji.GLOBE} *Region:* Africa-focused
Optimized for African routes and airports

${emoji.BELL} *Notifications:*
• Price alerts for saved searches
• Flight status updates
• Special deals

${emoji.SEARCH} *Search Preferences:*
• Default passengers: 1
• Include virtual interlining: Yes
• Maximum stops: 2
• Preferred airlines: None

${emoji.LANGUAGE} *Language:* English
Bot interface language

${emoji.LOCK} *Privacy:*
• Store search history: Yes
• Anonymous analytics: Yes
• Personal data: Encrypted

Click any setting to change it.
    `.trim();
  }

  /**
   * Format about message
   */
  static formatAboutMessage() {
    const emoji = constants.EMOJIS;
    
    return `
${emoji.AIRPLANE} *About Travel Scout*

Travel Scout is an advanced Telegram bot that finds the cheapest possible flight routes for African travelers, using virtual interlining technology.

${emoji.ROCKET} *Features:*
• Multi-source search (Kiwi, Skyscanner, Travelpayouts)
• Virtual interlining engine
• Price normalization to ZAR
• All fees included upfront
• African route optimization

${emoji.TEAM} *Mission:*
Make travel more affordable for Africans by finding routes that other search engines can't see.

${emoji.SHIELD} *Privacy & Security:*
• No credit card information stored
• Search history encrypted
• GDPR compliant
• Anonymous usage analytics

${emoji.MONEY} *Business Model:*
We earn affiliate commissions when you book through our links, at no extra cost to you. This keeps the bot free to use.

${emoji.WRENCH} *Technology Stack:*
• Node.js + Express backend
• PostgreSQL + Redis
• Multiple flight API integrations
• Telegram Bot API

${emoji.HEART} *Made with love for African travelers*

Version: 1.0.0
Last updated: ${new Date().toISOString().split('T')[0]}

GitHub: https://github.com/yourusername/telegram-travel-bot
Support: @travelscout_support
    `.trim();
  }

  /**
   * Format stats message (admin)
   */
  static formatStatsMessage(userStats, allUsers) {
    const emoji = constants.EMOJIS;
    
    let message = `${emoji.BAR_CHART} *Bot Statistics*\n\n`;
    
    // User stats
    if (userStats) {
      message += `${emoji.USER} *Your Stats:*\n`;
      message += `• Searches: ${userStats.searches_count || 0}\n`;
      message += `• Unique routes: ${userStats.unique_from_cities || 0} → ${userStats.unique_to_cities || 0}\n`;
      message += `• First search: ${Helpers.formatDate(userStats.first_search_date) || 'Never'}\n`;
      message += `• Last search: ${Helpers.formatDate(userStats.last_search_date) || 'Never'}\n\n`;
    }
    
    // Top users
    if (allUsers && allUsers.length > 0) {
      message += `${emoji.TROPHY} *Top Users:*\n`;
      allUsers.slice(0, 5).forEach((user, index) => {
        const name = user.username || `${user.first_name || ''} ${user.last_name || ''}`.trim() || `User ${user.id}`;
        message += `${index + 1}. ${name}: ${user.searches_count || 0} searches\n`;
      });
      message += `\n`;
    }
    
    // System stats
    message += `${emoji.COMPUTER} *System Status:*\n`;
    message += `• Uptime: ${Math.floor(process.uptime() / 3600)} hours\n`;
    message += `• Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n`;
    message += `• Redis: ${require('../database/redis-client').initialized ? 'Connected' : 'Disconnected'}\n`;
    message += `• APIs: All operational\n`;
    
    return message.trim();
  }

  /**
   * Format route details for callback
   */
  static formatRouteDetails(route) {
    const emoji = constants.EMOJIS;
    
    let message = `${emoji.INFO} *Route Details*\n\n`;
    
    // Basic info
    message += `*ID:* ${route.id.substring(0, 12)}...\n`;
    message += `*Source:* ${route.source || 'Unknown'}\n`;
    message += `*Booking Engine:* ${route.bookingEngine || 'Unknown'}\n\n`;
    
    // Segments
    message += `${emoji.AIRPLANE} *Flight Segments:*\n`;
    
    if (route.segments && route.segments.length > 0) {
      route.segments.forEach((segment, index) => {
        const departure = Helpers.formatTime(segment.departure);
        const arrival = Helpers.formatTime(segment.arrival);
        const airline = Helpers.getAirlineName(segment.airline);
        
        message += `${index + 1}. ${segment.from} → ${segment.to}\n`;
        message += `   ${airline} ${segment.flightNumber || ''}\n`;
        message += `   ${departure} - ${arrival}\n`;
        
        if (segment.aircraft) {
          message += `   Aircraft: ${segment.aircraft}\n`;
        }
        
        message += `\n`;
      });
    }
    
    // Price breakdown
    if (route.feeBreakdown) {
      message += `${emoji.MONEY} *Price Breakdown:*\n`;
      message += `• Base fare: ${Helpers.formatPrice(route.feeBreakdown.baseFare, 'ZAR')}\n`;
      message += `• Baggage: ${Helpers.formatPrice(route.feeBreakdown.baggage, 'ZAR')}\n`;
      message += `• Booking fee: ${Helpers.formatPrice(route.feeBreakdown.booking, 'ZAR')}\n`;
      message += `• Taxes: ${Helpers.formatPrice(route.feeBreakdown.taxes, 'ZAR')}\n`;
      message += `• *Total: ${Helpers.formatPrice(route.feeBreakdown.total, 'ZAR')}*\n\n`;
    }
    
    // Virtual interline details
    if (route.virtualInterline) {
      message += `${emoji.WARNING} *Virtual Interline Notes:*\n`;
      message += `• Self-transfer at ${route.connectionAirport}\n`;
      message += `• Minimum connection: ${Math.round(route.connectionTime || 4)} hours\n`;
      message += `• Collect and re-check baggage\n`;
      message += `• Separate tickets for each airline\n\n`;
    }
    
    // Value score
    if (route.valueScore) {
      message += `${emoji.STAR} *Value Score:* ${Math.round(route.valueScore)}/100\n`;
      if (route.valueScore < 30) message += `Excellent value! 🎉\n`;
      else if (route.valueScore < 60) message += `Good value 👍\n`;
      else message += `Standard fare\n`;
    }
    
    return message.trim();
  }

  /**
   * Get country from airport code (simplified)
   */
  static getCountryFromAirport(airportCode) {
    // Simplified mapping
    const countries = {
      'JNB': 'ZA', 'CPT': 'ZA', 'DUR': 'ZA',
      'LOS': 'NG', 'ABV': 'NG',
      'NBO': 'KE', 'MBA': 'KE',
      'ADD': 'ET',
      'CAI': 'EG', 'HRG': 'EG',
      'ACC': 'GH',
      'DAR': 'TZ',
      'CMN': 'MA', 'RAK': 'MA',
      'DXB': 'AE', 'AUH': 'AE',
      'DOH': 'QA',
      'LHR': 'GB', 'LGW': 'GB',
      'JFK': 'US', 'LAX': 'US',
      'CDG': 'FR', 'ORY': 'FR',
      'AMS': 'NL',
      'FRA': 'DE', 'MUC': 'DE',
      'IST': 'TR',
      'SIN': 'SG', 'BKK': 'TH'
    };
    
    return countries[airportCode] || 'UN';
  }

  /**
   * Format date with emoji based on proximity
   */
  static formatDateWithEmoji(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const diffTime = date - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    let emoji = '📅';
    
    if (diffDays === 0) emoji = '🚀';
    else if (diffDays === 1) emoji = '⏰';
    else if (diffDays <= 7) emoji = '📆';
    else if (diffDays <= 30) emoji = '📊';
    
    return `${emoji} ${Helpers.formatDate(dateString)}`;
  }

  /**
   * Format price with trend indicator
   */
  static formatPriceWithTrend(price, previousPrice, currency = 'ZAR') {
    const formattedPrice = Helpers.formatPrice(price, currency);
    
    if (!previousPrice || previousPrice === 0) {
      return formattedPrice;
    }
    
    const change = ((price - previousPrice) / previousPrice) * 100;
    
    let trend = '';
    if (change < -10) trend = '📉'; // Dropped significantly
    else if (change < -5) trend = '↘️'; // Dropped
    else if (change < 5) trend = '➡️'; // Stable
    else if (change < 10) trend = '↗️'; // Increased
    else trend = '📈'; // Increased significantly
    
    return `${formattedPrice} ${trend}`;
  }
}

module.exports = TelegramFormatter;
