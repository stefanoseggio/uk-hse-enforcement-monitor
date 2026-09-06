import { Actor, log } from 'apify';

import { fetchConvictions } from './fetchConvictions.js';
import { fetchNotices } from './fetchNotices.js';
import { loadState, saveDatasetState } from './state.js';
import type { ActorInput, HseRecord } from './types.js';

const RESULT_EVENT_NAME = 'result';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const {
        datasets = ['convictions', 'notices'],
        fetchBreachDetail = true,
        maxItemsPerDataset = 100,
        onlyNew = false,
        dateRange,
    } = input;

    const now = new Date();
    let state = await loadState();

    let records: HseRecord[] = [];
    try {
        if (datasets.includes('convictions')) {
            const seenIds = new Set(state.seenIds.convictions ?? []);
            const { records: convictions, allIdsThisRun } = await fetchConvictions(
                maxItemsPerDataset,
                fetchBreachDetail,
                seenIds,
                onlyNew,
                dateRange,
                now,
            );
            log.info(`Convictions extraidas: ${convictions.length} (onlyNew=${onlyNew})`);
            records = records.concat(convictions);
            state = await saveDatasetState(state, 'convictions', allIdsThisRun, now.toISOString());
        }
        if (datasets.includes('notices')) {
            const seenIds = new Set(state.seenIds.notices ?? []);
            const { records: notices, allIdsThisRun } = await fetchNotices(
                maxItemsPerDataset,
                fetchBreachDetail,
                seenIds,
                onlyNew,
                dateRange,
                now,
            );
            log.info(`Notices extraidas: ${notices.length} (onlyNew=${onlyNew})`);
            records = records.concat(notices);
            state = await saveDatasetState(state, 'notices', allIdsThisRun, now.toISOString());
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Fallo la extraccion: ${message}`);
        await Actor.pushData({ error: message, scraped_at: now.toISOString() });
        return;
    }

    let pushed = 0;
    for (const record of records) {
        await Actor.pushData(record);
        pushed += 1;

        const { eventChargeLimitReached } = await Actor.charge({ eventName: RESULT_EVENT_NAME, count: 1 });
        if (eventChargeLimitReached) {
            log.info('Charge limit reached - stopping.');
            return;
        }
    }

    log.info(`Cargados ${pushed} items al dataset.`);
}
