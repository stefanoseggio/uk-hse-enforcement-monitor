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
    /** New records whose detail page was missing this run and were held back (delta mode) instead of stubbed. */
    deferredMissingDetail: number;
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
        const droppedByEventType: string[] = [];
        for (let offset = 0; offset < queue.length && !this.chargeLimitReached; offset += DELIVERY_BATCH_SIZE) {
            const room = maxItems - count;
            if (room <= 0) {
                truncatedByMaxItems = true;
                log.warning(
                    `${register}: maxItemsPerDataset=${maxItems} reached - ${queue.length - offset} record(s) left undelivered for the next run.`,
                );
                break;
            }
            const batch = queue.slice(offset, offset + Math.min(DELIVERY_BATCH_SIZE, room));
            const built = await enrichBatch(batch, {
                fetchDetail: this.options.fetchDetail,
                fetchBreachDetail: this.options.fetchBreachDetail,
                fetchPartyDetail: this.options.fetchPartyDetail,
                maxConcurrency: this.options.maxConcurrency,
                now: this.now,
            });

            // Outage guard: too many listed records answering the "unknown id"
            // 500 at once is the site failing, not a wave of withdrawals.
            if (this.options.fetchDetail) {
                let attempted = 0;
                let notFound = 0;
                let longestStreak = 0;
                for (let i = 0; i < built.length; i++) {
                    if (batch[i].detail !== null) continue; // UPDATED candidates arrive with their page
                    attempted += 1;
                    if (built[i].record.detailError === 'NOT_FOUND') {
                        notFound += 1;
                        consecutiveNotFound += 1; // carried across batches
                        longestStreak = Math.max(longestStreak, consecutiveNotFound);
                    } else {
                        consecutiveNotFound = 0;
                    }
                }
                assertNotFoundWithinBounds(register, attempted, notFound, longestStreak, 'detail fetch');
            }

            // Charge the full price only for records that really carry breach detail.
            const groups: { eventName: string; items: { built: BuiltRecord; candidate: Candidate }[] }[] = [
                { eventName: EVENT_DETAIL, items: [] },
                { eventName: EVENT_SUMMARY, items: [] },
            ];
            for (let i = 0; i < built.length; i++) {
                const b = built[i];
                const candidate = batch[i];
                if (this.options.fetchDetail && b.record.detailError === 'NOT_FOUND' && this.options.onlyNew) {
                    // A missing page is only "withdrawn" once it has been missing
                    // in several runs; until then the record is neither stored
                    // nor remembered, so the next run simply retries it.
                    const runs = markMissing(this.state, register, candidate.id, today);
                    this.dirty = true;
                    if (runs < MISSING_RUNS_BEFORE_STUB) {
                        deferredMissingDetail += 1;
                        log.warning(
                            `${register} ${candidate.id}: detail page not found (run ${runs}/${MISSING_RUNS_BEFORE_STUB}) - held back for the next run instead of being delivered without detail.`,
                        );
                        continue;
                    }
                    log.warning(
                        `${register} ${candidate.id}: detail page missing in ${runs} runs - delivering the listing-only record and treating it as withdrawn.`,
                    );
                }
                if (!this.options.eventTypes.has(b.record.event_type)) {
                    droppedByEventType.push(candidate.id);
                    markSeen(this.state, register, candidate.id, b.stateEntry, today);
                    clearMissing(this.state, register, candidate.id);
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
        if (droppedByEventType.length > 0) {
            log.info(`${register}: ${droppedByEventType.length} record(s) skipped by eventTypes after detail fetch.`);
        }
        if (deferredMissingDetail > 0) {
            log.warning(
                `${register}: ${deferredMissingDetail} record(s) whose detail page was missing were held back for a later run.`,
            );
        }
        return { count, truncatedByMaxItems, deferredMissingDetail };
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
