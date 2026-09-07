/* eslint-disable no-param-reassign -- the delta state is an in-place mutable accumulator by design */
import { Actor, log } from 'apify';

import type { DatasetName } from './types.js';

// Delta state lives in a NAMED key-value store (the run's default store is
// isolated per run and would not survive between scheduled runs). One store
// per delta-state name, so two schedules with different filters never poison
// each other's "seen" set - the name defaults to a hash of the filter set
// (see input.ts) and can be pinned explicitly with the `deltaStateName` input.
const STORE_PREFIX = 'uk-hse-enforcement-monitor-state';
const STATE_KEY = 'state';

/** v1 wrote one unfiltered store under this name; adopted only for an unfiltered v2 run (see loadState). */
export const LEGACY_STORE_NAME = 'uk-hse-enforcement-monitor-delta-state';

// The notices register holds ~30k records over its whole 10-year retention
// and convictions ~210, so 50,000 entries per register never prunes in
// practice; the serialised JSON stays around 4 MB, well within a KV record.
export const MAX_SEEN_ENTRIES = 50_000;

export interface StateEntry {
    /** Content hash of the record's detail page at last delivery; null when delivered without detail (or by v1). */
    h: string | null;
    /** Register date (offence / latest hearing / served), YYYY-MM-DD; bounds the re-check window. */
    d: string | null;
    /** true while the record is worth re-checking for amendments (open notice, any conviction). */
    o: boolean;
    /** First delivered (YYYY-MM-DD, London calendar). */
    f: string;
    /** Last seen on the register (YYYY-MM-DD). */
    l: string;
}

export interface DeltaState {
    version: 2;
    seen: Record<DatasetName, Record<string, StateEntry>>;
    lastRunAt: string | null;
    filtersSignature: string | null;
}

interface LegacyState {
    seenIds?: Partial<Record<DatasetName, string[]>>;
    lastRunAt?: Partial<Record<DatasetName, string>>;
}

export function emptyState(filtersSignature: string | null): DeltaState {
    return { version: 2, seen: { convictions: {}, notices: {} }, lastRunAt: null, filtersSignature };
}

export function stateStoreName(deltaStateName: string): string {
    const safe = deltaStateName
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30);
    return `${STORE_PREFIX}-${safe || 'default'}`;
}

function isV2(value: unknown): value is DeltaState {
    return !!value && (value as DeltaState).version === 2 && typeof (value as DeltaState).seen === 'object';
}

function fromLegacy(legacy: LegacyState, filtersSignature: string | null, today: string): DeltaState {
    const state = emptyState(filtersSignature);
    for (const register of ['convictions', 'notices'] as const) {
        for (const id of legacy.seenIds?.[register] ?? []) {
            // No hash is known for v1 deliveries: they are a baseline, never re-checked for UPDATED.
            state.seen[register][id] = { h: null, d: null, o: false, f: today, l: today };
        }
    }
    state.lastRunAt = legacy.lastRunAt?.notices ?? legacy.lastRunAt?.convictions ?? null;
    return state;
}

export interface LoadStateOptions {
    filtersSignature: string;
    reset: boolean;
    /** Only an unfiltered run may inherit the v1 store, which was written regardless of filters. */
    adoptLegacy: boolean;
    today: string;
}

export async function loadState(storeName: string, options: LoadStateOptions): Promise<DeltaState> {
    const { filtersSignature, reset, adoptLegacy, today } = options;
    if (reset) {
        log.info(`resetState=true - starting from an empty seen-set in store "${storeName}".`);
        return emptyState(filtersSignature);
    }
    const store = await Actor.openKeyValueStore(storeName);
    const stored = await store.getValue<unknown>(STATE_KEY);
    if (isV2(stored)) {
        if (stored.filtersSignature && stored.filtersSignature !== filtersSignature) {
            log.warning(
                `Delta store "${storeName}" was built with a different filter set - records matching the new filters but already seen under the old ones will not be re-delivered. Use resetState=true to re-baseline.`,
            );
        }
        stored.seen.convictions ??= {};
        stored.seen.notices ??= {};
        return stored;
    }
    if (adoptLegacy) {
        const legacyStore = await Actor.openKeyValueStore(LEGACY_STORE_NAME);
        const legacy = await legacyStore.getValue<LegacyState>(STATE_KEY);
        if (legacy && legacy.seenIds) {
            const count = Object.values(legacy.seenIds).reduce((n, ids) => n + (ids?.length ?? 0), 0);
            log.info(
                `Adopting the v1 delta store "${LEGACY_STORE_NAME}" (${count} known ids, no filters were set) into "${storeName}".`,
            );
            return fromLegacy(legacy, filtersSignature, today);
        }
    }
    return emptyState(filtersSignature);
}

/** Record that a record was delivered (or intentionally excluded) with the given change key. */
export function markSeen(
    state: DeltaState,
    register: DatasetName,
    id: string,
    entry: { hash: string | null; dateIso: string | null; open: boolean },
    today: string,
): void {
    const previous = state.seen[register][id];
    state.seen[register][id] = {
        h: entry.hash,
        d: entry.dateIso ?? previous?.d ?? null,
        o: entry.open,
        f: previous?.f ?? today,
        l: today,
    };
}

/** Keep each register's map bounded: drop the entries last seen longest ago first. */
export function pruneState(state: DeltaState, max = MAX_SEEN_ENTRIES): void {
    for (const register of ['convictions', 'notices'] as const) {
        const entries = Object.entries(state.seen[register]);
        if (entries.length <= max) continue;
        entries.sort((a, b) => a[1].l.localeCompare(b[1].l));
        const drop = entries.length - max;
        for (let i = 0; i < drop; i++) delete state.seen[register][entries[i][0]];
        log.info(`Pruned ${drop} oldest ${register} entries from the delta state (cap ${max}).`);
    }
}

export async function saveState(storeName: string, state: DeltaState, runAt: string): Promise<void> {
    state.lastRunAt = runAt;
    pruneState(state);
    const store = await Actor.openKeyValueStore(storeName);
    await store.setValue(STATE_KEY, state);
}
