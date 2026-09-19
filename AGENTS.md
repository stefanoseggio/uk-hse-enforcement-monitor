# AGENTS.md - UK HSE Enforcement Monitor

Technical notes for whoever (human or AI) touches this actor next. Everything
below was verified live against resources.hse.gov.uk on 2026-09-07 unless
stated (v1 notes of 2026-09-06 are marked).

## What this actor does

Extracts the UK Health and Safety Executive's two public enforcement
registers - **Convictions** (successful prosecutions: defendant, offence,
fine, costs, breaches with court / Act / hearing / result) and **Enforcement
Notices** (Improvement / Prohibition notices: recipient, type, served and
compliance dates, result, breaches) - with the registers' own search
criteria applied server-side, the defendant / recipient profile and
history, and a delta engine keyed on a **content hash** of each record's
page (the registers have no timestamps).

## Site facts that shape the design

### No gate at all

IIS 7.5 classic ASP. No WAF, no Cloudflare, no JS, no CAPTCHA, no required
cookie (a request with no User-Agent still gets 200). `src/http.ts` sends a
browser UA anyway. `resources.hse.gov.uk/robots.txt` is 404 (no rules);
`www.hse.gov.uk/robots.txt` disallows `/prosecutions/case/case_details.asp?SF=CN&SV=4157835`
(the legacy path of this register) - `src/codes.ts` skips that case. Pages
answer in 0.3-2.5 s; 17 concurrent fetches were served without throttling
(v1 audit). `maxConcurrency` is capped at 10, default 5, and is a RUN-WIDE
cap: every fetch takes a slot in one semaphore (`http.ts`), so the breach
and party fan-out of a record never multiplies it.

### The query grammar is a classic-ASP comma join

Every wizard step ends in a plain GET on `case_list.asp` / `notice_list.asp`.
One criterion: `ST=C|N&CO=&SN=F|P&SF=<code>,+|&EO=<op>&SV=<value>,+|&SO=<sort>&PN=<page>`.
Several criteria (2 and 3 verified on both registers, AND and OR both work):
`CO=,AND,AND&SN=F,+P,+F&SF=A,|,+B,|,+C,+|&EO=x,+y,+z&SV=a,|,+b,|,+c,+|` -
`,|` after every value but the last, `,+|` after the last. `src/urls.ts`
`buildQueryString()` produces exactly this; `src/parsers/listing.ts`
validates every page because:

