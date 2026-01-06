const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

class Helpers {
    static generateRouteId(segments) {
        if (!segments || segments.length === 0) return uuidv4();
        const segmentStrings = segments.map(s => 
            `${s.airline || ''}_${s.flightNumber || ''}_${s.from}_${s.to}`
        ).join('_');
        return Buffer.from(segmentStrings).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    }

    static formatDuration(minutes) {
        if (!minutes || minutes < 0) return 'N/A';
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours === 0) return `${mins}m`;
        if (mins === 0) return `${hours}h`;
        return `${hours}h ${mins}m`;
    }

    static formatDate(date, format = 'DD MMM YYYY') {
        if (!date) return 'N/A';
        return moment(date).format(format);
    }

    static formatPrice(amount, currency = 'ZAR') {
        if (typeof amount !== 'number' || isNaN(amount)) return 'N/A';
        const symbol = currency === 'ZAR' ? 'R' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency;
        return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }

    static parseNaturalDate(text) {
        if (!text) return moment().format('YYYY-MM-DD');
        const lowerText = text.toLowerCase();
        const today = moment();
        
        if (lowerText.includes('today')) return today.format('YYYY-MM-DD');
        if (lowerText.includes('tomorrow')) return today.add(1, 'days').format('YYYY-MM-DD');
        if (lowerText.includes('next week')) return today.add(7, 'days').format('YYYY-MM-DD');
        
        const parsed = moment(lowerText, ['YYYY-MM-DD', 'DD-MM-YYYY', 'MM/DD/YYYY']);
        return parsed.isValid() ? parsed.format('YYYY-MM-DD') : today.add(7, 'days').format('YYYY-MM-DD');
    }

    static extractAirportCode(text) {
        if (!text) return null;
        if (/^[A-Z]{3}$/.test(text.trim().toUpperCase())) return text.trim().toUpperCase();
        return null;
    }

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (attempt === maxRetries - 1) throw error;
                const delay = baseDelay * Math.pow(2, attempt);
                await this.sleep(delay);
            }
        }
    }

    static generateCacheKey(params) {
        const { from, to, date, returnDate, passengers, currency } = params;
        return `search:${from}:${to}:${date}:${returnDate || 'oneway'}:${passengers || 1}:${currency || 'ZAR'}`;
    }
}

module.exports = Helpers;
