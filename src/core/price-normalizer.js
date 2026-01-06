const config = require('../../config/config');
const logger = require('../utils/logger');
const exchangeRateAPI = require('../api/exchange-rate-api');

class PriceNormalizer {
    constructor() {
        this.defaultCurrency = 'ZAR';
        this.baggageFees = { economy: 20, premium_economy: 30, business: 40, first: 50 };
        this.bookingFees = { kiwi: 5, travelpayouts: 3, skyscanner: 4, 'virtual-interline': 10 };
        this.taxRate = 0.15; // 15% VAT
    }

    async addAllFees(route, userPreferences = {}) {
        if (!route) return null;
        
        try {
            const normalized = { ...route };
            
            // Convert to ZAR
            if (normalized.currency !== this.defaultCurrency) {
                normalized.totalPriceZAR = await exchangeRateAPI.convert(
                    normalized.totalPrice,
                    normalized.currency,
                    this.defaultCurrency
                );
            } else {
                normalized.totalPriceZAR = normalized.totalPrice;
            }
            
            // Add baggage fees
            const baggageFee = this.calculateBaggageFee(
                userPreferences.bags || 0,
                userPreferences.cabinClass || 'economy'
            );
            normalized.baggageFeeZAR = baggageFee;
            
            // Add booking fees
            const bookingFee = this.calculateBookingFee(
                normalized.bookingEngine,
                normalized.virtualInterline
            );
            normalized.bookingFeeZAR = bookingFee;
            
            // Add taxes
            normalized.taxAmountZAR = normalized.totalPriceZAR * this.taxRate;
            
            // Calculate final price
            normalized.finalPriceZAR = 
                normalized.totalPriceZAR + 
                normalized.baggageFeeZAR + 
                normalized.bookingFeeZAR + 
                normalized.taxAmountZAR;
            
            // Format for display
            normalized.displayPrice = `R${Math.round(normalized.finalPriceZAR).toLocaleString()}`;
            
            return normalized;
            
        } catch (error) {
            logger.error('Price normalization error:', error);
            return route;
        }
    }

    calculateBaggageFee(bagsCount, cabinClass) {
        if (bagsCount <= 0) return 0;
        const baseFee = this.baggageFees[cabinClass] || this.baggageFees.economy;
        
        if (cabinClass === 'economy') return bagsCount * baseFee;
        if (cabinClass === 'premium_economy') return Math.max(0, bagsCount - 1) * baseFee;
        return Math.max(0, bagsCount - 2) * baseFee; // Business/First: first 2 bags free
    }

    calculateBookingFee(bookingEngine, isVirtualInterline = false) {
        return isVirtualInterline 
            ? this.bookingFees['virtual-interline']
            : this.bookingFees[bookingEngine] || this.bookingFees.travelpayouts;
    }

    async normalizeRoutes(routes, userPreferences = {}) {
        if (!Array.isArray(routes)) return [];
        
        const normalizedRoutes = [];
        for (const route of routes) {
            try {
                const normalized = await this.addAllFees(route, userPreferences);
                if (normalized) normalizedRoutes.push(normalized);
            } catch (error) {
                logger.error('Failed to normalize route:', error);
            }
        }
        
        return normalizedRoutes;
    }

    sortByPrice(routes) {
        return [...routes].sort((a, b) => {
            const priceA = a.finalPriceZAR || a.totalPriceZAR || a.totalPrice || 0;
            const priceB = b.finalPriceZAR || b.totalPriceZAR || b.totalPrice || 0;
            return priceA - priceB;
        });
    }

    filterByMaxPrice(routes, maxPriceZAR) {
        return routes.filter(route => {
            const price = route.finalPriceZAR || route.totalPriceZAR || route.totalPrice || 0;
            return price <= maxPriceZAR;
        });
    }
}

module.exports = new PriceNormalizer();
