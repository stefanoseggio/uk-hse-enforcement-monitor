import { Actor, log } from 'apify';

import { Delivery } from './delivery.js';
import type { Candidate, WalkResult } from './fetchRecords.js';
import { recheckKnown, selectRecheckIds, walkListing } from './fetchRecords.js';
import { setMaxInFlightRequests } from './http.js';
import type { RunOptions } from './input.js';
import { resolveInput } from './input.js';
import { lowestRecordId, siteCalendarDate } from './normalize.js';
import type { DeltaState } from './state.js';
import {
    clearMissing,
    isColdState,
    loadState,
    markMissing,
    markSeen,
    MISSING_RUNS_BEFORE_CLOSED,
    saveState,
    setBacklogFloor,
    setBaselineFloor,
    stateStoreName,
} from './state.js';
import type { DatasetName, RegisterQuery } from './types.js';
import { listingUrl } from './urls.js';

interface RegisterOutcome {
    walk: WalkResult;
    rechecked: number;
    recheckUpdated: number;
    /** Known open records whose page was not found THIS run (closed only after MISSING_RUNS_BEFORE_CLOSED runs). */
    recheckVanished: number;
    /** Known records that stopped being re-checked this run (missing in enough consecutive runs). */
    recheckClosed: number;
    delivered: number;
    /** New records held back because their detail page could not be read (retried next run). */
    deferredMissingDetail: number;
    truncatedByMaxItems: boolean;
    /** Walk watermark left for the next run (null = no backlog under the delivered records). */
    backlogFloor: string | null;
    /** Baseline: unseen records below this id are history and are never delivered in delta mode (null = none). */
    baselineFloor: string | null;
}

