import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// End-to-end run of src/main.ts with the Apify SDK and the HTTP layer mocked:
// proves the delta state is persisted ONLY for records actually stored, so a
// spending limit (or crash) half-way never loses records for the next run.

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const LISTING_PAGE1 = readFileSync(`${fixturesDir}/conviction_list_dcn_page1.html`, 'utf-8');
const PAST_END = readFileSync(`${fixturesDir}/conviction_list_past_end.html`, 'utf-8');

const kv = new Map<string, unknown>();
const pushed: Record<string, unknown>[] = [];
const pushEvents: string[] = [];
const statusMessages: string[] = [];
let failMessage: string | null = null;
const CHARGE_LIMIT = 4; // the customer's budget allows 4 records

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
            getInput: async () => ({
                datasets: ['convictions'],
                maxItemsPerDataset: 10,
                fetchDetail: false,
                onlyNew: true,
            }),
            openKeyValueStore: async () => store,
            setValue: async (key: string, value: unknown) => {
                kv.set(`default:${key}`, value);
            },
            setStatusMessage: async (message: string) => {
                statusMessages.push(message);
            },
            on: noop,
            off: noop,
            getChargingManager: () => ({ getPricingInfo: () => ({ isPayPerEvent: true }) }),
            pushData: async (items: Record<string, unknown>[], eventName: string) => {
                const room = Math.max(0, CHARGE_LIMIT - pushed.length);
                const stored = items.slice(0, room);
                pushed.push(...stored);
                pushEvents.push(...stored.map(() => eventName));
                return {
                    chargedCount: stored.length,
                    eventChargeLimitReached: pushed.length >= CHARGE_LIMIT,
                    chargeableWithinLimit: {},
                };
            },
        },
    };
});

vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    fetchWithRetry: async (path: string) => (path.includes('PN=1') ? LISTING_PAGE1 : PAST_END),
    fetchOptional: async () => null,
}));

describe('main.ts delivery semantics', () => {
    it('persists the seen-set only for delivered records and stops at the spending limit', async () => {
        await import('../src/main.js');

        expect(failMessage).toBeNull();
        expect(pushed.length).toBe(CHARGE_LIMIT);
        expect(pushEvents.every((e) => e === 'result-summary')).toBe(true); // fetchDetail=false -> summary price

        // Oldest-first delivery: the 4 stored records are the 4 OLDEST (lowest case numbers)
        // of the 10 candidates, so the undelivered ones are the newest - exactly where the
        // next walk starts.
        const state = kv.get('state') as {
            version: number;
            seen: { convictions: Record<string, { h: string | null; f: string; l: string; o: boolean }> };
            lastRunAt: string;
        };
        expect(state).toBeDefined();
        expect(state.version).toBe(2);
        const deliveredIds = pushed.map((r) => r.caseNumber as string);
        expect(Object.keys(state.seen.convictions).sort()).toEqual([...deliveredIds].sort());
        expect(deliveredIds).not.toContain('4883993'); // the newest row on the page was NOT delivered
        expect(state.lastRunAt).toBeTruthy();
        for (const e of Object.values(state.seen.convictions)) {
            expect(e.h).toBeNull(); // no detail -> no hash -> never re-checked
            expect(e.o).toBe(false);
            expect(e.f).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }

        const output = kv.get('default:OUTPUT') as {
            delivered: number;
            chargeLimitReached: boolean;
            mode: string;
            totalMatching: { convictions: number };
            byEventType: Record<string, number>;
        };
        expect(output.delivered).toBe(CHARGE_LIMIT);
        expect(output.chargeLimitReached).toBe(true);
        expect(output.mode).toBe('delta');
        expect(output.totalMatching.convictions).toBe(210);
        expect(output.byEventType.SANCTION).toBe(CHARGE_LIMIT);
        expect(statusMessages.at(-1)).toMatch(/4 delivered .* spending limit reached/);
        expect(pushed.every((r) => r.event_type === 'SANCTION' && r.is_new === true)).toBe(true);
    });
});
