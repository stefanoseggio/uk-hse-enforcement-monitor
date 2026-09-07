import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseListingPage } from '../src/parsers/listing.js';
import type { StateEntry } from '../src/state.js';
import type { RegisterQuery } from '../src/types.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const fx = (name: string): string => readFileSync(`${fixturesDir}/${name}`, 'utf-8');
const CONV_DCN_P1 = fx('conviction_list_dcn_page1.html');
const CONV_DODS_P1 = fx('conviction_list_page1.html');
const CONV_PAST_END = fx('conviction_list_past_end.html');
const CONV_ZERO = fx('conviction_list_zero_results.html');
const SQL_ERROR = fx('listing_sql_error_page.html');
const NOT_DNN_P1 = fx('notice_list_dnn_page1.html');
const NOT_DNIS_P1 = fx('notice_list_page1.html');
const NOT_PAST_END = fx('notice_list_past_end.html');

const convP1Ids = parseListingPage(cheerio.load(CONV_DCN_P1), 'convictions').rows.map((r) => r.id);
const convP2Ids = parseListingPage(cheerio.load(CONV_DODS_P1), 'convictions').rows.map((r) => r.id);
const notP1Ids = parseListingPage(cheerio.load(NOT_DNN_P1), 'notices').rows.map((r) => r.id);
const notP2Ids = parseListingPage(cheerio.load(NOT_DNIS_P1), 'notices').rows.map((r) => r.id);

const fetchWithRetryMock = vi.fn<(path: string) => Promise<string>>();
const fetchOptionalMock = vi.fn<(path: string) => Promise<string | null>>();
vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    fetchWithRetry: (path: string) => fetchWithRetryMock(path),
    fetchOptional: (path: string) => fetchOptionalMock(path),
}));

const {
    walkListing,
    recheckKnown,
    selectRecheckIds,
    enrichBatch,
    fetchDetailFor,
    detailContentHash,
    parseDetailPage,
    fetchRecords,
} = await import('../src/fetchRecords.js');

const CONV: RegisterQuery = { register: 'convictions', criteria: [], sort: 'DCN' };
const NOT: RegisterQuery = { register: 'notices', criteria: [], sort: 'DNN' };
const ALL_EVENTS = new Set(['NEW_LISTING', 'SANCTION', 'UPDATED'] as const);
const NOW = new Date('2026-09-07T12:00:00.000Z');

function pageOf(path: string): number {
    return Number(new URL(`https://x${path}`).searchParams.get('PN'));
}
function servePages(...pages: string[]): void {
    fetchWithRetryMock.mockImplementation(async (path) => pages[pageOf(path) - 1] ?? CONV_PAST_END);
}
function entry(overrides: Partial<StateEntry> = {}): StateEntry {
    return { h: 'abc', d: '2026-08-01', o: true, f: '2026-08-01', l: '2026-08-01', ...overrides };
}
function walk(query: RegisterQuery, overrides: Partial<Parameters<typeof walkListing>[0]> = {}) {
    return walkListing({
        query,
        maxItems: 100,
        onlyNew: false,
        seen: {},
        eventTypes: ALL_EVENTS,
        fullWalk: query.register === 'convictions',
        ...overrides,
    });
}

