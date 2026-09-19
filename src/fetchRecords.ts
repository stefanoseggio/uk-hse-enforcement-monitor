import { log } from 'apify';
import * as cheerio from 'cheerio';

import { ROBOTS_DISALLOWED_CASE_NUMBERS } from './codes.js';
import { fetchOptional, fetchWithRetry, mapWithConcurrency } from './http.js';
import {
    addDays,
    classifyBreachResult,
    classifyNoticeType,
    classifyPartyStatus,
    compareRecordIds,
    contentHash,
    daysBetween,
    extractCountry,
    extractNoticeItemIds,
    extractPostcode,
    isOpenNoticeResult,
    lowestRecordId,
    parseActReference,
    parseGbp,
    parseRegulationReference,
    parseUkDate,
    siteCalendarDate,
    splitNoticeBreach,
    splitSic,
} from './normalize.js';
import type { BreachListRow } from './parsers/breachList.js';
import { parseBreachList } from './parsers/breachList.js';
import {
    allHrefsMatching,
    extractIdParam,
    firstHrefMatching,
    isDetailPage,
    pageHeaderText,
    parseFatalityFlag,
    parseLabelValueRows,
} from './parsers/labelValueTable.js';
import type { ListingRow } from './parsers/listing.js';
import { parseListingIds, parseListingPage, parseTotalMatching } from './parsers/listing.js';
import { parseNoticeBreachList } from './parsers/noticeBreachList.js';
import type { PartyPage } from './parsers/party.js';
import { parsePartyPage } from './parsers/party.js';
import type { StateEntry } from './state.js';
import type {
    ConvictionBreach,
    ConvictionRecord,
    DatasetName,
    EventType,
    HseRecord,
    NoticeBreach,
    NoticeRecord,
    RegisterQuery,
} from './types.js';
import { DATA_SOURCE_ATTRIBUTION } from './types.js';
import {
    absoluteUrl,
    convictionBreachDetailPath,
    convictionBreachListPath,
    convictionDetailPath,
    defendantDetailPath,
    listingPath,
    noticeBreachListPath,
    noticeDetailPath,
    partyCasesPath,
    partyNoticesPath,
    recipientDetailPath,
} from './urls.js';

// ---------------------------------------------------------------------------
// Detail page (case / notice) - the unit the delta engine hashes
// ---------------------------------------------------------------------------

export interface DetailPage {
    fields: Record<string, string>;
    header: string;
    partyId: string | null;
    partyName: string | null;
    /** Convictions: breach ids (case-page links united with the per-case breach list). */
    breachIds: string[];
    /** Convictions: the per-case breach list rows (hearing date, result, fine, Act/Reg inline). */
    breachRows: BreachListRow[];
    /** Convictions: the "did result from the investigation of a fatality" row. */
    fatality: boolean;
    /** Notices: served-on date from the header, DD/MM/YYYY. */
    servedDate: string | null;
}

// The notice header reads "Notice 316005113 served against <a>Recipient</a> on 25/07/2026".
const SERVED_DATE_RE = /on (\d{2}\/\d{2}\/\d{4})\s*$/;

export function parseDetailPage($: cheerio.CheerioAPI, register: DatasetName): DetailPage {
    const fields = parseLabelValueRows($);
    const header = pageHeaderText($);
    if (register === 'convictions') {
        const defendantHref = firstHrefMatching($, 'defendant_details.asp');
        const breachIds = [
            ...new Set(
                allHrefsMatching($, 'breach_details.asp')
                    .map((href) => extractIdParam(href))
                    .filter((id): id is string => id !== null),
            ),
        ];
        return {
            fields,
            header,
            partyId: defendantHref ? extractIdParam(defendantHref) : null,
            partyName: fields.Defendant || null,
            breachIds,
            breachRows: [],
            fatality: parseFatalityFlag($),
            servedDate: null,
        };
    }
    const recipientHref = firstHrefMatching($, 'recipient_details.asp');
    return {
        fields,
        header,
        partyId: recipientHref ? extractIdParam(recipientHref) : null,
        partyName: $('a[href*="recipient_details.asp"]').first().text().trim() || null,
        breachIds: [],
        breachRows: [],
        fatality: false,
        servedDate: header.match(SERVED_DATE_RE)?.[1] ?? null,
    };
}

/**
 * The change key. The registers expose no published/last-updated timestamp
 * anywhere and amendments keep their original dates (a notice's Result flips
 * "Ongoing" -> "Complied with" in place; breaches are appended to a case), so
 * the only honest UPDATED signal is the content of the case/notice page
 * itself (plus, for convictions, the per-case breach list: a new hearing adds
 * a row). Breach pages and party pages are deliberately not part of the hash
 * so it is identical whatever fetchBreachDetail/fetchPartyDetail are set to.
 */
