import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it, vi } from 'vitest';

import { parseListingPage } from '../src/parsers/listing.js';

// Unit test of Delivery.deliver: the delivery cap is honoured batch by batch,
// and when the cap is NOT a multiple of the batch size (15) the queue's tail
// must still be reported as truncated - the offset advances by what each
// batch actually took, not by the nominal batch size.

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const DNN_P1 = readFileSync(`${fixturesDir}/notice_list_dnn_page1.html`, 'utf-8');
const NOTICE_DETAIL_HTML = readFileSync(`${fixturesDir}/notice_detail_315474881_complied.html`, 'utf-8');

const pushed: Record<string, unknown>[] = [];
const warnings: string[] = [];
vi.mock('apify', () => ({
    log: {
        info: (): void => {},
        warning: (message: string): void => {
            warnings.push(message);
        },
        debug: (): void => {},
        error: (): void => {},
        exception: (): void => {},
    },
    Actor: {
        on: (): void => {},
        off: (): void => {},
        openKeyValueStore: async () => ({ getValue: async () => null, setValue: async () => {} }),
        getChargingManager: () => ({ getPricingInfo: () => ({ isPayPerEvent: true }) }),
        pushData: async (items: Record<string, unknown>[]) => {
            pushed.push(...items);
            return { chargedCount: items.length, eventChargeLimitReached: false, chargeableWithinLimit: {} };
        },
    },
}));

// Ids whose detail page "does not exist" (the site's unknown-id 500 -> null
// from fetchOptional), used by the cumulative-outage-guard test below.
const badDetailIds = new Set<string>();
vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    fetchOptional: async (path: string) => {
        const id = path.match(/SV=(\d+)/)?.[1] ?? '';
        return badDetailIds.has(id) ? null : NOTICE_DETAIL_HTML;
    },
}));

const { Delivery, DELIVERY_BATCH_SIZE } = await import('../src/delivery.js');
const { resolveInput } = await import('../src/input.js');
const { emptyState } = await import('../src/state.js');
const { structuralEventType, parseDetailPage, assertNotFoundWithinBounds } = await import('../src/fetchRecords.js');
type Candidate = import('../src/fetchRecords.js').Candidate;

const rows = parseListingPage(cheerio.load(DNN_P1), 'notices').rows;
/** `count` new listing-only candidates in walk order (newest first), cloned from the real fixture rows. */
function candidates(count: number): Candidate[] {
    return Array.from({ length: count }, (_v, i) => {
        const id = String(916000200 - i);
        return {
            register: 'notices' as const,
            id,
            row: { ...rows[i % rows.length], id },
            eventType: structuralEventType('notices'),
            isNew: true,
            excludedBy: null,
            prior: null,
            detail: null,
        };
    });
}

// A real, already-parsed detail page, reused as the `detail` of "pre-fetched"
// filler candidates below (as an UPDATED candidate arrives from the re-check
// pass): enrichCandidate skips fetchDetailFor entirely when `detail` is
// already set, so these never count towards the outage guard's `attempted`.
const PREFETCHED_DETAIL = parseDetailPage(cheerio.load(NOTICE_DETAIL_HTML), 'notices');

/**
 * One batch's worth of candidates: `prefetchedCount` already-has-detail
 * fillers (never counted in the outage guard's `attempted`) followed by
 * `2*badCount + 1` new candidates in the pattern good, bad, good, bad, ...,
 * good - so failures are never adjacent to each other or to the batch's
 * edges, and no single batch's failures can chain into a 5-streak. The mock
 * ids are unique per call via `idStart`.
 */
function outageBatch(idStart: number, prefetchedCount: number, badCount: number): Candidate[] {
    let n = idStart;
    const nextId = (): string => String(n++);
    const prefetched: Candidate[] = Array.from({ length: prefetchedCount }, () => ({
        register: 'notices' as const,
        id: nextId(),
        row: null,
        eventType: 'UPDATED' as const,
        isNew: false,
        excludedBy: null,
        prior: null,
        detail: PREFETCHED_DETAIL,
    }));
    const fresh: Candidate[] = Array.from({ length: 2 * badCount + 1 }, (_v, i) => {
        const id = nextId();
        if (i % 2 === 1) badDetailIds.add(id); // odd positions: bad, good, bad, good, ... interleaved
        return {
            register: 'notices' as const,
            id,
            row: { ...rows[i % rows.length], id },
            eventType: structuralEventType('notices'),
            isNew: true,
            excludedBy: null,
            prior: null,
            detail: null,
        };
    });
    return [...prefetched, ...fresh];
}

