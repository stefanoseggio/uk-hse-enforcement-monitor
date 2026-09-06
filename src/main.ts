import { Actor, log } from 'apify';

import { fetchConvictions } from './fetchConvictions.js';
import { fetchNotices } from './fetchNotices.js';
import type { ActorInput, HseRecord } from './types.js';

const RESULT_EVENT_NAME = 'result';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { datasets = ['convictions', 'notices'], fetchBreachDetail = true, maxItemsPerDataset = 100 } = input;

    let records: HseRecord[] = [];
    try {
        if (datasets.includes('convictions')) {
            const convictions = await fetchConvictions(maxItemsPerDataset, fetchBreachDetail);
            log.info(`Convictions extraidas: ${convictions.length}`);
            records = records.concat(convictions);
        }
        if (datasets.includes('notices')) {
            const notices = await fetchNotices(maxItemsPerDataset, fetchBreachDetail);
            log.info(`Notices extraidas: ${notices.length}`);
            records = records.concat(notices);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Fallo la extraccion: ${message}`);
        await Actor.pushData({ error: message, scrapedAt: new Date().toISOString() });
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
