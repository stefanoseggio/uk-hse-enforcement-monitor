import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// End-to-end runs of src/main.ts (SDK + HTTP mocked) across several calendar
// days, proving the "missing detail page" policy: the site's unknown-id
// answer is a generic HTTP 500, indistinguishable from a transient error, so
//  - a NEW record whose page is missing is held back (not stored, NOT marked
//    seen) until it has been missing in MISSING_RUNS_BEFORE_STUB distinct
//    runs, then delivered as a listing-only stub;
//  - a KNOWN open record whose page is missing keeps being re-checked until
//    it has been missing in MISSING_RUNS_BEFORE_CLOSED distinct runs;
//  - a batch in which too many listed records "vanish" fails the run.

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const fx = (name: string): string => readFileSync(`${fixturesDir}/${name}`, 'utf-8');
const LISTING_PAGE1 = fx('conviction_list_dcn_page1.html');
const PAST_END = fx('conviction_list_past_end.html');
const CASE_PAGE = fx('conviction_detail_4849124_fatal_multibreach.html');
const BREACH_LIST = fx('conviction_breach_list_case_4849124.html');
const BREACH_PAGE = fx('conviction_breach_4763937001_prison_suspended.html');

const kv = new Map<string, unknown>();
let pushed: Record<string, unknown>[] = [];
let pushEvents: string[] = [];
let failMessage: string | null = null;
const missingIds = new Set<string>();
const input: Record<string, unknown> = {
    datasets: ['convictions'],
    maxItemsPerDataset: 3,
    fetchDetail: true,
    fetchBreachDetail: true,
    fetchPartyDetail: false,
    onlyNew: true,
    recheckDays: 365,
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
            pushData: async (items: Record<string, unknown>[], eventName: string) => {
                pushed.push(...items);
                pushEvents.push(...items.map(() => eventName));
                return { chargedCount: items.length, eventChargeLimitReached: false, chargeableWithinLimit: {} };
            },
        },
    };
});

vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    fetchWithRetry: async (path: string) => (path.includes('PN=1') ? LISTING_PAGE1 : PAST_END),
    fetchOptional: async (path: string) => {
        const id = path.match(/SV=(\d+)/)?.[1] ?? '';
        if (path.includes('breach_list.asp')) return missingIds.has(id) ? null : BREACH_LIST;
        if (path.includes('breach_details.asp')) return BREACH_PAGE;
        return missingIds.has(id) ? null : CASE_PAGE;
    },
}));

interface State {
    seen: { convictions: Record<string, { h: string | null; o: boolean; f: string; l: string }> };
    missing: { convictions: Record<string, { n: number; l: string }> };
}
interface Output {
    delivered: number;
    deferredMissingDetail: { convictions: number };
    rechecked: { convictions: number };
    recheckVanished: { convictions: number };
    recheckClosed: { convictions: number };
}

async function runOn(day: string): Promise<{ state: State; output: Output; pushed: Record<string, unknown>[] }> {
    pushed = [];
    pushEvents = [];
    failMessage = null;
    vi.setSystemTime(new Date(`${day}T12:00:00.000Z`));
    vi.resetModules();
    await import('../src/main.js');
    return { state: kv.get('state') as State, output: kv.get('default:OUTPUT') as Output, pushed };
}

// The 10 rows of the listing fixture in page (walk) order, newest first. With
// maxItemsPerDataset=3 the walk takes the first three unseen rows and delivery
// reverses them (oldest-first), so on a cold run HELD is delivered first.
const LISTING_IDS = [...LISTING_PAGE1.matchAll(/case_details\.asp\?SF=CN&amp;SV=(\d+)/g)].map((m) => m[1]);
const [NEWEST, SECOND, HELD] = LISTING_IDS;

