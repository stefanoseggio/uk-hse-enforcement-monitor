// Calls the UK HSE Enforcement Monitor Actor via the Apify API and prints each
// delivered record. Install first: npm install apify-client
// Run with: APIFY_TOKEN=your_token node examples/call-actor.cjs

const { ApifyClient } = require('apify-client');

const client = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

const input = {
    datasets: ['convictions', 'notices'],
    nameContains: 'Balfour Beatty',
    region: '3',
    industry: '13',
    minTotalFineGbp: 50000,
    onlyNew: true,
    maxItemsPerDataset: 50,
};

(async () => {
    // jV35qppM82fjyjsle is the UK HSE Enforcement Monitor Actor ID.
    const run = await client.actor('jV35qppM82fjyjsle').call(input);

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    for (const item of items) {
        const party = item.defendantName || item.recipientName;
        console.log(`${item.event_type} | ${item.recordType} | ${item.record_id} | ${party}`);
    }

    console.log(`\nFetched ${items.length} records. Full run: https://console.apify.com/actors/runs/${run.id}`);
})();
