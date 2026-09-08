import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseListingPage } from '../src/parsers/listing.js';

// End-to-end runs of src/main.ts (SDK + HTTP mocked) on the NOTICES register
// across several days, proving the walk watermark: a delta run that stops at
// maxItemsPerDataset - or cannot store every candidate (spending limit) -
// leaves a backlog UNDER the records it delivered, and the next run must walk
// past those known pages down to it instead of early-stopping at page 2.

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const fx = (name: string): string => readFileSync(`${fixturesDir}/${name}`, 'utf-8');
const DNN_P1 = fx('notice_list_dnn_page1.html');
const PAST_END = fx('notice_list_past_end.html');
const DETAIL = fx('notice_detail_315474881_complied.html');

const fixtureIds = parseListingPage(cheerio.load(DNN_P1), 'notices').rows.map((r) => r.id);
function noticePage(ids: readonly string[]): string {
    let html = DNN_P1;
    fixtureIds.forEach((old, i) => {
        html = html.replaceAll(old, ids[i]);
    });
    return html;
}
function tenIdsFrom(top: number): string[] {
    return Array.from({ length: 10 }, (_v, i) => String(top - i));
}

// Entry order (newest first). The register starts as [B1, B2, OLDER]; later
// days prepend blocks of new notices. B1+B2 become the cold baseline (two
// full pages: the early-stop needs two consecutive known pages to protect
// what lies below), OLDER is the pre-baseline region that is never delivered.
const B1 = tenIdsFrom(916000100);
const B2 = tenIdsFrom(916000090);
const OLDER = tenIdsFrom(916000080);
const NEW_P1 = tenIdsFrom(916000230);
const NEW_P2 = tenIdsFrom(916000220);
const NEW_P3 = tenIdsFrom(916000210);
let registerPages: string[][] = [B1, B2, OLDER];

const kv = new Map<string, unknown>();
let pushed: Record<string, unknown>[] = [];
let failMessage: string | null = null;
let chargeLimit = Number.POSITIVE_INFINITY;
/** When set, the first push throws (a platform failure) after recording the persisted watermark. */
let crashOnPush = false;
let floorAtCrash: string | null | undefined;
const input: Record<string, unknown> = {
    datasets: ['notices'],
    maxItemsPerDataset: 100,
    fetchDetail: true,
    fetchBreachDetail: false,
    fetchPartyDetail: false,
    onlyNew: true,
    recheckDays: 0,
};

vi.mock('apify', () => {
    const store = {
        getValue: async (key: string) => kv.get(key) ?? null,
        setValue: async (key: string, value: unknown) => {
            kv.set(key, JSON.parse(JSON.stringify(value)));
        },
    };
    const noop = (): void => {};
    return {
        log: { info: noop, warning: noop, debug: noop, error: noop, exception: noop },
        Actor: {
            init: async () => {},
            exit: async () => {},
            fail: async (message: string) => {
                failMessage = message;
            },
            getInput: async () => input,
            openKeyValueStore: async () => store,
            setValue: async (key: string, value: unknown) => {
                kv.set(`default:${key}`, JSON.parse(JSON.stringify(value)));
            },
            setStatusMessage: async () => {},
            on: noop,
            off: noop,
            getChargingManager: () => ({ getPricingInfo: () => ({ isPayPerEvent: true }) }),
            pushData: async (items: Record<string, unknown>[]) => {
                if (crashOnPush) {
                    floorAtCrash = (kv.get('state') as { backlogFloor: { notices: string | null } }).backlogFloor
                        .notices;
                    throw new Error('simulated platform failure');
                }
                const room = Math.max(0, chargeLimit - pushed.length);
                const stored = items.slice(0, room);
                pushed.push(...stored);
                return {
                    chargedCount: stored.length,
                    eventChargeLimitReached: pushed.length >= chargeLimit,
                    chargeableWithinLimit: {},
                };
            },
        },
    };
});

vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    fetchWithRetry: async (path: string) => {
        const page = Number(new URL(`https://x${path}`).searchParams.get('PN'));
        const ids = registerPages[page - 1];
        return ids ? noticePage(ids) : PAST_END;
    },
    fetchOptional: async () => DETAIL,
}));

interface State {
    seen: { notices: Record<string, { h: string | null }> };
    backlogFloor: { notices: string | null };
}
interface Output {
    delivered: number;
    stopReason: { notices: string };
    pagesWalked: { notices: number };
    backlogFloor: { notices: string | null };
    chargeLimitReached: boolean;
}

async function runOn(day: string): Promise<{ state: State; output: Output; ids: string[] }> {
    pushed = [];
    failMessage = null;
    vi.setSystemTime(new Date(`${day}T12:00:00.000Z`));
    vi.resetModules();
    await import('../src/main.js');
    expect(failMessage).toBeNull();
    return {
        state: kv.get('state') as State,
        output: kv.get('default:OUTPUT') as Output,
        ids: pushed.map((r) => r.noticeNumber as string),
    };
}

