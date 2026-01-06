const routeEngine = require('../core/route-stitcher');
const formatter = require('./formatter');
const logger = require('../utils/logger');
const { saveSearch, getUser } = require('../database/models');

class BotCommands {
    setup(bot) {
        // Start command
        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            await this.sendWelcomeMessage(bot, chatId);
            await this.initializeUser(msg.from);
        });

        // Help command
        bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            bot.sendMessage(chatId, this.getHelpText());
        });

        // Search command with inline keyboard
        bot.onText(/\/search/, (msg) => {
            const chatId = msg.chat.id;
            this.askSearchParameters(bot, chatId);
        });

        // Handle callback queries from inline keyboards
        bot.on('callback_query', async (callbackQuery) => {
            const message = callbackQuery.message;
            const data = callbackQuery.data;
            
            await this.handleCallbackQuery(bot, callbackQuery, data, message);
        });

        // Handle location sharing
        bot.on('location', async (msg) => {
            const chatId = msg.chat.id;
            // Use location to suggest nearest airports
            bot.sendMessage(chatId, "📍 Thanks! I'll find airports near your location...");
        });

        // Handle any message (fallback for search)
        bot.on('message', async (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                await this.handleNaturalLanguageSearch(bot, msg);
            }
        });
    }

    async sendWelcomeMessage(bot, chatId) {
        const welcomeText = `✈️ *Welcome to Travel Scout - Your African Travel Expert!*
        
I find you the *cheapest possible routes* across Africa and beyond, using advanced virtual interlining technology.

*What I can do:*
✅ Find cheapest flights (even mixing different airlines)
✅ Search across 1000+ airlines
✅ Include all taxes and fees upfront
✅ Show you options you won't find anywhere else

*Quick Start:* Send me:
• "Johannesburg to Cape Town next Friday"
• Or use /search for step-by-step search

*Pro Tip:* I'm especially good at finding cheap routes from:
🇿🇦 South Africa → 🇰🇪 Kenya
🇳🇬 Nigeria → 🇬🇧 UK
🇪🇬 Egypt → 🇦🇪 UAE
...and everywhere in between!

Ready to find your cheapest route?`;
        
        bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
        
        // Send quick action buttons
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔍 Start Search", callback_data: "start_search" }],
                    [{ text: "📖 How It Works", callback_data: "how_it_works" }],
                    [{ text: "⭐ Popular Routes", callback_data: "popular_routes" }]
                ]
            }
        };
        
        bot.sendMessage(chatId, "What would you like to do?", options);
    }

    getHelpText() {
        return `*Travel Scout Help Guide*

*Basic Commands:*
/start - Welcome message and setup
/search - Start a new flight search
/help - Show this help message

*How to Search:*
1. Use /search for guided search
2. Or just type your request:
   • "JNB to CPT tomorrow"
   • "Lagos to London next week return"
   • "Nairobi to Dubai one-way"

*What is Virtual Interlining?*
I combine separate tickets from different airlines to create cheaper routes that other search engines can't find.

*Example:* FlySafair (JNB→ADD) + Ethiopian (ADD→DXB) = Cheaper than any single airline!

*Tips:*
• Include baggage needs in your message
• Be flexible with dates for better prices
• I update prices every hour

Need support? Contact @your_support_handle`;
    }

    askSearchParameters(bot, chatId) {
        const questions = [
            {
                text: "📍 *Where are you flying from?*\n\nPlease enter city or airport code (e.g. 'Johannesburg' or 'JNB'):",
                callback: "from_city"
            },
            {
                text: "🎯 *Where do you want to go?*\n\nCity or airport code (e.g. 'Cape Town' or 'CPT'):",
                callback: "to_city"
            },
            {
                text: "📅 *When are you traveling?*\n\nPlease enter date (e.g. '2024-12-25' or 'next Friday'):",
                callback: "travel_date"
            },
            {
                text: "🔄 *Return trip?*\n\nIs this one-way or return?",
                callback: "trip_type",
                options: ["One-way", "Return"]
            }
        ];

        this.askQuestionSequentially(bot, chatId, questions);
    }

    async askQuestionSequentially(bot, chatId, questions, answers = {}, index = 0) {
        if (index >= questions.length) {
            // All questions answered, start search
            await this.performSearch(bot, chatId, answers);
            return;
        }

        const question = questions[index];
        
        if (question.options) {
            // Show inline keyboard for options
            const keyboard = {
                inline_keyboard: question.options.map(option => 
                    [{ text: option, callback_data: `${question.callback}:${option}` }]
                )
            };
            
            bot.sendMessage(chatId, question.text, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            // Simple text input
            bot.sendMessage(chatId, question.text, { parse_mode: 'Markdown' });
            
            // Wait for user response
            bot.once('message', async (msg) => {
                if (msg.chat.id === chatId && msg.text) {
                    answers[question.callback] = msg.text;
                    this.askQuestionSequentially(bot, chatId, questions, answers, index + 1);
                }
            });
        }
    }

    async handleCallbackQuery(bot, callbackQuery, data, message) {
        const chatId = message.chat.id;
        const [action, value] = data.split(':');
        
        try {
            await bot.answerCallbackQuery(callbackQuery.id);
            
            switch (action) {
                case 'start_search':
                    this.askSearchParameters(bot, chatId);
                    break;
                    
                case 'from_city':
                case 'to_city':
                case 'travel_date':
                case 'trip_type':
                    // Store answer and continue
                    break;
                    
                case 'popular_routes':
                    await this.showPopularRoutes(bot, chatId);
                    break;
                    
                case 'how_it_works':
                    await bot.sendMessage(chatId, 
                        `*How Virtual Interlining Works:*
                        
1. I search across ALL airlines individually
2. Find separate tickets that can be combined
3. Ensure legal connection times (2-24 hours)
4. Calculate total price with ALL fees
5. Show you options others can't find
                        
*Example:* You want JNB→LHR
• Option 1: Direct flight R15,000
• Option 2: JNB→ADD (FlySafair) + ADD→LHR (Ethiopian) = R8,500
                        
I'll show you option 2! 🎯`, 
                        { parse_mode: 'Markdown' }
                    );
                    break;
                    
                case 'book_now':
                    const [routeId, provider] = value.split('|');
                    await this.handleBooking(bot, chatId, routeId, provider);
                    break;
            }
            
        } catch (error) {
            logger.error('Error handling callback:', error);
            await bot.sendMessage(chatId, "❌ Something went wrong. Please try again.");
        }
    }

    async performSearch(bot, chatId, searchParams) {
        try {
            // Show searching message
            const searchMessage = await bot.sendMessage(chatId, 
                `🔍 *Searching for the cheapest routes...*\n\n` +
                `From: ${searchParams.from_city}\n` +
                `To: ${searchParams.to_city}\n` +
                `Date: ${searchParams.travel_date}\n` +
                `Trip: ${searchParams.trip_type || 'One-way'}\n\n` +
                `*Please wait while I scan all airlines and create custom routes...*`,
                { parse_mode: 'Markdown' }
            );

            // Perform actual search
            const results = await routeEngine.findCheapestRoutes(
                searchParams.from_city,
                searchParams.to_city,
                searchParams.travel_date,
                searchParams.trip_type === 'Return' ? searchParams.return_date : null,
                1 // Default to 1 passenger for now
            );

            // Delete searching message
            await bot.deleteMessage(chatId, searchMessage.message_id);

            if (results.length === 0) {
                await bot.sendMessage(chatId, 
                    "❌ *No routes found*\n\n" +
                    "I couldn't find any available routes for your search. Try:\n" +
                    "• Different dates\n" +
                    "• Nearby airports\n" +
                    "• More flexible timing",
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // Format and send results
            const formattedResults = formatter.formatResults(results);
            
            for (const result of formattedResults) {
                await bot.sendMessage(chatId, result.message, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: result.keyboard
                });
            }

            // Save search to database
            await saveSearch({
                telegramId: chatId,
                fromCity: searchParams.from_city,
                toCity: searchParams.to_city,
                travelDate: searchParams.travel_date,
                results: results
            });

            // Ask if user wants to save this search
            const saveOptions = {
                reply_markup: {
                    inline_keyboard: [[
                        { text: "💾 Save Search", callback_data: "save_search" },
                        { text: "🔍 New Search", callback_data: "start_search" }
                    ]]
                }
            };
            
            await bot.sendMessage(chatId, 
                `Found ${results.length} option${results.length > 1 ? 's' : ''}. ` +
                `Want to save this search or look for something else?`,
                saveOptions
            );

        } catch (error) {
            logger.error('Search error:', error);
            await bot.sendMessage(chatId, 
                "❌ *Search Failed*\n\n" +
                "I encountered an error while searching. This might be due to:\n" +
                "• API limitations\n" +
                "• Network issues\n" +
                "• Invalid airport codes\n\n" +
                "Please try again in a few minutes or use different airports.",
                { parse_mode: 'Markdown' }
            );
        }
    }

    async showPopularRoutes(bot, chatId) {
        const popularRoutes = [
            { from: "JNB", to: "CPT", name: "🇿🇦 Johannesburg → Cape Town" },
            { from: "LOS", to: "LHR", name: "🇳🇬 Lagos → London" },
            { from: "NBO", to: "DXB", name: "🇰🇪 Nairobi → Dubai" },
            { from: "ACC", to: "JFK", name: "🇬🇭 Accra → New York" },
            { from: "CAI", to: "CDG", name: "🇪🇬 Cairo → Paris" },
            { from: "ADD", to: "BKK", name: "🇪🇹 Addis Ababa → Bangkok" }
        ];

        const keyboard = {
            inline_keyboard: popularRoutes.map(route => [
                { 
                    text: route.name, 
                    callback_data: `quick_search:${route.from}:${route.to}` 
                }
            ])
        };

        await bot.sendMessage(chatId, 
            "*Popular African Routes*\n\n" +
            "Tap any route to instantly search for the cheapest options:",
            { 
                parse_mode: 'Markdown',
                reply_markup: keyboard 
            }
        );
    }

    async handleNaturalLanguageSearch(bot, msg) {
        const text = msg.text.toLowerCase();
        const chatId = msg.chat.id;
        
        // Simple NLP for flight search
        const patterns = [
            {
                pattern: /(?:from|fly from|departing from)\s+(\w+)\s+(?:to|going to)\s+(\w+)\s+(?:on|for)\s+([\w\s]+)/i,
                extract: (match) => ({
                    from: match[1],
                    to: match[2],
                    date: match[3]
                })
            },
            {
                pattern: /(\w+)\s+to\s+(\w+)\s+(?:on|for)\s+([\w\s]+)/i,
                extract: (match) => ({
                    from: match[1],
                    to: match[2],
                    date: match[3]
                })
            },
            {
                pattern: /(\w+)\s+to\s+(\w+)/i,
                extract: (match) => ({
                    from: match[1],
                    to: match[2],
                    date: 'next week'
                })
            }
        ];

        let searchParams = null;
        for (const { pattern, extract } of patterns) {
            const match = text.match(pattern);
            if (match) {
                searchParams = extract(match);
                break;
            }
        }

        if (searchParams) {
            await bot.sendMessage(chatId, 
                `✈️ *Searching for flights...*\n\n` +
                `I'll find the cheapest way from ${searchParams.from.toUpperCase()} ` +
                `to ${searchParams.to.toUpperCase()} for ${searchParams.date}.`,
                { parse_mode: 'Markdown' }
            );
            
            // Convert natural language date to actual date
            const actualDate = this.parseNaturalDate(searchParams.date);
            
            await this.performSearch(bot, chatId, {
                from_city: searchParams.from,
                to_city: searchParams.to,
                travel_date: actualDate,
                trip_type: 'One-way'
            });
        }
    }

    parseNaturalDate(text) {
        // Simple date parser for natural language
        const today = new Date();
        
        if (text.includes('tomorrow')) {
            today.setDate(today.getDate() + 1);
        } else if (text.includes('next week')) {
            today.setDate(today.getDate() + 7);
        } else if (text.includes('next month')) {
            today.setMonth(today.getMonth() + 1);
        }
        
        return today.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    async initializeUser(user) {
        try {
            const existingUser = await getUser(user.id);
            if (!existingUser) {
                // Create new user in database
                await saveUser({
                    telegramId: user.id,
                    username: user.username,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    languageCode: user.language_code
                });
                logger.info(`New user registered: ${user.username || user.id}`);
            }
        } catch (error) {
            logger.error('Error initializing user:', error);
        }
    }

    async handleBooking(bot, chatId, routeId, provider) {
        // Track the click
        logger.info(`Booking click: ${routeId} via ${provider} by ${chatId}`);
        
        // Redirect to affiliate link (in real implementation)
        await bot.sendMessage(chatId,
            `🔗 *Redirecting to booking...*\n\n` +
            `You'll be taken to the booking page in a moment.\n\n` +
            `*Remember:*\n` +
            `• Check baggage allowances\n` +
            `• Verify passport/visa requirements\n` +
            `• Save your booking confirmation`,
            { parse_mode: 'Markdown' }
        );
        
        // In production, you'd actually redirect or send the affiliate link
        // For now, send a message
        await bot.sendMessage(chatId,
            `📝 *Booking Instructions*\n\n` +
            `Since this is a demo, here's what would happen:\n\n` +
            `1. You'd be redirected to ${provider}\n` +
            `2. Complete booking on their site\n` +
            `3. Get instant confirmation\n\n` +
            `In production, this would be a direct affiliate link.`,
            { parse_mode: 'Markdown' }
        );
    }
}

module.exports = new BotCommands();