describe('main.ts missing-detail policy (HTTP 500 = unknown id OR outage)', () => {
    beforeAll(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterAll(() => {
        vi.useRealTimers();
    });

    it('holds a new record back - not stored, not marked seen - while its page is missing, then stubs it after 3 runs', async () => {
        missingIds.add(HELD);

        const day1 = await runOn('2026-09-07');
        expect(failMessage).toBeNull();
        expect(day1.pushed.map((r) => r.caseNumber)).toEqual([SECOND, NEWEST]);
        expect(pushEvents.every((e) => e === 'result')).toBe(true);
        expect(day1.state.seen.convictions[HELD]).toBeUndefined();
        expect(day1.state.missing.convictions[HELD]).toEqual({ n: 1, l: '2026-09-07' });
        expect(day1.output.deferredMissingDetail.convictions).toBe(1);
        expect(day1.output.delivered).toBe(2);
        for (const id of [SECOND, NEWEST]) expect(day1.state.seen.convictions[id].h).toMatch(/^[0-9a-f]{16}$/);

        // A second run on the SAME day does not count as another miss.
        const day1b = await runOn('2026-09-07');
        expect(day1b.state.missing.convictions[HELD]).toEqual({ n: 1, l: '2026-09-07' });
        expect(day1b.state.seen.convictions[HELD]).toBeUndefined();

        const day2 = await runOn('2026-09-08');
        expect(day2.state.missing.convictions[HELD]).toEqual({ n: 2, l: '2026-09-08' });
        expect(day2.state.seen.convictions[HELD]).toBeUndefined();
        expect(day2.pushed.map((r) => r.caseNumber)).not.toContain(HELD);

        const day3 = await runOn('2026-09-09');
        expect(failMessage).toBeNull();
        const stub = day3.pushed.find((r) => r.caseNumber === HELD);
        expect(stub).toMatchObject({ detailFetched: false, detailError: 'NOT_FOUND', event_type: 'SANCTION' });
        expect(pushEvents[day3.pushed.indexOf(stub!)]).toBe('result-summary');
        expect(day3.state.seen.convictions[HELD]).toMatchObject({ h: null, o: false, f: '2026-09-09' });
        expect(day3.state.missing.convictions[HELD]).toBeUndefined();
        missingIds.clear();
    });

    it('a known open record whose page is missing stays re-checked for one more run, then is closed', async () => {
        // SECOND was delivered with a hash and is open (every conviction is), so it is re-checked.
        missingIds.add(SECOND);
        const day4 = await runOn('2026-09-10');
        expect(failMessage).toBeNull();
        expect(day4.output.rechecked.convictions).toBeGreaterThanOrEqual(2);
        expect(day4.output.recheckVanished.convictions).toBe(1);
        expect(day4.output.recheckClosed.convictions).toBe(0);
        expect(day4.state.seen.convictions[SECOND].o).toBe(true);
        expect(day4.state.missing.convictions[SECOND]).toEqual({ n: 1, l: '2026-09-10' });

        const day5 = await runOn('2026-09-11');
        expect(day5.output.recheckClosed.convictions).toBe(1);
        expect(day5.state.seen.convictions[SECOND].o).toBe(false);
        expect(day5.state.missing.convictions[SECOND]).toBeUndefined();

        // Read again -> its missing history is forgotten (a closed record is simply no longer re-checked).
        missingIds.clear();
        const day6 = await runOn('2026-09-12');
        expect(day6.state.missing.convictions).toEqual({});
        expect(day6.output.recheckVanished.convictions).toBe(0);
    });

    it('FAILS the run (nothing stored, nothing remembered) when the re-check finds every known record "vanished"', async () => {
        for (const id of LISTING_IDS) missingIds.add(id);
        const before = JSON.stringify(kv.get('state'));
        const day7 = await runOn('2026-09-13');
        expect(failMessage).toMatch(/re-check of known open records.*site outage/);
        expect(day7.pushed).toEqual([]);
        expect(JSON.stringify(kv.get('state'))).toBe(before);
    });

    it('FAILS the run when a delivery batch of new records "vanishes" at once (nothing stubbed, nothing deferred)', async () => {
        for (const id of LISTING_IDS) missingIds.add(id);
        input.resetState = true; // every row is new again
        input.recheckDays = 0; // no re-check pass: the delivery guard must catch it
        input.maxItemsPerDataset = 10;
        const before = JSON.stringify(kv.get('state'));
        const day8 = await runOn('2026-09-14');
        expect(failMessage).toMatch(/detail fetch.*10 of 10.*site outage/);
        expect(day8.pushed).toEqual([]);
        expect(JSON.stringify(kv.get('state'))).toBe(before);
        missingIds.clear();
    });
});