- a wrong join renders **"0 Matching results found" with HTTP 200**;
- an unknown column renders the **SQL error page** ("Sorry ... some form
  of error ... Invalid column name 'XYZ'") which ALSO contains "0 Matching
  results found" - so the error text is checked first;
- `NT IN` (notice type) must be the FIRST criterion of a join (reversed
  order = SQL error);
- values are interpolated into SQL: an apostrophe is a SQL error.
  `sanitizeFreeText()` turns `'` `"` `` ` `` and `+` (decoded as a space)
  into `_`, the single-character LIKE wildcard ("O_Brien" matches
  "O'Brien", "A_E Drainage" matches "A+E Drainage"), and drops `;` `|` `\`.
- `LIKE` is case-insensitive; `%` and `_` wildcards pass through.
- date operators `>` / `<` are strict and `=` is an exact day, so
  `dateFrom` is sent as `> (dateFrom - 1 day)` and `dateTo` as
  `< (dateTo + 1 day)`.

Column codes (all verified with result counts; "-" = not on that register):

| Filter                   | Convictions     | Notices             | Notes                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name contains            | `DN` LIKE       | `RN` LIKE           | 127 / 8,792 for "Limited" / "Ltd"                                                                                                                                                                                                                                                                                                                                                        |
| summary contains         | `CSUM` LIKE     | `NSUM` LIKE         | "asbestos": 3 / 1,978                                                                                                                                                                                                                                                                                                                                                                    |
| local authority contains | `LA` LIKE       | `NLAC` LIKE         | `NLA` exists but is something else (0 hits)                                                                                                                                                                                                                                                                                                                                              |
| main activity (SIC)      | `SIC` / `SICD`  | `SIC` / `SICD` LIKE | TWO columns: `SIC` = code ("43910" -> 8 conv, "25620" -> 911 not; `=` needs the full code). Its LIKE is a SUBSTRING match (2026-09-07: "2562" -> 911, "562" -> 932 with page 1 all 25620, "43" -> 2,794 incl. 14310/24310/46430); `SICD` = description text only ("ROOFING" -> 8, "MACHINING" -> 911; "43910" -> 0). input.ts routes `/^\d{2,5}$/` to `SIC` LIKE and warns on 2-3 digits |
| UK region                | `UKR` = (P)     | `UKR` = (P)         | 1-7, see `src/codes.ts`                                                                                                                                                                                                                                                                                                                                                                  |
| country                  | `CTR` = (P)     | `CTR` = (P)         | 8-11                                                                                                                                                                                                                                                                                                                                                                                     |
| industry                 | `GS` = (P)      | `GS` = (P)          | 12-16                                                                                                                                                                                                                                                                                                                                                                                    |
| HSE division             | `HDV` = (P)     | `HDV` = (P)         | 17-27; `HDR` = directorate, `HGR`/`NHGR` = group, `HAR`/`NHAR` = area                                                                                                                                                                                                                                                                                                                    |
| date                     | `ODS` (offence) | `NIS` (issued)      | DD/MM/YYYY                                                                                                                                                                                                                                                                                                                                                                               |
| party id                 | `DID` =         | `RID` =             | the HSE Reference; the same id is used on both registers                                                                                                                                                                                                                                                                                                                                 |
| record number            | `CN` =          | `NN` =              |                                                                                                                                                                                                                                                                                                                                                                                          |
| defendant status         | `CTY` = (P)     | -                   | 1972-1981                                                                                                                                                                                                                                                                                                                                                                                |
| fatality                 | `FAT` = Yes/No  | -                   | 43 fatal cases                                                                                                                                                                                                                                                                                                                                                                           |
| total fine / costs       | `TF` / `TC` > < | -                   | numeric, no symbol                                                                                                                                                                                                                                                                                                                                                                       |
| notice type              | -               | `NT` IN `01;..;09;` | per code (page-1 wording): 01 Crown Improvement 16, 02 FEPA Improvement 25, 03 Improvement 22,383, 04 Deferred Crown Prohibition 1, 05 Immediate Crown Prohibition 2, 06 Deferred Prohibition 8, 07 FEPA Prohibition 9, 08 Immediate Prohibition 7,627, 09 COMAH 3. ANY of 01/02/03 -> 8-column listing                                                                                  |
| act                      | -               | `ACT` = (P)         | 43 codes; `ACTS`/`REGN`/`REGP` exist but are ignored by the listing                                                                                                                                                                                                                                                                                                                      |

Not exposed (code unknown or unverified): custodial sentence (wizard field
21 - none of 8 guessed codes existed), type of location, HSE directorate /
group / area (codes found but of little value), regulation picklist (536
entries). The wizard itself resolves `SF` from its session, so codes can
only be found by guessing against the error page.

### Ordering is NOT publication order - hence the walk design

- Convictions default sort is Offence Date, which lags publication by
  months to years: case 4883993 (Skanska/Costain/Strabag JV, offence
  27/07/2021, hearing 16/06/2026, GBP 400,000) is on page 1 of `SO=DCN`
  (case number desc) but on the last pages of `DODS`. The register is ~210
  records (21 pages, 6 s), so **convictions are always walked in full**
  (`fullWalk: true`) and delta mode never early-stops on them.
- Notices default sort is Issue Date; `SO=DNN` (notice number desc) is
  entry order: page 2 of `DNN` today holds notice 316119748 issued
  16/09/2025, ~250 pages deep in `DNIS`. Notices early-stop after 2
  consecutive fully-known pages. There is no timestamp to bound a
  watermark; the watermark is an ID instead (`backlogFloor`, see the
  invariants): the notice number where a capped walk stopped or the lowest
  candidate a run could not store, below which known pages must not stop
  the walk. A 20,000-page cap is the runaway guard.
- Other sorts: convictions `ACN/DCN, ADN/DDN, AODS/DODS, ALA/DLA, ASIC/DSIC`;
  notices `ANN/DNN, ARN/DRN, ANT/DNT, ANIS/DNIS, ANLA/DNLA, ASIC/DSIC`;
  breach list `ABID/DBID, AHD/DHD, AACT, AREG, AHRE, AFN/DFN`. `sortBy` is
  not an input: the delta engine needs entry order and the dataset can be
  sorted downstream.

### Page anatomy used for termination and block detection

- Listing header: "N Matching results found : Showing Page X of Y, results
  A to B" (notices insert "from 30226 total records"); column header row
  "Case Number | Defendant's Name | Offence Date | Local Authority | Main
  Activity" / "Notice Number | Recipient's Name | Notice Type | Issue Date |
  Local Authority | Main Activity". 10 rows per page. **Whenever the NT
  filter contains an Improvement code (01/02/03, alone or mixed with
  prohibition codes) the notices table has 8 columns**: "... Issue Date |
  Compliance Date | Notice Result | Local Authority | Main Activity"
  (fixture `notice_list_improvement_8col.html`). `parseListingPage` finds
  the header row by its `<th>` labels and maps cells BY NAME (never by
  position); the extra columns feed `ListingRow.complianceDate` /
  `noticeResult`, which `buildNoticeRecord` uses as fallbacks for
  `complianceDate` / `result` in listing-only runs.
- Past the end: HTTP 200, "Showing Page 22 of 21, results -3 to 210", zero
  rows - a legitimate end (cheap). Zero results: "0 Matching results
  found", no "Showing Page" line.
- `parseListingPage().isListingPage` requires: no error text, a header row
  carrying every required column of the requested register (in either
  shape), and a "Matching results found" count. The walker retries twice
  and then FAILS the run.
- Detail pages: a `<th>` header "Details for Case No. N" / "Notice N served
  against <a>Recipient</a> on DD/MM/YYYY" (`isDetailPage`). An unknown id
  answers **HTTP 500** (not 404) - the generic IIS "500 - Internal server
  error" page, byte-identical for cases and notices and to a transient
  server error. `fetchOptional` treats a 500 that survives two retries as
  "record missing" (null), and the callers never take one miss as final
  (see invariant 8).
- Fatal cases carry an extra single-cell row "This case did result from the
  investigation of a fatality" (`parseFatalityFlag`).
- A multi-breach case page does NOT link its breaches (its "Breaches
  involved in this Case" link is the generic New Breaches list); a
  single-breach page links `breach_details.asp?SF=BID&SV=<case><seq>`.
  The per-case breach list `breach_list.asp?ST=B&SN=F&EO=%3D&SF=CN&SV=<case>`
  is the one-request source of all breach ids plus hearing date, result
  ("Guilty-Fine", "Guilty-Prison Suspended", "Guilty-No Sep Penalty"), fine
  and "Act / reg / para". Breach ids are not always contiguous (4849124 has
  002 and 003 only). Breach pages use a different result vocabulary
  ("Fine", "Prison Suspended") and add court name / level, Act
  "..., Section 2, Sub Section 1", Regulation "... (No 15) para 2".
- Notices: Improvement Notices have Compliance Date / Revised Compliance
  Date / Result ("Ongoing" -> "Complied with"); **prohibition notice pages
  have no Result or Compliance rows at all**, so their `isOngoing` is null
  and they are never re-checked. Notices breach list rows are "Act / reg /
  para" inline (no per-breach page). Listing wording differs from the
  detail ("Prohibition Notice Immediate" vs "Immediate Prohibition
  Notice") - both are kept (`noticeTypeListing`, `noticeType`).
- Party pages (`defendant_details.asp?SF=DID&SV=` / `recipient_details.asp?SV=`):
  Defendant|Recipient, Address (`<br>`-joined), Status, HSE Reference, and
  links to the party's cases and notices on BOTH registers with the same
  id; the listing header count of those lists is the repeat-offender
  signal (`partyConvictionCount`, `partyNoticeCount`).
- Convictions have an Excel export (`case_list-excel.asp?<same query>`,
  Content-Disposition `HSEprosecutions.xls`, an HTML table with the same 5
  columns, whole result in one request - 211 rows). Not used (the paginated
  walk shares code with notices and costs 6 s); notices have no export
  (404).
- `HSE Area` is always empty on live pages; kept as a nullable field.
- Labels use `&nbsp;` (U+00A0) and addresses use `<br>`; see
  `parsers/labelValueTable.ts` (v1 notes).

### Amendments keep their original date -> content hashes

Notice 315474881 (served 24/11/2025) flipped Result "Ongoing" -> "Complied
with" and gained a Revised Compliance Date 06/03/2026 with no other change;
breaches are appended to a case under the same number. No page shows a
published / last-updated stamp. So:

- the delta state maps id -> `{ h: sha1-16 of the detail page (fields +
header + party id + breach ids + breach list rows + fatality), d: register
date (latest hearing ?? offence / served), o: still open, f: first
delivered, l: last seen }` (`src/state.ts`);
- delta mode re-fetches known records with `o=true` and `h != null` whose
  `max(d, f) >= today - recheckDays` (default 180, cap 2,000 per run, newest
  first) and emits `UPDATED` when the hash moved (`recheckKnown`);
- `o` = true for every conviction with a detail page; for notices only
  Improvement Notices whose Result is Ongoing/blank. Listing-only deliveries
  (`fetchDetail=false`) and v1-migrated ids have `h=null` and are never
  re-checked;
- in full mode a known id whose hash moved is also emitted as `UPDATED`
  (`finalEventType`).

## Architecture

- `src/input.ts` - validates and resolves the input into one `RegisterQuery`
  per register (criteria in the site's vocabulary) + `RunOptions`; filter
  fingerprint that names the delta store; relative dates; legacy
  `dateRange`; conviction-only / notice-only filters warn when the register
  is not selected.
- `src/codes.ts` - picklist codes captured from the wizard, robots skip-list.
- `src/urls.ts` - join grammar, listing / detail / breach / party paths.
- `src/http.ts` - fetch with 30 s timeout, retry policy (network /
  408/425/429/5xx, jittered backoff), `fetchOptional` (404/410/500 -> null),
  `mapWithConcurrency`.
- `src/parsers/listing.ts` (rows + markers + validity), `labelValueTable.ts`
  (detail tables, header, fatality, isDetailPage), `breachList.ts`
  (convictions breach list), `noticeBreachList.ts`, `party.ts`.
- `src/fetchRecords.ts` - `walkListing()` (pagination + classification +
  stop rules, no detail fetches), `selectRecheckIds()` / `recheckKnown()`
  (UPDATED detection), `enrichBatch()` (detail + breach list + breach pages
    - party page + party history with bounded concurrency), `buildConviction
Record()` / `buildNoticeRecord()` (all normalisation), `detailContentHash()`.
- `src/delivery.ts` - batches of 15, `Actor.pushData(items, eventName)`,
  `chargedCount` accounting, `markSeen` after a successful push, persist
  every 50 / on close / on `migrating` + `aborting`.
- `src/state.ts` - named-store delta state v2 (`seen`, `missing`,
  `backlogFloor` and `baselineFloor` per register, `isColdState`), v1
  adoption (unfiltered runs only), 50k-entry prune per register.
- `src/normalize.ts` - pure helpers (London calendar, dates, GBP, SIC,
  postcode - per address line, spaces removed first, because the register
  renders "S W17" / "L S17" for SW17 / LS17 - country, Act / Regulation
  parsing, result and party classification, notice-type flags, sha1
  content hash, FNV store hash, free-text sanitiser).
- `src/main.ts` - orchestration per register: walk -> re-check -> deliver
  (UPDATED first, then new oldest-first) -> mark excluded -> summary. Fails
  the run on any extraction error; never pushes anything but records.

## Delta engine invariants (do not break these)

1. **State is written only for delivered records** (`markSeen` after a
   successful `pushData`), plus, at the END of a successful run, for rows
   that were walked but excluded by `eventTypes` or as pre-baseline
   history (3b); known rows just get their last-seen date refreshed. `saveState` runs every 50 delivered records,
   in `Delivery.close()` (finally) and on the platform `migrating` /
   `aborting` events.
2. **Delivery order**: UPDATED candidates first (they are re-detected next
   run if lost), then new records **oldest-first**, so a crash leaves the
   NEWEST candidates undelivered - the rows the next walk visits first when
   they are at the top of the register, and otherwise covered by the
   watermark (3). The dataset is therefore UPDATED events followed by an
   oldest-first log per run; the views and README tell users to read it
   with `desc=true`.
3. **Walk watermark (`state.backlogFloor[register]`)**: the highest id at or
   below which undelivered matching records may exist. main.ts sets it
   BEFORE delivery to the lowest of {every candidate, the walk's stop id
   when it hit `max-items`/`page-cap` on a non-cold register, the previous
   floor when the walk did not complete} and persists it, then after
   delivery to the lowest of {candidates NOT stored, stop id, previous
   floor if incomplete} (null = no backlog). `walkListing` refuses the
   2-known-pages early-stop while the current page's lowest id is above
   the floor. Convictions ignore the floor (full walk). A COLD run (see
   3b) never records a backlog floor. Regression:
   `test/walkListing.test.ts` "walk watermark" and
   `test/main.backlogFloor.test.ts` (cap, spending limit, crash before
   the first push).
   3b. **Baseline (`state.baselineFloor[register]`)**: the COLD delta run -
   `isColdState`: no seen entry on either register and no `lastRunAt`,
   decided ONCE in `run()` before anything is persisted (the run's own
   mid-way persists set `lastRunAt`) - that is cut short by the cap
   (`max-items` / `page-cap`) persists, per register and BEFORE delivery,
   the id of the oldest candidate it took (= the lowest id, entry order
   is id-descending). On every later delta run `walkListing` excludes an
   UNSEEN row whose id is below the floor as `'baseline'`: not delivered,
   not counted as unseen for the early-stop, and marked seen at the end
   of a successful run (`h=null, o=false` - its page was never read, so
   it is never re-checked; a full run with `onlyNew=false` delivers it).
   The baseline is never cleared except by `resetState`; a cold walk that
   reaches the end sets none (nothing is history); a full run neither
   uses nor sets it. This is what makes "the first run's cap is the
   baseline" true for ANY cap - the page-granular early-stop alone only
   held for caps of two full pages or more (a cap of 4 used to drain the
   whole register, 4 records per run). Regression:
   `test/walkListing.test.ts` "baseline" and
   `test/main.baselineFloor.test.ts` (cold cap 4 on 30 rows -> 0 on the
   next run, only new entries later, a non-cold capped run still writes a
   backlog floor, a complete cold walk sets none, full run ignores it).
4. **Convictions are walked in full every run**; notices early-stop after 2
   consecutive pages with no unseen id, subject to (3).
5. `maxItemsPerDataset` truncation (at walk and at delivery) never marks the
   overflow as seen; it logs a warning, sets `truncatedByMaxItems` and
   leaves the watermark (3). `Delivery.deliver` advances its offset by the
   length of the batch it actually took (a batch is shortened to the room
   left under the cap), so a cap that is not a multiple of the batch size
   (15) still reports the queue's tail as truncated
   (`test/delivery.test.ts`: queue 25, cap 20).
6. The delta store name defaults to `auto-<hash of filters>` (dates,
   limits, fetch flags and the register selection excluded), so distinct
   schedules never share memory unless `deltaStateName` says so. The v1
   store is adopted only by an unfiltered run, as an id-only baseline.
7. Charging: records with the case/notice page AND breach detail are pushed
   with event `result`, everything lighter with `result-summary`;
   `chargedCount` from the SDK is the number actually stored in PPE mode
   (outside PPE everything is stored, nothing charged).
8. Every listing page is validated; a SQL error page or a non-listing fails
   the run after 2 retries. Never report "0 new" on a broken page.
9. **An unreadable detail page is never final after one run** - the site's
   "unknown id" 500, a timeout after the retries and a NOT_A_DETAIL_PAGE
   answer are all inconclusive. The state carries a second map
   `missing[register][id] = { n, l }` (distinct runs by London calendar
   day). Delta mode: a NEW record whose page cannot be read is neither
   pushed nor marked seen (a stub with `h=null` would never be re-read)
   until `n` reaches `MISSING_RUNS_BEFORE_STUB` (3), then it is pushed as a
   listing-only stub (`detailError` = the failure, `result-summary`) and
   marked seen with `h=null, o=false`; full mode pushes the stub at once
   (as v1 did). A KNOWN open record whose re-check answers NOT_FOUND keeps
   `o=true` until `n` reaches `MISSING_RUNS_BEFORE_CLOSED` (2); one whose
   re-check fails otherwise just stays open and is re-checked next run. Any
   successful read or delivery clears the entry. Outage guard
   (`assertNotFoundWithinBounds`, every failure kind counts): >= 30%
   failures of a sample of >= 10 detail fetches, or >= 5 in a row (carried
   across delivery batches), throws -> `Actor.fail`, nothing stored or
   remembered. Tests: `test/main.missingDetail.test.ts`.
10. The delta store fingerprint covers server-side filters only - never
    `eventTypes` (rows dropped by event type are marked seen anyway, so a
    later change of `eventTypes` must not re-baseline a running task).

## Tests

- `npm test` - offline, ~1 s: 105 tests on real captured fixtures + mocked
  HTTP (walk cold / delta / dedupe / maxItems / blocked / 8-column
  improvement listing / walk watermark and baseline on synthetic
  multi-page notice listings, UPDATED through hashes, outage guard incl.
  timeouts, record building incl. listing-only improvement notices, input
  incl. SIC routing and fingerprint, urls, normalisers incl. id ordering
  and spaced postcodes, parsers, `Delivery.deliver` under a cap that is
  not a multiple of the batch size) including four end-to-end runs of
  `src/main.ts` with the SDK mocked: the persist-after-delivery invariant
  under a spending limit, the missing-detail policy across several
  calendar days (deferral, stub after 3 runs, close after 2 re-checks,
  outage guard on both paths, timeout deferral - seeded with a non-cold
  store so the cap drains the register as the guard sample needs), the
  walk watermark across days (cap -> floor -> backlog delivered, spending
  limit inside a hole, crash before the first push) and the baseline
  across days (cold cap 4 on 30 rows, nothing older ever delivered).
- `npm run test:live` (`LIVE=1`) - 14 live checks (~25 s): both registers
  with full detail, name + region filter, inclusive date window, notice
  type join, Improvement code -> 8-column listing (single and mixed with
  08), the wording of all nine NT codes, numeric vs text
  `mainActivityContains`, zero-result termination, SQL error page
  detection, re-check semantics, missing-record 500.
- Local end-to-end: put an input in `storage/key_value_stores/default/INPUT.json`
  and `apify run --purge`; the delta store appears under
  `storage/key_value_stores/uk-hse-enforcement-monitor-state-<name>/`
  (`--purge` clears only the default stores, so a second run is a real delta
  run). Verified 2026-09-07 with `{ nameContains: "Llanelec", onlyNew: true }`:
  pass 1 delivered 22 notices, pass 2 delivered 0 (early-stop at page 2, 21
  re-checked, 0 changed); and again after the 8-column fix with
  `{ datasets: ["notices"], noticeTypes: ["03"], nameContains: "Llanelec", onlyNew: true, maxItemsPerDataset: 50 }`
  (the 8-column listing): pass 1 walked 3 pages and delivered 22 notices
  with detail (store `auto-1b447175`), pass 2 delivered 0 - early-stop at
  page 2, 20 excluded as known, 21 re-checked, 0 changed, 0 not found.
  Walk watermark, verified 2026-09-07 with
  `{ datasets: ["notices"], noticeTypes: ["08"], localAuthorityContains: "Sheffield", onlyNew: true, maxItemsPerDataset: 20, fetchBreachDetail: false, fetchPartyDetail: false }`
  (82 matching, store `auto-67fe1994`): pass 1 (cold, `resetState`) walked
  3 pages, delivered 20, stop `max-items`, `backlogFloor` null (cold cap =
  baseline; a store from before the baseline floor existed - the same now
  holds for any cap, see the 2026-09-08 runs below); pass 2 delivered 0,
  early-stop at page 2; pass 3 with the
  floor seeded to the cold run's stop id 314106790 (what a capped non-cold
  run writes) logged "page 2 is fully known but ... walking on", delivered
  the 20 records under the two known pages, hit the cap on page 5 and
  persisted the new floor 313548265. The site never adds entries on demand,
  so the offline `main.backlogFloor` test is the regression for the cap ->
  floor -> backlog sequence.
  Baseline, verified 2026-09-08 with
  `{ datasets: ["notices"], noticeTypes: ["08"], localAuthorityContains: "Leeds", onlyNew: true, maxItemsPerDataset: 4, fetchBreachDetail: false, fetchPartyDetail: false, deltaStateName: "fix-r4-e2e" }`
  (63 matching): pass 1 (cold, `resetState`) walked 1 page, delivered 4,
  stop `max-items`, `baselineFloor` 315841814, `backlogFloor` null; pass 2
  (delta) delivered 0 - early-stop at page 2, 4 excluded as known and 16 as
  `baseline` (remembered with `h=null`), the baseline unchanged. Before the
  baseline floor the same input delivered 4 pre-baseline notices per run
  until all 63 had been charged.

## Timeout-budget fix (2026-09-19)

`defaultRunOptions.timeoutSecs` is 3,600 (confirmed live via `GET
/v2/acts/stefano_seggio~uk-hse-enforcement-monitor`, 2026-09-19). `onlyNew:
false` has no early-stop (the delta-early-stop block in `walkListing` is
gated on `onlyNew`), so with a high `maxItemsPerDataset` the walk visits
essentially one candidate per listing row until the cap or the register end.
On the notices register (~30,226 records per the 2026-09-07 live count above,
`RESULTS_PER_PAGE = 10` -> ~3,023 pages) walked **strictly sequentially, one
page per HTTP round trip** (`walkListing`'s `for (;;)` loop `await`s each
page before requesting the next), that is already 3,023 x 2.5s (the
documented per-page ceiling, "Pages answer in 0.3-2.5 s" above) = 7,558s -
2.1x the timeout, using zero retries and before a single record's detail
page is fetched. Full enrichment (`fetchDetail`/`fetchBreachDetail`/
`fetchPartyDetail`, all default `true`) then adds up to 5 more requests per
notice (detail page, breach list, party page, party's 2 history lists),
throttled through the same `maxConcurrency`-wide semaphore (default 5): at
the same 2.5s ceiling that is ~2.5s of wall-clock time per delivered record,
on top of the walk's ~0.25s/record. Combined, a run risks exceeding the
timeout - and because records are only stored after `walkListing` returns
for that register (`processRegister` calls `delivery.deliver` once, after
the whole walk), a run that times out mid-walk delivers **nothing**, not
just the tail.

Fix: `MAX_ITEMS_HARD_CAP` (`src/input.ts`) and `.actor/input_schema.json`'s
`maxItemsPerDataset.maximum` are both capped at 900 (was 100,000) -
900 x ~2.75s/record (walk + full enrichment, derived above) =~ 2,475s, ~69%
of the real 3,600s timeout. The convictions register (~210 records) is
unaffected - it was always far under any cap. Getting more than 900 records
of notices history in one filter set now takes more than one `onlyNew:
false` run (each still returns up to the cap) or narrower filters
(`dateFrom`/`dateTo`, region, industry, ...) - the `maxItemsPerDataset`
description, the README table and the "raise the cap" log messages in
`fetchRecords.ts`/`main.ts` were updated to stop suggesting a single very
high cap gets the full history in one run.

Not changed in this fix (considered and rejected as out of scope for a
single, testable change): (1) raising `timeoutSecs` itself - the honest
full-history workload (30k+ notices, fully enriched) needs single-digit
hours even at the fastest documented per-request latency, which is not a
reasonable Actor run length to request via the Apify API; (2) tightening
`http.ts`'s `DEFAULTS` retry/backoff - they were not the dominant cost here
(the budget is blown by sheer request COUNT at normal latency, not by
retries); (3) incremental per-page delivery during the walk itself - it
would make a very large `onlyNew: false` run resumable across runs instead
of just capped, which is real future value, but is a materially bigger
change to the walk/delivery split than this bug needs now that the input
that could trigger it is capped inside the timeout with margin.

## Known scope limits (disclosed in the README)

- `UPDATED` says the record's page changed, not WHAT changed (no field-level
  diff; would need snapshot storage). A breach page changing without any
  change on the case page or the case breach list is not detected.
- Prohibition notices carry no Result on the register, so their status
  cannot be tracked; withdrawn / appealed notices are not flagged by HSE.
- Crown Censures (a separate small register under /convictions) are not
  covered.
- Party history lists read only the first page of the party's cases /
  notices (10 ids) - the counts are exact, the id lists are capped.
- No custodial-sentence server-side filter (code not found); use
  `hasCustodialSentence` on the output instead.
