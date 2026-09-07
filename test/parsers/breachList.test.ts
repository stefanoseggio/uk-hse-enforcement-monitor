import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseBreachList } from '../../src/parsers/breachList.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));
const load = (name: string) => cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));

describe('parseBreachList against the real breach_list.asp pages', () => {
    it('reads the per-case list (the only source of breach ids for a multi-breach case)', () => {
        const rows = parseBreachList(load('conviction_breach_list_case_4849124.html'));
        expect(rows).toEqual([
            {
                breachId: '4849124002',
                defendantName: 'GNW 2023 Realisations Limited',
                hearingDate: '17/06/2026',
                result: 'Guilty-Fine',
                fine: '400,000.00',
                actOrRegulation: 'Health and Safety At Work Act 1974 / 2 / 1',
            },
            {
                breachId: '4849124003',
                defendantName: 'GNW 2023 Realisations Limited',
                hearingDate: '17/06/2026',
                result: 'Guilty-No Sep Penalty',
                fine: '0.00',
                actOrRegulation: 'Provision and Use of Work Equip Regs 1998 / 5 / 1',
            },
        ]);
    });

    it('reads the site-wide "New Breaches" list with its result vocabulary', () => {
        const rows = parseBreachList(load('conviction_breach_list_new_breaches_page1.html'));
        expect(rows.length).toBe(10);
        expect(rows[0]).toMatchObject({ breachId: '4836027001', hearingDate: '22/06/2026', result: 'Guilty-Fine' });
        expect(rows.map((r) => r.result)).toContain('Guilty-Prison Suspended');
    });
});
