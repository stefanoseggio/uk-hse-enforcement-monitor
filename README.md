# UK HSE Enforcement Monitor

Extracts the UK **Health and Safety Executive (HSE)** public registers of
**Convictions** (successful prosecutions and fines) and **Enforcement
Notices** (Improvement/Prohibition notices) - the UK's direct equivalent of
US OSHA violation data - full defendant/recipient, fine, breach and
legislation-section detail, sorted newest-first for recurring compliance
monitoring.

## What you get

Both registers share a common shape (location, HSE admin fields) plus
their own specifics:

| Field | Convictions | Notices |
|---|---|---|
| `recordType` | `"conviction"` | `"notice"` |
| `caseNumber` / `noticeNumber` | Yes | Yes |
| `defendantName` / `recipientName` | Yes | Yes |
| `defendantId` / `recipientId` | Yes | Yes |
| `description` | Breach summary | Notice text (may cover several items) |
| `offenceDate` | Yes | - |
| `servedDate` / `complianceDate` / `revisedComplianceDate` | - | Yes |
| `noticeType` | - | Improvement / Prohibition |
| `totalFine` / `totalCosts` | Yes | - |
| `result` | - | e.g. "Ongoing" |
| `address`, `region`, `localAuthority`, `industry`, `mainActivity`, `typeOfLocation` | Yes | Yes |
| `hseGroup`, `hseDirectorate`, `hseArea`, `hseDivision` | Yes | Yes |
| `breaches` | Court, Act/Section, hearing date, per-breach fine | Act/Regulation reference per breach |
| `detailUrl`, `scrapedAt` | Yes | Yes |

## Input

| Field | Type | Default | Description |
|---|---|---|---|
| `datasets` | array | `["convictions", "notices"]` | Which register(s) to pull |
| `fetchBreachDetail` | boolean | `true` | Fetch per-breach legislation/court detail (one extra request per record) |
| `maxItemsPerDataset` | integer | `100` | Cap per register, applied independently |

```json
{ "datasets": ["convictions", "notices"], "fetchBreachDetail": true, "maxItemsPerDataset": 100 }
```

Both registers are sorted **newest first**, so a small `maxItemsPerDataset`
run on a schedule is the intended usage pattern - each run's top of the
list is what changed since the last one.

## Usage

```bash
curl "https://api.apify.com/v2/acts/stefano_seggio~uk-hse-enforcement-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"datasets": ["convictions", "notices"], "maxItemsPerDataset": 50}'
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/uk-hse-enforcement-monitor").call(run_input={"maxItemsPerDataset": 50})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["recordType"], item.get("defendantName") or item.get("recipientName"))
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/uk-hse-enforcement-monitor').call({ maxItemsPerDataset: 50 });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

## Known limitations

- The public Convictions register only retains **the last 5 years** of
  cases (a policy limit disclosed on HSE's own site, not a limitation of
  this actor) - roughly 200 total records at any time. Notices has no such
  stated cap and currently holds 30,000+ records.
- No proxy needed - the source is reachable from a plain datacenter IP.
- `description` is plain text extracted from the source page, not
  reformatted.

Full technical detail - including the real ASP wizard mechanics this
integration depends on and two genuine parsing gotchas (`&nbsp;` labels,
`<BR>`-joined addresses) - is in `AGENTS.md`.
