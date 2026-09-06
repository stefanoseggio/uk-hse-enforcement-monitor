import { describe, expect, it } from 'vitest';

import { fetchConvictions } from '../src/fetchConvictions.js';
import { fetchNotices } from '../src/fetchNotices.js';

// Live checks against the real HSE registers - skipped in CI (same lesson
// as every other actor in this portfolio: don't make CI depend on an
// external host with no uptime guarantee).
describe.skipIf(process.env.CI)('live fetchConvictions + fetchNotices against the real HSE site', () => {
    it('fetches real convictions with breach detail, newest first', async () => {
        const records = await fetchConvictions(3, true);
        expect(records.length).toBe(3);
        for (const record of records) {
            expect(record.recordType).toBe('conviction');
            expect(record.caseNumber).toMatch(/^\d+$/);
            expect(record.defendantName).toBeTruthy();
            expect(record.scrapedAt).toBeTruthy();
        }
        // at least one of the 3 newest cases should have a resolved breach
        expect(records.some((r) => r.breaches.some((b) => b.act))).toBe(true);
    }, 60_000);

    it('fetches real convictions without breach detail (fast path)', async () => {
        const records = await fetchConvictions(2, false);
        expect(records.length).toBe(2);
        for (const record of records) {
            for (const breach of record.breaches) {
                expect(breach.act).toBeNull();
                expect(breach.breachId).toBeTruthy();
            }
        }
    }, 30_000);

    it('paginates across multiple listing pages when maxItemsPerDataset exceeds one page', async () => {
        const records = await fetchConvictions(15, false);
        expect(records.length).toBeGreaterThan(10); // proves it advanced past the 10-item page size
        const ids = records.map((r) => r.caseNumber);
        expect(new Set(ids).size).toBe(ids.length); // no duplicates across pages
    }, 60_000);

    it('fetches real enforcement notices with breach detail, newest first', async () => {
        const records = await fetchNotices(3, true);
        expect(records.length).toBe(3);
        for (const record of records) {
            expect(record.recordType).toBe('notice');
            expect(record.noticeNumber).toMatch(/^\d+$/);
            expect(record.recipientName).toBeTruthy();
            expect(record.noticeType).toBeTruthy();
        }
        expect(records.some((r) => r.breaches.length > 0)).toBe(true);
    }, 60_000);
});