describe('main.ts walk watermark on the notices register', () => {
    beforeAll(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterAll(() => {
        vi.useRealTimers();
    });

    it('day 1 (cold): the newest records up to the cap are the baseline - no watermark', async () => {
        input.maxItemsPerDataset = 20;
        const day1 = await runOn('2026-09-07');
        expect(day1.ids).toEqual([...B1, ...B2].reverse()); // oldest-first delivery of the 20 newest
        expect(day1.output.stopReason.notices).toBe('max-items');
        expect(day1.state.backlogFloor.notices).toBeNull(); // below the cold cap is deliberately pre-baseline
        expect(Object.keys(day1.state.seen.notices).length).toBe(20);
    });

    it('day 2: 30 new notices, cap 20 -> the 20 newest are delivered and the stop id becomes the watermark', async () => {
        registerPages = [NEW_P1, NEW_P2, NEW_P3, B1, B2, OLDER];
        input.maxItemsPerDataset = 20;
        const day2 = await runOn('2026-09-08');
        expect(day2.ids).toEqual([...NEW_P1, ...NEW_P2].reverse());
        expect(day2.output.stopReason.notices).toBe('max-items');
        expect(day2.output.backlogFloor.notices).toBe(NEW_P3[0]);
        expect(day2.state.backlogFloor.notices).toBe(NEW_P3[0]);
    });

    it('day 3: the walk passes the two known pages, delivers the 10 stranded notices and clears the watermark', async () => {
        input.maxItemsPerDataset = 100;
        const day3 = await runOn('2026-09-09');
        expect(day3.ids).toEqual([...NEW_P3].reverse());
        expect(day3.output.stopReason.notices).toBe('delta-early-stop');
        expect(day3.output.pagesWalked.notices).toBe(5); // 2 known, the backlog page, then B1 + B2 known below the floor
        expect(day3.state.backlogFloor.notices).toBeNull();
        // The pre-baseline notices below the cold cap are still not delivered - by design.
        expect(day3.ids).not.toContain(OLDER[0]);
    });

    it('day 4: nothing new -> ordinary early-stop after two known pages', async () => {
        const day4 = await runOn('2026-09-10');
        expect(day4.ids).toEqual([]);
        expect(day4.output.stopReason.notices).toBe('delta-early-stop');
        expect(day4.output.pagesWalked.notices).toBe(2);
    });

    it('a spending limit while filling a hole under known pages leaves a watermark at the lowest unstored candidate', async () => {
        // Back to the state after day 2 (NEW_P3 unseen under two known pages, watermark at its top),
        // and allow only 4 records to be charged.
        const state = kv.get('state') as State;
        for (const id of NEW_P3) delete state.seen.notices[id];
        state.backlogFloor.notices = NEW_P3[0];
        kv.set('state', state);
        chargeLimit = 4;
        const day5 = await runOn('2026-09-11');
        expect(day5.output.chargeLimitReached).toBe(true);
        expect(day5.ids).toEqual([...NEW_P3.slice(6)].reverse()); // the 4 OLDEST of the hole
        expect(day5.state.backlogFloor.notices).toBe(NEW_P3[5]); // lowest candidate not stored
        for (const id of NEW_P3.slice(0, 6)) expect(day5.state.seen.notices[id]).toBeUndefined();

        chargeLimit = Number.POSITIVE_INFINITY;
        const day6 = await runOn('2026-09-12');
        expect(day6.ids).toEqual([...NEW_P3.slice(0, 6)].reverse());
        expect(day6.state.backlogFloor.notices).toBeNull();
        expect(day6.output.stopReason.notices).toBe('delta-early-stop');
    });

    it('the provisional watermark is persisted BEFORE delivery so a crash mid-run cannot strand the candidates', async () => {
        const state = kv.get('state') as State;
        for (const id of NEW_P3) delete state.seen.notices[id];
        state.backlogFloor.notices = NEW_P3[0];
        kv.set('state', state);
        // Delivery dies on the very first push (a platform failure, not a site error).
        crashOnPush = true;
        pushed = [];
        failMessage = null;
        vi.setSystemTime(new Date('2026-09-13T12:00:00.000Z'));
        vi.resetModules();
        await import('../src/main.js');
        crashOnPush = false;
        expect(failMessage).toMatch(/simulated platform failure/);
        expect(floorAtCrash).toBe(NEW_P3[9]); // lowest candidate, written before the first push
        expect((kv.get('state') as State).backlogFloor.notices).toBe(NEW_P3[9]);
        for (const id of NEW_P3) expect((kv.get('state') as State).seen.notices[id]).toBeUndefined();

        // The next run recovers the whole hole.
        const day8 = await runOn('2026-09-14');
        expect(day8.ids).toEqual([...NEW_P3].reverse());
        expect(day8.state.backlogFloor.notices).toBeNull();
    });
});
