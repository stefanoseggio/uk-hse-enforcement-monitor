import { describe, expect, it } from 'vitest';

import { resolveDate, resolveInput } from '../src/input.js';

const NOW = new Date('2026-09-07T12:00:00.000Z'); // 13:00 BST on 7 Sep in London

describe('resolveDate', () => {
    it('accepts absolute dates, relative windows and the legacy presets, counting back from the London calendar day', () => {
        expect(resolveDate('2026-07-01', NOW, 'x')).toBe('2026-07-01');
        expect(resolveDate('7 days', NOW, 'x')).toBe('2026-08-31');
        expect(resolveDate('2 weeks', NOW, 'x')).toBe('2026-08-24');
        expect(resolveDate('3 months', NOW, 'x')).toBe('2026-06-07');
        expect(resolveDate('1 year', NOW, 'x')).toBe('2025-09-07');
        expect(resolveDate('24h', NOW, 'x')).toBe('2026-09-06');
        expect(resolveDate('30d', NOW, 'x')).toBe('2026-08-08');
        expect(resolveDate('', NOW, 'x')).toBeNull();
        expect(() => resolveDate('next tuesday', NOW, 'x')).toThrow(/Invalid input/);
    });
});

describe('resolveInput', () => {
    it('applies the documented defaults for an empty input and walks both registers unfiltered', () => {
        const r = resolveInput({}, NOW);
        expect(r.options).toMatchObject({
            datasets: ['convictions', 'notices'],
            maxItems: 100,
            fetchDetail: true,
            fetchBreachDetail: true,
            fetchPartyDetail: true,
            onlyNew: false,
            recheckDays: 180,
            maxConcurrency: 5,
            resetState: false,
        });
        expect([...r.options.eventTypes].sort()).toEqual(['NEW_LISTING', 'SANCTION', 'UPDATED']);
        expect(r.options.deltaStateName).toMatch(/^auto-[0-9a-f]{8}$/);
        expect(r.hasFilters).toBe(false);
        expect(r.queries.convictions.criteria).toEqual([]);
        expect(r.queries.notices.criteria).toEqual([]);
        expect(r.queries.convictions.sort).toBe('DCN');
        expect(r.queries.notices.sort).toBe('DNN');
    });

    it('maps every filter onto the verified column codes, register by register, with NT first', () => {
        const r = resolveInput(
            {
                nameContains: "O'Brien Ltd",
                descriptionContains: 'asbestos',
                localAuthorityContains: 'Bradford',
                mainActivityContains: 'ROOFING',
                region: '3',
                country: 'Scotland',
                industry: '13',
                hseDivision: '20',
                dateFrom: '2024-01-01',
                dateTo: '2024-12-31',
                hseReference: '4392330',
                recordNumber: '4883993',
                defendantStatus: '1980',
                resultingFromFatality: 'yes',
                minTotalFineGbp: 10000,
                maxTotalFineGbp: 100000,
                noticeTypes: ['8', '01'],
                act: '502',
            },
            NOW,
        );
        const conv = r.queries.convictions.criteria.map((c) => `${c.sf} ${c.eo} ${c.sv}`);
        expect(conv).toEqual([
            'DN LIKE O_Brien Ltd',
            'CSUM LIKE asbestos',
            'LA LIKE Bradford',
            'SICD LIKE ROOFING',
            'UKR = 3',
            'CTR = 9',
            'GS = 13',
            'HDV = 20',
            'DID = 4392330',
            'CN = 4883993',
            'ODS > 31/12/2023',
            'ODS < 01/01/2025',
            'CTY = 1980',
            'FAT = Yes',
            'TF > 9999',
            'TF < 100001',
        ]);
        const not = r.queries.notices.criteria.map((c) => `${c.sf} ${c.eo} ${c.sv}`);
        expect(not[0]).toBe('NT IN 01;08;');
        expect(not).toContain('RN LIKE O_Brien Ltd');
        expect(not).toContain('NSUM LIKE asbestos');
        expect(not).toContain('NLAC LIKE Bradford');
        expect(not).toContain('RID = 4392330');
        expect(not).toContain('NN = 4883993');
        expect(not).toContain('NIS > 31/12/2023');
        expect(not).toContain('ACT = 502');
        expect(not.some((c) => c.startsWith('TF') || c.startsWith('CTY') || c.startsWith('FAT'))).toBe(false);
        expect(r.hasFilters).toBe(true);
    });

    it('honours the legacy dateRange preset and keeps existing input names working', () => {
        const r = resolveInput({ dateRange: '7d', maxItemsPerDataset: 5000, fetchBreachDetail: false }, NOW);
        expect(r.queries.convictions.criteria).toEqual([{ sf: 'ODS', sn: 'F', eo: '>', sv: '30/08/2026' }]);
        expect(r.options.maxItems).toBe(5000);
        expect(r.options.fetchBreachDetail).toBe(false);
        expect(r.options.fetchDetail).toBe(true);
    });

    it('rejects contradictory or malformed filters with a clear message', () => {
        expect(() => resolveInput({ minTotalFineGbp: 10, maxTotalFineGbp: 5 }, NOW)).toThrow(
            /minTotalFineGbp is greater/,
        );
        expect(() => resolveInput({ region: '99' }, NOW)).toThrow(/region "99"/);
        expect(() => resolveInput({ noticeTypes: ['77'] }, NOW)).toThrow(/noticeTypes/);
        expect(() => resolveInput({ hseReference: 'abc' }, NOW)).toThrow(/hseReference/);
        expect(() => resolveInput({ dateFrom: '2026-09-01', dateTo: '2026-08-01' }, NOW)).toThrow(
            /dateFrom is after dateTo/,
        );
        expect(() => resolveInput({ eventTypes: ['BOGUS' as never] }, NOW)).toThrow(/eventTypes/);
        expect(() => resolveInput({ datasets: ['bogus' as never] }, NOW)).toThrow(/datasets/);
        expect(() => resolveInput({ nameContains: ' ;| ' }, NOW)).toThrow(/no searchable characters/);
        expect(() => resolveInput({ deltaStateName: 'has spaces!' }, NOW)).toThrow(/deltaStateName/);
        expect(() => resolveInput({ recheckDays: -1 }, NOW)).toThrow(/recheckDays/);
    });

    it('clamps performance knobs to safe ranges and ties breach/party fetches to fetchDetail', () => {
        const r = resolveInput({ maxItemsPerDataset: 10_000_000, maxConcurrency: 99, recheckDays: 99_999 }, NOW);
        expect(r.options.maxItems).toBe(100_000);
        expect(r.options.maxConcurrency).toBe(10);
        expect(r.options.recheckDays).toBe(3650);
        expect(resolveInput({ maxConcurrency: 0 }, NOW).options.maxConcurrency).toBe(1);
        const listingOnly = resolveInput({ fetchDetail: false }, NOW).options;
        expect(listingOnly.fetchBreachDetail).toBe(false);
        expect(listingOnly.fetchPartyDetail).toBe(false);
    });

    it('derives the delta store from the filter set only - not from dates, limits, fetch flags or registers', () => {
        const a = resolveInput({ region: '3', maxItemsPerDataset: 10, fetchDetail: false, dateFrom: '7 days' }, NOW);
        const b = resolveInput(
            { region: '3', maxItemsPerDataset: 500, datasets: ['notices'], dateFrom: '30 days' },
            NOW,
        );
        const c = resolveInput({ region: '7' }, NOW);
        expect(a.filtersSignature).toBe(b.filtersSignature);
        expect(a.filtersSignature).not.toBe(c.filtersSignature);
        expect(resolveInput({ deltaStateName: 'construction-nw' }, NOW).options.deltaStateName).toBe('construction-nw');
        expect(resolveInput({ dateFrom: '30 days' }, NOW).hasFilters).toBe(false);
    });
});
