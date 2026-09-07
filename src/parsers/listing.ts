import type { CheerioAPI } from 'cheerio';

import type { DatasetName } from '../types.js';

// Both listing tables link to their detail page as `..._details.asp?SF=CN&SV=<id>`
// (cheerio decodes the `&amp;` entity automatically). No other link on either
// listing page matches this exact `SF=CN` shape, so a single regex is safe
// for both registers.
const DETAIL_LINK_RE = /_details\.asp\?SF=CN&SV=(\d+)/;

export interface ListingRow {
    id: string;
    detailHref: string;
    /** Defendant's / Recipient's name as shown on the listing row. */
    name: string | null;
    /** Offence Date (convictions) / Issue Date (notices), DD/MM/YYYY. */
    date: string | null;
    localAuthority: string | null;
    mainActivity: string | null;
    /** Notices only: "Improvement Notice", "Prohibition Notice Immediate", ... */
    noticeType: string | null;
}

export interface ListingPage {
    /** true when the page carries the register's own result markers (a real listing, empty or not). */
    isListingPage: boolean;
    /** true when the site rendered its "Sorry ... some form of error" SQL error page (HTTP 200!). */
    isErrorPage: boolean;
    /** "N Matching results found" for the current criteria (0 on a zero-result page). */
    totalMatching: number | null;
    /** "Showing Page X of Y" - null on a zero-result page. */
    page: number | null;
    totalPages: number | null;
    rows: ListingRow[];
}

const CONVICTIONS_HEADER = /Case Number\s*Defendant'?s? Name\s*Offence Date\s*Local Authority\s*Main Activity/i;
const NOTICES_HEADER =
    /Notice Number\s*Recipient'?s? Name\s*Notice Type\s*Issue Date\s*Local Authority\s*Main Activity/i;

function clean(text: string): string | null {
    const t = text.replace(/\s+/g, ' ').trim();
    return t === '' ? null : t;
}

export function parseListingRows($: CheerioAPI, register: DatasetName): ListingRow[] {
    const rows: ListingRow[] = [];
    $('table tr').each((_i, tr) => {
        const cells = $(tr).children('td').toArray();
        if (cells.length < 5) return;
        const link = $(cells[0]).find('a[href*="_details.asp"]').first();
        const href = link.attr('href') ?? '';
        const match = href.match(DETAIL_LINK_RE);
        if (!match) return;
        const text = (i: number): string | null => (cells[i] ? clean($(cells[i]).text()) : null);
        if (register === 'convictions') {
            rows.push({
                id: match[1],
                detailHref: href,
                name: text(1),
                date: text(2),
                localAuthority: text(3),
                mainActivity: text(4),
                noticeType: null,
            });
        } else {
            rows.push({
                id: match[1],
                detailHref: href,
                name: text(1),
                noticeType: text(2),
                date: text(3),
                localAuthority: text(4),
                mainActivity: text(5),
            });
        }
    });
    return rows;
}

/**
 * Validates that the response is really one of the register's listing pages
 * and reads its markers. Live-verified shapes (2026-09-07):
 * - normal page: "210 Matching results found : Showing Page 1 of 21, results 1 to 10"
 *   (notices add "from 30226 total records" before the colon);
 * - past the end: "Showing Page 22 of 21, results -3 to 210" and no rows (a legitimate end);
 * - zero results: "0 Matching results found" and no "Showing Page" line;
 * - SQL error (unknown column, bad join): "Sorry ... some form of error ..."
 *   AND "0 Matching results found", HTTP 200 - must be checked first;
 * - every real listing page carries the column header row.
 */
export function parseListingPage($: CheerioAPI, register: DatasetName): ListingPage {
    const text = $('body').text().replace(/\s+/g, ' ');
    const isErrorPage = /some form of error/i.test(text);
    const headerRe = register === 'convictions' ? CONVICTIONS_HEADER : NOTICES_HEADER;
    const hasHeader = headerRe.test(text);
    const total = text.match(/(\d+) Matching results found/);
    const paging = text.match(/Showing Page (\d+) of (\d+)/);
    const rows = parseListingRows($, register);
    const isListingPage = !isErrorPage && hasHeader && total !== null;
    return {
        isListingPage,
        isErrorPage,
        totalMatching: isListingPage && total ? Number(total[1]) : null,
        page: isListingPage && paging ? Number(paging[1]) : null,
        totalPages: isListingPage && paging ? Number(paging[2]) : null,
        rows: isListingPage ? rows : [],
    };
}

/** Backwards-compatible helpers kept for the parser tests and the party-history lookups. */
export function parseListingIds($: CheerioAPI): string[] {
    const ids: string[] = [];
    $('a[href*="_details.asp"]').each((_i, el) => {
        const href = $(el).attr('href') ?? '';
        const match = href.match(DETAIL_LINK_RE);
        if (match) ids.push(match[1]);
    });
    return ids;
}

export function parseTotalPages($: CheerioAPI): number {
    const match = $('body')
        .text()
        .match(/Showing Page \d+ of (\d+)/);
    return match ? parseInt(match[1], 10) : 1;
}

/** "N Matching results found" of any listing page (used for the party-history counts); null when the page is not a listing. */
export function parseTotalMatching($: CheerioAPI): number | null {
    const text = $('body').text().replace(/\s+/g, ' ');
    if (/some form of error/i.test(text)) return null;
    const match = text.match(/(\d+) Matching results found/);
    return match ? Number(match[1]) : null;
}
