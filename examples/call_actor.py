# Calls the UK HSE Enforcement Monitor Actor via the Apify API and prints each
# delivered record. Install first: pip install apify-client
# Run with: APIFY_TOKEN=your_token python examples/call_actor.py

import os

from apify_client import ApifyClient

client = ApifyClient(os.environ["APIFY_TOKEN"])

run_input = {
    "datasets": ["convictions", "notices"],
    "nameContains": "Balfour Beatty",
    "region": "3",
    "industry": "13",
    "minTotalFineGbp": 50000,
    "onlyNew": True,
    "maxItemsPerDataset": 50,
}

# jV35qppM82fjyjsle is the UK HSE Enforcement Monitor Actor ID.
run = client.actor("jV35qppM82fjyjsle").call(run_input=run_input)

items = list(client.dataset(run["defaultDatasetId"]).iterate_items())

for item in items:
    party = item.get("defendantName") or item.get("recipientName")
    print(f"{item['event_type']} | {item['recordType']} | {item['record_id']} | {party}")

print(f"\nFetched {len(items)} records. Full run: https://console.apify.com/actors/runs/{run['id']}")
