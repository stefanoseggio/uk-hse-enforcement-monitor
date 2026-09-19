import { Actor, log } from 'apify';

import type { BuiltRecord, Candidate } from './fetchRecords.js';
import { assertNotFoundWithinBounds, enrichBatch } from './fetchRecords.js';
import type { RunOptions } from './input.js';
import { siteCalendarDate } from './normalize.js';
import type { DeltaState } from './state.js';
import { clearMissing, markMissing, markSeen, MISSING_RUNS_BEFORE_STUB, saveState } from './state.js';
import type { DatasetName, HseRecord } from './types.js';

// Pay-per-event names. Both must exist in the actor's pricing configuration
// on the platform (see README "Pricing"): a record carrying the case/notice
// page AND its breach detail is charged as `result`; anything lighter
// (listing-only, no breach detail, or a page that could not be fetched) as
// the cheaper `result-summary`.
export const EVENT_DETAIL = 'result';
export const EVENT_SUMMARY = 'result-summary';

export const DELIVERY_BATCH_SIZE = 15;
export const PERSIST_EVERY_N_DELIVERED = 50;

export interface DeliveryOutcome {
    count: number;
    truncatedByMaxItems: boolean;
    /** New records whose detail page could not be read this run and were held back (delta mode) instead of stubbed. */
    deferredMissingDetail: number;
    /**
     * Ids of NEW candidates that were not stored (delivery cap, spending
     * limit, held back): they are still unseen and sit under the records
     * stored today, so main.ts records them in the walk watermark.
     */
    unstoredNewIds: string[];
}

/**
 * Pushes records in small batches, persisting the seen-set only for records
 * actually stored (and charged). Persist runs every N records, on close
 * (finally) and on the platform migrating/aborting events.
 */
export class Delivery {
    readonly records: HseRecord[] = [];
    chargeLimitReached = false;
    private readonly isPayPerEvent: boolean;
    private sinceLastPersist = 0;
    private dirty = false;
    private readonly onPlatformEvent = (): void => {
        void this.persist();
    };

    constructor(
        private readonly state: DeltaState,
        private readonly storeName: string,
        private readonly runAt: string,
        private readonly options: RunOptions,
        private readonly now: Date,
    ) {
        this.isPayPerEvent = Actor.getChargingManager().getPricingInfo().isPayPerEvent;
        Actor.on('migrating', this.onPlatformEvent);
        Actor.on('aborting', this.onPlatformEvent);
    }

