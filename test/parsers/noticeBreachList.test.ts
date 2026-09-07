import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseNoticeBreachList } from '../../src/parsers/noticeBreachList.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

describe('parseNoticeBreachList against the real breach_list.asp page', () => {
    it('extracts both breach rows with their Act/Regulation text split into legislation / provision / paragraph', () => {
        const html = readFileSync(`${fixturesDir}/notice_breach_list_316005113.html`, 'utf-8');
        const breaches = parseNoticeBreachList(cheerio.load(html));
        expect(breaches).toEqual([
            {
                breachId: '001',
                actOrRegulation: 'Health and Safety At Work Act 1974 / 2 /',
                legislation: 'Health and Safety At Work Act 1974',
                provision: '2',
                paragraph: null,
            },
            {
                breachId: '002',
                actOrRegulation: 'Control of Substances Hazardous to Health Regs 2002 / 7 /',
                legislation: 'Control of Substances Hazardous to Health Regs 2002',
                provision: '7',
                paragraph: null,
            },
        ]);
    });

    it('handles a prohibition notice breach list (Gas Safety regulations)', () => {
        const html = readFileSync(`${fixturesDir}/notice_breach_list_316063545.html`, 'utf-8');
        const breaches = parseNoticeBreachList(cheerio.load(html));
        expect(breaches.map((b) => b.legislation)).toEqual([
            'Gas Safety (Installation and Use) Regulations 1998',
            'Health and Safety At Work Act 1974',
        ]);
    });
});