describe('walkListing against real captured fixtures', () => {
    beforeEach(() => {
        fetchWithRetryMock.mockReset();
        fetchOptionalMock.mockReset();
    });

    it('cold full run: every row is a SANCTION candidate, the total is read, and the walk stops at the empty page', async () => {
        servePages(CONV_DCN_P1, CONV_DODS_P1, CONV_PAST_END);
        const result = await walk(CONV);
        const expected = [...new Set([...convP1Ids, ...convP2Ids])];
        expect(result.candidates.map((c) => c.id)).toEqual(expected);
        expect(result.candidates.every((c) => c.eventType === 'SANCTION' && c.isNew)).toBe(true);
        expect(result.candidates[0].row?.name).toBe('Skanska, Costain and Strabag- Joint Venture');
        expect(result.totalMatching).toBe(210);
        expect(result.stopReason).toBe('end-of-results');
        expect(result.pagesWalked).toBe(3);
        expect(result.excluded).toEqual([]);
    });

    it('notices: rows are NEW_LISTING candidates and the walk ends on the last page number', async () => {
        const lastPage = NOT_DNN_P1.replace('Showing Page 1 of 3023', 'Showing Page 1 of 1');
        servePages(lastPage);
        const result = await walk(NOT);
        expect(result.candidates.map((c) => c.id)).toEqual(notP1Ids);
        expect(result.candidates.every((c) => c.eventType === 'NEW_LISTING')).toBe(true);
        expect(result.stopReason).toBe('no-more-pages');
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    });

    it('de-duplicates rows that repeat across pages when the listing shifts under the walk', async () => {
        servePages(CONV_DCN_P1, CONV_DCN_P1, CONV_PAST_END);
        const result = await walk(CONV);
        expect(result.candidates.length).toBe(10);
        expect(new Set(result.candidates.map((c) => c.id)).size).toBe(10);
    });

    it('stops at maxItems, flags that more matching records exist, and never marks the overflow', async () => {
        servePages(CONV_DCN_P1, CONV_DODS_P1);
        const result = await walk(CONV, { maxItems: 5 });
        expect(result.candidates.length).toBe(5);
        expect(result.truncatedByMaxItems).toBe(true);
        expect(result.stopReason).toBe('max-items');
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    });

    it('a zero-result query ends cleanly', async () => {
        servePages(CONV_ZERO);
        const result = await walk(CONV);
        expect(result.candidates).toEqual([]);
        expect(result.totalMatching).toBe(0);
        expect(result.stopReason).toBe('end-of-results');
    });

    it('delta (notices): a fully-known listing early-stops after 2 known pages without walking further', async () => {
        servePages(NOT_DNN_P1, NOT_DNIS_P1, NOT_DNN_P1, NOT_DNN_P1);
        const seen: Record<string, StateEntry> = {};
        for (const id of [...notP1Ids, ...notP2Ids]) seen[id] = entry();
        const result = await walk(NOT, { onlyNew: true, seen, fullWalk: false });
        expect(result.candidates).toEqual([]);
        expect(result.stopReason).toBe('delta-early-stop');
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
        expect(result.excluded.length).toBe(20);
        expect(result.excluded.every((c) => c.excludedBy === 'known')).toBe(true);
    });

    it('delta (notices): one unseen id among known pages is the only candidate and resets the early-stop counter', async () => {
        servePages(NOT_DNN_P1, NOT_DNIS_P1, NOT_PAST_END);
        const seen: Record<string, StateEntry> = {};
        for (const id of [...notP1Ids, ...notP2Ids]) seen[id] = entry();
        delete seen[notP2Ids[3]];
        const result = await walk(NOT, { onlyNew: true, seen, fullWalk: false });
        expect(result.candidates.map((c) => [c.id, c.eventType, c.isNew])).toEqual([
            [notP2Ids[3], 'NEW_LISTING', true],
        ]);
        expect(result.stopReason).toBe('end-of-results');
    });

    it('delta (convictions): the small register is always walked in full - no early stop on known pages', async () => {
        servePages(CONV_DCN_P1, CONV_DODS_P1, CONV_PAST_END);
        const seen: Record<string, StateEntry> = {};
        for (const id of [...convP1Ids, ...convP2Ids]) seen[id] = entry();
        const result = await walk(CONV, { onlyNew: true, seen });
        expect(result.candidates).toEqual([]);
        expect(result.stopReason).toBe('end-of-results');
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(3);
    });

    it('excludes new records whose structural event type is not wanted, and the robots-disallowed case', async () => {
        servePages(CONV_DCN_P1.replace(/4883993/g, '4157835'), CONV_PAST_END);
        const result = await walk(CONV, { eventTypes: new Set(['UPDATED'] as const) });
        expect(result.candidates).toEqual([]);
        expect(result.excluded.filter((c) => c.excludedBy === 'robots').map((c) => c.id)).toEqual(['4157835']);
        expect(result.excluded.filter((c) => c.excludedBy === 'eventType').length).toBe(9);
    });

    it('FAILS LOUDLY (after retries) on the site SQL error page instead of reporting "nothing new"', async () => {
        fetchWithRetryMock.mockResolvedValue(SQL_ERROR);
        await expect(walk(CONV)).rejects.toThrow(/SQL error page/);
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(3);
    });

    it('FAILS LOUDLY on a page that is not a register listing at all (maintenance / block)', async () => {
        fetchWithRetryMock.mockResolvedValue('<html><body><h1>Service unavailable</h1></body></html>');
        await expect(walk(NOT)).rejects.toThrow(/not a register listing/);
    });
});