describe('Delivery.deliver and the delivery cap', () => {
    it('queue 25, cap 20 (not a multiple of the batch size): stores exactly 20 and reports the 5 left as truncated', async () => {
        expect(20 % DELIVERY_BATCH_SIZE).not.toBe(0);
        const now = new Date('2026-09-07T12:00:00.000Z');
        const { options } = resolveInput(
            { datasets: ['notices'], onlyNew: true, fetchDetail: false, maxItemsPerDataset: 20 },
            now,
        );
        const state = emptyState(null);
        const delivery = new Delivery(state, 'test-store', now.toISOString(), options, now);
        const queue = candidates(25);
        const outcome = await delivery.deliver('notices', queue, 20);

        expect(outcome.count).toBe(20);
        expect(pushed.length).toBe(20);
        expect(outcome.truncatedByMaxItems).toBe(true);
        expect(outcome.unstoredNewIds).toEqual(queue.slice(20).map((c) => c.id));
        expect(Object.keys(state.seen.notices).length).toBe(20);
        for (const c of queue.slice(20)) expect(state.seen.notices[c.id]).toBeUndefined();
        expect(warnings.some((w) => /maxItemsPerDataset=20 reached - 5 record\(s\) left undelivered/.test(w))).toBe(
            true,
        );
        expect(delivery.chargeLimitReached).toBe(false);
        await delivery.close();
    });

    it('a queue that fits under the cap is not truncated', async () => {
        pushed.length = 0;
        const now = new Date('2026-09-07T12:00:00.000Z');
        const { options } = resolveInput(
            { datasets: ['notices'], onlyNew: true, fetchDetail: false, maxItemsPerDataset: 20 },
            now,
        );
        const delivery = new Delivery(emptyState(null), 'test-store', now.toISOString(), options, now);
        const outcome = await delivery.deliver('notices', candidates(20), 20);
        expect(outcome.count).toBe(20);
        expect(outcome.truncatedByMaxItems).toBe(false);
        expect(outcome.unstoredNewIds).toEqual([]);
        await delivery.close();
    });
});

describe('Delivery.deliver outage guard: attempted/failed accumulate across the whole queue', () => {
    it('a sustained failure rate that stays under the per-batch sample threshold in every batch still trips the cumulative check', async () => {
        pushed.length = 0;
        warnings.length = 0;
        badDetailIds.clear();
        const now = new Date('2026-09-07T12:00:00.000Z');
        const { options } = resolveInput(
            {
                datasets: ['notices'],
                onlyNew: true,
                fetchDetail: true,
                fetchBreachDetail: false,
                fetchPartyDetail: false,
                maxItemsPerDataset: 30,
            },
            now,
        );
        const delivery = new Delivery(emptyState(null), 'test-store', now.toISOString(), options, now);
        // Each batch: 6 pre-fetched fillers (excluded from "attempted") + 9 new
        // fetches, 4 of which fail (44% of the 9, but 9 < minSample=10, so
        // neither batch alone reaches the 10-sample ratio check or a 5-streak).
        const batch1 = outageBatch(100, 6, 4);
        const batch2 = outageBatch(200, 6, 4);
        expect(batch1.length).toBe(DELIVERY_BATCH_SIZE);
        expect(batch2.length).toBe(DELIVERY_BATCH_SIZE);
        // Confirms neither batch trips in isolation (the bug this test guards against).
        expect(() => assertNotFoundWithinBounds('notices', 9, 4, 1, 'detail fetch')).not.toThrow();

        const queue = [...batch1, ...batch2];
        await expect(delivery.deliver('notices', queue, 30)).rejects.toThrow(
            /detail fetch \(run total\).*8 of 18.*site outage/,
        );
        // Batch 1 (9 attempted, 4 failed - below minSample either way) was
        // delivered in full before batch 2's cumulative total (18 attempted,
        // 8 failed = 44%) tripped the guard: 6 pre-fetched + 5 good of batch 1.
        expect(pushed.length).toBe(11);
        await delivery.close();
    });
});
