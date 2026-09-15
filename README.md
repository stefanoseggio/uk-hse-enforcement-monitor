# UK HSE Enforcement Monitor - Health & Safety Prosecutions and Notices (Compliance Risk Tracker)

[![Built for Apify](https://img.shields.io/badge/Built%20for-Apify-00C1A2?style=flat-square&logo=apify&logoColor=white)](https://apify.com)
[![Pay-Per-Event](https://img.shields.io/badge/Pay--Per--Event-from%20%240.001%2Fevent-blue?style=flat-square)](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Apache 2.0 License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square&logo=apache&logoColor=white)](./LICENSE)

[![Run on Apify](https://img.shields.io/badge/Run%20on-Apify-00C1A2?style=for-the-badge&logo=apify&logoColor=white)](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor)

## Executive Value Proposition

Checking a company's HSE enforcement history by hand means running two separate search wizards on a 2013-era classic-ASP site, paging through ten rows at a time, and coming back later to re-check each notice's own page because the register carries no "last updated" field and no alerts. This Actor runs both public HSE registers - the register of convictions (prosecutions, fines, breaches, courts) and the register of enforcement notices (Improvement, Prohibition) - as one server-side-filtered query and turns the result into structured JSON, CSV or Excel with normalised dates, numeric GBP fines and split-out legislation fields. Turn on "Only new" and put it on a schedule, and every later run returns only the sanctions and notices that appeared or changed on the register since the previous run, so watching a contractor list or a whole industry stops being a manual re-search and becomes something a webhook can deliver.

## Enterprise Use Cases

- **Contractor and supply-chain risk screening.** H&S compliance teams running CHAS/SSIP/Constructionline-style vetting can filter on `nameContains` for a named subcontractor, or leave it open and watch `event_type`, `noticeCategory` and `isImmediate` for anything landing across an approved-supplier list. `partyHseReference` and `isRepeatOffender` carry the count across both registers, so a name that looks like a first offence in isolation can be flagged as a repeat pattern instead.
- **Underwriting and renewal risk assessment.** Employers'-liability and public-liability underwriters can pull `totalFineGbp`, `resultingFromFatality`, `hasCustodialSentence`, `partyConvictionCount` and `partyNoticeCount` for a risk before binding or at renewal, and filter a whole book by `minTotalFineGbp` / `maxTotalFineGbp` to build a watch-list of six-figure or fatal cases rather than reading each judgment.
- **Industry enforcement trend tracking.** Legal, PR and H&S-consultancy teams can slice by `region`, `industry`, `noticeTypes` and `dateFrom`/`dateTo` to see who was just served an Immediate Prohibition Notice in a given sector, or use `legislationBreached` and `sicDescription` to track which Acts and activities are driving prosecutions this quarter - source material for briefings, business development outreach or trade-press coverage.

## Input

```json
{
  "nameContains": "Balfour Beatty",
  "industry": "13",
  "region": "3",
  "noticeTypes": ["08"],
  "minTotalFineGbp": 50000,
  "dateFrom": "180 days",
  "onlyNew": true,
  "maxItemsPerDataset": 200
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `datasets` | array | `["convictions", "notices"]` | Which register(s) to pull: convictions (prosecutions & fines) and/or enforcement notices. |
| `nameContains` | string | - | Substring match on the defendant's (convictions) or recipient's (notices) name - the contractor-vetting filter. |
| `region` | string | - | HSE's seven UK regions, e.g. `3` North West, `6` London, `7` Scotland. |
| `industry` | string | - | HSE's five industry groups, e.g. `13` Construction, `15` Manufacturing. |
| `minTotalFineGbp` / `maxTotalFineGbp` | integer | - | Convictions only: total fine range in GBP. |
| `noticeTypes` | array | `[]` | Notices only: HSE's nine notice-type codes, e.g. `03` Improvement Notice, `08` Immediate Prohibition Notice. Several selected = union. |
| `dateFrom` / `dateTo` | string | - | Offence date (convictions) / served date (notices): absolute (`2026-01-01`) or relative (`90 days`, `6 months`). |
| `onlyNew` | boolean | `false` | Delta mode - see Reliability below. |
| `recheckDays` | integer | `180` | Delta mode: re-read known open records for this many days to detect `UPDATED` events (0 disables it; up to 2,000 records re-checked per run). |
| `maxItemsPerDataset` | integer | `100` | Hard cap on delivered records per register per run (and on cost), 1-100,000. |
| `fetchDetail` / `fetchBreachDetail` / `fetchPartyDetail` | boolean | `true` | Which extra pages to open per record - case/notice detail, per-breach legislation, and the defendant/recipient's own profile and history. |

Every filter above is applied server-side by the HSE register itself, so a narrow run only touches the pages it needs.

## Quick start

Via the [Apify CLI](https://docs.apify.com/cli):

```bash
apify call stefano_seggio/uk-hse-enforcement-monitor --input '{
  "datasets": ["convictions", "notices"],
  "nameContains": "Balfour Beatty",
  "region": "3",
  "minTotalFineGbp": 50000,
  "onlyNew": true,
  "maxItemsPerDataset": 50
}'
```

Or run it straight from the [Actor page](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor) with no code at all - paste the same input into the web UI and hit Start. See `examples/` in this repo for the equivalent Node.js and Python calls via `apify-client`.

## Output

One record per conviction or notice, with raw site strings kept next to normalised twins. A real notice record (fields trimmed for length - every record carries 90+ fields):

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

A conviction record carries the same integrity envelope (`record_id`, `event_type: "SANCTION"`, `source_url`, `data_source`) plus `caseNumber`, `defendantName`, `offenceDateIso`, `hearingDateIso`, `totalFineGbp`, `totalCostsGbp`, `totalPenaltyGbp`, `resultingFromFatality`, `hasCustodialSentence`, `courtLevel` and a `breaches[]` array with each breach's court, Act section / regulation paragraph, hearing date, result and per-breach fine. The dataset can be downloaded as JSON, CSV, Excel or XML, and read through five ready-made Output-tab views (Overview, Convictions & fines, Enforcement notices, Compliance tracker, Defendants & recipients).

## Reliability

Delta mode (`onlyNew: true`) tracks state in a named, per-filter-set key-value store rather than trusting the register's own sort order, because the listings are sorted by offence/issue date, which lags publication by weeks to years. Each run walks the registers in entry order (case/notice number descending) - the whole ~210-record convictions register every time, the notices register until it meets two consecutive already-known pages - and remembers each stored record's page **content hash**, since the register has no "last updated" field of its own; a changed hash on a known open record (an Improvement Notice still "Ongoing", or any conviction, re-read for up to `recheckDays`) is delivered again as `UPDATED`. Memory is written only for records actually stored, and new records are delivered oldest-first, so a spending limit, timeout or platform migration mid-run never loses a record - the next run simply resumes. A first delta run establishes a persisted **baseline** (the oldest record it delivered); later capped runs leave a per-register **walk watermark** so the next run backfills any batch the cap cut short instead of silently skipping it. The state store holds up to 50,000 entries per register. Record pages that fail to load are never taken at face value: a new record is held back and retried across runs, only surfacing as a listing-only record after being missing on three separate days; if more than 30% of a batch (or 5 records in a row) go missing at once, the run fails outright as a site-outage signal instead of stubbing data.

## Instant Terminal Run (cURL)

Runs synchronously and returns the resulting dataset items directly in the response - no polling needed. Get your token from [console.apify.com/settings/integrations](https://console.apify.com/settings/integrations).

```bash
curl -X POST "https://api.apify.com/v2/acts/jV35qppM82fjyjsle/run-sync-get-dataset-items?token=<YOUR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
  "datasets": [
    "convictions",
    "notices"
  ],
  "maxItemsPerDataset": 50,
  "onlyNew": true
}'
```

## Sample Extracted Dataset (JSON)

One real record from this Actor's own dataset, matching `.actor/dataset_schema.json`:

```json
{
  "record_id": "314719061",
  "event_type": "NEW_LISTING",
  "scraped_at": "2026-09-07T21:10:39.804Z",
  "is_new": true,
  "source_url": "https://resources.hse.gov.uk/notices/notices/notice_details.asp?SF=CN&SV=314719061",
  "recordType": "notice",
  "noticeNumber": "314719061",
  "recipientName": "Llanelec Precision Engineering Company Limited",
  "noticeType": "Improvement Notice",
  "servedDateIso": "2024-12-05",
  "complianceDateIso": "2025-03-03",
  "result": "Complied with",
  "region": "Wales & South West",
  "industry": "Manufacturing"
}
```

## Pricing (Pay-Per-Event)

Pay per event, platform usage included - you pay only for records delivered, never for compute:

| Event | Title | What it covers | Price |
|---|---|---|---|
| `result` | Record (full detail) | A record with the case/notice page and breach detail (court, Act section, regulation paragraph) | $0.003/event |
| `result-summary` | Record (listing summary) | A lighter record: `fetchDetail: false` or `fetchBreachDetail: false`, or a page that could not be fetched | $0.001/event |
| Actor start | - | Once per run | $0.00005 |

A quiet monitoring run with nothing new to deliver costs the start fee only - no records, no charge.

## Support & Enterprise SLA

This Actor is built and maintained by an independent developer, not a staffed vendor team - there is no dedicated support desk or contractual uptime SLA on offer. Bugs, source-coverage questions and field requests are handled through this Actor's Apify Store Issues tab and are typically addressed within 48 hours; versioned changes are listed in the Changelog tab.

---

This Actor is part of **Delta Registry** - pay-per-event regulatory & compliance data infrastructure built and operated by Stefano Seggio. For professional inquiries or enterprise licensing, connect on [LinkedIn](https://www.linkedin.com/in/stefanoseggio-deltaregistry); for the rest of the fleet, see [github.com/stefanoseggio](https://github.com/stefanoseggio).
