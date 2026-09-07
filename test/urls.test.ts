import { describe, expect, it } from 'vitest';

import type { RegisterQuery } from '../src/types.js';
import { buildQueryString, convictionBreachListPath, listingPath, listingUrl, partyCasesPath } from '../src/urls.js';

describe('classic-ASP criteria join grammar (all forms verified live 2026-09-07)', () => {
    it('serialises one, two and three criteria exactly like the site does', () => {
        const one = buildQueryString([{ sf: 'ODS', sn: 'F', eo: '<', sv: '31/12/2100' }]);
        expect(Object.fromEntries(one)).toEqual({ CO: '', SN: 'F', SF: 'ODS,+|', EO: '<', SV: '31/12/2100,+|' });

        const two = buildQueryString([
            { sf: 'DN', sn: 'F', eo: 'LIKE', sv: 'Limited' },
            { sf: 'UKR', sn: 'P', eo: '=', sv: '3' },
        ]);
        expect(Object.fromEntries(two)).toEqual({
            CO: ',AND',
            SN: 'F,+P',
            SF: 'DN,|,+UKR,+|',
            EO: 'LIKE,+=',
            SV: 'Limited,|,+3,+|',
        });

        const three = buildQueryString([
            { sf: 'NT', sn: 'F', eo: 'IN', sv: '08;' },
            { sf: 'RN', sn: 'F', eo: 'LIKE', sv: 'Ltd' },
            { sf: 'NIS', sn: 'F', eo: '>', sv: '01/01/2026' },
        ]);
        expect(Object.fromEntries(three)).toEqual({
            CO: ',AND,AND',
            SN: 'F,+F,+F',
            SF: 'NT,|,+RN,|,+NIS,+|',
            EO: 'IN,+LIKE,+>',
            SV: '08;,|,+Ltd,|,+01/01/2026,+|',
        });
        expect(() => buildQueryString([])).toThrow();
    });

    it('builds the all-records listing path with the walk sort when no criterion is given', () => {
        const conv: RegisterQuery = { register: 'convictions', criteria: [], sort: 'DCN' };
        expect(listingPath(conv, 1)).toBe(
            '/convictions/case/case_list.asp?ST=C&CO=&SN=F&SF=ODS,+|&EO=%3C&SV=31%2F12%2F2100,+|&SO=DCN&PN=1',
        );
        const not: RegisterQuery = { register: 'notices', criteria: [], sort: 'DNN' };
        expect(listingPath(not, 7)).toBe(
            '/notices/notices/notice_list.asp?ST=N&CO=&SN=F&SF=NIS,+|&EO=%3C&SV=31%2F12%2F2100,+|&SO=DNN&PN=7',
        );
        expect(listingUrl(conv)).toMatch(/^https:\/\/resources\.hse\.gov\.uk\/convictions\/case\/case_list\.asp\?/);
    });

    it('keeps the literal "+" and "|" of the join and encodes only the values', () => {
        const q: RegisterQuery = {
            register: 'notices',
            criteria: [
                { sf: 'NT', sn: 'F', eo: 'IN', sv: '08;' },
                { sf: 'RN', sn: 'F', eo: 'LIKE', sv: 'A_E Drainage' },
            ],
            sort: 'DNN',
        };
        expect(listingPath(q, 1)).toBe(
            '/notices/notices/notice_list.asp?ST=N&CO=,AND&SN=F,+F&SF=NT,|,+RN,+|&EO=IN,+LIKE&SV=08%3B,|,+A_E+Drainage,+|&SO=DNN&PN=1',
        );
    });

    it('builds the per-case breach list and party history paths', () => {
        expect(convictionBreachListPath('4849124')).toBe(
            '/convictions/breach/breach_list.asp?ST=B&SN=F&EO=%3D&SF=CN&SV=4849124',
        );
        expect(partyCasesPath('4392330')).toContain('SF=DID&SV=4392330');
    });
});
