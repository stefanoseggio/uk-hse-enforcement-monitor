import type { CheerioAPI } from 'cheerio';

// /convictions/breach/breach_list.asp rows (verified live 2026-09-07, both
// the site's "New Breaches" view and the per-case filter SF=CN&SV=<case>):
//   Case/Breach (link to breach_details.asp?SF=BID&SV=<breachId>) |
//   Defendant's Name | Hearing Date | Result ("Guilty-Fine",
//   "Guilty-Prison Suspended", "Guilty-No Sep Penalty") | Fine £ ("400,000.00") |
//   Act or Regulation ("Health and Safety At Work Act 1974 / 2 / 1").
// A multi-breach case page does NOT link its breach ids (its "Breaches
// involved" link is the generic New Breaches list), so this list is the
// only one-request source of a case's breach ids.
const BREACH_LINK_RE = /breach_details\.asp\?SF=BID&SV=(\d+)/;

export interface BreachListRow {
    breachId: string;
    defendantName: string | null;
    hearingDate: string | null;
    result: string | null;
    fine: string | null;
    actOrRegulation: string | null;
}

function clean(text: string): string | null {
    const t = text.replace(/\s+/g, ' ').trim();
    return t === '' ? null : t;
}

export function parseBreachList($: CheerioAPI): BreachListRow[] {
    const rows: BreachListRow[] = [];
    $('table tr').each((_i, tr) => {
        const cells = $(tr).children('td').toArray();
        if (cells.length < 6) return;
        const href = $(cells[0]).find('a[href*="breach_details.asp"]').first().attr('href') ?? '';
        const match = href.match(BREACH_LINK_RE);
        if (!match) return;
        rows.push({
            breachId: match[1],
            defendantName: clean($(cells[1]).text()),
            hearingDate: clean($(cells[2]).text()),
            result: clean($(cells[3]).text()),
            fine: clean($(cells[4]).text()),
            actOrRegulation: clean($(cells[5]).text()),
        });
    });
    return rows;
}
