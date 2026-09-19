# Changelog

## [2.1.0](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/compare/uk-hse-enforcement-monitor-v2.0.1...uk-hse-enforcement-monitor-v2.1.0) (2026-09-19)


### Features

* delta engine (onlyNew/dateRange) + standardized B2B output envelope ([b469957](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/b469957cbcea8e07e57c53051430b64622739b2e))
* UK HSE Enforcement Monitor - Convictions + Notices registers ([18eb429](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/18eb429191b447181684c1ce2fac5529e84aaf9b))
* v2.0.0 - server-side filters, content-hash delta engine with UPDATED events, party profiles, normalised fields ([bd2965b](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/bd2965b2a7d5c89c580c9a871d43b8fcfe6ad16d))


### Bug Fixes

* accept the 8-column Improvement listing, correct notice-type labels and SIC column, make missing pages non-final ([c8ff9fd](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/c8ff9fd5968324d29a6cfb045c0828d20c210383))
* cap maxItemsPerDataset so a full onlyNew=false walk fits the timeout ([#10](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/issues/10)) ([fa87791](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/fa8779143cba8dac887ccd710ff88b9f14261992))
* **ci:** pass RELEASE_PLEASE_TOKEN so release PRs skip the bot-approval gate ([b5bd525](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/b5bd52536fab646a8242b6a71749729f29ce538e))
* close two outage-guard blind spots (cumulative ratio, small re-check batches) ([#11](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/issues/11)) ([232d17a](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/232d17af7120303b33a17a45d2c41916b1398ad2))
* **delta:** cold-cap baseline floor, truthful delivery truncation, spaced postcodes ([78a1abc](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/78a1abc51b1e9f5c88d90aff5519250cb3f1d094))
* **delta:** walk watermark so a capped notices walk never strands its overflow; truthful SIC docs; defer every unreadable detail page ([01948f6](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/01948f6b72c206aef763749ce2363e0d92b0a582))
* **state:** never adopt the v1 delta store into a v2 delta-state name ([ab26b03](https://github.com/stefanoseggio/uk-hse-enforcement-monitor/commit/ab26b038d4bd62cd25af183f95f6f552ca275ced))

## 2.0.1 - 2026-09-08

### Fixed

- **The first delta run's cap now really is the baseline, whatever the cap.** The promise "on the first delta run the cap defines the baseline" only held for caps of two full listing pages (20) or more: with a smaller cap the page-granular early-stop never met two fully-known pages, so every following run delivered - and charged for - the next slice of older records until the whole matching register had been drained (a cap of 4 on 63 matching notices meant ~16 runs and 63 charged records instead of 4). The cold run (a delta memory that never completed a run) that is cut short by `maxItemsPerDataset` now persists, per register and before it delivers anything, the oldest record it took as a **baseline floor**; later delta runs exclude unseen records below it as history (excluded as `baseline`, never delivered, never charged, never a reason to keep walking, remembered as known at the end of a successful run), while entries above it are news as before. A cold run never writes a walk watermark; a later capped run still does, so a backlog is still drained. The baseline is cleared only by `resetState` and ignored by a full run (`onlyNew: false`). `OUTPUT.baselineFloor` reports it. README, input description and AGENTS.md now say exactly this.
- `OUTPUT.truncatedByMaxItems`, the "maxItemsPerDataset reached" warning and the status message were missing when the delivery queue (updated + new records) exceeded a cap that is not a multiple of 15 - the default 100 included: the delivery loop advanced by the nominal batch size even when the last batch had been shortened to the room left under the cap, and skipped the tail without reporting it. The offset now advances by what each batch actually took, and whatever was not attempted (for any reason but the spending limit) is reported as truncated. No record was lost (the walk watermark already covered the tail).
- `postcode` / `partyPostcode` for addresses where the register splits the outward code with a stray space ("L S17" for LS17 on notice 315841814, "S W17" for SW17) came out as the wrong code ("S17"). Each address line is now read without its spaces first, so those yield `LS17` / `SW17` (and "L S17 8AB" yields `LS17 8AB`).

## 2.0.0 - 2026-09-07

The "institutional-grade" release: same envelope, far more data, server-side filters, and a delta engine that catches late-published cases and amended notices.

### Added

- **Server-side filters** mirroring the registers' own Advanced Search wizard (every column code verified live with result counts): `nameContains` (defendant / recipient), `descriptionContains`, `localAuthorityContains`, `mainActivityContains` (SIC), `region`, `country`, `industry`, `hseDivision`, `dateFrom` / `dateTo` (absolute or relative), `hseReference` (everything about one party), `recordNumber`; convictions-only `defendantStatus`, `resultingFromFatality`, `minTotalFineGbp` / `maxTotalFineGbp`; notices-only `noticeTypes` (9 codes, multi-select) and `act`. Narrow runs touch a handful of pages instead of walking 3,000.
- **`UPDATED` event type.** The registers have no "last updated" field and amend records in place, so every delivered record's page is hashed; known records that are still open (Improvement Notices with Result "Ongoing", every conviction) are re-read for `recheckDays` (default 180) after first delivery and re-delivered as `UPDATED` when the page changed - a notice complied with, a revised compliance date, a breach or hearing added.
- **`eventTypes`** filter, `deltaStateName` and `resetState` inputs; delta memory is now per filter set by default, so several schedules never interfere.
- **Normalised fields** next to every raw string: `offenceDateIso`, `hearingDate(Iso)` (latest hearing across the case's breaches), `servedDateIso`, `complianceDateIso`, `revisedComplianceDateIso`, `effectiveComplianceDateIso`, `daysToComply`, `daysUntilCompliance`, `totalFineGbp`, `totalCostsGbp`, `totalPenaltyGbp`, `postcode`, `country`, `sicCode`, `sicDescription`, `noticeCategory` and the `isProhibition` / `isImprovement` / `isImmediate` / `isDeferred` / `isCrown` / `isComah` / `isFepa` flags, `isOngoing`, `isCompliedWith`, `isOverdue`, `hasRevisedComplianceDate`, `resultingFromFatality`, `hasCustodialSentence`, `breachCount`, `legislationBreached`, `courtLevel`, `descriptionItemIds`; per breach `dateOfHearingIso`, `fineGbp`, `actName` / `actSection` / `actSubSection`, `regulationName` / `regulationNumber` / `regulationParagraph`, `legislation` / `provision` / `paragraph`, `resultListing`, `resultCategory`, `isCustodial`, `source_url`.
- **Party profile and history** (`fetchPartyDetail`, default on): `partyStatus` (Private Company, Individual, Sole Trader, LLP, NHS...), `partyEntityType`, `partyAddress`, `partyPostcode`, `partyHseReference`, `partyUrl`, `partyConvictionCount`, `partyNoticeCount`, `partyOtherCaseNumbers`, `partyOtherNoticeNumbers`, `isRepeatOffender` - the same HSE reference links both registers.
- **Per-case breach list** for convictions: a multi-breach case page does not link its breaches, so the register's breach list (`SF=CN`) is read for every case - breach ids, hearing dates, results, fines and Act/Regulation come with the case page even when `fetchBreachDetail` is off.
- `fetchDetail` input for listing-row-only records, `maxConcurrency` (default 5, max 10), `data_source` attribution (Open Government Licence v3.0), `detailFetched` / `detailError` / `breachDetailFetched` / `partyDetailFetched` / `contentHash` / `firstSeenAt` provenance fields.
- **Run summary** in the key-value store (`OUTPUT`): delivered by event type and register, total matching on HSE per register, pages walked, stop reason, re-check counts, delta store name.
- Five dataset views (Overview, Convictions & fines, Enforcement notices, Compliance tracker, Defendants & recipients) and CSV / Excel / newest-first output links.
- Cheaper `result-summary` price for records without breach detail (`fetchDetail: false`, `fetchBreachDetail: false`, or a page that could not be fetched).

### Fixed

- **Improvement notice filters crashed the run.** Selecting any Improvement code in `noticeTypes` (`01`/`02`/`03`, alone or mixed) makes the register render an 8-column listing (Compliance Date and Notice Result added); the page validator only knew the 6-column shape and failed the run as "not a register listing". Listing columns are now mapped by header name, both shapes are accepted, and the two extra columns feed `complianceDate` / `result` (and `isOngoing` / `isCompliedWith` / `isOverdue`) in listing-only runs.
- **`noticeTypes` labels for `01`-`03` were wrong**: on the register `01` is the Crown Improvement Notice (16 records), `02` the FEPA Improvement Notice (25) and `03` the ordinary Improvement Notice (22,383). Labels in the input form, README and code now match the site.
- **`mainActivityContains` never matched SIC codes**: the site keeps the code (`SIC`) and the description (`SICD`) in different columns. A numeric value is now sent to the code column, text to the description column. The code column's match is a substring match on the register (`562` also returns `25620`), so 2-3 digit values are accepted with a warning and the documentation says what they really select.
- **A transient HTTP 500, timeout or non-record page no longer poisons the delta memory.** The site's answer for an unknown record id is a plain 500, identical to a passing server error. A new record whose page cannot be read (500, timeout after the retries, a non-record page) is now held back (not stored, not charged, not remembered) until it has failed in three runs on different days, then delivered as a listing-only record; a known open record keeps being re-checked until it has been missing in two runs; and a batch in which 30% of the records (or five in a row) go missing at once fails the run as a site outage instead of stubbing or closing anything. `fetchOptional` also retries a 500 twice before treating it as missing.
- `maxConcurrency` is now a run-wide cap on simultaneous requests (one semaphore for listing, detail, breach and party pages), instead of a per-record limit that the breach / party fan-out could multiply.
- `eventTypes` no longer forms part of the delta-store fingerprint: re-ticking "updates" on a running task keeps its memory instead of re-baselining (and re-charging) it.
- **Silent data loss in delta mode**: the seen-set used to be persisted _before_ records were pushed, so a spending limit, timeout, migration or a failure on the second register marked undelivered records as seen forever. State is now written only for records actually stored, new records are delivered oldest-first, a per-register **walk watermark** (the notice number where a capped walk stopped, or the lowest candidate a run could not store) is persisted before delivery starts so the next run walks down to the backlog instead of early-stopping on the records already delivered, and the state is also flushed on platform `migrating` / `aborting` events.
- **Late-published cases were invisible**: the walk used the site's default Offence Date / Issue Date order, which lags publication by months to years (case 4883993, offence 2021, hearing June 2026, GBP 400,000 fine, sat on the last page). Convictions are now walked in case-number order and always in full (21 pages); notices in notice-number order (entry order - a notice served ten months ago but entered last week is on page 2).
- A failed extraction used to push an `{ error }` row into the dataset and finish as SUCCEEDED. The run now fails properly (alerts and webhooks fire) and never writes non-record rows.
- The site's HTTP-200 SQL error page (which also says "0 Matching results found") and any maintenance page used to be reported as "no more results". Every listing page is now validated and the run fails loudly instead.
- `maxItemsPerDataset` overflow in delta mode no longer strands records: the overflow under the delivered records is reached by the following runs through the walk watermark (previously the two-known-pages early-stop fired above it and the records were lost until a `resetState`); a warning tells you to raise the cap to catch up faster.
- Withdrawn records (the site answers HTTP 500 for an unknown id) degrade to a summary record instead of aborting the whole run after four retries.
- Fetches now time out (30 s), only retriable statuses are retried, with jittered backoff.
- Detail, breach and party pages are fetched with bounded concurrency instead of one at a time (a 100-record run drops from ~8 minutes to under a minute).
- The recency window is applied server-side (and is inclusive) instead of after the expensive detail fetch; filtered-out records are no longer marked as seen. Relative windows use the UK calendar day.
- Duplicate rows caused by the listing shifting between page fetches are de-duplicated within a run.
- Quote characters in free-text filters (a SQL error on the site) are turned into single-character wildcards.
- The delta memory cap grew from 2,000 ids per register to 50,000 hashed entries.
- The case disallowed by www.hse.gov.uk/robots.txt (4157835) is skipped.
- Log messages are in English.

### Changed

- `dateRange` is deprecated (still honoured) in favour of `dateFrom` / `dateTo`.
- Walk order is case number / notice number descending (was offence / issue date).
- Within a run, `UPDATED` events are appended first, then new records oldest-first; use `?desc=true` on the dataset API (the views already do) to read newest-first.
- A v2 run with no filters adopts the v1 delta memory (ids only, as a baseline that is never re-checked); a filtered run starts its own memory.
- `npm test` is offline; live checks moved to `npm run test:live`.

## 1.0.2 - 2026-09-06

- Delta engine (`onlyNew`, `dateRange`) and the standardised `record_id` / `event_type` / `scraped_at` / `is_new` / `source_url` envelope.

## 1.0.0 - 2026-09-06

- Initial release: Convictions and Enforcement Notices registers, listing + detail + breach extraction, newest offence / issue date first.