async function processRegister(
    register: DatasetName,
    query: RegisterQuery,
    options: RunOptions,
    state: DeltaState,
    delivery: Delivery,
    today: string,
    cold: boolean,
): Promise<RegisterOutcome> {
    const seen = state.seen[register];
    // The convictions register is ~210 records (21 pages) and its entry
    // order is only a proxy for publication order, so it is always walked
    // in full; notices (30k) early-stop after two fully-known pages - unless
    // a walk watermark says a backlog is still waiting further down.
    const fullWalk = register === 'convictions';
    // The COLD run (a store that never completed a run) delivers the newest
    // records up to the cap as the baseline and remembers the oldest one it
    // took as the register's baseline floor: unseen records below it are
    // history, excluded by every later delta walk. Only a NON-cold capped
    // walk leaves a backlog (a watermark) - its overflow is news that the
    // next run must reach.
    const floorBefore = fullWalk ? null : state.backlogFloor[register];
    const walk = await walkListing({
        query,
        maxItems: options.maxItems,
        onlyNew: options.onlyNew,
        seen,
        eventTypes: options.eventTypes,
        fullWalk,
        backlogFloor: floorBefore,
        baselineFloor: options.onlyNew ? state.baselineFloor[register] : null,
        cold,
    });
    const matched = walk.totalMatching !== null ? walk.totalMatching.toLocaleString('en-GB') : 'unknown';
    log.info(
        `${register} walk finished: ${walk.candidates.length} to deliver, ${walk.excluded.length} excluded, ${walk.pagesWalked} page(s), stop=${walk.stopReason}, ${matched} matching on HSE.`,
    );

    const walkIncomplete = walk.stopReason === 'max-items' || walk.stopReason === 'page-cap';

    // Baseline (cold delta run only): a walk cut short by the cap defines it
    // as the oldest record taken - persisted before delivery, so even a run
    // that dies half-way has fixed what counts as history. A cold walk that
    // reached the end saw everything: no baseline, nothing is history. A
    // cold run never records a backlog floor: what it could not store sits
    // ABOVE the stored block (delivery is oldest-first) and is unseen, so the
    // next walk meets it before any known page.
    if (options.onlyNew && cold) {
        if (walkIncomplete) {
            const baseline = lowestRecordId(walk.candidates.map((c) => c.id)) ?? walk.stoppedAtId;
            if (setBaselineFloor(state, register, baseline)) {
                delivery.noteStateChanged();
                await delivery.persist();
            }
            log.info(
                `${register}: baseline set at ${baseline ?? 'n/a'} - this first delta run delivers the ${walk.candidates.length} most recently entered matching record(s); the matching records below it (${matched} match in total) are history and later delta runs deliver only what is entered above it (run once with onlyNew=false for the full history).`,
            );
        } else {
            log.info(
                `${register}: first delta run walked the whole register - nothing is history, no baseline needed.`,
            );
        }
    }

    // Walk watermark, part 1 (before anything is pushed): the backlog this
    // run may leave behind is bounded above by the walk's stop point (when
    // it was cut short) and by every candidate not stored yet - persist that
    // now so a crash half-way through delivery cannot strand anything.
    const trackBacklog = options.onlyNew && !fullWalk && !cold;
    const backlogTops = (unstored: readonly string[]): (string | null)[] => [
        ...unstored,
        walkIncomplete ? walk.stoppedAtId : null,
        walkIncomplete ? floorBefore : null,
    ];
    if (trackBacklog) {
        const provisional = lowestRecordId(backlogTops(walk.candidates.map((c) => c.id)));
        if (setBacklogFloor(state, register, provisional)) {
            delivery.noteStateChanged();
            await delivery.persist();
        }
    }

    let updated: Candidate[] = [];
    let rechecked = 0;
    let vanished: string[] = [];
    let recheckClosed = 0;
    if (options.onlyNew && options.fetchDetail && options.eventTypes.has('UPDATED')) {
        const ids = selectRecheckIds(seen, today, options.recheckDays);
        rechecked = ids.length;
        if (ids.length > 0) {
            await Actor.setStatusMessage(
                `${register}: re-checking ${ids.length} known open record(s) for amendments...`,
            );
            const result = await recheckKnown(register, ids, seen, options.maxConcurrency);
            updated = result.updated;
            vanished = result.vanished;
            for (const id of ids) if (seen[id]) seen[id].l = today;
            for (const id of result.readIds) clearMissing(state, register, id);
        }
    }
    // A page that answers the site's "unknown id" 500 may be a withdrawn
    // record or a server hiccup; a known record stops being re-checked only
    // once it has been missing in MISSING_RUNS_BEFORE_CLOSED distinct runs.
    for (const id of vanished) {
        const runs = markMissing(state, register, id, today);
        if (runs >= MISSING_RUNS_BEFORE_CLOSED && seen[id]) {
            seen[id].o = false;
            clearMissing(state, register, id);
            recheckClosed += 1;
            log.info(`${register} ${id}: page missing in ${runs} runs - no longer re-checked for updates.`);
        } else {
            log.warning(
                `${register} ${id}: page not found (run ${runs}/${MISSING_RUNS_BEFORE_CLOSED}) - will be re-checked again next run.`,
            );
        }
    }

    await Actor.setStatusMessage(
        `${register}: ${walk.candidates.length} new + ${updated.length} updated record(s) to deliver (${matched} match your filters on HSE). Fetching detail...`,
    );

    // Deliver UPDATED first (they are re-detected on the next run if lost),
    // then new records OLDEST-FIRST: if the run dies half-way, the
    // undelivered records are the newest candidates - the rows the next
    // delta walk visits first when they sit at the top of the register, and
    // otherwise covered by the walk watermark persisted above.
    const queue: Candidate[] = [...updated, ...[...walk.candidates].reverse()];
    const delivered = await delivery.deliver(register, queue, options.maxItems);

    // Walk watermark, part 2: only the candidates that were NOT stored are
    // still a backlog. A completed walk whose candidates were all stored
    // clears the floor; an incomplete one keeps the lower of its stop point
    // and the previous floor (the older backlog was not reached).
    if (trackBacklog) {
        const floorAfter = lowestRecordId(backlogTops(delivered.unstoredNewIds));
        if (setBacklogFloor(state, register, floorAfter)) delivery.noteStateChanged();
        if (floorAfter !== null) {
            log.warning(
                `${register}: ${delivered.unstoredNewIds.length} candidate(s) not stored${walkIncomplete ? ' and the walk stopped at its cap' : ''} - walk watermark set to ${floorAfter}; the next delta run walks down to it.`,
            );
        } else if (floorBefore !== null) {
            log.info(`${register}: backlog below ${floorBefore} cleared - walk watermark removed.`);
        }
    }
    return {
        walk,
        rechecked,
        recheckUpdated: updated.length,
        recheckVanished: vanished.length,
        recheckClosed,
        delivered: delivered.count,
        deferredMissingDetail: delivered.deferredMissingDetail,
        truncatedByMaxItems: walk.truncatedByMaxItems || delivered.truncatedByMaxItems,
        backlogFloor: state.backlogFloor[register],
        baselineFloor: state.baselineFloor[register],
    };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
    return out;
}

