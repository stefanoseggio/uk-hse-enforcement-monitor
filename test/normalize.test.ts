import { describe, expect, it } from 'vitest';

import {
    addDays,
    classifyBreachResult,
    classifyNoticeType,
    classifyPartyStatus,
    contentHash,
    daysBetween,
    extractCountry,
    extractNoticeItemIds,
    extractPostcode,
    isOpenNoticeResult,
    isoToSiteDate,
    parseActReference,
    parseGbp,
    parseRegulationReference,
    parseUkDate,
    sanitizeFreeText,
    shortHash,
    siteCalendarDate,
    splitNoticeBreach,
    splitSic,
} from '../src/normalize.js';

describe('dates', () => {
    it('parses the register DD/MM/YYYY format and rejects anything else', () => {
        expect(parseUkDate('26/09/2025')).toBe('2025-09-26');
        expect(parseUkDate('5/1/2026')).toBe('2026-01-05');
        expect(parseUkDate('31/02/2026')).toBeNull();
        expect(parseUkDate('2025-09-26')).toBeNull();
        expect(parseUkDate('')).toBeNull();
        expect(parseUkDate(null)).toBeNull();
    });

    it('round-trips to the search-criteria format and shifts by whole days', () => {
        expect(isoToSiteDate('2024-01-01')).toBe('01/01/2024');
        expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
        expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
        expect(daysBetween('2025-11-24', '2026-01-26')).toBe(63);
        expect(daysBetween('2026-09-07', '2026-03-06')).toBe(-185);
        expect(daysBetween(null, '2026-03-06')).toBeNull();
    });

    it('uses the London calendar day (BST in summer, GMT in winter)', () => {
        expect(siteCalendarDate(new Date('2026-07-01T23:30:00.000Z'))).toBe('2026-07-02');
        expect(siteCalendarDate(new Date('2026-01-01T23:30:00.000Z'))).toBe('2026-01-01');
    });
});

describe('money and codes', () => {
    it('parses GBP strings from both the detail page and the breach list', () => {
        expect(parseGbp('£1,000.00')).toBe(1000);
        expect(parseGbp('400,000.00')).toBe(400000);
        expect(parseGbp('£8,974.16')).toBe(8974.16);
        expect(parseGbp('£0.00')).toBe(0);
        expect(parseGbp('')).toBeNull();
    });

    it('splits SIC codes, postcodes and countries out of the register strings', () => {
        expect(splitSic('38320 - RECOVERY OF SORTED MATERIALS')).toEqual({
            code: '38320',
            description: 'RECOVERY OF SORTED MATERIALS',
        });
        expect(splitSic('MACHINING')).toEqual({ code: null, description: 'MACHINING' });
        expect(extractPostcode('Hale Road, WIDNES, Cheshire, WA8 0TL, England')).toBe('WA8 0TL');
        expect(extractPostcode('Harvil Road, London, UB9, England')).toBe('UB9');
        expect(extractPostcode('Any Location Great Britain, , England')).toBeNull();
        expect(extractCountry('Croescadarn Close, CARDIFF, CF23 8HE, Wales')).toBe('Wales');
        expect(extractCountry('A+E Drainage and Plumbing, Any Location Great Britain, , England')).toBe('England');
        expect(extractCountry(null)).toBeNull();
    });
});

describe('legislation references', () => {
    it('splits Act section/sub-section and Regulation number/paragraph strings', () => {
        expect(
            parseActReference('Employers Liability Compulsory Insurance Act 1969, Section 1, Sub Section 1'),
        ).toEqual({ name: 'Employers Liability Compulsory Insurance Act 1969', section: '1', subSection: '1' });
        expect(parseActReference('Health and Safety at Work Act 1974, Section 2')).toEqual({
            name: 'Health and Safety at Work Act 1974',
            section: '2',
            subSection: null,
        });
        expect(parseActReference('')).toEqual({ name: null, section: null, subSection: null });
        expect(
            parseRegulationReference('Construction (Design and Management) Regulations 2015 (No 15) para 2'),
        ).toEqual({
            name: 'Construction (Design and Management) Regulations 2015',
            number: '15',
            paragraph: '2',
        });
        expect(parseRegulationReference('Work at Height Regulations 2005 (No 4)')).toEqual({
            name: 'Work at Height Regulations 2005',
            number: '4',
            paragraph: null,
        });
        expect(splitNoticeBreach('Health and Safety At Work Act 1974 / 2 / ')).toEqual({
            legislation: 'Health and Safety At Work Act 1974',
            provision: '2',
            paragraph: null,
        });
        expect(splitNoticeBreach('Provision and Use of Work Equip Regs 1998 / 11 / 1')).toEqual({
            legislation: 'Provision and Use of Work Equip Regs 1998',
            provision: '11',
            paragraph: '1',
        });
    });
});

