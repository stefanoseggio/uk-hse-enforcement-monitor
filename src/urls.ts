import type { Criterion, DatasetName, RegisterQuery } from './types.js';

export const BASE_URL = 'https://resources.hse.gov.uk';

export const RESULTS_PER_PAGE = 10;

// Walk order per register (verified live 2026-09-07, see AGENTS.md):
// - convictions: DCN (case number desc). Case numbers track entry into the
//   register far better than the site's default Offence Date order, which
//   lags publication by months to years. The register is only ~210 records
//   (21 pages), so it is walked in full every run anyway.
// - notices: DNN (notice number desc). Notice numbers are assigned on entry,
//   so a notice served months ago but entered yesterday sits on page 1-2,
//   whereas the default Issue Date order buries it hundreds of pages deep.
export const WALK_SORT: Record<DatasetName, string> = { convictions: 'DCN', notices: 'DNN' };

// "Offence date / issue date < 31/12/2100" is the site's own all-records
// sentinel (copied from its "New cases" link), used when no filter is given.
export const ALL_RECORDS_CRITERION: Record<DatasetName, Criterion> = {
    convictions: { sf: 'ODS', sn: 'F', eo: '<', sv: '31/12/2100' },
    notices: { sf: 'NIS', sn: 'F', eo: '<', sv: '31/12/2100' },
};

const LISTING_BASE: Record<DatasetName, string> = {
    convictions: '/convictions/case/case_list.asp',
    notices: '/notices/notices/notice_list.asp',
};

/**
 * Serialises criteria in the classic-ASP comma-join grammar the site uses
 * when a browser submits several "Add a criterion" wizard steps. Verified
 * live for one, two and three criteria on both registers:
 *   one:   CO=      SN=F        SF=A,+|        EO=x        SV=a,+|
 *   two:   CO=,AND  SN=F,+P     SF=A,|,+B,+|   EO=x,+y     SV=a,|,+b,+|
 *   three: CO=,AND,AND  SN=F,+P,+F  SF=A,|,+B,|,+C,+|  ...
 * A wrong join renders "0 Matching results found" with HTTP 200 and an
 * unknown column renders a SQL error page, so parsers/listing.ts validates
 * every page. Note `NT IN` (notice type) must be the FIRST criterion: the
 * reversed order is a SQL error on the site (verified).
 */
export function buildQueryString(criteria: readonly Criterion[]): URLSearchParams {
    if (criteria.length === 0) throw new Error('at least one criterion is required');
    const params = new URLSearchParams();
    const co =
        criteria.length === 1
            ? ''
            : criteria
                  .slice(1)
                  .map(() => ',AND')
                  .join('');
    const join = (values: readonly string[]): string => {
        if (values.length === 1) return `${values[0]},+|`;
        return `${values.map((v, i) => (i === 0 ? `${v},|` : `,+${v},|`)).join('')}`.replace(/,\|$/, ',+|');
    };
    params.set('CO', co);
    params.set('SN', criteria.map((c, i) => (i === 0 ? c.sn : `,+${c.sn}`)).join(''));
    params.set('SF', join(criteria.map((c) => c.sf)));
    params.set('EO', criteria.map((c, i) => (i === 0 ? c.eo : `,+${c.eo}`)).join(''));
    params.set('SV', join(criteria.map((c) => c.sv)));
    return params;
}

function serialise(params: URLSearchParams): string {
    // URLSearchParams encodes "+" as "%2B" and "," as "%2C"; the site expects
    // the literal "+" (a space) and "," of its own links, so decode those two.
    return params.toString().replace(/%2B/g, '+').replace(/%2C/g, ',').replace(/%7C/g, '|');
}

export function listingPath(query: RegisterQuery, page: number): string {
    const params = new URLSearchParams();
    params.set('ST', query.register === 'convictions' ? 'C' : 'N');
    const criteria = query.criteria.length > 0 ? query.criteria : [ALL_RECORDS_CRITERION[query.register]];
    for (const [k, v] of buildQueryString(criteria)) params.set(k, v);
    params.set('SO', query.sort);
    params.set('PN', String(page));
    return `${LISTING_BASE[query.register]}?${serialise(params)}`;
}

/** Human-readable listing URL (page 1) for logs, status messages and the run summary. */
export function listingUrl(query: RegisterQuery): string {
    return `${BASE_URL}${listingPath(query, 1)}`;
}

export function convictionDetailPath(caseNumber: string): string {
    return `/convictions/case/case_details.asp?SF=CN&SV=${caseNumber}`;
}

export function convictionBreachDetailPath(breachId: string): string {
    return `/convictions/breach/breach_details.asp?SF=BID&SV=${breachId}`;
}

/**
 * All breaches of one case with hearing date, result, fine and Act/Regulation
 * inline (verified live 2026-09-07). A multi-breach case page links only the
 * generic "New Breaches" list, so this is the one-request source of breach ids.
 */
export function convictionBreachListPath(caseNumber: string): string {
    return `/convictions/breach/breach_list.asp?ST=B&SN=F&EO=%3D&SF=CN&SV=${caseNumber}`;
}

export function defendantDetailPath(defendantId: string): string {
    return `/convictions/defendant/defendant_details.asp?SF=DID&SV=${defendantId}`;
}

export function noticeDetailPath(noticeNumber: string): string {
    return `/notices/notices/notice_details.asp?SF=CN&SV=${noticeNumber}`;
}

// Live-verified 2026-09-06: returns the notice's breach rows with the
// Act/Regulation already inline, one request, no per-breach page needed.
export function noticeBreachListPath(noticeNumber: string): string {
    return `/notices/breach/breach_list.asp?ST=B&SN=F&EO=%3D&SF=NN&SV=${noticeNumber}`;
}

export function recipientDetailPath(recipientId: string): string {
    return `/notices/recipient/recipient_details.asp?SV=${recipientId}`;
}

/**
 * The party pages link to "List all Cases/Notices involving this
 * defendant/recipient" with the SAME HSE reference on both registers
 * (verified live: the recipient page links to the convictions register with
 * its own id). The listing header "N Matching results found" is the
 * repeat-offender count.
 */
export function partyCasesPath(partyId: string): string {
    return `/convictions/case/case_list.asp?ST=C&SN=F&EO=%3D&SF=DID&SV=${partyId}&SO=DCN&PN=1`;
}

export function partyNoticesPath(partyId: string): string {
    return `/notices/notices/notice_list.asp?ST=N&SN=F&EO=%3D&SF=RID&SV=${partyId}&SO=DNN&PN=1`;
}

export function absoluteUrl(path: string): string {
    return new URL(path, BASE_URL).href;
}
