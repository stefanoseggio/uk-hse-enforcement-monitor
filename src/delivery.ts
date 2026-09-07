import { Actor, log } from 'apify';

import type { BuiltRecord, Candidate } from './fetchRecords.js';
import { enrichBatch } from './fetchRecords.js';
import type { RunOptions } from './input.js';
import { siteCalendarDate } from './normalize.js';
import type { DeltaState } from './state.js';
import { markSeen, saveState } from './state.js';
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

    async deliver(
        register: DatasetName,
        queue: readonly Candidate[],
        maxItems: number,
    ): Promise<{ count: number; truncatedByMaxItems: boolean }> {
        const today = siteCalendarDate(this.now);
        let count = 0;
        let truncatedByMaxItems = false;
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

            // Charge the full price only for records that really carry breach detail.
            const groups: { eventName: string; items: { built: BuiltRecord; candidate: Candidate }[] }[] = [
                { eventName: EVENT_DETAIL, items: [] },
                { eventName: EVENT_SUMMARY, items: [] },
            ];
            built.forEach((b, i) => {
                if (!this.options.eventTypes.has(b.record.event_type)) {
                    droppedByEventType.push(batch[i].id);
                    markSeen(this.state, register, batch[i].id, b.stateEntry, today);
                    this.dirty = true;
                    return;
                }
                const full = b.record.detailFetched && b.record.breachDetailFetched;
                groups[full ? 0 : 1].items.push({ built: b, candidate: batch[i] });
            });

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
        return { count, truncatedByMaxItems };
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
