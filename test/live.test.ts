import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { detailContentHash, fetchDetailFor, fetchRecords, recheckKnown } from '../src/fetchRecords.js';
import { fetchWithRetry } from '../src/http.js';
import { resolveInput } from '../src/input.js';
import { parseListingPage } from '../src/parsers/listing.js';
import type { ActorInput, DatasetName } from '../src/types.js';
import { listingPath } from '../src/urls.js';

// Live checks against the real HSE registers. Opt-in (npm run test:live)
// so a developer's routine `npm test` and CI never depend on an external host.
const NOW = new Date();

function run(register: DatasetName, input: ActorInput) {
    const { queries, options } = resolveInput(input, NOW);
    return fetchRecords({
        query: queries[register],
        maxItems: options.maxItems,
        onlyNew: options.onlyNew,
        seen: {},
        eventTypes: options.eventTypes,
        fullWalk: register === 'convictions',
        fetchDetail: options.fetchDetail,
        fetchBreachDetail: options.fetchBreachDetail,
        fetchPartyDetail: options.fetchPartyDetail,
        maxConcurrency: options.maxConcurrency,
        now: NOW,
    });
}

describe.skipIf(!process.env.LIVE)('live HSE register integration', () => {
    it('convictions: the newest cases (case-number order) with breaches, court, party status and repeat count', async () => {
        const { records, walk } = await run('convictions', { maxItemsPerDataset: 3 });
        expect(records.length).toBe(3);
        expect(walk.totalMatching).toBeGreaterThan(100);
        for (const r of records) {
            if (r.recordType !== 'conviction') throw new Error('expected a conviction');
            expect(r.caseNumber).toMatch(/^\d+$/);
            expect(r.defendantName).toBeTruthy();
            expect(r.offenceDateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(r.detailFetched).toBe(true);
            expect(r.breachDetailFetched).toBe(true);
            expect(r.breaches.length).toBeGreaterThan(0);
            expect(r.breaches.every((b) => b.legislation)).toBe(true);
            expect(r.contentHash).toMatch(/^[0-9a-f]{16}$/);
            expect(r.partyDetailFetched).toBe(true);
            expect(r.partyStatus).toBeTruthy();
            expect(r.partyConvictionCount).toBeGreaterThanOrEqual(1);
            expect(typeof r.isRepeatOffender).toBe('boolean');
            expect(r.event_type).toBe('SANCTION');
        }
        expect(records.some((r) => r.recordType === 'conviction' && (r.totalFineGbp ?? 0) > 0)).toBe(true);
        expect(records.some((r) => r.recordType === 'conviction' && r.breaches.some((b) => b.court))).toBe(true);
    }, 120_000);

    it('notices: the most recently entered notices (notice-number order) with served date and breaches', async () => {
        const { records, walk } = await run('notices', { maxItemsPerDataset: 3 });
        expect(records.length).toBe(3);
        expect(walk.totalMatching).toBeGreaterThan(10_000);
        for (const r of records) {
            if (r.recordType !== 'notice') throw new Error('expected a notice');
            expect(r.noticeNumber).toMatch(/^\d{9}$/);
            expect(r.recipientName).toBeTruthy();
            expect(r.noticeType).toBeTruthy();
            expect(r.servedDateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(r.noticeCategory).toMatch(/^(Improvement|Prohibition)$/);
            expect(r.event_type).toBe('NEW_LISTING');
            expect(r.detailFetched).toBe(true);
        }
        expect(records.some((r) => r.recordType === 'notice' && r.breaches.length > 0)).toBe(true);
    }, 120_000);

    it('server-side filters narrow the result (name + region on convictions) and every row matches', async () => {
        const { records, walk } = await run('convictions', {
            nameContains: 'Limited',
            region: '3',
            fetchDetail: false,
            maxItemsPerDataset: 50,
        });
        expect(walk.totalMatching).toBeGreaterThan(0);
        expect(walk.totalMatching).toBeLessThan(100);
        expect(records.length).toBe(walk.totalMatching);
        expect(
            records.every((r) => /limited/i.test(r.recordType === 'conviction' ? (r.defendantName ?? '') : '')),
        ).toBe(true);
        expect(new Set(records.map((r) => r.record_id)).size).toBe(records.length);
    }, 120_000);

    it('a date window is applied server-side and is inclusive', async () => {
        const { records, walk } = await run('convictions', {
            dateFrom: '2024-01-01',
            dateTo: '2024-12-31',
            fetchDetail: false,
            maxItemsPerDataset: 100,
        });
        expect(walk.totalMatching).toBeGreaterThan(0);
        expect(records.length).toBe(walk.totalMatching);
        for (const r of records) {
            if (r.recordType !== 'conviction') throw new Error('expected a conviction');
            expect(r.offenceDateIso! >= '2024-01-01' && r.offenceDateIso! <= '2024-12-31').toBe(true);
        }
    }, 120_000);

    it('notice types are a server-side IN filter joined ahead of a name filter', async () => {
        const { records, walk } = await run('notices', {
            noticeTypes: ['08'],
            nameContains: 'Ltd',
            fetchDetail: false,
            maxItemsPerDataset: 10,
        });
        expect(walk.totalMatching).toBeGreaterThan(100);
        expect(records.length).toBe(10);
        expect(records.every((r) => r.recordType === 'notice' && /Prohibition/i.test(r.noticeTypeListing ?? ''))).toBe(
            true,
        );
    }, 120_000);

    it('a zero-result query ends cleanly instead of being mistaken for a block', async () => {
        const { records, walk } = await run('notices', { nameContains: 'zzzzqqqqxxxx', fetchDetail: false });
        expect(records).toEqual([]);
        expect(walk.totalMatching).toBe(0);
        expect(walk.stopReason).toBe('end-of-results');
    }, 60_000);

    it('the SQL error page is detected as a non-listing (never "0 new")', async () => {
        const path = listingPath(
            { register: 'convictions', criteria: [{ sf: 'XYZ', sn: 'F', eo: '=', sv: '1' }], sort: 'DCN' },
            1,
        );
        const page = parseListingPage(cheerio.load(await fetchWithRetry(path)), 'convictions');
        expect(page.isErrorPage).toBe(true);
        expect(page.isListingPage).toBe(false);
    }, 60_000);

    it('re-check: an unchanged known notice is not an update, a stale hash is', async () => {
        const detail = await fetchDetailFor('notices', '315474881');
        expect(detail.detail).not.toBeNull();
        const hash = detailContentHash(detail.detail!);
        const seen = {
            '315474881': { h: hash, d: '2025-11-24', o: true, f: '2026-01-01', l: '2026-01-01' },
            '316005113': { h: 'stale', d: '2026-07-25', o: true, f: '2026-01-01', l: '2026-01-01' },
        };
        const result = await recheckKnown('notices', Object.keys(seen), seen, 2);
        expect(result.unchanged).toBe(1);
        expect(result.updated.map((c) => c.id)).toEqual(['316005113']);
        expect(result.vanished).toEqual([]);
    }, 60_000);

    it('an unknown record id is a missing record, not a run failure', async () => {
        const result = await fetchDetailFor('convictions', '1');
        expect(result.detail).toBeNull();
        expect(result.error).toBe('NOT_FOUND');
    }, 60_000);
});
