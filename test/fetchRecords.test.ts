import { describe, expect, it } from 'vitest';

import { fetchConvictions } from '../src/fetchConvictions.js';
import { fetchNotices } from '../src/fetchNotices.js';

const NO_SEEN = new Set<string>();
const NOW = new Date('2026-09-06T12:00:00.000Z');

// Live checks against the real HSE registers - skipped in CI (same lesson
// as every other actor in this portfolio: don't make CI depend on an
// external host with no uptime guarantee).
describe.skipIf(process.env.CI)('live fetchConvictions + fetchNotices against the real HSE site', () => {
    it('fetches real convictions with breach detail, newest first', async () => {
        const { records } = await fetchConvictions(3, true, NO_SEEN, false, undefined, NOW);
        expect(records.length).toBe(3);
        for (const record of records) {
            expect(record.recordType).toBe('conviction');
            expect(record.caseNumber).toMatch(/^\d+$/);
            expect(record.defendantName).toBeTruthy();
            expect(record.scraped_at).toBeTruthy();
            expect(record.record_id).toBe(record.caseNumber);
            expect(record.event_type).toBe('SANCTION');
        }
        // at least one of the 3 newest cases should have a resolved breach
        expect(records.some((r) => r.breaches.some((b) => b.act))).toBe(true);
    }, 60_000);

    it('fetches real convictions without breach detail (fast path)', async () => {
        const { records } = await fetchConvictions(2, false, NO_SEEN, false, undefined, NOW);
        expect(records.length).toBe(2);
        for (const record of records) {
            for (const breach of record.breaches) {
                expect(breach.act).toBeNull();
                expect(breach.breachId).toBeTruthy();
            }
        }
    }, 30_000);

    it('paginates across multiple listing pages when maxItemsPerDataset exceeds one page', async () => {
        const { records } = await fetchConvictions(15, false, NO_SEEN, false, undefined, NOW);
        expect(records.length).toBeGreaterThan(10); // proves it advanced past the 10-item page size
        const ids = records.map((r) => r.caseNumber);
        expect(new Set(ids).size).toBe(ids.length); // no duplicates across pages
    }, 60_000);

    it('fetches real enforcement notices with breach detail, newest first', async () => {
        const { records } = await fetchNotices(3, true, NO_SEEN, false, undefined, NOW);
        expect(records.length).toBe(3);
        for (const record of records) {
            expect(record.recordType).toBe('notice');
            expect(record.noticeNumber).toMatch(/^\d+$/);
            expect(record.recipientName).toBeTruthy();
            expect(record.noticeType).toBeTruthy();
            expect(record.record_id).toBe(record.noticeNumber);
            expect(record.event_type).toBe('NEW_LISTING');
        }
        expect(records.some((r) => r.breaches.length > 0)).toBe(true);
    }, 60_000);

    it('marks every record is_new=true on a cold run (empty seen-set)', async () => {
        const { records } = await fetchConvictions(3, false, NO_SEEN, false, undefined, NOW);
        expect(records.every((r) => r.is_new)).toBe(true);
    }, 30_000);

    it('delta mode (onlyNew): once the top N ids are marked seen, a second run returns only what is genuinely new', async () => {
        // First pass: discover the real current top ids (acts as "yesterday's run").
        // maxItems is a clean multiple of the 10-item page size so allIdsThisRun
        // captures two FULL pages, not a partial page truncated mid-page by the
        // maxItems cutoff (a partial page would leave some of page 1's own ids
        // unmarked as seen, making the "nothing new" assertion below flaky by
        // construction rather than by real site activity).
        const first = await fetchConvictions(20, false, NO_SEEN, false, undefined, NOW);
        expect(first.allIdsThisRun.length).toBe(20);
        const seenFromFirstRun = new Set(first.allIdsThisRun);

        // Second pass simulating "today's run" against the identical live state:
        // nothing genuinely new exists between the two calls seconds apart, so
        // onlyNew should short-circuit to zero results very quickly (early-stop
        // pagination), not silently return old records relabeled.
        const second = await fetchConvictions(50, false, seenFromFirstRun, true, undefined, NOW);
        expect(second.records.length).toBe(0);
    }, 60_000);

    it('dateRange filtering excludes records whose Offence Date falls outside the window', async () => {
        const veryOld = new Date('2099-01-01T00:00:00.000Z'); // guarantees every real offence date is "more than 24h old" from this vantage
        const { records } = await fetchConvictions(5, false, NO_SEEN, false, '24h', veryOld);
        expect(records.length).toBe(0);
    }, 30_000);
});
