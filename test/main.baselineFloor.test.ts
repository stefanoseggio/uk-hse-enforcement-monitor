import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseListingPage } from '../src/parsers/listing.js';

// End-to-end runs of src/main.ts (SDK + HTTP mocked) on the NOTICES register
// across several days, proving the BASELINE: the first (cold) delta run cut
// short by maxItemsPerDataset defines what counts as history. The records
// below the oldest one it delivered are never delivered by later delta runs
// - whatever the cap, even one far below two listing pages - while a
// NON-cold capped run still leaves a walk watermark (backlog) that the next
// run drains. Companion of test/main.backlogFloor.test.ts.

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
/** `count` descending notice numbers starting at `top` (entry order, newest first). */
function idsFrom(top: number, count: number): string[] {
    return Array.from({ length: count }, (_v, i) => String(top - i));
}
/** The register as pages of 10 in entry order (a short last page is padded - the fixture needs 10 ids). */
function pagesOf(ids: readonly string[]): string[][] {
    const pages: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) pages.push(ids.slice(i, i + 10));
    return pages;
}

// A 30-row register at the start; later days prepend new entries.
const REGISTER = idsFrom(916000130, 30);
let register: string[] = [...REGISTER];

const kv = new Map<string, unknown>();
let pushed: Record<string, unknown>[] = [];
let failMessage: string | null = null;
const input: Record<string, unknown> = {
    datasets: ['notices'],
    maxItemsPerDataset: 4,
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
                pushed.push(...items);
                return { chargedCount: items.length, eventChargeLimitReached: false, chargeableWithinLimit: {} };
            },
        },
    };
});

vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    fetchWithRetry: async (path: string) => {
        const page = Number(new URL(`https://x${path}`).searchParams.get('PN'));
        const ids = pagesOf(register)[page - 1];
        if (!ids) return PAST_END;
        // The fixture carries 10 rows; a short last page repeats its own ids
        // (walkListing de-duplicates ids it has already walked).
        return noticePage(Array.from({ length: 10 }, (_v, i) => ids[i % ids.length]));
    },
    fetchOptional: async () => DETAIL,
}));

