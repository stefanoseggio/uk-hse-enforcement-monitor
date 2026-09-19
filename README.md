# UK HSE Enforcement Monitor - Health & Safety Prosecutions and Notices (Compliance Risk Tracker)

[![Built for Apify](https://img.shields.io/badge/Built%20for-Apify-00C1A2?style=flat-square&logo=apify&logoColor=white)](https://apify.com)
[![Pay-Per-Event](https://img.shields.io/badge/Pay--Per--Event-from%20%240.001%2Fevent-blue?style=flat-square)](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Apache 2.0 License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square&logo=apache&logoColor=white)](./LICENSE)

[![Run on Apify](https://img.shields.io/badge/Run%20on-Apify%20Store-00C1A2?style=for-the-badge&logo=apify&logoColor=white)](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor)

Live and public at [apify.com/stefano_seggio/uk-hse-enforcement-monitor](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor).

**Structured, delta-tracked access to the United Kingdom's two public HSE enforcement registers — convictions and enforcement notices — that runs on your own configured Apify schedule, not a fixed cadence.**

## Executive Value Proposition

Checking a company's HSE enforcement history by hand means running two separate search wizards on a 2013-era classic-ASP site, paging through ten rows at a time, and coming back later to re-check each notice's own page because the register carries no "last updated" field and no alerts. This Actor runs both public HSE registers - the register of convictions (prosecutions, fines, breaches, courts) and the register of enforcement notices (Improvement, Prohibition) - as one server-side-filtered query and turns the result into structured JSON, CSV or Excel with normalised dates, numeric GBP fines and split-out legislation fields. Turn on "Only new" and put it on a schedule, and every later run returns only the sanctions and notices that appeared or changed on the register since the previous run, so watching a contractor list or a whole industry stops being a manual re-search and becomes something a webhook can deliver.

## Enterprise Use Cases

- **Contractor and supply-chain risk screening.** H&S compliance teams running CHAS/SSIP/Constructionline-style vetting can filter on `nameContains` for a named subcontractor, or leave it open and watch `event_type`, `noticeCategory` and `isImmediate` for anything landing across an approved-supplier list. `partyHseReference` and `isRepeatOffender` carry the count across both registers, so a name that looks like a first offence in isolation can be flagged as a repeat pattern instead.
- **Underwriting and renewal risk assessment.** Employers'-liability and public-liability underwriters can pull `totalFineGbp`, `resultingFromFatality`, `hasCustodialSentence`, `partyConvictionCount` and `partyNoticeCount` for a risk before binding or at renewal, and filter a whole book by `minTotalFineGbp` / `maxTotalFineGbp` to build a watch-list of six-figure or fatal cases rather than reading each judgment.
- **Industry enforcement trend tracking.** Legal, PR and H&S-consultancy teams can slice by `region`, `industry`, `noticeTypes` and `dateFrom`/`dateTo` to see who was just served an Immediate Prohibition Notice in a given sector, or use `legislationBreached` (`act`) and `sicDescription` to track which Acts and activities are driving prosecutions this quarter - source material for briefings, business development outreach or trade-press coverage.

## Cost & BYOK Disclosure

Pay per event, platform usage included - you pay only for records delivered, never for compute:

| Event | Title | What it covers | Price |
|---|---|---|---|
| `result` | Record (full detail) | A record with the case/notice page and breach detail (court, Act section, regulation paragraph) | **$0.003/event** |
| `result-summary` | Record (listing summary) | A lighter record: `fetchDetail: false` or `fetchBreachDetail: false`, or a page that could not be fetched | **$0.001/event** |
| Actor start | — | Once per run | **$0.00005** |

A quiet monitoring run with nothing new to deliver costs the start fee only - no records, no charge. In delta mode (`onlyNew: true`), each stored record's page content hash is compared on every re-check; an unchanged hash means the record is suppressed before delivery and is **never billed** — only a genuinely new record or a real content change (an `UPDATED` event) reaches your dataset as a charged event.

**No third-party API key required.** BYOK status: **none**. This Actor calls only HSE's own public registers (`resources.hse.gov.uk`) - there is no paid third-party API in the pipeline, and no key of any kind for you to supply.

## Quickstart

Get your token from [console.apify.com/settings/integrations](https://console.apify.com/settings/integrations). All three examples below run the real, public Actor (`stefano_seggio/uk-hse-enforcement-monitor`, Actor ID `jV35qppM82fjyjsle` — either identifier works).

### cURL (instant, synchronous)

Runs synchronously and returns the resulting dataset items directly in the response - no polling needed.

```bash
curl -X POST "https://api.apify.com/v2/acts/jV35qppM82fjyjsle/run-sync-get-dataset-items?token=<YOUR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
  "datasets": ["convictions", "notices"],
  "maxItemsPerDataset": 50,
  "onlyNew": true
}'
```

### Python (`apify_client`)

```python
# Calls the UK HSE Enforcement Monitor Actor via the Apify API and prints each
# delivered record. Install first: pip install apify-client
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

run = client.actor("stefano_seggio/uk-hse-enforcement-monitor").call(run_input=run_input)

items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
for item in items:
    party = item.get("defendantName") or item.get("recipientName")
    print(f"{item['event_type']} | {item['recordType']} | {item['record_id']} | {party}")
```

### Node.js (`apify-client`)

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const input = {
  datasets: ['convictions', 'notices'],
  nameContains: 'Balfour Beatty',
  region: '3',
  industry: '13',
  minTotalFineGbp: 50000,
  onlyNew: true,
  maxItemsPerDataset: 50,
};

const run = await client.actor('stefano_seggio/uk-hse-enforcement-monitor').call(input);
const { items } = await client.dataset(run.defaultDatasetId).listItems();

for (const item of items) {
  const party = item.defendantName || item.recipientName;
  console.log(`${item.event_type} | ${item.recordType} | ${item.record_id} | ${party}`);
}
```

Or run it straight from the [Actor page](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor) with no code at all - paste the same input into the web UI and hit Start. Full, runnable copies of the Node.js and Python examples above live in this repo under [`examples/`](examples) (`call-actor.cjs`, `call_actor.py`).

## Use this from Claude Desktop, Cursor, or Windsurf (via MCP)

This Actor is also reachable as an MCP tool through Apify's own hosted `@apify/actors-mcp-server`, scoped to just this one Actor via a `?tools=` query string — not the full fleet. Get a token from [Apify Console → Settings → Integrations](https://console.apify.com/settings/integrations) first.

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS) — uses the `mcp-remote` stdio bridge. Note: `mcp-remote` does not expand shell environment variables inside the JSON string, so paste the literal token in place of `${APIFY_TOKEN}` below, and keep this file out of version control.

```json
{
  "mcpServers": {
    "delta-registry-uk-hse-enforcement-monitor": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.apify.com/?tools=stefano_seggio/uk-hse-enforcement-monitor",
        "--header",
        "Authorization: Bearer ${APIFY_TOKEN}"
      ]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json` or `~/.cursor/mcp.json`) — native HTTP transport:

```json
{
  "mcpServers": {
    "delta-registry-uk-hse-enforcement-monitor": {
      "url": "https://mcp.apify.com/?tools=stefano_seggio/uk-hse-enforcement-monitor",
      "headers": {
        "Authorization": "Bearer ${APIFY_TOKEN}"
      }
    }
  }
}
```

**Windsurf** (`~/.codeium/windsurf/mcp_config.json`) — uses `serverUrl`, not `url`. Windsurf's `${env:...}` syntax genuinely does resolve from the environment, unlike Claude Desktop's config above:

```json
{
  "mcpServers": {
    "delta-registry-uk-hse-enforcement-monitor": {
      "serverUrl": "https://mcp.apify.com/?tools=stefano_seggio/uk-hse-enforcement-monitor",
      "headers": {
        "Authorization": "Bearer ${env:APIFY_TOKEN}"
      }
    }
  }
}
```

Want the full 28-actor fleet in one closed-scope config instead of just this Actor? See [`MCP_INTEGRATION.md`](https://github.com/stefanoseggio/delta-registry-website/blob/main/MCP_INTEGRATION.md) in the `delta-registry-website` repo.

## Input & Output Schema

### Input

Every filter below is applied server-side by the HSE register itself, so a narrow run only touches the pages it needs. Full field list from [`.actor/input_schema.json`](.actor/input_schema.json):

| Field | Type | Default | Description |
|---|---|---|---|
| `datasets` | array | `["convictions", "notices"]` | Which register(s) to pull: convictions (prosecutions & fines) and/or enforcement notices. |
| `nameContains` | string | - | Substring match on the defendant's (convictions) or recipient's (notices) name - the contractor-vetting filter. |
| `descriptionContains` | string | - | Full-text substring over the case description (convictions) or notice summary (notices), e.g. `asbestos`, `scaffold`, `silica`. |
| `localAuthorityContains` | string | - | Local authority where the offence occurred, e.g. `Bradford`, `Cardiff UA`. |
| `mainActivityContains` | string | - | SIC 2007 code or activity-description text, e.g. `43910` or `ROOFING`. |
| `region` | string | any | HSE's seven UK regions, e.g. `3` North West, `6` London, `7` Scotland. |
| `country` | string | any | Country of the offence location: England, Scotland, Wales, Jersey. |
| `industry` | string | any | HSE's five industry groups, e.g. `13` Construction, `15` Manufacturing. |
| `hseDivision` | string | any | HSE's finer-grained operational division (11 UK/devolved divisions). |
| `dateFrom` / `dateTo` | string | - | Offence date (convictions) / served date (notices): absolute (`2026-01-01`) or relative (`90 days`, `6 months`). |
| `hseReference` | string | - | Numeric HSE Reference for one defendant/recipient - returns everything about that one party across both registers. |
| `recordNumber` | string | - | Look up a single record by its case or notice number. |
| `defendantStatus` | string | any | Convictions only: legal form of the defendant (Private Company, Individual, Sole Trader, LLP, Local Authority, etc.). |
| `resultingFromFatality` | string | `any` | Convictions only: `yes` restricts to RIDDOR-reportable-fatality cases, `no` excludes them. |
| `minTotalFineGbp` / `maxTotalFineGbp` | integer | - | Convictions only: total fine range in GBP. |
| `noticeTypes` | array | `[]` | Notices only: HSE's nine notice-type codes, e.g. `03` Improvement Notice, `08` Immediate Prohibition Notice. Several selected = union. |
| `act` | string | any | Notices only: primary legislation breached (`legislationBreached` in the output), e.g. Health and Safety At Work Act 1974. |
| `eventTypes` | array | all three | Delta mode: which of `SANCTION` (new conviction), `NEW_LISTING` (new notice), `UPDATED` to deliver. |
| `onlyNew` | boolean | `false` | Delta mode - see Reliability below. |
| `recheckDays` | integer | `180` | Delta mode: re-read known open records for this many days to detect `UPDATED` events (0 disables it; up to 2,000 records re-checked per run). |
| `deltaStateName` | string | filter fingerprint | Names the persistent state store for a monitoring task; set the same name on two tasks to share one memory. |
| `resetState` | boolean | `false` | Forget all previously delivered records for this delta state and re-baseline. |
| `maxItemsPerDataset` | integer | `100` | Hard cap on delivered records per register per run (and on cost), 1-900 - sized so even the ~30,000-record notices register with full detail fetch stays inside the run's 3,600s timeout; run `onlyNew=false` more than once, or narrow the filters, for more history than one capped run returns. |
| `fetchDetail` / `fetchBreachDetail` / `fetchPartyDetail` | boolean | `true` | Which extra pages to open per record - case/notice detail, per-breach legislation, and the defendant/recipient's own profile and history. |
| `maxConcurrency` | integer | `5` | Run-wide cap on simultaneous HTTP requests to the register. |
| `dateRange` | string | - | Legacy (v1), hidden from the input UI: `"24h"`, `"7d"` or `"30d"`, interpreted as `dateFrom`. Kept for tasks created before `dateFrom`/`dateTo` existed. |

### Output

One record per conviction or notice, with raw site strings kept next to normalised twins. A real notice record (fields trimmed for length - every record carries 86 fields, per `.actor/dataset_schema.json`):

```json
{
  "record_id": "314719061",
  "event_type": "NEW_LISTING",
  "scraped_at": "2026-09-07T21:10:39.804Z",
  "is_new": true,
  "source_url": "https://resources.hse.gov.uk/notices/notices/notice_details.asp?SF=CN&SV=314719061",
  "data_source": "Contains public sector information published by the Health and Safety Executive and licensed under the Open Government Licence v3.0 (HSE public registers of convictions and enforcement notices, resources.hse.gov.uk)",
  "recordType": "notice",
  "noticeNumber": "314719061",
  "recipientName": "Llanelec Precision Engineering Company Limited",
  "recipientId": "1108773",
  "noticeType": "Improvement Notice",
  "noticeCategory": "Improvement",
  "isImmediate": false,
  "servedDateIso": "2024-12-05",
  "complianceDateIso": "2025-03-03",
  "revisedComplianceDateIso": "2025-03-31",
  "effectiveComplianceDateIso": "2025-03-31",
  "result": "Complied with",
  "isOngoing": false,
  "isCompliedWith": true,
  "breachCount": 2,
  "legislationBreached": [
    "Health and Safety At Work Act 1974",
    "Management of Health & Safety at Work Regulations 1999"
  ],
  "localAuthority": "Neath & Port Talbot UA",
  "region": "Wales & South West",
  "industry": "Manufacturing",
  "sicDescription": "MACHINING",
  "partyStatus": "Private Company",
  "partyConvictionCount": 0,
  "partyNoticeCount": 22,
  "isRepeatOffender": true,
  "contentHash": "e20670777ba0369e",
  "firstSeenAt": "2026-09-07"
}
```

| Field | Description |
|---|---|
| `record_id` | Stable identifier (case or notice number). |
| `event_type` | `NEW_LISTING` (notice) / `SANCTION` (conviction) on first delivery, `UPDATED` on a detected change. |
| `scraped_at` | UTC timestamp this record was captured. |
| `is_new` | `true` on a record's first-ever appearance in the dataset. |
| `source_url` | Direct link to the record's own page on the HSE register. |
| `data_source` | OGL v3.0 attribution string, present on every record. |
| `recordType` | `notice` or `conviction`. |
| `noticeNumber` / `recipientName` / `recipientId` | Notices: the register's own identifiers and the served party's name/HSE Reference. |
| `noticeType` / `noticeCategory` / `isImmediate` | Notice classification - full type text, category (Improvement/Prohibition), and whether it took immediate effect. |
| `servedDateIso` / `complianceDateIso` / `revisedComplianceDateIso` / `effectiveComplianceDateIso` | Normalised ISO dates for when the notice was served and when compliance was/is due. |
| `result` / `isOngoing` / `isCompliedWith` | Current status of the notice in plain text plus two derived booleans. |
| `breachCount` / `legislationBreached` | Number of breaches and the parsed list of Acts/Regulations cited. |
| `localAuthority` / `region` / `industry` / `sicDescription` | Location and activity classification, normalised from the register's own codes. |
| `partyStatus` / `partyConvictionCount` / `partyNoticeCount` / `isRepeatOffender` | The recipient/defendant's legal form and enforcement history across both registers. |
| `contentHash` | Content-hash fingerprint of the record's page, used to detect `UPDATED` events since the register has no "last updated" field. |
| `firstSeenAt` | Date this Actor first delivered the record. |

A conviction record carries the same integrity envelope (`record_id`, `event_type: "SANCTION"`, `source_url`, `data_source`) plus `caseNumber`, `defendantName`, `offenceDateIso`, `hearingDateIso`, `totalFineGbp`, `totalCostsGbp`, `totalPenaltyGbp`, `resultingFromFatality`, `hasCustodialSentence`, `courtLevel` and a `breaches[]` array with each breach's court, Act section / regulation paragraph, hearing date, result and per-breach fine. The dataset can be downloaded as JSON, CSV, Excel or XML, and read through five ready-made Output-tab views (Overview, Convictions & fines, Enforcement notices, Compliance tracker, Defendants & recipients).

## Reliability

Delta mode (`onlyNew: true`) tracks state in a named, per-filter-set key-value store rather than trusting the register's own sort order, because the listings are sorted by offence/issue date, which lags publication by weeks to years. Each run walks the registers in entry order (case/notice number descending) - the whole ~210-record convictions register every time, the notices register until it meets two consecutive already-known pages - and remembers each stored record's page **content hash**, since the register has no "last updated" field of its own; a changed hash on a known open record (an Improvement Notice still "Ongoing", or any conviction, re-read for up to `recheckDays`) is delivered again as `UPDATED`. Memory is written only for records actually stored, and new records are delivered oldest-first, so a spending limit, timeout or platform migration mid-run never loses a *stored* record - the next run simply resumes. The listing walk itself (before any record is stored) is strictly sequential, one page at a time, so `maxItemsPerDataset` is capped at 900 (see above) to keep even a worst-case, `onlyNew=false` walk of the ~30,000-record notices register inside the run's 3,600s timeout with margin, rather than risk a run that times out mid-walk having delivered nothing at all. A first delta run establishes a persisted **baseline** (the oldest record it delivered); later capped runs leave a per-register **walk watermark** so the next run backfills any batch the cap cut short instead of silently skipping it. The state store holds up to 50,000 entries per register. Record pages that fail to load are never taken at face value: a new record is held back and retried across runs, only surfacing as a listing-only record after being missing on three separate days; if more than 30% of a batch (or 5 records in a row) go missing at once, the run fails outright as a site-outage signal instead of stubbing data.

## Why not just scrape it yourself

- **Zero infrastructure** - no server, cron host, or classic-ASP scraping pipeline to stand up and maintain; Apify's platform runs the schedule.
- **Managed scheduling and delta state** - the content-hash delta engine tracks every record across runs via a per-filter-set Key-Value Store, so you never reprocess something unchanged.
- **No proxy or session babysitting** - retrying, backing-off HTTP requests with a tuned concurrency cap already handle this classic-ASP site's quirks for you.
- **Built-in cross-run change detection** - content-hash-based `UPDATED` events catch a notice being complied with or a hearing being added, which a one-off cron scraper won't notice without building its own state layer and page-diffing logic.

## Contributing & Local Setup

The real, buildable TypeScript source for this Actor **is** checked into this repository (`src/`, `test/`, `package.json`) — this is not a thin documentation wrapper. To run it locally:

```bash
git clone https://github.com/stefanoseggio/uk-hse-enforcement-monitor.git
cd uk-hse-enforcement-monitor
npm install
apify login          # paste your Apify API token
apify run             # runs the Actor locally against src/main.ts, using .actor/input_schema.json defaults
```

`npm test` runs the test suite under `test/`. `npx tsc --noEmit` type-checks the project against `tsconfig.json`. Local runs still hit the real, live HSE registers - there is no bundled fixture/mock server - so keep `maxItemsPerDataset` and `maxConcurrency` modest while developing. Bug reports and pull requests against `src/` are welcome via GitHub issues/PRs on this repository; behavioral changes are also reflected in the Actor's Store listing and Changelog tab on the next `apify push`.

## Support & Enterprise SLA

This Actor is built and maintained by an independent developer, not a staffed vendor team - there is no dedicated support desk or contractual uptime SLA on offer. Bugs, source-coverage questions and field requests are handled through this Actor's Apify Store Issues tab and are typically addressed within 48 hours; versioned changes are listed in the Changelog tab.

---

This Actor is part of **Delta Registry** - pay-per-event regulatory & compliance data infrastructure built and operated by Stefano Seggio. For professional inquiries or enterprise licensing, connect on [LinkedIn](https://www.linkedin.com/in/stefanoseggio-deltaregistry); for the rest of the fleet, see [github.com/stefanoseggio](https://github.com/stefanoseggio).
