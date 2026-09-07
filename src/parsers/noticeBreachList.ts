import type { CheerioAPI } from 'cheerio';

import { splitNoticeBreach } from '../normalize.js';
import type { NoticeBreach } from '../types.js';

// breach_list.asp rows: Notice(link) | Breach ID | Recipient's Name | Act or
// Regulation - the Act/Regulation text is already inline here ("Act / reg /
// para"), no separate per-breach detail page exists for notices (unlike
// convictions). Verified live 2026-09-06.
export function parseNoticeBreachList($: CheerioAPI): NoticeBreach[] {
    const breaches: NoticeBreach[] = [];
    $('table tr').each((_i, row) => {
        const cells = $(row).children('td').toArray();
        if (cells.length < 4) return;
        const breachId = $(cells[1]).text().trim();
        if (!/^\d+$/.test(breachId)) return;
        const actOrRegulation = $(cells[3]).text().replace(/\s+/g, ' ').trim() || null;
        const split = splitNoticeBreach(actOrRegulation);
        breaches.push({
            breachId,
            actOrRegulation,
            legislation: split.legislation,
            provision: split.provision,
            paragraph: split.paragraph,
        });
    });
    return breaches;
}
