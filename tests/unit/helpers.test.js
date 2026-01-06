const Helpers = require('../../src/utils/helpers');

describe('Helpers', () => {
    test('formatDuration formats correctly', () => {
        expect(Helpers.formatDuration(90)).toBe('1h 30m');
        expect(Helpers.formatDuration(60)).toBe('1h');
        expect(Helpers.formatDuration(45)).toBe('45m');
    });
    
    test('extractAirportCode extracts IATA codes', () => {
        expect(Helpers.extractAirportCode('JNB')).toBe('JNB');
        expect(Helpers.extractAirportCode('cpt')).toBe('CPT');
        expect(Helpers.extractAirportCode('not code')).toBe(null);
    });
});
