# UK HSE Enforcement Monitor

**Daily risk-monitoring API for the UK's public prosecution and enforcement
register.** Extracts the UK **Health and Safety Executive (HSE)** registers
of **Convictions** (successful prosecutions and fines) and **Enforcement
Notices** (Improvement/Prohibition notices) - the UK's direct equivalent of
US OSHA violation data - with full defendant/recipient, fine, breach and
legislation-section detail.

Built for compliance, credentialing and background-check teams (the same
buyer segment already paying CHAS/SSIP-style contractor-vetting products
for this exact register) who need to know **the moment a new sanction or
notice appears**, not just a one-off historical dump.

## 🔔 Delta mode - daily/hourly monitoring, not just a dump

Set `onlyNew: true` and this actor persists which records it has already
returned (in its own private key-value store) and, on every subsequent
run, returns **only what's genuinely new since the last run** - typically
resolving in a few seconds and under 256MB of memory, because pagination
stops the moment it reaches already-seen records instead of walking the
whole register every time.

```json
{ "datasets": ["convictions", "notices"], "onlyNew": true }
```

Run this on an Apify schedule (e.g. every 6 hours) and pipe the output
straight into Slack/Email/Zapier/Make/your own webhook via [Apify's native
dataset webhooks](https://docs.apify.com/platform/integrations/webhooks) -
every record already carries the standardized integration metadata below,
so no intermediate parser is needed.

Prefer filtering by the source's own date field instead of run-history?
Use `dateRange` (`"24h"`, `"7d"`, or `"30d"`) - independent of `onlyNew`,
though note that HSE's own **Offence Date** can lag real publication by
months (a conviction is dated to when the breach happened, not when it was
prosecuted), so `onlyNew` is the more reliable "what's new" signal for
recurring monitoring; `dateRange` is there for when you specifically need
the source's own date semantics.

## What you get

Every record carries this standardized B2B integration envelope:

| Field        | Type    | Description                                         |
| ------------ | ------- | --------------------------------------------------- |
| `record_id`  | string  | `caseNumber` or `noticeNumber` - stable across runs |
| `event_type` | string  | `SANCTION` (convictions) or `NEW_LISTING` (notices) |
| `scraped_at` | string  | ISO-8601 timestamp of this extraction               |
| `is_new`     | boolean | `true` if not seen in a prior run (delta mode)      |
| `source_url` | string  | Direct link to the official HSE record              |

Plus the full domain detail, common to both registers (location, HSE admin
fields) with register-specific fields on top:

| Field                                                                               | Convictions                                       | Notices                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------- |
| `recordType`                                                                        | `"conviction"`                                    | `"notice"`                            |
| `caseNumber` / `noticeNumber`                                                       | Yes                                               | Yes                                   |
| `defendantName` / `recipientName`                                                   | Yes                                               | Yes                                   |
| `defendantId` / `recipientId`                                                       | Yes                                               | Yes                                   |
| `description`                                                                       | Breach summary                                    | Notice text (may cover several items) |
| `offenceDate`                                                                       | Yes                                               | -                                     |
| `servedDate` / `complianceDate` / `revisedComplianceDate`                           | -                                                 | Yes                                   |
| `noticeType`                                                                        | -                                                 | Improvement / Prohibition             |
| `totalFine` / `totalCosts`                                                          | Yes                                               | -                                     |
| `result`                                                                            | -                                                 | e.g. "Ongoing"                        |
| `address`, `region`, `localAuthority`, `industry`, `mainActivity`, `typeOfLocation` | Yes                                               | Yes                                   |
| `hseGroup`, `hseDirectorate`, `hseArea`, `hseDivision`                              | Yes                                               | Yes                                   |
| `breaches`                                                                          | Court, Act/Section, hearing date, per-breach fine | Act/Regulation reference per breach   |

## Input

| Field                | Type    | Default                      | Description                                                              |
| -------------------- | ------- | ---------------------------- | ------------------------------------------------------------------------ |
| `datasets`           | array   | `["convictions", "notices"]` | Which register(s) to pull                                                |
| `fetchBreachDetail`  | boolean | `true`                       | Fetch per-breach legislation/court detail (one extra request per record) |
| `maxItemsPerDataset` | integer | `100`                        | Cap per register, applied independently                                  |
| `onlyNew`            | boolean | `false`                      | Delta mode - see above                                                   |
| `dateRange`          | string  | (none)                       | `"24h"` \| `"7d"` \| `"30d"` - filter by the source's own date field     |

```json
{ "datasets": ["convictions", "notices"], "fetchBreachDetail": true, "maxItemsPerDataset": 100, "onlyNew": false }
```

Both registers are sorted **newest first** even outside delta mode, so a
small `maxItemsPerDataset` run is a reasonable poor-man's monitor even
without `onlyNew` - but `onlyNew` is what makes scheduled runs cheap and
exact.

## Usage

```bash
# One-off extraction
curl "https://api.apify.com/v2/acts/stefano_seggio~uk-hse-enforcement-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"datasets": ["convictions", "notices"], "maxItemsPerDataset": 50}'

# Daily monitoring (schedule this call every few hours)
curl "https://api.apify.com/v2/acts/stefano_seggio~uk-hse-enforcement-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"datasets": ["convictions", "notices"], "onlyNew": true}'
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")

# Daily monitoring run - only genuinely new sanctions/notices come back
run = client.actor("stefano_seggio/uk-hse-enforcement-monitor").call(run_input={"onlyNew": True})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    name = item.get("defendantName") or item.get("recipientName")
    print(f"[{item['event_type']}] {name} - {item['source_url']}")
    # -> forward `item` as-is to your webhook/Slack/CRM; the record_id/
    #    event_type/scraped_at/source_url envelope needs no reshaping.
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });

// Daily monitoring run
const run = await client.actor('stefano_seggio/uk-hse-enforcement-monitor').call({ onlyNew: true });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
for (const item of items) {
    // item.record_id / item.event_type / item.scraped_at / item.source_url
    // are already webhook/Zapier/Make-ready - post `item` straight through.
}
```

**Webhook / Zapier / Make**: configure an [Apify dataset webhook](https://docs.apify.com/platform/integrations/webhooks)
on `ACTOR.RUN.SUCCEEDED` for this actor and point it at your endpoint - the
standardized `record_id`/`event_type`/`scraped_at`/`is_new`/`source_url`
envelope on every item means no custom parser is needed on the receiving
end.

## Known limitations

- The public Convictions register only retains **the last 5 years** of
  cases (a policy limit disclosed on HSE's own site, not a limitation of
  this actor) - roughly 200 total records at any time. Notices has no such
  stated cap and currently holds 30,000+ records.
- `event_type` currently distinguishes "new record appearing in the
  register" (`SANCTION`/`NEW_LISTING`) - it does not yet diff individual
  field-level changes to a previously-seen record (e.g. a status update),
  which would need full snapshot storage rather than id-based delta
  tracking.
- No proxy needed - the source is reachable from a plain datacenter IP.
- `description` is plain text extracted from the source page, not
  reformatted.

Full technical detail - including the real ASP wizard mechanics this
integration depends on, two genuine parsing gotchas (`&nbsp;` labels,
`<BR>`-joined addresses), and the delta-engine's state/early-stop design -
is in `AGENTS.md`.
