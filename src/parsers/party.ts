import type { CheerioAPI } from 'cheerio';

import { parseLabelValueRows } from './labelValueTable.js';

// defendant_details.asp / recipient_details.asp share one shape (verified
// live 2026-09-07): a two-column table with Defendant|Recipient, Address
// (<br>-joined), Status ("Private Company", "Individual", ...), HSE
// Reference, followed by "List all Cases/Notices involving this ..." links.
export interface PartyPage {
    name: string | null;
    address: string | null;
    status: string | null;
    hseReference: string | null;
}

export function parsePartyPage($: CheerioAPI): PartyPage {
    const fields = parseLabelValueRows($);
    return {
        name: fields.Defendant || fields.Recipient || null,
        address: fields.Address || null,
        status: fields.Status || null,
        hseReference: fields['HSE Reference'] || null,
    };
}
