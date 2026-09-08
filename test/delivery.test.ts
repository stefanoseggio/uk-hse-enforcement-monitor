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

const { Delivery, DELIVERY_BATCH_SIZE } = await import('../src/delivery.js');
const { resolveInput } = await import('../src/input.js');
const { emptyState } = await import('../src/state.js');
const { structuralEventType } = await import('../src/fetchRecords.js');
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