export function detailContentHash(detail: DetailPage): string {
    return contentHash({
        fields: detail.fields,
        header: detail.header,
        partyId: detail.partyId,
        breachIds: detail.breachIds,
        breachRows: detail.breachRows.map((r) => [r.breachId, r.hearingDate, r.result, r.fine, r.actOrRegulation]),
        fatality: detail.fatality,
    });
}

export interface DetailResult {
    detail: DetailPage | null;
    error: string | null;
}

export async function fetchDetailFor(register: DatasetName, id: string): Promise<DetailResult> {
    const path = register === 'convictions' ? convictionDetailPath(id) : noticeDetailPath(id);
    try {
        const html = await fetchOptional(path);
        if (html === null) return { detail: null, error: 'NOT_FOUND' };
        const $ = cheerio.load(html);
        if (!isDetailPage($)) return { detail: null, error: 'NOT_A_DETAIL_PAGE' };
        const detail = parseDetailPage($, register);
        if (register === 'convictions') {
            // A multi-breach case page does not link its breaches; the per-case
            // breach list is the only complete source of breach ids (1 request).
            const listHtml = await fetchOptional(convictionBreachListPath(id));
            if (listHtml !== null) {
                detail.breachRows = parseBreachList(cheerio.load(listHtml)).filter((r) => r.breachId.startsWith(id));
                detail.breachIds = [
                    ...new Set([...detail.breachIds, ...detail.breachRows.map((r) => r.breachId)]),
                ].sort();
            }
        }
        return { detail, error: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warning(`Detail fetch failed for ${register} ${id}: ${message}`);
        return { detail: null, error: message };
    }
}

// ---------------------------------------------------------------------------
// Listing walk
// ---------------------------------------------------------------------------

/** 'baseline': an unseen record below the cold run's baseline - history, never delivered in delta mode. */
export type ExclusionReason = 'known' | 'eventType' | 'robots' | 'baseline';

export interface Candidate {
    register: DatasetName;
    id: string;
    /** Listing row (null for re-check candidates, which are not on a walked page). */
    row: ListingRow | null;
    eventType: EventType;
    isNew: boolean;
    excludedBy: ExclusionReason | null;
    prior: StateEntry | null;
    /** Detail page already fetched during the re-check pass. */
    detail: DetailPage | null;
}

export interface WalkOptions {
    query: RegisterQuery;
    maxItems: number;
    onlyNew: boolean;
    seen: Readonly<Record<string, StateEntry>>;
    eventTypes: ReadonlySet<EventType>;
    /** Never early-stop: walk every page of the (small) register. */
    fullWalk: boolean;
    /**
     * Walk watermark (see state.ts): undelivered records may exist at or
     * below this id, so the known-pages early-stop is suppressed until the
     * walk has reached it. Null when the previous walk left no backlog.
     */
    backlogFloor?: string | null;
    /**
     * Baseline (see state.ts): the oldest id the cold delta run delivered
     * when its walk was cut short. Unseen records below it are excluded as
     * 'baseline' - not delivered, and not counted as unseen for the
     * early-stop. Null when the cold run saw the whole register.
     */
    baselineFloor?: string | null;
    /** True on the run that defines the baseline (only changes the cap warning). Defaults to "nothing known yet". */
    cold?: boolean;
}

export type StopReason = 'end-of-results' | 'no-more-pages' | 'max-items' | 'delta-early-stop' | 'page-cap';

export interface WalkResult {
    /** Deliverable candidates in walk order (newest entry first). */
    candidates: Candidate[];
    /** Walked but intentionally not delivered. */
    excluded: Candidate[];
    totalMatching: number | null;
    pagesWalked: number;
    stopReason: StopReason;
    truncatedByMaxItems: boolean;
    /**
     * Incomplete walks only ('max-items' / 'page-cap'): the id of the first
     * matching record the walk did NOT take. Every unvisited record is at or
     * below it - the top of the backlog the next run must reach.
     */
    stoppedAtId: string | null;
}

const CONSECUTIVE_KNOWN_PAGES_TO_STOP = 2;
const PAGE_CAP = 20_000; // 200,000 rows - a runaway guard well above the 30k-notice register
const NOT_A_LISTING_RETRIES = 2;

export function structuralEventType(register: DatasetName): EventType {
    return register === 'convictions' ? 'SANCTION' : 'NEW_LISTING';
}

async function loadListingPage(query: RegisterQuery, page: number) {
    for (let attempt = 0; ; attempt++) {
        const html = await fetchWithRetry(listingPath(query, page));
        const parsed = parseListingPage(cheerio.load(html), query.register);
        if (parsed.isListingPage) return parsed;
        if (attempt >= NOT_A_LISTING_RETRIES) {
            const why = parsed.isErrorPage
                ? 'the site rendered its SQL error page (an unsupported filter combination or a site change)'
                : 'the response is not a register listing (blocked, under maintenance, or the site changed)';
            throw new Error(
                `HSE ${query.register} listing page ${page}: ${why}. Aborting instead of reporting "nothing new". URL: ${absoluteUrl(listingPath(query, page))}`,
            );
        }
        log.warning(
            `${query.register} page ${page} did not look like a listing page - retrying (${attempt + 1}/${NOT_A_LISTING_RETRIES}).`,
        );
    }
}

/**
 * Walk one register's listing in entry order (DCN / DNN) and decide, per
 * row, whether it must be delivered. Never fetches detail pages.
 */
export async function walkListing(options: WalkOptions): Promise<WalkResult> {
    const { query, maxItems, onlyNew, seen, eventTypes, fullWalk } = options;
    const backlogFloor = options.backlogFloor ?? null;
    // The baseline only shapes delta walks: a full run delivers history too.
    const baselineFloor = onlyNew ? (options.baselineFloor ?? null) : null;
    const cold = options.cold ?? Object.keys(seen).length === 0;
    const { register } = query;
    const candidates: Candidate[] = [];
    const excluded: Candidate[] = [];
    const walkedIds = new Set<string>();
    const structural = structuralEventType(register);

    const done = (
        stopReason: StopReason,
        pagesWalked: number,
        totalMatching: number | null,
        truncatedByMaxItems = false,
        stoppedAtId: string | null = null,
    ): WalkResult => ({
        candidates,
        excluded,
        totalMatching,
        pagesWalked,
        stopReason,
        truncatedByMaxItems,
        stoppedAtId,
    });

    let totalMatching: number | null = null;
    let consecutiveKnownPages = 0;
    let floorNoted = false;
    let page = 1;
    for (;;) {
        const listing = await loadListingPage(query, page);
        totalMatching ??= listing.totalMatching;
        if (listing.rows.length === 0) {
            log.info(`${register} page ${page}: no rows - end of listing.`);
            return done('end-of-results', page, totalMatching);
        }

        let pageHasUnseen = false;
        for (const row of listing.rows) {
            if (walkedIds.has(row.id)) continue; // the listing shifted under us between two page fetches
            walkedIds.add(row.id);
            const prior = seen[row.id] ?? null;
            const isNew = prior === null;
            // An unseen record entered before the baseline is history: it is
            // neither delivered nor a reason to keep walking.
            const belowBaseline = isNew && baselineFloor !== null && compareRecordIds(row.id, baselineFloor) < 0;
            if (isNew && !belowBaseline) pageHasUnseen = true;
            const candidate: Candidate = {
                register,
                id: row.id,
                row,
                eventType: structural,
                isNew,
                excludedBy: null,
                prior,
                detail: null,
            };
            if (register === 'convictions' && ROBOTS_DISALLOWED_CASE_NUMBERS.has(row.id))
                candidate.excludedBy = 'robots';
            else if (onlyNew && !isNew) candidate.excludedBy = 'known';
            else if (belowBaseline) candidate.excludedBy = 'baseline';
            else if (isNew && !eventTypes.has(structural)) candidate.excludedBy = 'eventType';

            if (candidate.excludedBy) {
                excluded.push(candidate);
                continue;
            }
            if (candidates.length >= maxItems) {
                let catchUp = 'raise the cap or narrow the filters to get more in one run';
                if (onlyNew && cold) {
                    catchUp =
                        'this first delta run defines the baseline: the older records below the cap are history and are never delivered by later delta runs - raise the cap now for a deeper baseline, or run once with onlyNew=false for the full history';
                } else if (onlyNew) {
                    catchUp =
                        'the walk watermark makes the next delta run walk down to it instead of early-stopping on the records delivered today; raise the cap to catch up faster';
                }
                log.warning(
                    `${register}: maxItemsPerDataset=${maxItems} reached on page ${page} at record ${row.id} - the remaining matching records were NOT delivered this run (${catchUp}).`,
                );
                return done('max-items', page, totalMatching, true, row.id);
            }
            candidates.push(candidate);
        }

        const matchingNote = totalMatching !== null ? ` (of ${totalMatching.toLocaleString('en-GB')} matching)` : '';
        log.info(
            `${register} page ${page}/${listing.totalPages ?? '?'}: ${listing.rows.length} rows, ${candidates.length} to deliver so far${matchingNote}`,
        );

        if (onlyNew && !fullWalk) {
            consecutiveKnownPages = pageHasUnseen ? 0 : consecutiveKnownPages + 1;
            if (consecutiveKnownPages >= CONSECUTIVE_KNOWN_PAGES_TO_STOP) {
                // Known pages only prove "nothing new ABOVE here". A previous
                // run that stopped at its cap (or did not store every
                // candidate) left undelivered records further down, under
                // the very records it delivered - so the stop is deferred
                // until the walk has reached that watermark.
                const pageLowestId = lowestRecordId(listing.rows.map((r) => r.id));
                const aboveFloor =
                    backlogFloor !== null && pageLowestId !== null && compareRecordIds(pageLowestId, backlogFloor) > 0;
                if (aboveFloor) {
                    if (!floorNoted) {
                        log.info(
                            `${register}: page ${page} is fully known but a previous run left undelivered records at or below ${backlogFloor} - walking on until the watermark is reached.`,
                        );
                        floorNoted = true;
                    }
                } else {
                    log.info(
                        `${register}: delta early-stop at page ${page} - ${CONSECUTIVE_KNOWN_PAGES_TO_STOP} consecutive pages with no unseen record${backlogFloor !== null ? ` (watermark ${backlogFloor} reached)` : ''}.`,
                    );
                    return done('delta-early-stop', page, totalMatching);
                }
            }
        }
        if (listing.totalPages !== null && page >= listing.totalPages)
            return done('no-more-pages', page, totalMatching);
        if (page >= PAGE_CAP) {
            log.warning(`Page cap (${PAGE_CAP}) reached - stopping the walk.`);
            return done('page-cap', page, totalMatching, true, lowestRecordId(listing.rows.map((r) => r.id)));
        }
        page += 1;
    }
}

// ---------------------------------------------------------------------------
// Re-check of known open records (UPDATED detection)
// ---------------------------------------------------------------------------

export const RECHECK_CAP = 2000;

/**
 * Known records worth re-fetching this run: they were delivered WITH a
 * detail hash, are still "open" (an Improvement Notice whose Result was
 * Ongoing/blank; every conviction), and are within `recheckDays` of the
 * later of their register date and their first delivery. Ordered by that
 * date descending and capped.
 */
export function selectRecheckIds(
    seen: Readonly<Record<string, StateEntry>>,
    today: string,
    recheckDays: number,
    cap = RECHECK_CAP,
): string[] {
    if (recheckDays <= 0) return [];
    const cutoff = addDays(today, -recheckDays);
    const eligible: [string, string][] = [];
    for (const [id, entry] of Object.entries(seen)) {
        if (!entry.h || !entry.o) continue;
        const anchor = entry.d && entry.d > entry.f ? entry.d : entry.f;
        if (anchor >= cutoff) eligible.push([id, anchor]);
    }
    eligible.sort((a, b) => b[1].localeCompare(a[1]));
    if (eligible.length > cap) {
        log.warning(
            `${eligible.length} known open records are eligible for re-check; only the ${cap} most recent are re-checked this run (lower recheckDays to narrow the window).`,
        );
    }
    return eligible.slice(0, cap).map(([id]) => id);
}

export interface RecheckResult {
    updated: Candidate[];
    unchanged: number;
    /** Ids whose page answered the site's "unknown id" 500 this run (NOT final - see main.ts). */
    vanished: string[];
    /** Ids whose page was read (changed or unchanged) - their missing history, if any, is cleared. */
    readIds: string[];
    failed: number;
}

/**
 * Outage guard. The site's answer for an unknown id is the generic IIS 500
 * page, so a server hiccup looks exactly like a withdrawn record - and a
 * timeout after the retries or a non-record page (maintenance, block) is
 * no more conclusive. A single unreadable record is plausible; a large
 * share of listed / recently delivered records failing in one run is not -
 * that is the site failing, and the run must fail with it rather than
 * quietly closing or stubbing them. Applied to any sample of at least
 * MIN_SAMPLE detail fetches (ratio), and to a streak of consecutive
 * failures in delivery order. Every detail failure counts (NOT_FOUND,
 * NOT_A_DETAIL_PAGE, timeout / network error).
 */
export const NOT_FOUND_GUARD = { ratio: 0.3, minSample: 10, maxConsecutive: 5 };

export function assertNotFoundWithinBounds(
    register: DatasetName,
    attempted: number,
    failed: number,
    consecutive: number,
    context: string,
    options?: {
        /**
         * A small re-check batch (fewer open records fall inside
         * `recheckDays` than `minSample`) never reaches the 10-sample ratio
         * threshold, so a sustained outage could return NOT_FOUND for every
         * one of them, run after run, without ever tripping the guard. When
         * set, a batch where every attempted fetch failed is treated as
         * suspicious regardless of its size (below `minSample` this adds
         * coverage; at or above it the ratio check already covers a 100%
         * failure, so this is a no-op there).
         */
        allFailedIsSuspicious?: boolean;
    },
): void {
    const tooMany = attempted >= NOT_FOUND_GUARD.minSample && failed / attempted >= NOT_FOUND_GUARD.ratio;
    const streak = consecutive >= NOT_FOUND_GUARD.maxConsecutive;
    const allFailedSmallBatch = Boolean(options?.allFailedIsSuspicious) && attempted >= 1 && failed === attempted;
    if (!tooMany && !streak && !allFailedSmallBatch) return;
    throw new Error(
        `HSE ${register} ${context}: ${failed} of ${attempted} record page(s) could not be read (${consecutive} in a row: the site's "unknown id" 500, a timeout or a non-record page) although the register lists them - treating this as a site outage, not as withdrawals. Aborting so no record is stubbed or dropped; the next run retries.`,
    );
}

/** Longest streak of consecutive detail failures (any non-null error), in order. */
export function longestNotFoundStreak(errors: readonly (string | null)[]): number {
    let streak = 0;
    let longest = 0;
    for (const e of errors) {
        streak = e !== null ? streak + 1 : 0;
        longest = Math.max(longest, streak);
    }
    return longest;
}

export async function recheckKnown(
    register: DatasetName,
    ids: readonly string[],
    seen: Readonly<Record<string, StateEntry>>,
    maxConcurrency: number,
): Promise<RecheckResult> {
    const result: RecheckResult = { updated: [], unchanged: 0, vanished: [], readIds: [], failed: 0 };
    if (ids.length === 0) return result;
    const details = await mapWithConcurrency(ids, maxConcurrency, async (id) => fetchDetailFor(register, id));
    assertNotFoundWithinBounds(
        register,
        ids.length,
        details.filter((d) => d.error !== null).length,
        longestNotFoundStreak(details.map((d) => d.error)),
        're-check of known open records',
        // A small re-check batch (few open records inside recheckDays) can
        // never reach the 10-sample ratio threshold; a 100% failure of even
        // a tiny batch is as suspicious as a large one, since a genuine
        // multi-day outage could otherwise return NOT_FOUND for all of them
        // across two runs and risk a false MISSING_RUNS_BEFORE_CLOSED closure.
        { allFailedIsSuspicious: true },
    );
    details.forEach((d, i) => {
        const id = ids[i];
        const prior = seen[id];
        if (d.error === 'NOT_FOUND') {
            result.vanished.push(id);
            return;
        }
        if (!d.detail) {
            result.failed += 1;
            return;
        }
        result.readIds.push(id);
        if (detailContentHash(d.detail) === prior.h) {
            result.unchanged += 1;
            return;
        }
        result.updated.push({
            register,
            id,
            row: null,
            eventType: 'UPDATED',
            isNew: false,
            excludedBy: null,
            prior,
            detail: d.detail,
        });
    });
    log.info(
        `${register}: re-checked ${ids.length} known open record(s) - ${result.updated.length} changed, ${result.unchanged} unchanged, ${result.vanished.length} not found this run, ${result.failed} could not be read.`,
    );
    return result;
}

// ---------------------------------------------------------------------------
// Enrichment (breaches, party) and record building
// ---------------------------------------------------------------------------

export interface EnrichOptions {
    fetchDetail: boolean;
    fetchBreachDetail: boolean;
    fetchPartyDetail: boolean;
    maxConcurrency: number;
    now: Date;
}

interface PartyResult {
    party: PartyPage | null;
    convictionCount: number | null;
    noticeCount: number | null;
    caseNumbers: string[];
    noticeNumbers: string[];
    error: string | null;
}

async function fetchParty(register: DatasetName, partyId: string): Promise<PartyResult> {
    const out: PartyResult = {
        party: null,
        convictionCount: null,
        noticeCount: null,
        caseNumbers: [],
        noticeNumbers: [],
        error: null,
    };
    try {
        const path = register === 'convictions' ? defendantDetailPath(partyId) : recipientDetailPath(partyId);
        const html = await fetchOptional(path);
        if (html === null) {
            out.error = 'NOT_FOUND';
            return out;
        }
        out.party = parsePartyPage(cheerio.load(html));
        const [cases, notices] = await Promise.all([
            fetchWithRetry(partyCasesPath(partyId)),
            fetchWithRetry(partyNoticesPath(partyId)),
        ]);
        const $cases = cheerio.load(cases);
        const $notices = cheerio.load(notices);
        out.convictionCount = parseTotalMatching($cases);
        out.noticeCount = parseTotalMatching($notices);
        out.caseNumbers = [...new Set(parseListingIds($cases))];
        out.noticeNumbers = [...new Set(parseListingIds($notices))];
    } catch (error) {
        out.error = error instanceof Error ? error.message : String(error);
        log.warning(`Party page fetch failed for ${register} party ${partyId}: ${out.error}`);
    }
    return out;
}

/** Breach record from the per-case breach list row alone (no breach page fetched). */
function breachFromListRow(breachId: string, row: BreachListRow | null): ConvictionBreach {
    const split = splitNoticeBreach(row?.actOrRegulation);
    const category = classifyBreachResult(row?.result);
    return {
        breachId,
        court: null,
        courtLevel: null,
        act: null,
        regulation: null,
        dateOfHearing: row?.hearingDate ?? null,
        result: null,
        fine: row?.fine ?? null,
        resultListing: row?.result ?? null,
        actOrRegulation: row?.actOrRegulation ?? null,
        legislation: split.legislation,
        provision: split.provision,
        paragraph: split.paragraph,
        dateOfHearingIso: parseUkDate(row?.hearingDate),
        fineGbp: parseGbp(row?.fine),
        actName: null,
        actSection: null,
        actSubSection: null,
        regulationName: null,
        regulationNumber: null,
        regulationParagraph: null,
        resultCategory: category,
        isCustodial: category === null ? null : category === 'custodial' || category === 'suspended_custodial',
        source_url: absoluteUrl(convictionBreachDetailPath(breachId)),
    };
}

/** Breach record with its own page (court, Act section, Regulation paragraph) merged over the list row. */
async function fetchConvictionBreach(breachId: string, row: BreachListRow | null): Promise<ConvictionBreach> {
    const base = breachFromListRow(breachId, row);
    const html = await fetchOptional(convictionBreachDetailPath(breachId));
    if (html === null) return base;
    const fields = parseLabelValueRows(cheerio.load(html));
    const act = parseActReference(fields.Act);
    const reg = parseRegulationReference(fields.Regulation);
    const result = fields.Result || null;
    const category = classifyBreachResult(result) ?? base.resultCategory;
    return {
        ...base,
        court: fields['Court Name'] || null,
        courtLevel: fields['Court Level'] || null,
        act: fields.Act || null,
        regulation: fields.Regulation || null,
        dateOfHearing: fields['Date of Hearing'] || base.dateOfHearing,
        result,
        fine: fields.Fine || base.fine,
        dateOfHearingIso: parseUkDate(fields['Date of Hearing']) ?? base.dateOfHearingIso,
        fineGbp: parseGbp(fields.Fine) ?? base.fineGbp,
        actName: act.name,
        actSection: act.section,
        actSubSection: act.subSection,
        regulationName: reg.name,
        regulationNumber: reg.number,
        regulationParagraph: reg.paragraph,
        resultCategory: category,
        isCustodial: category === null ? null : category === 'custodial' || category === 'suspended_custodial',
    };
}

async function fetchNoticeBreaches(noticeNumber: string): Promise<NoticeBreach[]> {
    const html = await fetchOptional(noticeBreachListPath(noticeNumber));
    if (html === null) return [];
    return parseNoticeBreachList(cheerio.load(html));
}

export interface BuiltRecord {
    record: HseRecord;
    /** What the delta state must remember for this record once it is stored. */
    stateEntry: { hash: string | null; dateIso: string | null; open: boolean };
}

function unique(values: (string | null)[]): string[] | null {
    const out = [...new Set(values.filter((v): v is string => !!v))];
    return out;
}

function commonFields(
    candidate: Candidate,
    detail: DetailPage | null,
    detailError: string | null,
    breachDetailFetched: boolean,
    party: PartyResult | null,
    partyIdFromDetail: string | null,
    scrapedAt: string,
    today: string,
) {
    const f = detail?.fields ?? {};
    const { row } = candidate;
    const address = f.Address || null;
    const sic = splitSic(f['Main Activity'] || row?.mainActivity);
    const partyPage = party?.party ?? null;
    let partyPath: string | null = null;
    if (partyIdFromDetail !== null) {
        partyPath =
            candidate.register === 'convictions'
                ? defendantDetailPath(partyIdFromDetail)
                : recipientDetailPath(partyIdFromDetail);
    }
    const totalParty =
        party && (party.convictionCount !== null || party.noticeCount !== null)
            ? (party.convictionCount ?? 0) + (party.noticeCount ?? 0)
            : null;
    return {
        record_id: candidate.id,
        event_type: candidate.eventType,
        scraped_at: scrapedAt,
        is_new: candidate.isNew,
        source_url: absoluteUrl(
            candidate.register === 'convictions' ? convictionDetailPath(candidate.id) : noticeDetailPath(candidate.id),
        ),
        data_source: DATA_SOURCE_ATTRIBUTION,

        address,
        region: f.Region || null,
        localAuthority: f['Local Authority'] || row?.localAuthority || null,
        industry: f.Industry || null,
        mainActivity: f['Main Activity'] || row?.mainActivity || null,
        typeOfLocation: f['Type of Location'] || null,
        hseGroup: f['HSE Group'] || null,
        hseDirectorate: f['HSE Directorate'] || null,
        hseArea: f['HSE Area'] || null,
        hseDivision: f['HSE Division'] || null,

        postcode: extractPostcode(address),
        country: extractCountry(address),
        sicCode: sic.code,
        sicDescription: sic.description,

        partyStatus: partyPage?.status ?? null,
        partyEntityType: classifyPartyStatus(partyPage?.status),
        partyAddress: partyPage?.address ?? null,
        partyPostcode: extractPostcode(partyPage?.address),
        partyHseReference: partyPage?.hseReference ?? partyIdFromDetail,
        partyUrl: partyPath ? absoluteUrl(partyPath) : null,
        partyConvictionCount: party?.convictionCount ?? null,
        partyNoticeCount: party?.noticeCount ?? null,
        partyOtherCaseNumbers: party
            ? party.caseNumbers.filter((id) => !(candidate.register === 'convictions' && id === candidate.id))
            : null,
        partyOtherNoticeNumbers: party
            ? party.noticeNumbers.filter((id) => !(candidate.register === 'notices' && id === candidate.id))
            : null,
        isRepeatOffender: totalParty === null ? null : totalParty > 1,

        detailFetched: detail !== null,
        detailError,
        breachDetailFetched,
        partyDetailFetched: party?.party !== null && party?.party !== undefined,
        partyDetailError: party?.error ?? null,
        contentHash: detail ? detailContentHash(detail) : null,
        firstSeenAt: candidate.prior?.f ?? today,
    };
}

export function buildConvictionRecord(
    candidate: Candidate,
    detail: DetailPage | null,
    detailError: string | null,
    breaches: ConvictionBreach[],
    breachDetailFetched: boolean,
    party: PartyResult | null,
    now: Date,
    scrapedAt = now.toISOString(),
): BuiltRecord {
    const today = siteCalendarDate(now);
    const f = detail?.fields ?? {};
    const { row } = candidate;
    const offenceDate = f['Offence Date'] || row?.date || null;
    const offenceDateIso = parseUkDate(offenceDate);
    const totalFineGbp = parseGbp(f['Total Fine']);
    const totalCostsGbp = parseGbp(f['Total Costs Awarded to HSE']);
    const hearing = breaches
        .filter((b) => b.dateOfHearingIso)
        .sort((a, b) => (b.dateOfHearingIso ?? '').localeCompare(a.dateOfHearingIso ?? ''))[0];
    // Result vocabulary is available from the per-case breach list even without breach pages.
    const custodial = breaches.some((b) => b.isCustodial !== null)
        ? breaches.some((b) => b.isCustodial === true)
        : null;
    const legislation = unique(breaches.map((b) => b.actName ?? b.regulationName ?? b.legislation));
    const record: ConvictionRecord = {
        ...commonFields(
            candidate,
            detail,
            detailError,
            breachDetailFetched,
            party,
            detail?.partyId ?? null,
            scrapedAt,
            today,
        ),
        recordType: 'conviction',
        caseNumber: candidate.id,
        defendantName: detail?.partyName ?? row?.name ?? null,
        defendantId: detail?.partyId ?? null,
        description: f.Description || null,
        offenceDate,
        totalFine: f['Total Fine'] || null,
        totalCosts: f['Total Costs Awarded to HSE'] || null,
        breaches,
        offenceDateIso,
        totalFineGbp,
        totalCostsGbp,
        totalPenaltyGbp:
            totalFineGbp !== null || totalCostsGbp !== null ? (totalFineGbp ?? 0) + (totalCostsGbp ?? 0) : null,
        hearingDate: hearing?.dateOfHearing ?? null,
        hearingDateIso: hearing?.dateOfHearingIso ?? null,
        resultingFromFatality: detail ? detail.fatality : null,
        hasCustodialSentence: custodial,
        breachCount: detail ? detail.breachIds.length : null,
        legislationBreached: detail ? legislation : null,
        courtLevel: breachDetailFetched
            ? (unique(breaches.map((b) => b.courtLevel))?.join(', ') ?? null) || null
            : null,
    };
    return {
        record,
        stateEntry: {
            hash: record.contentHash,
            dateIso: record.hearingDateIso ?? offenceDateIso,
            open: detail !== null,
        },
    };
}

export function buildNoticeRecord(
    candidate: Candidate,
    detail: DetailPage | null,
    detailError: string | null,
    breaches: NoticeBreach[],
    breachDetailFetched: boolean,
    party: PartyResult | null,
    now: Date,
    scrapedAt = now.toISOString(),
): BuiltRecord {
    const today = siteCalendarDate(now);
    const f = detail?.fields ?? {};
    const { row } = candidate;
    const noticeType = f['Notice Type'] || row?.noticeType || null;
    const flags = classifyNoticeType(noticeType);
    const servedDate = detail?.servedDate ?? row?.date ?? null;
    const servedDateIso = parseUkDate(servedDate);
    // The detail page is authoritative; the listing row carries Compliance
    // Date and Notice Result too whenever an Improvement code is in the
    // noticeTypes filter (the site's 8-column shape), so listing-only runs of
    // improvement notices still get them.
    const complianceDate = f['Compliance Date'] || row?.complianceDate || null;
    const complianceDateIso = parseUkDate(complianceDate);
    const revisedComplianceDateIso = parseUkDate(f['Revised Compliance Date']);
    const effective = revisedComplianceDateIso ?? complianceDateIso;
    const result = f.Result || row?.noticeResult || null;
    // Improvement Notices carry a Result ("Ongoing" / "Complied with"); prohibition
    // notice pages have no Result row at all (verified live), so their status is unknown.
    let isOngoing: boolean | null = null;
    let isCompliedWith: boolean | null = null;
    if (result) {
        isOngoing = /^ongoing$/i.test(result);
        isCompliedWith = /complied/i.test(result);
    } else if (detail && flags.isImprovement) {
        isOngoing = true;
        isCompliedWith = false;
    }
    const description = f.Description || null;
    const record: NoticeRecord = {
        ...commonFields(
            candidate,
            detail,
            detailError,
            breachDetailFetched,
            party,
            detail?.partyId ?? null,
            scrapedAt,
            today,
        ),
        recordType: 'notice',
        noticeNumber: candidate.id,
        recipientName: detail?.partyName ?? row?.name ?? null,
        recipientId: detail?.partyId ?? null,
        noticeType,
        servedDate,
        description,
        complianceDate,
        revisedComplianceDate: f['Revised Compliance Date'] || null,
        result,
        breaches,
        noticeTypeListing: row?.noticeType ?? null,
        noticeCategory: flags.category,
        isProhibition: flags.isProhibition,
        isImprovement: flags.isImprovement,
        isImmediate: flags.isImmediate,
        isDeferred: flags.isDeferred,
        isCrown: flags.isCrown,
        isComah: flags.isComah,
        isFepa: flags.isFepa,
        servedDateIso,
        complianceDateIso,
        revisedComplianceDateIso,
        effectiveComplianceDateIso: effective,
        daysToComply: daysBetween(servedDateIso, complianceDateIso),
        daysUntilCompliance: daysBetween(today, effective),
        hasRevisedComplianceDate: detail ? revisedComplianceDateIso !== null : null,
        isOngoing,
        isCompliedWith,
        isOverdue: isOngoing === null || effective === null ? null : isOngoing && effective < today,
        descriptionItemIds: detail ? extractNoticeItemIds(description) : null,
        breachCount: breachDetailFetched ? breaches.length : null,
        legislationBreached: breachDetailFetched ? unique(breaches.map((b) => b.legislation)) : null,
    };
    return {
        record,
        stateEntry: {
            hash: record.contentHash,
            dateIso: servedDateIso,
            open: detail !== null && flags.isImprovement === true && isOpenNoticeResult(result),
        },
    };
}

/** Build the final record for one candidate, fetching its pages as configured. */
export async function enrichCandidate(candidate: Candidate, options: EnrichOptions): Promise<BuiltRecord> {
    const { register, id } = candidate;
    let { detail } = candidate;
    let detailError: string | null = null;
    if (detail === null && options.fetchDetail) {
        const fetched = await fetchDetailFor(register, id);
        detail = fetched.detail;
        detailError = fetched.error;
    }
    const breachDetailFetched = options.fetchBreachDetail && detail !== null;
    let convictionBreaches: ConvictionBreach[] = [];
    let noticeBreaches: NoticeBreach[] = [];
    if (detail && register === 'convictions') {
        const rowById = new Map(detail.breachRows.map((r) => [r.breachId, r]));
        convictionBreaches = breachDetailFetched
            ? await mapWithConcurrency(detail.breachIds, 3, async (b) =>
                  fetchConvictionBreach(b, rowById.get(b) ?? null),
              )
            : detail.breachIds.map((b) => breachFromListRow(b, rowById.get(b) ?? null));
    } else if (detail && breachDetailFetched) {
        noticeBreaches = await fetchNoticeBreaches(id);
    }
    const party = options.fetchPartyDetail && detail?.partyId ? await fetchParty(register, detail.partyId) : null;
    return register === 'convictions'
        ? buildConvictionRecord(
              candidate,
              detail,
              detailError,
              convictionBreaches,
              breachDetailFetched,
              party,
              options.now,
          )
        : buildNoticeRecord(candidate, detail, detailError, noticeBreaches, breachDetailFetched, party, options.now);
}

/**
 * Final event type once the detail is known: a record delivered before whose
 * content hash moved is an UPDATED event (full mode; delta mode finds these
 * through the re-check pass instead).
 */
export function finalEventType(candidate: Candidate, built: BuiltRecord): EventType {
    if (candidate.eventType === 'UPDATED') return 'UPDATED';
    const priorHash = candidate.prior?.h ?? null;
    if (priorHash && built.stateEntry.hash && built.stateEntry.hash !== priorHash) return 'UPDATED';
    return candidate.eventType;
}

/** Build final records for a batch of candidates with bounded concurrency. Order is preserved. */
export async function enrichBatch(candidates: readonly Candidate[], options: EnrichOptions): Promise<BuiltRecord[]> {
    const built = await mapWithConcurrency(candidates, options.maxConcurrency, async (c) =>
        enrichCandidate(c, options),
    );
    return built.map((b, i) => ({
        ...b,
        record: { ...b.record, event_type: finalEventType(candidates[i], b) } as HseRecord,
    }));
}

export interface FetchRecordsOptions extends Omit<WalkOptions, 'query'>, EnrichOptions {
    query: RegisterQuery;
}

/**
 * Convenience one-shot: walk + enrich everything. main.ts streams in batches
 * instead (so state is persisted only for delivered records); this is the
 * simpler entry point used by the live integration tests.
 */
export async function fetchRecords(options: FetchRecordsOptions): Promise<{ records: HseRecord[]; walk: WalkResult }> {
    const walk = await walkListing(options);
    const built = await enrichBatch(walk.candidates, options);
    return { records: built.map((b) => b.record), walk };
}