describe('UPDATED detection through content hashes (the register has no timestamps)', () => {
    beforeEach(() => {
        fetchWithRetryMock.mockReset();
        fetchOptionalMock.mockReset();
    });

    it('selects known open records inside the re-check window, newest first, capped', () => {
        const seen: Record<string, StateEntry> = {
            recent: entry({ d: '2026-08-20', f: '2026-08-21' }),
            oldButRecentlyDelivered: entry({ d: '2021-07-27', f: '2026-09-01' }),
            closed: entry({ o: false }),
            noHash: entry({ h: null }),
            tooOld: entry({ d: '2025-01-01', f: '2025-01-02' }),
        };
        expect(selectRecheckIds(seen, '2026-09-07', 180)).toEqual(['oldButRecentlyDelivered', 'recent']);
        expect(selectRecheckIds(seen, '2026-09-07', 0)).toEqual([]);
        expect(selectRecheckIds(seen, '2026-09-07', 180, 1)).toEqual(['oldButRecentlyDelivered']);
    });

    it('emits UPDATED when a known notice page changed, nothing when unchanged, and reports vanished ids', async () => {
        const complied = fx('notice_detail_315474881_complied.html');
        const currentHash = detailContentHash(parseDetailPage(cheerio.load(complied), 'notices'));
        fetchOptionalMock.mockImplementation(async (path) => (path.includes('SV=999') ? null : complied));
        const seen: Record<string, StateEntry> = {
            '315474881': entry({ h: 'stale-hash-from-when-it-was-ongoing' }),
            '315474882': entry({ h: currentHash }),
            '999': entry(),
        };
        const result = await recheckKnown('notices', ['315474881', '315474882', '999'], seen, 3);
        expect(result.updated.map((c) => [c.id, c.eventType, c.isNew])).toEqual([['315474881', 'UPDATED', false]]);
        expect(result.updated[0].detail?.fields.Result).toBe('Complied with');
        expect(result.unchanged).toBe(1);
        expect(result.vanished).toEqual(['999']);
    });

    it('the conviction hash covers the per-case breach list, so an appended hearing is an update', async () => {
        const casePage = fx('conviction_detail_4849124_fatal_multibreach.html');
        const list = fx('conviction_breach_list_case_4849124.html');
        fetchOptionalMock.mockImplementation(async (path) => (path.includes('breach_list') ? list : casePage));
        const a = await fetchDetailFor('convictions', '4849124');
        expect(a.detail?.breachIds).toEqual(['4849124002', '4849124003']);
        fetchOptionalMock.mockImplementation(async (path) =>
            path.includes('breach_list') ? list.replaceAll('4849124003', '4849124004') : casePage,
        );
        const b = await fetchDetailFor('convictions', '4849124');
        expect(detailContentHash(a.detail!)).not.toBe(detailContentHash(b.detail!));
    });
});

