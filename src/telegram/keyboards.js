const constants = require('../utils/constants');

class Keyboards {
    static mainMenu() {
        return {
            inline_keyboard: [
                [
                    { text: `${constants.EMOJIS.SEARCH} Search Flights`, callback_data: 'search_menu' },
                    { text: `${constants.EMOJIS.HISTORY} History`, callback_data: 'history_menu' }
                ],
                [
                    { text: `${constants.EMOJIS.POPULAR} Popular Routes`, callback_data: 'popular_menu' },
                    { text: `${constants.EMOJIS.SETTINGS} Settings`, callback_data: 'settings_menu' }
                ],
                [
                    { text: `${constants.EMOJIS.HELP} Help`, callback_data: 'help_menu' },
                    { text: `${constants.EMOJIS.ABOUT} About`, callback_data: 'about_menu' }
                ]
            ]
        };
    }

    static searchOptions() {
        return {
            inline_keyboard: [
                [
                    { text: '🔍 New Search', callback_data: 'new_search' },
                    { text: '📅 Search by Date', callback_data: 'search_by_date' }
                ],
                [
                    { text: '🌍 Multi-City', callback_data: 'multi_city' },
                    { text: '💰 Price Alert', callback_data: 'price_alert' }
                ],
                [
                    { text: '🔙 Back to Main', callback_data: 'main_menu' }
                ]
            ]
        };
    }

    static passengerSelector() {
        return {
            inline_keyboard: [
                [
                    { text: '1 Adult', callback_data: 'passengers:1' },
                    { text: '2 Adults', callback_data: 'passengers:2' },
                    { text: '3 Adults', callback_data: 'passengers:3' }
                ],
                [
                    { text: '4 Adults', callback_data: 'passengers:4' },
                    { text: '5 Adults', callback_data: 'passengers:5' },
                    { text: 'Custom', callback_data: 'passengers:custom' }
                ]
            ]
        };
    }

    static tripTypeSelector() {
        return {
            inline_keyboard: [
                [
                    { text: '🔄 One-Way', callback_data: 'trip_type:oneway' },
                    { text: '🔁 Return', callback_data: 'trip_type:return' }
                ]
            ]
        };
    }

    static cabinClassSelector() {
        return {
            inline_keyboard: [
                [
                    { text: 'Economy', callback_data: 'cabin:economy' },
                    { text: 'Premium', callback_data: 'cabin:premium' }
                ],
                [
                    { text: 'Business', callback_data: 'cabin:business' },
                    { text: 'First', callback_data: 'cabin:first' }
                ]
            ]
        };
    }

    static searchConfirmation() {
        return {
            inline_keyboard: [
                [
                    { text: '✅ Confirm Search', callback_data: 'confirm_search' },
                    { text: '✏️ Edit Search', callback_data: 'edit_search' }
                ],
                [
                    { text: '➕ Add Return', callback_data: 'add_return' },
                    { text: '🔙 Start Over', callback_data: 'start_over' }
                ]
            ]
        };
    }

    static routeActions(routeId, affiliateLink) {
        const keyboard = {
            inline_keyboard: []
        };

        if (affiliateLink) {
            keyboard.inline_keyboard.push([
                { text: '🛫 Book Now', url: affiliateLink }
            ]);
        }

        keyboard.inline_keyboard.push([
            { text: '📋 Details', callback_data: `details:${routeId}` },
            { text: '💾 Save', callback_data: `save:${routeId}` },
            { text: '🔔 Alert', callback_data: `alert:${routeId}` }
        ]);

        return keyboard;
    }

    static pagination(currentPage, totalPages, prefix = 'page') {
        const keyboard = [];
        const row = [];
        
        if (currentPage > 1) {
            row.push({ text: '⬅️ Previous', callback_data: `${prefix}:${currentPage - 1}` });
        }
        
        row.push({ text: `${currentPage}/${totalPages}`, callback_data: 'current_page' });
        
        if (currentPage < totalPages) {
            row.push({ text: 'Next ➡️', callback_data: `${prefix}:${currentPage + 1}` });
        }
        
        keyboard.push(row);
        keyboard.push([{ text: '🔙 Back to Results', callback_data: 'back_to_results' }]);
        
        return { inline_keyboard: keyboard };
    }

    static quickSearchButtons(popularRoutes) {
        const keyboard = {
            inline_keyboard: []
        };

        popularRoutes.forEach(route => {
            keyboard.inline_keyboard.push([
                { 
                    text: `✈️ ${route.from} → ${route.to}`, 
                    callback_data: `quick:${route.from}:${route.to}` 
                }
            ]);
        });

        keyboard.inline_keyboard.push([
            { text: '🔙 Back', callback_data: 'back_to_main' }
        ]);

        return keyboard;
    }

    static locationRequest() {
        return {
            keyboard: [[{ text: '📍 Send Location', request_location: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
        };
    }

    static removeKeyboard() {
        return { remove_keyboard: true };
    }

    static yesNo() {
        return {
            inline_keyboard: [
                [
                    { text: '✅ Yes', callback_data: 'yes' },
                    { text: '❌ No', callback_data: 'no' }
                ]
            ]
        };
    }

    static feedback() {
        return {
            inline_keyboard: [
                [
                    { text: '👍 Helpful', callback_data: 'feedback:helpful' },
                    { text: '👎 Not Helpful', callback_data: 'feedback:not_helpful' }
                ]
            ]
        };
    }

    static settingsMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '💰 Currency', callback_data: 'settings:currency' },
                    { text: '🌍 Region', callback_data: 'settings:region' }
                ],
                [
                    { text: '🔔 Notifications', callback_data: 'settings:notifications' },
                    { text: '🔒 Privacy', callback_data: 'settings:privacy' }
                ],
                [
                    { text: '📊 Analytics', callback_data: 'settings:analytics' },
                    { text: '🔙 Back', callback_data: 'back_to_main' }
                ]
            ]
        };
    }
}

module.exports = Keyboards;
