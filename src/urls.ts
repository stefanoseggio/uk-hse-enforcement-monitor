import type { DatasetName } from './types.js';

// Both registers are a multi-step ASP wizard in a browser, but every step
// bottoms out in a plain GET to case_list.asp / notice_list.asp with a
// fixed set of query params - verified live by walking the real wizard
// with curl (see AGENTS.md). "offence date/issue date < 31/12/2100" is the
// site's own built-in "New cases"/all-records sentinel (copied verbatim
// from a real link on the site, not invented), SO=DODS/DNIS sorts by that
// date descending, so page 1 is always the newest records - exactly what a
// recurring monitor needs.
const CONVICTIONS_LIST_PARAMS = { ST: 'C', CO: '', SN: 'F', SF: 'ODS, |', EO: '<', SV: '31/12/2100, |', SO: 'DODS' };
const NOTICES_LIST_PARAMS = { ST: 'N', CO: '', SN: 'F', SF: 'NIS, |', EO: '<', SV: '31/12/2100, |', SO: 'DNIS' };

export function listingPath(dataset: DatasetName, page: number): string {
    const base = dataset === 'convictions' ? '/convictions/case/case_list.asp' : '/notices/notices/notice_list.asp';
    const params = dataset === 'convictions' ? CONVICTIONS_LIST_PARAMS : NOTICES_LIST_PARAMS;
    const qs = new URLSearchParams({ ...params, PN: String(page) });
    return `${base}?${qs.toString()}`;
}

export function convictionDetailPath(caseNumber: string): string {
    return `/convictions/case/case_details.asp?SF=CN&SV=${caseNumber}`;
}

export function convictionBreachDetailPath(breachId: string): string {
    return `/convictions/breach/breach_details.asp?SF=BID&SV=${breachId}`;
}

export function noticeDetailPath(noticeNumber: string): string {
    return `/notices/notices/notice_details.asp?SF=CN&SV=${noticeNumber}`;
}

// Live-verified 2026-09-06: this returns the notice's breach rows with
// Act/Regulation already inline, one request, no separate per-breach page
// needed (unlike convictions, where each breach has its own detail page).
export function noticeBreachListPath(noticeNumber: string): string {
    const qs = new URLSearchParams({ ST: 'B', SN: 'F', EO: '=', SF: 'NN', SV: noticeNumber });
    return `/notices/breach/breach_list.asp?${qs.toString()}`;
}
