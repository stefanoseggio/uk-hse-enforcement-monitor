import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseListingIds, parseListingPage, parseTotalMatching, parseTotalPages } from '../../src/parsers/listing.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));
const load = (name: string) => cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));

describe('parseListingPage against real captured pages', () => {
    it('reads every column of the convictions listing (case-number order, live 2026-09-07)', () => {
        const page = parseListingPage(load('conviction_list_dcn_page1.html'), 'convictions');
        expect(page.isListingPage).toBe(true);
        expect(page.isErrorPage).toBe(false);
        expect(page).toMatchObject({ totalMatching: 210, page: 1, totalPages: 21 });
        expect(page.rows.length).toBe(10);
        expect(page.rows[0]).toEqual({
            id: '4883993',
            detailHref: 'case_details.asp?SF=CN&SV=4883993',
            name: 'Skanska, Costain and Strabag- Joint Venture',
            date: '27/07/2021',
            localAuthority: 'Hillingdon',
            mainActivity: '41201 - CONSTRUCTION COMMERCIAL BLDGS',
            noticeType: null,
        });
    });

    it('reads every column of the notices listing (notice-number order)', () => {
        const page = parseListingPage(load('notice_list_dnn_page1.html'), 'notices');
        expect(page).toMatchObject({ isListingPage: true, totalMatching: 30226, page: 1, totalPages: 3023 });
        expect(page.rows[0]).toEqual({
            id: '316153979',
            detailHref: 'notice_details.asp?SF=CN&SV=316153979',
            name: 'Chase Accident Repairs Limited',
            noticeType: 'Prohibition Notice Immediate',
            date: '24/06/2026',
            localAuthority: 'Cannock Chase',
            mainActivity: 'MVR',
        });
    });

    it('treats a page past the end as a legitimate empty listing', () => {
        const conv = parseListingPage(load('conviction_list_past_end.html'), 'convictions');
        expect(conv).toMatchObject({ isListingPage: true, totalMatching: 210, page: 22, totalPages: 21 });
        expect(conv.rows).toEqual([]);
        const not = parseListingPage(load('notice_list_past_end.html'), 'notices');
        expect(not).toMatchObject({ isListingPage: true, totalMatching: 22, page: 9, totalPages: 3, rows: [] });
    });

    it('treats a zero-result query as a legitimate empty listing (no "Showing Page" line)', () => {
        const conv = parseListingPage(load('conviction_list_zero_results.html'), 'convictions');
        expect(conv).toMatchObject({ isListingPage: true, isErrorPage: false, totalMatching: 0, page: null, rows: [] });
        const not = parseListingPage(load('notice_list_zero_results.html'), 'notices');
        expect(not).toMatchObject({ isListingPage: true, totalMatching: 0, rows: [] });
    });

    it('recognises the HTTP-200 SQL error page (which ALSO says "0 Matching results found") as NOT a listing', () => {
        const page = parseListingPage(load('listing_sql_error_page.html'), 'convictions');
        expect(page.isErrorPage).toBe(true);
        expect(page.isListingPage).toBe(false);
        expect(page.totalMatching).toBeNull();
        expect(parseTotalMatching(load('listing_sql_error_page.html'))).toBeNull();
    });

    it('rejects a page of the other register and anything without the column header', () => {
        expect(parseListingPage(load('conviction_list_dcn_page1.html'), 'notices').isListingPage).toBe(false);
        expect(
            parseListingPage(cheerio.load('<html><body>Maintenance</body></html>'), 'convictions').isListingPage,
        ).toBe(false);
    });

    it('keeps the v1 id/page helpers working on the original fixtures', () => {
        const $ = load('conviction_list_page1.html');
        expect(parseListingIds($).length).toBe(10);
        expect(parseListingIds($)[0]).toBe('4858770');
        expect(parseTotalPages($)).toBe(21);
        expect(parseTotalMatching($)).toBe(210);
        expect(parseTotalMatching(load('conviction_list_by_defendant_4392330.html'))).toBe(1);
        expect(parseTotalMatching(load('notice_list_by_recipient_1108773.html'))).toBe(22);
    });
});
