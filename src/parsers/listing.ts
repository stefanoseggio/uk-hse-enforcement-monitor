import type { AnyNode, Cheerio, CheerioAPI } from 'cheerio';

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
    /** Notices only, 8-column shape (any Improvement code in the NT filter): Compliance Date, DD/MM/YYYY. */
    complianceDate: string | null;
    /** Notices only, 8-column shape: "Ongoing" / "Complied with" (the site's "Notice Result" column). */
    noticeResult: string | null;
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
    /** Column labels of the header row, in site order (6 or 8 for notices, 5 for convictions). */
    columns: string[];
    rows: ListingRow[];
}

/**
 * Column key -> the header labels the site uses for it. Labels are compared
 * after lower-casing and stripping everything but letters, so "Case&nbsp;Number",
 * "Defendant's Name" and "Recipient's Name" all normalise cleanly.
 *
 * Live-verified shapes (2026-09-07):
 * - convictions: Case Number | Defendant's Name | Offence Date | Local Authority | Main Activity
 * - notices (no NT filter, or prohibition codes only):
 *   Notice Number | Recipient's Name | Notice Type | Issue Date | Local Authority | Main Activity
 * - notices (any Improvement code 01/02/03 in the NT filter, alone or mixed):
 *   Notice Number | Recipient's Name | Notice Type | Issue Date | Compliance Date | Notice Result |
 *   Local Authority | Main Activity
 * Rows are therefore mapped by header NAME, never by position.
 */
type ColumnKey =
    'id' | 'name' | 'date' | 'localAuthority' | 'mainActivity' | 'noticeType' | 'complianceDate' | 'noticeResult';

const COLUMN_LABELS: Record<ColumnKey, string[]> = {
    id: ['casenumber', 'noticenumber'],
    name: ['defendantsname', 'recipientsname'],
    date: ['offencedate', 'issuedate'],
    localAuthority: ['localauthority'],
    mainActivity: ['mainactivity', 'sicclassification'],
    noticeType: ['noticetype'],
    complianceDate: ['compliancedate'],
    noticeResult: ['noticeresult', 'result'],
};

/** Columns every real listing of the register carries (the validity check). */
const REQUIRED_COLUMNS: Record<DatasetName, ColumnKey[]> = {
    convictions: ['id', 'name', 'date', 'localAuthority', 'mainActivity'],
    notices: ['id', 'name', 'noticeType', 'date', 'localAuthority', 'mainActivity'],
};

const ID_LABEL: Record<DatasetName, string> = { convictions: 'casenumber', notices: 'noticenumber' };

function normaliseLabel(text: string): string {
    return text.toLowerCase().replace(/[^a-z]/g, '');
}

function clean(text: string): string | null {
    const t = text.replace(/\s+/g, ' ').trim();
    return t === '' ? null : t;
}

interface HeaderMap {
    /** Header labels as rendered (whitespace-collapsed). */
    labels: string[];
    /** Column key -> cell index. */
    index: Partial<Record<ColumnKey, number>>;
    /** The <table> element holding the header row. */
    table: Cheerio<AnyNode>;
}

/**
 * Finds the results table of the requested register by its header row (the
 * <tr> whose <th> cells include "Case Number" / "Notice Number") and maps
 * every recognised label to its cell index.
 */
function findHeader($: CheerioAPI, register: DatasetName): HeaderMap | null {
    let found: HeaderMap | null = null;
    $('table tr').each((_i, tr) => {
        if (found) return;
        const ths = $(tr).children('th').toArray();
        if (ths.length < 5) return;
        const labels = ths.map((th) => clean($(th).text()) ?? '');
        const normalised = labels.map(normaliseLabel);
        if (!normalised.includes(ID_LABEL[register])) return;
        const index: Partial<Record<ColumnKey, number>> = {};
        for (const [key, aliases] of Object.entries(COLUMN_LABELS) as [ColumnKey, string[]][]) {
            const at = normalised.findIndex((label) => aliases.includes(label));
            if (at >= 0) index[key] = at;
        }
        found = { labels, index, table: $(tr).closest('table') };
    });
    return found;
}

function rowsFromHeader($: CheerioAPI, header: HeaderMap): ListingRow[] {
    const rows: ListingRow[] = [];
    const idAt = header.index.id ?? 0;
    header.table.find('tr').each((_i, tr) => {
        const cells = $(tr).children('td').toArray();
        if (cells.length < header.labels.length) return;
        const link = $(cells[idAt]).find('a[href*="_details.asp"]').first();
        const href = link.attr('href') ?? '';
        const match = href.match(DETAIL_LINK_RE);
        if (!match) return;
        const text = (key: ColumnKey): string | null => {
            const at = header.index[key];
            return at === undefined || !cells[at] ? null : clean($(cells[at]).text());
        };
        rows.push({
            id: match[1],
            detailHref: href,
            name: text('name'),
            date: text('date'),
            localAuthority: text('localAuthority'),
            mainActivity: text('mainActivity'),
            noticeType: text('noticeType'),
            complianceDate: text('complianceDate'),
            noticeResult: text('noticeResult'),
        });
    });
    return rows;
}

/** Rows of the register's results table, mapped by header name (empty when the header is not present). */
export function parseListingRows($: CheerioAPI, register: DatasetName): ListingRow[] {
    const header = findHeader($, register);
    return header ? rowsFromHeader($, header) : [];
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
 * - every real listing page carries the column header row, in the 6- or the
 *   8-column shape for notices (see COLUMN_LABELS) - all required columns must be present.
 */
export function parseListingPage($: CheerioAPI, register: DatasetName): ListingPage {
    const text = $('body').text().replace(/\s+/g, ' ');
    const isErrorPage = /some form of error/i.test(text);
    const header = findHeader($, register);
    const hasHeader = header !== null && REQUIRED_COLUMNS[register].every((key) => header.index[key] !== undefined);
    const total = text.match(/(\d+) Matching results found/);
    const paging = text.match(/Showing Page (\d+) of (\d+)/);
    const isListingPage = !isErrorPage && hasHeader && total !== null;
    return {
        isListingPage,
        isErrorPage,
        totalMatching: isListingPage && total ? Number(total[1]) : null,
        page: isListingPage && paging ? Number(paging[1]) : null,
        totalPages: isListingPage && paging ? Number(paging[2]) : null,
        columns: isListingPage && header ? header.labels : [],
        rows: isListingPage && header ? rowsFromHeader($, header) : [],
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