interface State {
    seen: { notices: Record<string, { h: string | null; o: boolean }> };
    backlogFloor: { notices: string | null };
    baselineFloor: { notices: string | null };
    lastRunAt: string | null;
}
interface Output {
    delivered: number;
    stopReason: { notices: string };
    pagesWalked: { notices: number };
    backlogFloor: { notices: string | null };
    baselineFloor: { notices: string | null };
    truncatedByMaxItems: boolean;
    excluded: Record<string, number>;
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

describe('main.ts baseline: a cold delta run cut short by the cap defines what is history', () => {
    beforeAll(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterAll(() => {
        vi.useRealTimers();
    });

    const TOP4 = REGISTER.slice(0, 4);
    const OLDER26 = REGISTER.slice(4);

    it('run 1 (cold, cap 4 on 30 rows): delivers the 4 newest and persists their oldest id as the baseline - no backlog floor', async () => {
        const run1 = await runOn('2026-09-07');
        expect(run1.ids).toEqual([...TOP4].reverse()); // oldest-first delivery
        expect(run1.output.stopReason.notices).toBe('max-items');
        expect(run1.output.truncatedByMaxItems).toBe(true);
        expect(run1.state.baselineFloor.notices).toBe(TOP4[3]);
        expect(run1.output.baselineFloor.notices).toBe(TOP4[3]);
        expect(run1.state.backlogFloor.notices).toBeNull();
        expect(run1.state.lastRunAt).not.toBeNull();
        expect(Object.keys(run1.state.seen.notices).sort()).toEqual([...TOP4].sort());
    });

    it('run 2 (nothing new): delivers 0 - the 26 older rows are history, not a backlog to drain', async () => {
        const run2 = await runOn('2026-09-08');
        expect(run2.ids).toEqual([]);
        expect(run2.output.truncatedByMaxItems).toBe(false);
        expect(run2.output.stopReason.notices).toBe('delta-early-stop');
        // Page 1 = 4 known + 6 history, page 2 = history: two pages with nothing unseen.
        expect(run2.output.pagesWalked.notices).toBe(2);
        expect(run2.output.excluded.baseline).toBe(16);
        expect(run2.output.excluded.known).toBe(4);
        expect(run2.state.baselineFloor.notices).toBe(TOP4[3]);
        expect(run2.state.backlogFloor.notices).toBeNull();
        // History rows are remembered as known (no hash: never re-checked), so nothing is walked twice.
        for (const id of REGISTER.slice(4, 20))
            expect(run2.state.seen.notices[id]).toMatchObject({ h: null, o: false });
    });

    it('run 3: only entries above the baseline are delivered, never the older rows', async () => {
        const NEW3 = idsFrom(916000140, 3);
        register = [...NEW3, ...REGISTER];
        const run3 = await runOn('2026-09-09');
        expect(run3.ids).toEqual([...NEW3].reverse());
        expect(run3.output.truncatedByMaxItems).toBe(false);
        expect(run3.output.stopReason.notices).toBe('delta-early-stop');
        for (const id of OLDER26) expect(run3.ids).not.toContain(id);
        expect(run3.state.baselineFloor.notices).toBe(TOP4[3]); // never moves
        expect(run3.state.backlogFloor.notices).toBeNull();
    });

    it('a NON-cold capped run still records a backlog floor, and the next run drains it - still never the history', async () => {
        const NEW30 = idsFrom(916000230, 30);
        register = [...NEW30, ...register];
        input.maxItemsPerDataset = 4;
        const run4 = await runOn('2026-09-10');
        expect(run4.ids).toEqual([...NEW30.slice(0, 4)].reverse());
        expect(run4.output.stopReason.notices).toBe('max-items');
        expect(run4.output.truncatedByMaxItems).toBe(true);
        expect(run4.state.backlogFloor.notices).toBe(NEW30[4]); // the first record the walk did not take
        expect(run4.state.baselineFloor.notices).toBe(TOP4[3]); // untouched

        input.maxItemsPerDataset = 100;
        const run5 = await runOn('2026-09-11');
        expect(run5.ids).toEqual([...NEW30.slice(4)].reverse());
        expect(run5.state.backlogFloor.notices).toBeNull(); // backlog delivered -> watermark cleared
        expect(run5.state.baselineFloor.notices).toBe(TOP4[3]);
        for (const id of OLDER26) expect(run5.ids).not.toContain(id);

        const run6 = await runOn('2026-09-12');
        expect(run6.ids).toEqual([]);
        expect(run6.output.stopReason.notices).toBe('delta-early-stop');
        expect(run6.output.pagesWalked.notices).toBe(2);
    });

    it('a cold run that walks the whole register sets no baseline (nothing is history)', async () => {
        input.resetState = true;
        input.maxItemsPerDataset = 1000;
        const run7 = await runOn('2026-09-13');
        expect(run7.ids.length).toBe(register.length);
        expect(run7.state.baselineFloor.notices).toBeNull();
        expect(run7.state.backlogFloor.notices).toBeNull();
        input.resetState = false;
    });

    it('resetState clears the baseline, and a full run (onlyNew=false) ignores it', async () => {
        input.resetState = true;
        input.maxItemsPerDataset = 4;
        const run8 = await runOn('2026-09-14');
        expect(run8.state.baselineFloor.notices).toBe(register[3]);
        input.resetState = false;
        input.onlyNew = false;
        input.maxItemsPerDataset = 1000;
        const run9 = await runOn('2026-09-15');
        expect(run9.ids.length).toBe(register.length); // history included
        expect(run9.state.baselineFloor.notices).toBe(register[3]); // a full run neither uses nor clears it
        input.onlyNew = true;
    });
});