describe('classification', () => {
    it('maps breach results from both the breach page and the breach list vocabularies', () => {
        expect(classifyBreachResult('Fine')).toBe('fine');
        expect(classifyBreachResult('Guilty-Fine')).toBe('fine');
        expect(classifyBreachResult('Prison Suspended')).toBe('suspended_custodial');
        expect(classifyBreachResult('Guilty-Prison Suspended')).toBe('suspended_custodial');
        expect(classifyBreachResult('Guilty-Prison')).toBe('custodial');
        expect(classifyBreachResult('Guilty-No Sep Penalty')).toBe('no_separate_penalty');
        expect(classifyBreachResult('Community Order')).toBe('other');
        expect(classifyBreachResult(null)).toBeNull();
    });

    it('derives notice-type flags from both the detail and the listing wording', () => {
        expect(classifyNoticeType('Immediate Prohibition Notice')).toMatchObject({
            category: 'Prohibition',
            isProhibition: true,
            isImprovement: false,
            isImmediate: true,
            isDeferred: false,
            isCrown: false,
        });
        expect(classifyNoticeType('Prohibition Notice Immediate')).toMatchObject({ isImmediate: true });
        expect(classifyNoticeType('Improvement Notice')).toMatchObject({
            category: 'Improvement',
            isImprovement: true,
            isProhibition: false,
            isImmediate: false,
        });
        expect(classifyNoticeType('Deferred Prohibition Notice (Crown)')).toMatchObject({
            isDeferred: true,
            isCrown: true,
        });
        expect(classifyNoticeType(null).category).toBeNull();
        expect(isOpenNoticeResult('Ongoing')).toBe(true);
        expect(isOpenNoticeResult(null)).toBe(true);
        expect(isOpenNoticeResult('Complied with')).toBe(false);
    });

    it('classifies party status into coarse entity types', () => {
        expect(classifyPartyStatus('Private Company')).toBe('company');
        expect(classifyPartyStatus('Limited Liability Partnership')).toBe('company');
        expect(classifyPartyStatus('Individual')).toBe('individual');
        expect(classifyPartyStatus('Self Employed (Sole Trader)')).toBe('individual');
        expect(classifyPartyStatus('Partnership')).toBe('partnership');
        expect(classifyPartyStatus('Local Authority')).toBe('public_body');
        expect(classifyPartyStatus('NHS')).toBe('public_body');
        expect(classifyPartyStatus('Other')).toBe('other');
        expect(classifyPartyStatus(null)).toBeNull();
    });

    it('extracts the per-item notice numbers embedded in multi-item descriptions', () => {
        expect(extractNoticeItemIds('IN/090626/LPEC/MG19 -316005113\nfoo\n IN/090626/LPEC/MG20 - 316005195')).toEqual([
            '316005113',
            '316005195',
        ]);
        expect(extractNoticeItemIds(null)).toEqual([]);
    });
});

describe('hashing and sanitising', () => {
    it('content hash is canonical (key order independent) and sensitive to any value change', () => {
        const a = contentHash({ b: 1, a: { y: 'x', x: ['1', '2'] } });
        const b = contentHash({ a: { x: ['1', '2'], y: 'x' }, b: 1 });
        const c = contentHash({ a: { x: ['1', '3'], y: 'x' }, b: 1 });
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).toMatch(/^[0-9a-f]{16}$/);
        expect(shortHash('x')).toMatch(/^[0-9a-f]{8}$/);
    });

    it('turns quote characters (a SQL error on the site) and + (decoded as a space) into single-char wildcards', () => {
        expect(sanitizeFreeText("O'Brien")).toBe('O_Brien');
        expect(sanitizeFreeText('A+E Drainage')).toBe('A_E Drainage');
        expect(sanitizeFreeText('  Skanska,  Costain ')).toBe('Skanska, Costain');
        expect(sanitizeFreeText('a;b|c')).toBe('a b c');
    });
});