function mapOutcomes<T>(
    outcomes: Partial<Record<DatasetName, RegisterOutcome>>,
    pick: (o: RegisterOutcome, register: DatasetName) => T,
): Partial<Record<DatasetName, T>> {
    const out: Partial<Record<DatasetName, T>> = {};
    for (const register of ['convictions', 'notices'] as const) {
        const o = outcomes[register];
        if (o) out[register] = pick(o, register);
    }
    return out;
}

async function run(): Promise<void> {
    const now = new Date();
    const runAt = now.toISOString();
    const today = siteCalendarDate(now);
    const resolved = resolveInput((await Actor.getInput()) ?? {}, now);
    const { queries, options } = resolved;
    // One run-wide budget for simultaneous requests (listing, detail, breach and party pages together).
    setMaxInFlightRequests(options.maxConcurrency);

    for (const register of options.datasets) log.info(`${register} query: ${listingUrl(queries[register])}`);
    log.info(
        `Mode: ${options.onlyNew ? 'delta (only new/updated)' : 'full'} | registers=${options.datasets.join(',')} | maxItemsPerDataset=${options.maxItems} | fetchDetail=${options.fetchDetail} | fetchBreachDetail=${options.fetchBreachDetail} | fetchPartyDetail=${options.fetchPartyDetail} | recheckDays=${options.recheckDays} | concurrency=${options.maxConcurrency}`,
    );

    const storeName = stateStoreName(options.deltaStateName);
    const state = await loadState(storeName, {
        filtersSignature: resolved.filtersSignature,
        reset: options.resetState,
        today,
    });
    // Decided once, before anything is persisted (the run's own mid-way
    // persists set lastRunAt): the cold run is the one that sets the baseline.
    const cold = options.onlyNew && isColdState(state);
    log.info(
        `Delta state store: ${storeName} (${cold ? 'cold - this run sets the baseline; ' : ''}${Object.keys(state.seen.convictions).length} known cases, ${Object.keys(state.seen.notices).length} known notices, notices walk watermark ${state.backlogFloor.notices ?? 'none'}, baseline convictions ${state.baselineFloor.convictions ?? 'none'} / notices ${state.baselineFloor.notices ?? 'none'})`,
    );

    const delivery = new Delivery(state, storeName, runAt, options, now);
    const outcomes: Partial<Record<DatasetName, RegisterOutcome>> = {};
    try {
        for (const register of options.datasets) {
            outcomes[register] = await processRegister(
                register,
                queries[register],
                options,
                state,
                delivery,
                today,
                cold,
            );
            if (delivery.chargeLimitReached) break;
        }
    } finally {
        await delivery.close();
    }

    // Records that were walked but intentionally not delivered (filtered by
    // event type, or history below the baseline) become "seen" only once the
    // run completed normally - never on a crash, so nothing is lost. They
    // carry no hash (their page was never read), so they are never
    // re-checked for amendments. Known records just get their last-seen date
    // refreshed.
    for (const register of options.datasets) {
        const outcome = outcomes[register];
        if (!outcome) continue;
        for (const c of outcome.walk.excluded) {
            if (c.excludedBy === 'eventType' || c.excludedBy === 'baseline') {
                markSeen(state, register, c.id, { hash: null, dateIso: null, open: false }, today);
            } else if (c.excludedBy === 'known' && state.seen[register][c.id]) {
                state.seen[register][c.id].l = today;
            }
        }
    }
    await saveState(storeName, state, runAt);

    const { records } = delivery;
    const byType = countBy(records, (r) => r.event_type);
    const summary = {
        delivered: records.length,
        byEventType: byType,
        byRegister: countBy(records, (r) => r.recordType),
        detailFetched: records.filter((r) => r.detailFetched).length,
        detailFailed: records.filter((r) => options.fetchDetail && !r.detailFetched).length,
        totalMatching: mapOutcomes(outcomes, (o) => o.walk.totalMatching),
        pagesWalked: mapOutcomes(outcomes, (o) => o.walk.pagesWalked),
        stopReason: mapOutcomes(outcomes, (o) => o.walk.stopReason),
        rechecked: mapOutcomes(outcomes, (o) => o.rechecked),
        recheckUpdated: mapOutcomes(outcomes, (o) => o.recheckUpdated),
        recheckVanished: mapOutcomes(outcomes, (o) => o.recheckVanished),
        recheckClosed: mapOutcomes(outcomes, (o) => o.recheckClosed),
        deferredMissingDetail: mapOutcomes(outcomes, (o) => o.deferredMissingDetail),
        backlogFloor: mapOutcomes(outcomes, (o) => o.backlogFloor),
        baselineFloor: mapOutcomes(outcomes, (o) => o.baselineFloor),
        truncatedByMaxItems: Object.values(outcomes).some((o) => o?.truncatedByMaxItems === true),
        chargeLimitReached: delivery.chargeLimitReached,
        excluded: countBy(
            Object.values(outcomes).flatMap((o) => o?.walk.excluded ?? []),
            (c) => c.excludedBy ?? 'none',
        ),
        mode: options.onlyNew ? 'delta' : 'full',
        deltaStateStore: storeName,
        knownAfterRun: {
            convictions: Object.keys(state.seen.convictions).length,
            notices: Object.keys(state.seen.notices).length,
        },
        listingUrl: mapOutcomes(outcomes, (_o, register) => listingUrl(queries[register])),
        runAt,
    };
    await Actor.setValue('OUTPUT', summary);

    const parts = [`${summary.delivered} delivered`];
    if (byType.SANCTION) parts.push(`${byType.SANCTION} convictions`);
    if (byType.NEW_LISTING) parts.push(`${byType.NEW_LISTING} notices`);
    if (byType.UPDATED) parts.push(`${byType.UPDATED} updated`);
    if (summary.detailFailed) parts.push(`${summary.detailFailed} without detail`);
    const deferred = Object.values(summary.deferredMissingDetail).reduce((n, v) => n + (v ?? 0), 0);
    if (deferred) parts.push(`${deferred} held back (detail page missing)`);
    if (summary.truncatedByMaxItems) parts.push('maxItemsPerDataset reached - more available');
    if (delivery.chargeLimitReached) parts.push('spending limit reached');
    const matching = options.datasets
        .map((r) => `${(outcomes[r]?.walk.totalMatching ?? 0).toLocaleString('en-GB')} ${r}`)
        .join(', ');
    await Actor.setStatusMessage(`${parts.join(' · ')} · matching on HSE: ${matching}`, {
        isStatusMessageTerminal: true,
    });
    log.info(`Done: ${parts.join(', ')}.`);
}

await Actor.init();
try {
    await run();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.exception(error instanceof Error ? error : new Error(message), 'Run failed');
    await Actor.setValue('LAST_ERROR', { message, at: new Date().toISOString() });
    await Actor.fail(`HSE extraction failed: ${message}`);
}
await Actor.exit();
