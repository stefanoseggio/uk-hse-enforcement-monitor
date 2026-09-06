import { Actor } from 'apify';

// A NAMED key-value store (not the run's default one, which is isolated per
// run) persists across scheduled runs of this actor - this is what makes
// "only new since last run" possible at all. Keyed per dataset since case
// numbers and notice numbers are independent id spaces.
const STATE_STORE_NAME = 'uk-hse-enforcement-monitor-delta-state';
const MAX_SEEN_IDS_PER_DATASET = 2000;

export interface DeltaState {
    seenIds: Record<string, string[]>;
    lastRunAt: Record<string, string>;
}

export async function loadState(): Promise<DeltaState> {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    const state = await store.getValue<DeltaState>('state');
    return state ?? { seenIds: {}, lastRunAt: {} };
}

export async function saveDatasetState(
    state: DeltaState,
    dataset: string,
    idsSeenThisRun: string[],
    runAt: string,
): Promise<DeltaState> {
    const previous = state.seenIds[dataset] ?? [];
    const merged = [...idsSeenThisRun, ...previous.filter((id) => !idsSeenThisRun.includes(id))];
    const next: DeltaState = {
        seenIds: { ...state.seenIds, [dataset]: merged.slice(0, MAX_SEEN_IDS_PER_DATASET) },
        lastRunAt: { ...state.lastRunAt, [dataset]: runAt },
    };
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    await store.setValue('state', next);
    return next;
}
