import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseNoticeBreachList } from '../../src/parsers/noticeBreachList.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

describe('parseNoticeBreachList against the real breach_list.asp page', () => {
    it('extracts both breach rows with their Act/Regulation text', () => {
        const html = readFileSync(`${fixturesDir}/notice_breach_list_316005113.html`, 'utf-8');
        const $ = cheerio.load(html);

        const breaches = parseNoticeBreachList($);
        expect(breaches).toEqual([
            { breachId: '001', actOrRegulation: 'Health and Safety At Work Act 1974 / 2 /' },
            { breachId: '002', actOrRegulation: 'Control of Substances Hazardous to Health Regs 2002 / 7 /' },
        ]);
    });
});
