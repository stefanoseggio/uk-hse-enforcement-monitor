# UK HSE Enforcement Monitor - Prosecutions & Notices Scraper

**The HSE enforcement API that the Health and Safety Executive never shipped.** This Actor turns the UK's two public **HSE enforcement registers on resources.hse.gov.uk** - the **register of convictions** (every successful HSE prosecution of the last five years: defendant, offence, fine, costs, breaches, court, hearing date) and the **register of enforcement notices** (30,000+ **Improvement and Prohibition notices** of the last ten years: recipient, type, served and compliance dates, result, legislation breached) - into clean JSON/CSV, and keeps them under watch: put it on a schedule with _Only new_ switched on and each run returns just the sanctions and notices that **appeared on the register or changed since the last run**.

[![UK HSE Enforcement Monitor](https://apify.com/actor-badge?actor=stefano_seggio/uk-hse-enforcement-monitor)](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor)

- **Search like the register, at API speed** - company or person name, case summary, local authority, SIC activity, region, country, industry, HSE division, date window, defendant status, fatality, fine range, notice type and Act are applied by the register itself (server-side), so a narrow run touches a handful of pages.
- **See what nobody else sees** - the register's own listings are sorted by offence / issue date, which lags publication by weeks to years; a GBP 400,000 Skanska/Costain/Strabag conviction sat on the last page for months. This Actor walks in entry order and re-reads open records, tagging every row `SANCTION`, `NEW_LISTING` or `UPDATED` (a notice complied with, a revised compliance date, a hearing added).
- **Warehouse-ready, not screen-scraped** - every raw site string comes with a normalised twin: ISO dates, numeric GBP fine / costs / total, postcode, country, SIC code, notice-type flags, days to comply, overdue / complied booleans, custodial and fatality flags, legislation split into Act / section / regulation / paragraph, plus the defendant's or recipient's **legal status, registered address, HSE reference and repeat-offender counts**.
- **No browser, no proxy, no login.** Plain HTTP, 256 MB of memory, pay per record.

## What are the HSE enforcement registers and why do they matter?

The Health and Safety Executive is Great Britain's workplace safety regulator. When an inspector finds a serious breach they serve an **Improvement Notice** (fix it by a date) or a **Prohibition Notice** (stop the activity now); when a breach is prosecuted and the defendant is convicted, the case, the fine and the costs are published. HSE keeps both on public registers at [resources.hse.gov.uk](https://resources.hse.gov.uk/) - convictions for five years, notices for ten - and they are the UK's direct equivalent of US OSHA inspection and violation data.

For anyone who vets contractors, underwrites employers' liability, screens counterparties or sells health-and-safety services, the registers are the primary source. But the site is a 2013-era classic-ASP search wizard: ten rows per page, no API, no CSV of the notices, no alerts, no "last updated" field, and a default sort that hides late-published records. This Actor is that missing layer.

## Quick start

1. Click **Try for free**. The default input returns the 100 most recently entered convictions and the 100 most recently entered notices with full detail - about a minute.
2. Open the **Output** tab: five ready-made views (Overview, Convictions & fines, Enforcement notices, Compliance tracker, Defendants & recipients) or export **JSON, CSV or Excel**.
3. Narrow it: type a company name, pick _Construction_ and _North West_, choose _Immediate Prohibition Notice_, or set _Date from_ to `90 days`.
4. Monitor it: keep **Only new** on, add an [Apify Schedule](https://docs.apify.com/platform/schedules) (daily is plenty - HSE enters records in batches) and a [webhook](https://docs.apify.com/platform/integrations/webhooks) or the Slack / Make / Zapier integration. From the second run on, you only pay for what actually appeared or changed.

## Who uses HSE enforcement data

| Team                                                                              | Question they ask                                                                                  | Fields that answer it                                                                                       | Decision                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Supply-chain / contractor pre-qualification (CHAS, SSIP, Constructionline buyers) | Has any subcontractor picked up a notice or conviction since we approved them?                     | `nameContains`, `event_type`, `noticeCategory`, `isImmediate`, `partyHseReference`, `isRepeatOffender`      | Approve / suspend / re-audit at onboarding and renewal; duty-of-care evidence |
| Employers' liability & public liability underwriters, MGAs, brokers               | Does this risk have enforcement history, and did anything new land before renewal?                 | `totalFineGbp`, `resultingFromFatality`, `hasCustodialSentence`, `partyConvictionCount`, `partyNoticeCount` | Price, load, survey or decline                                                |
| KYB, adverse-media and ESG data vendors                                           | Give me the whole register keyed on company name and address, then the daily delta.                | `partyStatus`, `partyAddress`, `partyPostcode`, `contentHash`, `firstSeenAt`                                | "UK H&S enforcement" attribute on company profiles; subscriber alerts         |
| H&S consultancies and regulatory-defence law firms (business development)         | Who in my region / industry was just served an Improvement Notice with a compliance date in weeks? | `region`, `industry`, `servedDateIso`, `effectiveComplianceDateIso`, `daysUntilCompliance`, `isOngoing`     | Outbound campaigns to fresh recipients; prosecution-defence pitches           |
| Journalists, trade unions, academics, H&S trade press                             | Which fatal cases, custodial sentences and largest fines were published this week, by sector?      | `resultingFromFatality`, `hasCustodialSentence`, `totalFineGbp`, `sicDescription`, `legislationBreached`    | Story selection, FOI targets, campaign statistics                             |
| M&A, property and ESG due-diligence analysts                                      | Any HSE history for the target and its subsidiaries?                                               | `nameContains`, `hseReference`, `partyOtherCaseNumbers`, `partyOtherNoticeNumbers`                          | Disclosure schedule, controversy score                                        |

## Sample output

One real notice record (fields trimmed for length; every record carries all 90+ fields listed below):

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
    "isProhibition": false,
    "isImmediate": false,
    "servedDate": "05/12/2024",
    "servedDateIso": "2024-12-05",
    "complianceDateIso": "2025-03-03",
    "revisedComplianceDateIso": "2025-03-31",
    "effectiveComplianceDateIso": "2025-03-31",
    "daysToComply": 88,
    "daysUntilCompliance": -525,
    "hasRevisedComplianceDate": true,
    "result": "Complied with",
    "isOngoing": false,
    "isCompliedWith": true,
    "isOverdue": false,
    "breachCount": 2,
    "legislationBreached": [
        "Health and Safety At Work Act 1974",
        "Management of Health & Safety at Work Regulations 1999"
    ],
    "breaches": [
        {
            "breachId": "001",
            "actOrRegulation": "Health and Safety At Work Act 1974 / 2 / 1",
            "legislation": "Health and Safety At Work Act 1974",
            "provision": "2",
            "paragraph": "1"
        },
        {
            "breachId": "002",
            "actOrRegulation": "Management of Health & Safety at Work Regulations 1999 / 3 / 1",
            "legislation": "Management of Health & Safety at Work Regulations 1999",
            "provision": "3",
            "paragraph": "1"
        }
    ],
    "address": "Llanelec Prec. Eng. Co. Ltd./L, Llanelec Precision Engineering, Nidum House, Neath Abbey Business Park, NEATH, West Glamorgan, SA10 7DR, Wales",
    "postcode": "SA10 7DR",
    "country": "Wales",
    "region": "Wales & South West",
    "localAuthority": "Neath & Port Talbot UA",
    "industry": "Manufacturing",
    "mainActivity": "25620 - MACHINING",
    "sicCode": "25620",
    "sicDescription": "MACHINING",
    "hseDivision": "Wales",
    "partyStatus": "Private Company",
    "partyEntityType": "company",
    "partyAddress": "Nidum House, Neath Abbey Business Park, NEATH, West Glamorgan, SA10 7DR",
    "partyPostcode": "SA10 7DR",
    "partyHseReference": "1108773",
    "partyConvictionCount": 0,
    "partyNoticeCount": 22,
    "isRepeatOffender": true,
    "detailFetched": true,
    "breachDetailFetched": true,
    "partyDetailFetched": true,
    "contentHash": "e20670777ba0369e",
    "firstSeenAt": "2026-09-07"
}
```

A conviction looks the same with `"recordType": "conviction"`, `"event_type": "SANCTION"`, `caseNumber`, `defendantName`, `offenceDateIso`, `hearingDateIso`, `totalFineGbp: 400000`, `totalCostsGbp: 8974.16`, `totalPenaltyGbp`, `resultingFromFatality`, `hasCustodialSentence`, `courtLevel`, and `breaches[]` carrying `court`, `courtLevel`, `dateOfHearingIso`, `result` ("Fine", "Prison Suspended"), `resultCategory`, `isCustodial`, `fineGbp`, `actName` / `actSection` / `actSubSection`, `regulationName` / `regulationNumber` / `regulationParagraph` and the breach page `source_url`.

## Output fields

**Integration envelope** (identical across all of this developer's public-register Actors, so one webhook parser serves them all):

| Field         | Type    | Description                                                                                                                                                                          |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `record_id`   | string  | `caseNumber` or `noticeNumber` - stable across runs                                                                                                                                  |
| `event_type`  | string  | `SANCTION` (a conviction not delivered before), `NEW_LISTING` (a notice not delivered before), `UPDATED` (a previously delivered record whose case/notice page changed - delta mode) |
| `scraped_at`  | string  | ISO-8601 UTC timestamp of the extraction                                                                                                                                             |
| `is_new`      | boolean | `true` if never delivered by a previous run of this delta memory                                                                                                                     |
| `source_url`  | string  | The official HSE register page                                                                                                                                                       |
| `data_source` | string  | Open Government Licence v3.0 attribution string                                                                                                                                      |

**Record** - raw site strings are kept verbatim; normalised twins sit next to them:

| Group                              | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                           | `recordType`, `caseNumber` / `noticeNumber`, `defendantName` / `recipientName`, `defendantId` / `recipientId`, `description`                                                                                                                                                                                                                                                                                                                                                                          |
| Conviction                         | `offenceDate` / `offenceDateIso`, `hearingDate` / `hearingDateIso` (latest hearing across the breaches - the closest thing to a publication date), `totalFine` / `totalFineGbp`, `totalCosts` / `totalCostsGbp`, `totalPenaltyGbp`, `resultingFromFatality`, `hasCustodialSentence`, `breachCount`, `legislationBreached`, `courtLevel`                                                                                                                                                               |
| Conviction breaches (`breaches[]`) | `breachId`, `court`, `courtLevel`, `act` / `actName` / `actSection` / `actSubSection`, `regulation` / `regulationName` / `regulationNumber` / `regulationParagraph`, `actOrRegulation` / `legislation` / `provision` / `paragraph`, `dateOfHearing` / `dateOfHearingIso`, `result` (breach page), `resultListing` (breach list, e.g. "Guilty-Prison Suspended"), `resultCategory` (fine, custodial, suspended_custodial, no_separate_penalty, other), `isCustodial`, `fine` / `fineGbp`, `source_url` |
| Notice                             | `noticeType`, `noticeTypeListing`, `noticeCategory`, `isProhibition`, `isImprovement`, `isImmediate`, `isDeferred`, `isCrown`, `isComah`, `isFepa`, `servedDate` / `servedDateIso`, `complianceDate` / `complianceDateIso`, `revisedComplianceDate` / `revisedComplianceDateIso`, `effectiveComplianceDateIso`, `daysToComply`, `daysUntilCompliance`, `hasRevisedComplianceDate`, `result`, `isOngoing`, `isCompliedWith`, `isOverdue`, `descriptionItemIds`, `breachCount`, `legislationBreached`   |
| Notice breaches (`breaches[]`)     | `breachId`, `actOrRegulation`, `legislation`, `provision`, `paragraph`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Location of offence                | `address`, `postcode`, `country`, `region`, `localAuthority`, `industry`, `mainActivity` / `sicCode` / `sicDescription`, `typeOfLocation`, `hseGroup`, `hseDirectorate`, `hseArea`, `hseDivision`                                                                                                                                                                                                                                                                                                     |
| Party (`fetchPartyDetail`)         | `partyStatus` (Private Company, Individual, Self Employed (Sole Trader), LLP, Partnership, Local Authority, NHS...), `partyEntityType`, `partyAddress`, `partyPostcode`, `partyHseReference`, `partyUrl`, `partyConvictionCount`, `partyNoticeCount`, `partyOtherCaseNumbers`, `partyOtherNoticeNumbers`, `isRepeatOffender`                                                                                                                                                                          |
| Provenance                         | `detailFetched`, `detailError` (`NOT_FOUND` when the record's page was missing in 3 runs on different days - in delta mode - or once in a full run), `breachDetailFetched`, `partyDetailFetched`, `partyDetailError`, `contentHash` (the delta engine's change key), `firstSeenAt`                                                                                                                                                                                                                    |

Within a run, `UPDATED` events are appended first, then new records **oldest-first** (that is what makes delta mode crash-safe - see _How monitoring works_). The Output views show newest first; on the API add `?desc=true`.

## Input

Every filter is applied server-side by the register.

| Field                                | Type     | Default                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `datasets`                           | string[] | `["convictions", "notices"]` | Which register(s) to pull                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `nameContains`                       | string   | -                            | Substring on the defendant's / recipient's name (the contractor-vetting filter)                                                                                                                                                                                                                                                                                                                                                            |
| `descriptionContains`                | string   | -                            | Substring over the case description / notice summary (`asbestos`, `scaffold`, `silica`)                                                                                                                                                                                                                                                                                                                                                    |
| `localAuthorityContains`             | string   | -                            | Local authority of the offence                                                                                                                                                                                                                                                                                                                                                                                                             |
| `mainActivityContains`               | string   | -                            | A number matches the SIC 2007 code, other text the activity description (`ROOFING`) - two different site columns. The code match is a **contains** match on the register: `43910` (one class) or `4391` (a group) do what you expect; `43` also returns `14310`, `24310`, `46430`... (the site cannot select a division - use `industry`)                                                                                                  |
| `region`                             | string   | -                            | `1` Wales & South West, `2` East & South East, `3` North West, `4` Yorks & North East, `5` Midlands, `6` London, `7` Scotland                                                                                                                                                                                                                                                                                                              |
| `country`                            | string   | -                            | `8` England, `9` Scotland, `10` Wales, `11` Jersey                                                                                                                                                                                                                                                                                                                                                                                         |
| `industry`                           | string   | -                            | `12` Agriculture, `13` Construction, `14` Extractive & utility, `15` Manufacturing, `16` Service industries                                                                                                                                                                                                                                                                                                                                |
| `hseDivision`                        | string   | -                            | HSE operational division codes `17`-`27` (see the input form)                                                                                                                                                                                                                                                                                                                                                                              |
| `dateFrom`, `dateTo`                 | string   | -                            | Offence date (convictions) / served date (notices): `2026-01-01` or relative `30 days`, `6 months`, `1 year` (UK calendar, inclusive)                                                                                                                                                                                                                                                                                                      |
| `hseReference`                       | string   | -                            | Everything about one party: the numeric HSE Reference of a defendant / recipient (shared by both registers)                                                                                                                                                                                                                                                                                                                                |
| `recordNumber`                       | string   | -                            | One case number / notice number                                                                                                                                                                                                                                                                                                                                                                                                            |
| `defendantStatus`                    | string   | -                            | Convictions: `1980` Private Company, `1972` Individual, `1981` Sole Trader, `1974` Self Employed (Employer), `1976` LLP, `1978` Partnership, `1977` Local Authority, `1973` Central Government, `1975` NHS, `1979` Other                                                                                                                                                                                                                   |
| `resultingFromFatality`              | string   | `any`                        | Convictions: `any`, `yes`, `no`                                                                                                                                                                                                                                                                                                                                                                                                            |
| `minTotalFineGbp`, `maxTotalFineGbp` | integer  | -                            | Convictions: total fine range                                                                                                                                                                                                                                                                                                                                                                                                              |
| `noticeTypes`                        | string[] | `[]`                         | Notices: `03` Improvement Notice (22,000+, the ordinary one), `01` Improvement (Crown, 16), `02` Improvement (FEPA, 25), `08` Immediate Prohibition (7,600+), `06` Deferred Prohibition, `04`/`05` Deferred / Immediate Prohibition (Crown), `07` Prohibition (FEPA), `09` Prohibition (COMAH). Several = union. Labels verified against the register 2026-09-07                                                                           |
| `act`                                | string   | -                            | Notices: Act code, e.g. `502` Health and Safety at Work Act 1974, `517` Corporate Manslaughter (43 codes in the form)                                                                                                                                                                                                                                                                                                                      |
| `eventTypes`                         | string[] | all three                    | Which of `SANCTION`, `NEW_LISTING`, `UPDATED` to deliver (applied by the delta engine, not by the site - changing it later keeps the same delta memory)                                                                                                                                                                                                                                                                                    |
| `onlyNew`                            | boolean  | `false`                      | Delta mode - see below                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `recheckDays`                        | integer  | `180`                        | Delta mode: re-read known open records for this many days after first delivery to detect `UPDATED` (0 = off; up to 2,000 per run)                                                                                                                                                                                                                                                                                                          |
| `deltaStateName`                     | string   | fingerprint of the filters   | Name of the delta memory; share it between tasks on purpose, never by accident                                                                                                                                                                                                                                                                                                                                                             |
| `resetState`                         | boolean  | `false`                      | Forget delivered records and re-baseline                                                                                                                                                                                                                                                                                                                                                                                                   |
| `maxItemsPerDataset`                 | integer  | `100`                        | Cap on delivered records per register per run (and on cost). Max 100,000. On the first delta run the cap defines the baseline: the oldest record it delivers is remembered and older records are history, never delivered by later delta runs (run once with `onlyNew: false` for the history). On every later delta run the overflow is a backlog: a walk watermark makes the next run walk down to where this one stopped and deliver it |
| `fetchDetail`                        | boolean  | `true`                       | Open each case / notice page (plus, for convictions, the per-case breach list). Off = listing-row-only records at the `result-summary` price                                                                                                                                                                                                                                                                                               |
| `fetchBreachDetail`                  | boolean  | `true`                       | Convictions: open each breach page (court, Act section / Regulation paragraph). Notices: fetch the breach list. Off = `result-summary` price                                                                                                                                                                                                                                                                                               |
| `fetchPartyDetail`                   | boolean  | `true`                       | Open the defendant / recipient page and its history on both registers (status, address, HSE reference, repeat-offender counts)                                                                                                                                                                                                                                                                                                             |
| `maxConcurrency`                     | integer  | `5`                          | Run-wide cap on simultaneous requests - listing, detail, breach and party pages together (1-10)                                                                                                                                                                                                                                                                                                                                            |

### Ready-to-run examples

**Daily monitor of everything new or changed on both registers**

```json
{ "onlyNew": true, "maxItemsPerDataset": 500 }
```

**Watch a contractor list (one task per name, or one name pattern)**

```json
{ "nameContains": "Balfour Beatty", "onlyNew": true, "maxItemsPerDataset": 200 }
```

**Immediate Prohibition Notices in Construction, North West, served in the last 90 days**

```json
{
    "datasets": ["notices"],
    "noticeTypes": ["08"],
    "industry": "13",
    "region": "3",
    "dateFrom": "90 days",
    "maxItemsPerDataset": 500
}
```

**Fatal cases and six-figure fines (underwriting watch-list)**

```json
{ "datasets": ["convictions"], "resultingFromFatality": "yes", "minTotalFineGbp": 100000, "maxItemsPerDataset": 300 }
```

**Everything about one party (HSE reference from any record)**

```json
{ "hseReference": "1108773", "maxItemsPerDataset": 500 }
```

**Cold pull of the whole notices register, listing rows only (cheapest)**

```json
{ "datasets": ["notices"], "fetchDetail": false, "maxItemsPerDataset": 40000 }
```

**Compliance-date lead generation: Improvement Notices with their compliance date and result, then updates**

```json
{
    "datasets": ["notices"],
    "noticeTypes": ["03"],
    "onlyNew": true,
    "eventTypes": ["NEW_LISTING", "UPDATED"],
    "recheckDays": 365
}
```

With any Improvement code in `noticeTypes` the register renders two extra listing columns (Compliance Date, Notice Result), so `complianceDate`, `result`, `isOngoing` and `isOverdue` are filled even with `fetchDetail: false`. Add `"01", "02"` for the rare Crown / FEPA variants.

## How monitoring works (delta mode)

1. The first run with `onlyNew: true` delivers up to `maxItemsPerDataset` of the most recently entered records per register that match your filters and remembers each one's page **content hash** (the registers have no "last updated" field) in a private, named key-value store (`uk-hse-enforcement-monitor-state-<deltaStateName>`).
2. Every later run walks the registers in **entry order** (case number / notice number descending): the whole convictions register (about 210 records, 21 pages) every time, so a case published years after its offence date is never missed; the notices register until it meets two consecutive pages it already knows. New records are delivered as `SANCTION` / `NEW_LISTING`.
3. Known records that are still **open** - Improvement Notices whose Result is "Ongoing", and every conviction - are re-read for `recheckDays` after they were first delivered; when the page changed (Result "Complied with", a revised compliance date, a breach or hearing added, a fine corrected) the record is delivered again as `UPDATED`. Prohibition notices carry no Result on the register and are not re-checked.
4. Memory is written **only for records that were actually stored** - and new records are delivered oldest-first - so a spending limit, a timeout or a platform migration half-way never loses a record: the next run simply picks it up. The memory holds 50,000 entries per register (more than the whole notices register).
5. **Baseline and walk watermark.** The very first delta run (a memory that has never completed a run) is the _baseline_ run: if `maxItemsPerDataset` cuts it short, the oldest record it delivered becomes the register's **baseline** - persisted before anything is delivered and never moved except by `resetState`. Records entered _below_ the baseline are history: later delta runs never deliver them (whatever the cap - 4 or 4,000), never charge for them, and remember them as known once walked (without a page hash, so they are not re-checked for amendments). New entries above the baseline are news as usual. Every _later_ run cut short by the cap is different: HSE enters notices in batches, so a run can meet more new notices than the cap, and stopping there would leave the older part of the batch _under_ the records just delivered, where "two known pages" would hide it forever. The memory therefore also keeps, per register, the notice number where a capped walk stopped (or the lowest candidate a run could not store) as a **walk watermark**; the next run ignores known pages until it has walked down to that number, delivers the backlog, and clears the watermark. Want the history too? Run once with `onlyNew: false` (a full run ignores the baseline) or set the cap high on the first run.
6. Different **server-side filter** sets get different memories automatically (dates, limits, fetch flags, registers and `eventTypes` do not fork it); set `deltaStateName` to share one deliberately, `resetState: true` to start over. A quiet day costs a few page fetches, the re-checks and the start fee - no records, no charge.
7. A record page that cannot be read - the site's "unknown id" error (a plain HTTP 500, identical to a transient server error), a timeout after the retries, or a non-record page - is never taken at face value: a **new** record is held back - not stored, not charged, not remembered - and retried on the next runs, and only after 3 runs on different days is it delivered as a listing-only record (`detailError: "NOT_FOUND"`, `result-summary` price); a **known** record keeps being re-checked until it has been missing in 2 runs. If more than 30% of a batch (or 5 records in a row) go missing at once, the run fails as a site outage instead of stubbing anything.

Why not sort by date? Because HSE enters convictions months after the hearing and notices weeks after service, keeps the original dates, and amends records in place. Only entry order plus content hashing sees all of it.

## Scheduling and alerts: Slack, email, Make, Zapier, n8n, Google Sheets

- **Apify Schedule + webhook** - schedule the task, add a webhook on `ACTOR.RUN.SUCCEEDED` pointing at your endpoint; the payload links the dataset and every item already carries the envelope, so no parser is needed. Read the items newest-first with `?desc=true`. A failed run (blocked site, changed markup) fires `ACTOR.RUN.FAILED` instead of silently delivering nothing.
- **Slack** - the native [Apify Slack integration](https://apify.com/integrations/slack) posts each run's results to a channel.
- **Make** - _Apify > Watch Actor Runs_ -> _Get Dataset Items_ -> Slack / Gmail / Google Sheets ([apify.com/integrations/make](https://apify.com/integrations/make)).
- **Zapier** - _Apify: Finished Actor Run_ -> _Get Dataset Items_ -> anything ([apify.com/integrations/zapier](https://apify.com/integrations/zapier)).
- **n8n** - the Apify node, same pattern.
- **Google Sheets** - the [Apify Google Sheets integration](https://apify.com/integrations/google-sheets), or `=IMPORTDATA("https://api.apify.com/v2/datasets/<datasetId>/items?format=csv&desc=true&token=<token>")` (the token is then visible in the sheet - use a read-only token).

## Use it from code

**Node.js**

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/uk-hse-enforcement-monitor').call({
    industry: '13',
    region: '3',
    onlyNew: true,
    maxItemsPerDataset: 500,
});
const { items } = await client.dataset(run.defaultDatasetId).listItems({ desc: true });
for (const r of items) {
    console.log(
        r.event_type,
        r.recordType,
        r.defendantName ?? r.recipientName,
        r.totalFineGbp ?? r.noticeType,
        r.source_url,
    );
}
```

**Python**

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/uk-hse-enforcement-monitor").call(
    run_input={"nameContains": "Balfour Beatty", "maxItemsPerDataset": 200}
)
for r in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(r["record_id"], r["recordType"], r.get("defendantName") or r.get("recipientName"), r.get("partyStatus"))
```

**cURL (synchronous, up to 300 s - fine for delta runs and small pulls)**

```bash
curl -X POST "https://api.apify.com/v2/acts/stefano_seggio~uk-hse-enforcement-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN&desc=true" \
  -H "Content-Type: application/json" \
  -d '{"onlyNew": true, "maxItemsPerDataset": 500}'
```

For large backfills start the run asynchronously (`/runs`) and read the dataset when the webhook fires.

**Apify CLI**

```bash
apify call stefano_seggio/uk-hse-enforcement-monitor --input '{"datasets":["convictions"],"resultingFromFatality":"yes","maxItemsPerDataset":100}' --output-dataset
```

**AI agents (MCP)** - add `https://mcp.apify.com/?tools=stefano_seggio/uk-hse-enforcement-monitor` as an MCP server and ask: _"Has any company called Acme Scaffolding received an HSE prohibition notice or conviction, and how many does it have in total?"_

## How much does it cost to scrape the HSE registers?

Pay per event, platform usage included - you pay only for records, never for compute:

| Event            | Price                 | When                                                                                                                       |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `result`         | **$0.003** per record | A record with the case / notice page AND breach detail (court, Act section, regulation paragraph)                          |
| `result-summary` | **$0.001** per record | Anything lighter: `fetchDetail: false` (listing row only), `fetchBreachDetail: false`, or a page that could not be fetched |
| Actor start      | $0.00005              | Once per run                                                                                                               |

Worked examples: a daily monitor of both registers that finds 20 new notices and one conviction costs about **$0.06/day**; a full pull of the convictions register (about 210 cases) **$0.63**; all 7,900 Construction notices with detail **$24**; the whole 30,000-notice register as listing rows **$30**, with full detail **$91**. A quiet monitoring run with nothing new costs the start fee only. The Apify free plan's monthly credit covers well over a thousand detailed records.

Compare: contractor accreditation schemes charge GBP 300-900 per contractor per year for a check whose H&S component is largely this register, and a compliance analyst screening 200 subcontractors by hand on the site spends a full day.

## This Actor vs. the alternatives

|                   | This Actor                                                                                            | Manual register search                    | CHAS / Constructionline / SafeContractor | Creditsafe / Experian / adverse-media feeds         |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| Coverage          | Both registers, every record, since HSE's retention start (5 / 10 years)                              | Same, 10 rows per screen                  | Self-declared at accreditation time      | Convictions that made the news; notices not covered |
| Export            | JSON, CSV, Excel, API, webhooks                                                                       | Screen (convictions have a one-shot .xls) | Certificate / portal                     | Report / API                                        |
| New-record alerts | Delta mode + schedule + Slack/webhook, entry order                                                    | None                                      | Annual renewal                           | Media-driven                                        |
| Updates           | `UPDATED` when a notice is complied with, a date revised, a hearing added                             | Invisible (no timestamp on the site)      | n/a                                      | n/a                                                 |
| Fields            | 90+ incl. numeric GBP, ISO dates, party status, repeat-offender counts, legislation split             | Screen text                               | Pass / fail                              | Company-level flags                                 |
| Filters           | Name, summary, LA, SIC, region, country, industry, division, dates, status, fatality, fine, type, Act | Same wizard, by hand                      | n/a                                      | n/a                                                 |
| Price             | $0.003 per record                                                                                     | Free (your time)                          | GBP 300-900 per contractor per year      | GBP 1k-10k per year                                 |

## Where the data comes from, legality and attribution

The Actor reads the public, logged-out HSE registers at `resources.hse.gov.uk` (Health and Safety Executive). It bypasses no login, CAPTCHA or access control (there is none - the site does not even require a cookie), identifies itself with a normal browser `User-Agent`, never has more than `maxConcurrency` requests in flight (default 5, hard cap 10 - one run-wide budget shared by listing, detail, breach and party pages) against a site that served 17 without throttling, and never touches search endpoints other than the register's own listing and record pages. `resources.hse.gov.uk` publishes no `robots.txt`; the main site's `robots.txt` disallows one specific case page, which this Actor skips.

HSE states on [hse.gov.uk/help/copyright.htm](https://www.hse.gov.uk/help/copyright.htm) that its content may be re-used free of charge in any format or medium under the terms of the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/), with the preferred acknowledgement "Contains public sector information published by the Health and Safety Executive and licensed under the Open Government Licence". Every record carries that acknowledgement in `data_source`. This Actor republishes exactly what HSE publishes, retains nothing beyond the run's dataset plus an id/hash memory for delta mode, and is not affiliated with or endorsed by HSE.

**Personal data.** The registers name individuals (sole traders, directors, "Mr ... Smith") and convictions are criminal-offence data. Under UK GDPR Article 10 / DPA 2018 Schedule 1 any downstream processing of individuals' conviction data needs a lawful basis and an applicable condition, and under the Rehabilitation of Offenders Act 1974 a fine becomes spent after one year. HSE itself limits the registers to five and ten years; if you screen individuals (employment or background checks) you are responsible for ROA and DPA compliance. Notices are regulatory action, not convictions, may be appealed or withdrawn, and the `result` field is surfaced verbatim.

## Honest limits

- `UPDATED` tells you a record's page changed, not which field (no snapshot diff yet). A breach page changing without any change on the case page or the case's breach list is not detected.
- Prohibition notices carry no Result on the register, so their `isOngoing` / `isCompliedWith` are `null` and they are not re-checked; HSE does not flag withdrawn or appealed notices.
- The register dates (offence, served) lag entry by weeks to years, so `dateFrom` means "the offence / service happened after", never "appeared on the register after" - use delta mode for the latter.
- Party history lists are read from their first page (10 ids); the counts are exact, the `partyOther*Numbers` lists are capped at 10.
- There is no server-side "custodial sentence" filter (the register's own wizard has one but its column code is not discoverable); filter on `hasCustodialSentence` in the output instead.
- The Crown Censures register (a separate small list under the convictions site) is not covered.
- The site answers a plain HTTP 500 both for an unknown record id and for a transient server error, so a withdrawn record can only be recognised over several runs (see _How monitoring works_, point 7); in delta mode such a record arrives up to three runs late, and a one-off full run delivers it as a listing-only record straight away.
- The site is a 2013-era classic-ASP application; if HSE migrates it, extraction breaks. The Actor validates every page - including the two listing shapes (6 columns, or 8 with Compliance Date and Notice Result when an Improvement notice type is selected) - and fails loudly (never "0 results, success"), so your schedule alerts you.

## FAQ

### Is there an HSE enforcement API?

No. HSE offers two search wizards, a one-shot Excel export of the convictions listing (five columns) and nothing for notices. This Actor is the programmable interface to both registers.

### How do I get alerts when a company receives an HSE notice or conviction?

Run this Actor on a schedule with `onlyNew: true` (optionally with `nameContains`) and connect a webhook, Slack, Make or Zapier. Each run delivers only the records that appeared or changed since the previous run.

### Can I look up one company's full HSE history?

Yes - `nameContains` (substring, case-insensitive) or, once you have any of its records, `hseReference` returns every case and notice of that party on both registers; every record also carries `partyConvictionCount`, `partyNoticeCount` and `isRepeatOffender`.

### What is the difference between SANCTION, NEW_LISTING and UPDATED?

`SANCTION` is a conviction you have not received before, `NEW_LISTING` a notice you have not received before, `UPDATED` a record you already received whose case / notice page has since changed (a notice complied with, a revised compliance date, a breach or hearing added).

### How far back does the data go?

HSE keeps convictions for five years and notices for ten (about 210 and 30,000 records today). Use `dateFrom` / `dateTo` to slice by offence or service date.

### How often are the registers updated?

In batches: notices appear roughly six weeks after service, convictions two to three months after the hearing. Daily runs are plenty.

### Why is the convictions register so small?

It is HSE's own five-year retention window, and only HSE prosecutions (not local-authority or Scottish COPFS cases) - about 40-50 new cases a year.

### Can I export to CSV or Excel?

Yes - every run's dataset can be downloaded as JSON, CSV, Excel or XML from the Output tab or the API, and the five views give ready-made column sets.

### Why did a record arrive without detail, or a run fail with "site outage"?

The register answers HTTP 500 for an unknown record id - the same status as a passing server error. The Actor therefore retries three times, and in delta mode holds a new record back until its page has been missing in three runs on different days before delivering it as a listing-only record with `detailError: "NOT_FOUND"`; a known open record stops being re-checked only after two such runs. When 30% of a batch or five records in a row go missing at once the run fails instead, because that is the site, not the records - the next scheduled run simply retries.

### Do I need a proxy?

No. The site is reachable from Apify's datacenter IPs with no gate of any kind.

### Is scraping the HSE registers legal?

The data is public sector information published under the Open Government Licence v3.0, which permits commercial re-use with attribution; see _Where the data comes from_ above for the personal-data caveats.

## Related Actors and roadmap

Same envelope, same delta engine, other registers by the same developer: [GrantConnect Grant Awards Scraper & Monitor](https://apify.com/stefano_seggio/australia-grantconnect-monitor) (Australian Government grants), [Florida Tenders Monitor](https://apify.com/stefano_seggio/florida-tenders-monitor), and public-procurement monitors for Argentina and Chile.

Coming next for HSE: field-level change diffs for `UPDATED` events, Companies House number matching on `partyAddress`, and the Crown Censures list. Ask for features in the Issues tab.

## Support

Report problems or request fields in the **Issues** tab of this Actor - typical response within one business day. Versioned changes are listed in the Changelog tab.
