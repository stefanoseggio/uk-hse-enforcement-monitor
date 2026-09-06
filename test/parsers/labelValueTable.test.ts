import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import {
    allHrefsMatching,
    extractIdParam,
    firstHrefMatching,
    parseLabelValueRows,
} from '../../src/parsers/labelValueTable.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

describe('parseLabelValueRows against real conviction detail page', () => {
    const html = readFileSync(`${fixturesDir}/conviction_detail_4858770.html`, 'utf-8');
    const $ = cheerio.load(html);
    const fields = parseLabelValueRows($);

    it('extracts the flat label/value fields', () => {
        expect(fields['Defendant']).toBe('Mill House Metals Limited');
        expect(fields['Description']).toBe('Lack of ELCI');
        expect(fields['Offence Date']).toBe('26/09/2025');
        expect(fields['Total Fine']).toBe('£1,000.00');
        // real source label is "Total&nbsp;Costs&nbsp;Awarded&nbsp;to&nbsp;HSE" - must be nbsp-normalized
        expect(fields['Total Costs Awarded to HSE']).toBe('£2,000.00');
        expect(fields['Region']).toBe('North West');
        expect(fields['Local Authority']).toBe('Halton UA');
        expect(fields['Industry']).toBe('Extractive and utility supply industries');
        expect(fields['Main Activity']).toBe('38320 - RECOVERY OF SORTED MATERIALS');
        expect(fields['Type of Location']).toBe('Fixed');
        expect(fields['HSE Group']).toBe('IVDIIU2G7');
        expect(fields['HSE Directorate']).toBe('INVESTIGATION DIVISION');
        expect(fields['HSE Division']).toBe('North West');
    });

    it('joins <BR>-separated address lines with a comma, not run together', () => {
        expect(fields['Address']).toBe(
            'Hale Road/Millhouse Metals, Millhouse Metals, Hale Road, WIDNES, Cheshire, WA8 0TL, England',
        );
    });

    it('skips spanning single-cell rows (section headers, the breach link row) without corrupting the map', () => {
        expect(fields['Location of Offence']).toBeUndefined();
        expect(fields['HSE Details']).toBeUndefined();
        expect(fields['Breach involved in this Case']).toBeUndefined();
    });

    it('finds the defendant id and breach id(s) via the real hrefs', () => {
        const defendantHref = firstHrefMatching($, 'defendant_details.asp');
        expect(extractIdParam(defendantHref!)).toBe('4392330');

        const breachHrefs = allHrefsMatching($, 'breach_details.asp');
        expect(breachHrefs.length).toBeGreaterThan(0);
        expect(extractIdParam(breachHrefs[0])).toBe('4858770001');
    });
});

describe('parseLabelValueRows against real breach detail page', () => {
    const html = readFileSync(`${fixturesDir}/conviction_breach_4858770001.html`, 'utf-8');
    const $ = cheerio.load(html);
    const fields = parseLabelValueRows($);

    it('extracts court, act and fine fields, including the label-less trailing empty pair', () => {
        expect(fields['Defendant']).toBe('Mill House Metals Limited');
        expect(fields['Court Name']).toBe('Liverpool');
        expect(fields['Court Level']).toBe('Magistrates Court');
        expect(fields['Act']).toBe('Employers Liability Compulsory Insurance Act 1969, Section 1, Sub Section 1');
        expect(fields['Date of Hearing']).toBe('15/04/2026');
        expect(fields['Result']).toBe('Fine');
        expect(fields['Fine']).toBe('£1,000.00');
        // the row's 3rd/4th cells are both empty <td></td> - must not appear as a "" key
        expect(fields['']).toBeUndefined();
    });
});

describe('parseLabelValueRows against real notice detail page', () => {
    const html = readFileSync(`${fixturesDir}/notice_detail_316005113.html`, 'utf-8');
    const $ = cheerio.load(html);
    const fields = parseLabelValueRows($);

    it('extracts fields even though notice labels are plain text, not <strong>', () => {
        expect(fields['Notice Type']).toBe('Improvement Notice');
        expect(fields['Compliance Date']).toBe('30/06/2027');
        expect(fields['Result']).toBe('Ongoing');
        expect(fields['Region']).toBe('Wales & South West');
        expect(fields['Local Authority']).toBe('Neath & Port Talbot UA');
        expect(fields['Industry']).toBe('Manufacturing');
        expect(fields['HSE Directorate']).toBe('INSPECTION DIVISION');
    });

    it('preserves the multi-line description as real newlines (no <br> tags there, unlike Address)', () => {
        expect(fields['Description']).toContain('IN/090626/LPEC/MG19 -316005113');
        expect(fields['Description']).toContain('IN/090626/LPEC/MG21 - 316005207');
        expect(fields['Description']!.split('\n').length).toBeGreaterThan(1);
    });

    it('finds the recipient id via the real recipient_details.asp href', () => {
        const href = firstHrefMatching($, 'recipient_details.asp');
        expect(extractIdParam(href!)).toBe('1108773');
    });
});