    async deliver(register: DatasetName, queue: readonly Candidate[], maxItems: number): Promise<DeliveryOutcome> {
        const today = siteCalendarDate(this.now);
        let count = 0;
        let truncatedByMaxItems = false;
        let deferredMissingDetail = 0;
        let consecutiveNotFound = 0;
        // Accumulated across the whole delivery queue (every batch of this
        // call), in addition to the per-batch counts below: a sustained
        // partial outage failing an evenly-distributed share of detail
        // fetches (e.g. ~20-29%) can stay under the 30% ratio in every
        // individual batch while clearing it comfortably over the run as a
        // whole, so the cumulative totals must be checked too.
        let totalAttempted = 0;
        let totalFailed = 0;
        const droppedByEventType: string[] = [];
        const storedIds = new Set<string>();
        let offset = 0;
        while (offset < queue.length && !this.chargeLimitReached) {
            const room = maxItems - count;
            if (room <= 0) break;
            // A batch is shortened to the room left under the cap, so the
            // offset must advance by what was actually taken - never by the
            // nominal batch size, or the tail of the queue would be skipped
            // without being reported as truncated.
            const batch = queue.slice(offset, offset + Math.min(DELIVERY_BATCH_SIZE, room));
            offset += batch.length;
            const built = await enrichBatch(batch, {
                fetchDetail: this.options.fetchDetail,
                fetchBreachDetail: this.options.fetchBreachDetail,
                fetchPartyDetail: this.options.fetchPartyDetail,
                maxConcurrency: this.options.maxConcurrency,
                now: this.now,
            });

            // Outage guard: too many listed records failing to read at once
            // (the "unknown id" 500, timeouts, non-record pages) is the site
            // failing, not a wave of withdrawals.
            if (this.options.fetchDetail) {
                let attempted = 0;
                let failed = 0;
                let longestStreak = 0;
                for (let i = 0; i < built.length; i++) {
                    if (batch[i].detail !== null) continue; // UPDATED candidates arrive with their page
                    attempted += 1;
                    if (!built[i].record.detailFetched) {
                        failed += 1;
                        consecutiveNotFound += 1; // carried across batches
                        longestStreak = Math.max(longestStreak, consecutiveNotFound);
                    } else {
                        consecutiveNotFound = 0;
                    }
                }
                totalAttempted += attempted;
                totalFailed += failed;
                assertNotFoundWithinBounds(register, attempted, failed, longestStreak, 'detail fetch');
                assertNotFoundWithinBounds(
                    register,
                    totalAttempted,
                    totalFailed,
                    consecutiveNotFound,
                    'detail fetch (run total)',
                );
            }

            // Charge the full price only for records that really carry breach detail.
            const groups: { eventName: string; items: { built: BuiltRecord; candidate: Candidate }[] }[] = [
                { eventName: EVENT_DETAIL, items: [] },
                { eventName: EVENT_SUMMARY, items: [] },
            ];
            for (let i = 0; i < built.length; i++) {
                const b = built[i];
                const candidate = batch[i];
                if (this.options.fetchDetail && !b.record.detailFetched && this.options.onlyNew) {
                    // An unreadable page - the "unknown id" 500, a timeout after
                    // the retries, a non-record page - is only "withdrawn" once
                    // it has failed in several runs; until then the record is
                    // neither stored nor remembered (a stub with no hash would
                    // never be re-read), so the next run simply retries it.
                    const runs = markMissing(this.state, register, candidate.id, today);
                    this.dirty = true;
                    const why = b.record.detailError ?? 'unknown error';
                    if (runs < MISSING_RUNS_BEFORE_STUB) {
                        deferredMissingDetail += 1;
                        log.warning(
                            `${register} ${candidate.id}: detail page could not be read (${why}; run ${runs}/${MISSING_RUNS_BEFORE_STUB}) - held back for the next run instead of being delivered without detail.`,
                        );
                        continue;
                    }
                    log.warning(
                        `${register} ${candidate.id}: detail page unreadable in ${runs} runs (${why}) - delivering the listing-only record and treating it as withdrawn.`,
                    );
                }
                if (!this.options.eventTypes.has(b.record.event_type)) {
                    droppedByEventType.push(candidate.id);
                    markSeen(this.state, register, candidate.id, b.stateEntry, today);
                    clearMissing(this.state, register, candidate.id);
                    storedIds.add(candidate.id);
                    this.dirty = true;
                    continue;
                }
                const full = b.record.detailFetched && b.record.breachDetailFetched;
                groups[full ? 0 : 1].items.push({ built: b, candidate });
            }

            for (const group of groups) {
                if (group.items.length === 0 || this.chargeLimitReached) continue;
                const result = await Actor.pushData(
                    group.items.map((g) => g.built.record),
                    group.eventName,
                );
                // In pay-per-event mode the SDK stores only as many items as the
                // customer's spending limit allows and reports that count; outside
                // PPE (local runs, tests) everything is stored and nothing charged.
                const stored = this.isPayPerEvent ? result.chargedCount : group.items.length;
                for (const { built: b, candidate } of group.items.slice(0, stored)) {
                    this.records.push(b.record);
                    markSeen(this.state, register, candidate.id, b.stateEntry, today);
                    clearMissing(this.state, register, candidate.id);
                    storedIds.add(candidate.id);
                    this.dirty = true;
                    this.sinceLastPersist += 1;
                    count += 1;
                }
                if (result.eventChargeLimitReached) {
                    this.chargeLimitReached = true;
                    log.warning(
                        `Spending limit reached after ${this.records.length} record(s) - stopping. Undelivered records will be picked up by the next run.`,
                    );
                }
            }
            if (this.sinceLastPersist >= PERSIST_EVERY_N_DELIVERED) await this.persist();
            log.info(`${register}: delivered ${count}/${Math.min(queue.length, maxItems)}.`);
        }
        // Whatever was not even attempted - for any reason but the spending
        // limit - was cut off by the cap: say so (OUTPUT and status message).
        if (offset < queue.length && !this.chargeLimitReached) {
            truncatedByMaxItems = true;
            log.warning(
                `${register}: maxItemsPerDataset=${maxItems} reached - ${queue.length - offset} record(s) left undelivered for the next run.`,
            );
        }
        if (droppedByEventType.length > 0) {
            log.info(`${register}: ${droppedByEventType.length} record(s) skipped by eventTypes after detail fetch.`);
        }
        if (deferredMissingDetail > 0) {
            log.warning(
                `${register}: ${deferredMissingDetail} record(s) whose detail page could not be read were held back for a later run.`,
            );
        }
        const unstoredNewIds = queue.filter((c) => c.isNew && !storedIds.has(c.id)).map((c) => c.id);
        return { count, truncatedByMaxItems, deferredMissingDetail, unstoredNewIds };
    }

    /** The caller changed the shared state outside a push (walk watermark): include it in the next persist. */
    noteStateChanged(): void {
        this.dirty = true;
    }

    async persist(): Promise<void> {
        if (!this.dirty) return;
        await saveState(this.storeName, this.state, this.runAt);
        this.dirty = false;
        this.sinceLastPersist = 0;
    }

    async close(): Promise<void> {
        try {
            await this.persist();
        } finally {
            Actor.off('migrating', this.onPlatformEvent);
            Actor.off('aborting', this.onPlatformEvent);
        }
    }
}
