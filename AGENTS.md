# AGENTS.md - UK HSE Enforcement Monitor

Technical notes for whoever (human or AI) touches this actor next.

## What this actor does

Extracts the UK Health and Safety Executive's public register of
**Convictions** (prosecutions/fines) and **Enforcement Notices**
(Improvement/Prohibition), each with full defendant/recipient, fine,
breach/legislation and location detail, sorted newest-first.

## The site is a classic-ASP multi-step wizard, but every step is a plain,
## stateless GET with a fixed, discoverable query shape

`resources.hse.gov.uk` presents its search as a multi-page wizard (pick
Cases/Breaches -> pick a search field -> enter a value -> "Add" -> "Perform
search"), but every step bottoms out in a plain `GET` with query params -
verified live 2026-09-06 by walking the real wizard with curl end to end
(home -> `Default.asp` step posts -> `search/advanced/default.asp` step
posts -> the "Perform search" form's own `GET ../search.asp` -> the 302
redirect target `case_list.asp?...`). **No session cookie is required at
any point** - a bare, cookie-less request to the final listing URL returns
the identical result set as one that walked the whole wizard first. This
was directly verified (`curl` with no `-b`/`-c` at all, zero prior
requests) - see `src/http.ts`.

## The "no real filter, sorted newest-first" query is copied verbatim
## from a real link on the site, not invented

The site's own "New cases" navigation link is:
```
case_list.asp?ST=C&CO=,+AND&SN=F&SF=ODS,+|&EO=<&SV=31/12/2100,+|&SO=DODS
```
i.e. "offence date < 31/12/2100" (effectively "all records") sorted by
`SO=DODS` (Date descending). The notices equivalent (self-derived by
walking the same wizard shape with `FI=7` "date notice was issued") is
`SO=DNIS` with `SF=NIS, |` / the same `31/12/2100, |` sentinel. Both are
hardcoded in `src/urls.ts`. Pagination is a simple `&PN=<n>` param on the
same URL; the header text `Showing Page X of Y` gives the total page
count directly - no need to guess when to stop (see
`src/parsers/listing.ts`).

**Why the literal `", |"` suffix on `SF`/`SV`?** Classic ASP's
`Request.Form("X")` joins multiple form fields sharing the same name with
`", "` when read as a scalar. The real wizard submits `SF`/`SV` twice per
step (once for the real value, once as a `|` chain terminator for
additional criteria), and the server's own rendered "Current Search
Criteria" hidden fields show the *already-joined* result: `SF="ODS, |"`.
For the final GET this is sent as a single, ordinary query param with
that literal joined value - verified this works identically to walking
the full wizard.

## Endpoints (all verified live 2026-09-06, no auth, no proxy)

Convictions (`/convictions/...`):
- `case/case_list.asp` - listing, links to `case_details.asp?SF=CN&SV=<id>`.
- `case/case_details.asp?SF=CN&SV=<caseNumber>` - full detail: defendant
  (+ link to `defendant/defendant_details.asp?SF=DID&SV=<id>`),
  description, offence date, total fine, total costs, location, HSE admin
  fields, and one or more links to `breach/breach_details.asp?SF=BID&SV=<breachId>`.
- `breach/breach_details.asp?SF=BID&SV=<breachId>` - court, Act/Section,
  Regulation, hearing date, result, per-breach fine.

Notices (`/notices/...`):
- `notices/notice_list.asp` - listing, links to
  `notice_details.asp?SF=CN&SV=<id>`.
- `notices/notice_details.asp?SF=CN&SV=<noticeNumber>` - the `<th>` header
  reads `Notice <id> served against <a>Recipient</a> on <date>` (recipient
  name/id and served date are parsed from this header, not a normal
  label/value row); plus notice type, description, compliance dates,
  result, location, HSE admin fields.
- `breach/breach_list.asp?ST=B&SN=F&EO=%3D&SF=NN&SV=<noticeNumber>` - one
  row per breach with Act/Regulation **already inline** - unlike
  convictions, notices have no separate per-breach detail page.

## Two real parsing gotchas found and fixed before writing the final parser

1. **`&nbsp;`-padded labels.** Several `<strong>` labels in the source use
   `&nbsp;` instead of a plain space (e.g.
   `Total&nbsp;Costs&nbsp;Awarded&nbsp;to&nbsp;HSE`, `HSE&nbsp;Area ` with
   a trailing one too). Cheerio's `.text()` turns `&nbsp;` into a literal
   U+00A0 character, which looks identical to a space in a terminal/log
   but does **not** equal `" "` in a JS string comparison - a naive
   `fields['Total Costs Awarded to HSE']` lookup would silently miss.
   Fixed by normalizing with `.replace(/\s+/g, ' ')`, which - contrary to
   the common assumption that `\s` is ASCII-only - **does** match U+00A0
   under the ECMAScript spec, so this one regex handles it.
2. **`<BR>`-joined addresses.** The `Address` value cell uses literal
   `<BR>` tags to separate lines (`Hale Road/Millhouse Metals<BR>...`),
   not real newline text nodes. Cheerio's `.text()` simply drops `<br>`
   tags with no replacement, which would silently concatenate every line
   into one run-together string. Fixed in `parsers/labelValueTable.ts` by
   cloning the cell and replacing `<br>` elements with `, ` text nodes
   before extracting text. This does **not** affect the Notices
   `Description` field, which uses genuine newline text nodes (no `<br>`)
   for its multi-item breach summaries - those are correctly preserved
   as-is by the same code path, verified against a real multi-breach
   fixture.

## Architecture

- `src/http.ts` - plain `fetch()` with retry, no proxy, no cookies.
- `src/urls.ts` - the two hardcoded "all records, newest first" listing
  queries plus detail/breach URL builders.
- `src/parsers/listing.ts` - harvests detail-page ids straight from the
  listing's own `<a href="..._details.asp?SF=CN&SV=<id>">` links (the
  listing table's other columns are redundant with the detail page, so
  they're not parsed at all) and the `Page X of Y` total.
- `src/parsers/labelValueTable.ts` - one generic parser shared by all
  three detail-page shapes (conviction detail, notice detail, breach
  detail): pairs `<td>` cells two-at-a-time **within each row**, keyed by
  the first cell's text (label markup differs - conviction/breach pages
  wrap labels in `<strong>`, notice pages don't - so the parser matches by
  position, not markup). Rows with an odd cell count (section headers like
  "Location of Offence", the "Breach involved..." link row) have no pair
  partner and are silently skipped - this is the same shape of fix as
  Cordoba's checkbox bug and Mendoza's EVENTVALIDATION difference
  elsewhere in this portfolio: verify the real markup, don't assume a
  uniform row shape.
- `src/parsers/noticeBreachList.ts` - the notices breach-list table (Act/
  Regulation inline, no detail-page fetch needed).
- `src/fetchListingIds.ts` - shared pagination loop for both registers.
- `src/fetchConvictions.ts` / `src/fetchNotices.ts` - orchestrate
  listing -> detail (-> breach) per record.

## Known scope limits (disclosed, not hidden)

- The Convictions register is small by design: HSE's own site states it
  covers **the last 5 years only** (~200 records total at audit time,
  2026-09-06) - not a bug, a stated retention policy. Notices has no such
  disclosed cap (~30,000 records at audit time).
- `description` is plain text, not reformatted or summarized.
- The multi-select "Add a criteria" wizard supports many other search
  dimensions (location, industry, HSE region, etc.) not exposed as actor
  input - every run currently pulls the newest N records unfiltered,
  matching the "recurring compliance monitor" use case this was built for
  (CHAS/SSIP-style contractor vetting checks the *whole* register for a
  name match, not a pre-filtered slice).
