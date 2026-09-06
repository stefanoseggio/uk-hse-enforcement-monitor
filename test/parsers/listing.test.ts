import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseListingIds, parseTotalPages } from '../../src/parsers/listing.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

describe('parseListingIds + parseTotalPages', () => {
    it('extracts case numbers from the real convictions listing page, newest first', () => {
        const html = readFileSync(`${fixturesDir}/conviction_list_page1.html`, 'utf-8');
        const $ = cheerio.load(html);

        const ids = parseListingIds($);
        expect(ids.length).toBe(10);
        expect(ids[0]).toBe('4858770'); // Mill House Metals Limited, the newest offence date in the fixture

        expect(parseTotalPages($)).toBe(21); // "210 Matching results ... Page 1 of 21"
    });

    it('extracts notice numbers from the real notices listing page', () => {
        const html = readFileSync(`${fixturesDir}/notice_list_page1.html`, 'utf-8');
        const $ = cheerio.load(html);

        const ids = parseListingIds($);
        expect(ids.length).toBe(10);
        expect(ids[0]).toBe('316005113'); // Llanelec Precision Engineering Company Limited

        expect(parseTotalPages($)).toBe(3023); // "30226 Matching results ... Page 1 of 3023"
    });
});
