import { describe, expect, it } from 'vitest';

import { isWithinDateRange, parseUkDate } from '../src/dateFilter.js';

describe('parseUkDate', () => {
    it('parses a real DD/MM/YYYY value', () => {
        const date = parseUkDate('26/09/2025');
        expect(date?.toISOString()).toBe('2025-09-26T00:00:00.000Z');
    });

    it('returns null for null/empty/malformed input', () => {
        expect(parseUkDate(null)).toBeNull();
        expect(parseUkDate('')).toBeNull();
        expect(parseUkDate('2025-09-26')).toBeNull();
        expect(parseUkDate('not a date')).toBeNull();
    });
});

describe('isWithinDateRange', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');

    it('always passes when no preset is given', () => {
        expect(isWithinDateRange(null, undefined, now)).toBe(true);
        expect(isWithinDateRange(parseUkDate('01/01/2000'), undefined, now)).toBe(true);
    });

    it('rejects a null date when a preset is given', () => {
        expect(isWithinDateRange(null, '24h', now)).toBe(false);
    });

    it('correctly buckets a date at each preset boundary', () => {
        const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        expect(isWithinDateRange(twelveHoursAgo, '24h', now)).toBe(true);
        expect(isWithinDateRange(threeDaysAgo, '24h', now)).toBe(false);

        expect(isWithinDateRange(threeDaysAgo, '7d', now)).toBe(true);
        expect(isWithinDateRange(twentyDaysAgo, '7d', now)).toBe(false);

        expect(isWithinDateRange(twentyDaysAgo, '30d', now)).toBe(true);
        expect(isWithinDateRange(sixtyDaysAgo, '30d', now)).toBe(false);
    });
});