describe('enrichBatch builds full records from real pages', () => {
    beforeEach(() => {
        fetchWithRetryMock.mockReset();
        fetchOptionalMock.mockReset();
    });

    function serveConvictionPages(): void {
        fetchOptionalMock.mockImplementation(async (path) => {
            if (path.includes('breach_list.asp'))
                return fx('conviction_breach_list_case_4849124.html').replaceAll('4849124', '4883993');
            if (path.includes('breach_details.asp')) return fx('conviction_breach_4763937001_prison_suspended.html');
            if (path.includes('defendant_details.asp')) return fx('conviction_defendant_4392330.html');
            return fx('conviction_detail_4849124_fatal_multibreach.html');
        });
        fetchWithRetryMock.mockImplementation(async (path) => {
            if (path.includes('SF=RID')) return fx('notice_list_by_recipient_1108773.html');
            if (path.includes('SF=DID')) return fx('conviction_list_by_defendant_4392330.html');
            return pageOf(path) === 1 ? CONV_DCN_P1 : CONV_PAST_END;
        });
    }

    it('conviction: breaches from the per-case list merged with breach pages, fatality, money, party history', async () => {
        serveConvictionPages();
        const { records } = await fetchRecords({
            query: CONV,
            maxItems: 1,
            onlyNew: false,
            seen: {},
            eventTypes: ALL_EVENTS,
            fullWalk: true,
            fetchDetail: true,
            fetchBreachDetail: true,
            fetchPartyDetail: true,
            maxConcurrency: 2,
            now: NOW,
        });
        expect(records.length).toBe(1);
        const r = records[0];
        if (r.recordType !== 'conviction') throw new Error('expected a conviction');
        expect(r.event_type).toBe('SANCTION');
        expect(r.detailFetched).toBe(true);
        expect(r.breachDetailFetched).toBe(true);
        expect(r.partyDetailFetched).toBe(true);
        expect(r.resultingFromFatality).toBe(true);
        expect(r.totalFineGbp).toBe(400000);
        expect(r.totalCostsGbp).toBe(17854.06);
        expect(r.totalPenaltyGbp).toBe(417854.06);
        expect(r.breachCount).toBe(2);
        expect(r.breaches.map((b) => b.breachId)).toEqual(['4883993002', '4883993003']);
        expect(r.breaches[0]).toMatchObject({
            resultListing: 'Guilty-Fine',
            fine: '£0.00', // the breach page is authoritative over the list row
            fineGbp: 0,
            dateOfHearingIso: '2026-06-17',
            legislation: 'Health and Safety At Work Act 1974',
            provision: '2',
            paragraph: '1',
            court: 'Westminster Magistrates Court',
            courtLevel: 'Magistrates Court',
            regulationName: 'Construction (Design and Management) Regulations 2015',
            regulationNumber: '15',
            regulationParagraph: '2',
            result: 'Prison Suspended',
            resultCategory: 'suspended_custodial',
            isCustodial: true,
        });
        expect(r.hasCustodialSentence).toBe(true);
        expect(r.hearingDateIso).toBe('2026-06-17');
        expect(r.postcode).toBe('CF23 8HE');
        expect(r.country).toBe('Wales');
        expect(r.sicCode).toBe('18129');
        expect(r.partyStatus).toBe('Private Company');
        expect(r.partyEntityType).toBe('company');
        expect(r.partyPostcode).toBe('L3 6BN');
        expect(r.partyConvictionCount).toBe(1);
        expect(r.partyNoticeCount).toBe(22);
        expect(r.isRepeatOffender).toBe(true);
        expect(r.partyOtherNoticeNumbers?.length).toBe(10);
        expect(r.contentHash).toMatch(/^[0-9a-f]{16}$/);
        expect(r.data_source).toMatch(/Open Government Licence/);
    });

    it('listing-only mode (fetchDetail=false) builds summary records without any page fetch', async () => {
        servePages(NOT_DNN_P1, NOT_PAST_END);
        const { records } = await fetchRecords({
            query: NOT,
            maxItems: 3,
            onlyNew: false,
            seen: {},
            eventTypes: ALL_EVENTS,
            fullWalk: false,
            fetchDetail: false,
            fetchBreachDetail: false,
            fetchPartyDetail: false,
            maxConcurrency: 2,
            now: NOW,
        });
        expect(fetchOptionalMock).not.toHaveBeenCalled();
        expect(records.length).toBe(3);
        const r = records[0];
        if (r.recordType !== 'notice') throw new Error('expected a notice');
        expect(r).toMatchObject({
            noticeNumber: '316153979',
            recipientName: 'Chase Accident Repairs Limited',
            noticeTypeListing: 'Prohibition Notice Immediate',
            noticeType: 'Prohibition Notice Immediate',
            isProhibition: true,
            isImmediate: true,
            servedDateIso: '2026-06-24',
            localAuthority: 'Cannock Chase',
            detailFetched: false,
            breachDetailFetched: false,
            contentHash: null,
            result: null,
            isOngoing: null,
        });
    });

    it('notice: compliance maths and open/complied flags; a known id whose hash moved becomes UPDATED in full mode', async () => {
        fetchOptionalMock.mockImplementation(async (path) =>
            path.includes('breach_list')
                ? fx('notice_breach_list_316005113.html')
                : fx('notice_detail_315474881_complied.html'),
        );
        const candidate = {
            register: 'notices' as const,
            id: '315474881',
            row: null,
            eventType: 'NEW_LISTING' as const,
            isNew: false,
            excludedBy: null,
            prior: entry({ h: 'old-hash' }),
            detail: null,
        };
        const [built] = await enrichBatch([candidate], {
            fetchDetail: true,
            fetchBreachDetail: true,
            fetchPartyDetail: false,
            maxConcurrency: 1,
            now: NOW,
        });
        const r = built.record;
        if (r.recordType !== 'notice') throw new Error('expected a notice');
        expect(r.event_type).toBe('UPDATED');
        expect(r).toMatchObject({
            servedDateIso: '2025-11-24',
            complianceDateIso: '2026-01-26',
            revisedComplianceDateIso: '2026-03-06',
            effectiveComplianceDateIso: '2026-03-06',
            daysToComply: 63,
            daysUntilCompliance: -185,
            hasRevisedComplianceDate: true,
            isOngoing: false,
            isCompliedWith: true,
            isOverdue: false,
            breachCount: 2,
            firstSeenAt: '2026-08-01',
        });
        expect(r.legislationBreached).toEqual([
            'Health and Safety At Work Act 1974',
            'Control of Substances Hazardous to Health Regs 2002',
        ]);
        expect(built.stateEntry.open).toBe(false); // complied with -> no longer re-checked
        expect(built.stateEntry.dateIso).toBe('2025-11-24');
    });

    it('a withdrawn record (site 500 -> null) degrades to a summary record instead of failing the run', async () => {
        fetchOptionalMock.mockResolvedValue(null);
        servePages(CONV_DCN_P1, CONV_PAST_END);
        const { records } = await fetchRecords({
            query: CONV,
            maxItems: 1,
            onlyNew: false,
            seen: {},
            eventTypes: ALL_EVENTS,
            fullWalk: true,
            fetchDetail: true,
            fetchBreachDetail: true,
            fetchPartyDetail: true,
            maxConcurrency: 1,
            now: NOW,
        });
        expect(records[0]).toMatchObject({
            detailFetched: false,
            detailError: 'NOT_FOUND',
            breachDetailFetched: false,
            defendantName: 'Skanska, Costain and Strabag- Joint Venture',
            offenceDateIso: '2021-07-27',
        });
    });
});
