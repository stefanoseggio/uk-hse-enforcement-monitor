import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parsePartyPage } from '../../src/parsers/party.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));
const load = (name: string) => cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));

describe('parsePartyPage', () => {
    it('reads a defendant page (convictions register)', () => {
        expect(parsePartyPage(load('conviction_defendant_4392330.html'))).toEqual({
            name: 'Mill House Metals Limited',
            address: '85-87 Vauxhall Road, LIVERPOOL, L3 6BN',
            status: 'Private Company',
            hseReference: '4392330',
        });
    });

    it('reads a recipient page (notices register - same shape without <strong> labels)', () => {
        expect(parsePartyPage(load('notice_recipient_1108773.html'))).toEqual({
            name: 'Llanelec Precision Engineering Company Limited',
            address: 'Nidum House, Neath Abbey Business Park, NEATH, West Glamorgan, SA10 7DR',
            status: 'Private Company',
            hseReference: '1108773',
        });
    });
});
