import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseListingIds } from '../src/parsers/listing.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const CONVICTIONS_PAGE1 = readFileSync(`${fixturesDir}/conviction_list_page1.html`, 'utf-8');
const NO_MORE_RESULTS = '<html><body>no results</body></html>';
const pageIds = parseListingIds(cheerio.load(CONVICTIONS_PAGE1));

const fetchWithRetryMock = vi.fn<(path: string) => Promise<string>>();
vi.mock('../src/http.js', () => ({ fetchWithRetry: (path: string) => fetchWithRetryMock(path) }));

const { fetchListingIds } = await import('../src/fetchListingIds.js');

function pageOf(path: string): number {
    return Number(new URL(`https://x${path}`).searchParams.get('PN'));
}

describe('fetchListingIds delta (onlyNew) early-stop, against a real captured fixture', () => {
    beforeEach(() => {
        fetchWithRetryMock.mockReset();
    });

    it('cold run (empty seen-set): returns every id on the page, marks nothing to stop early for', async () => {
        fetchWithRetryMock.mockImplementation(async () => CONVICTIONS_PAGE1);
        const { ids, allIdsThisRun } = await fetchListingIds('convictions', 10, new Set(), false);
        expect(ids).toEqual(pageIds);
        expect(allIdsThisRun).toEqual(pageIds);
    });

    it('onlyNew=true with every id already seen: stops after 2 consecutive fully-known pages, returns zero new ids', async () => {
        // Page 1 and page 2 both genuinely fully-known (same fixture content
        // reused to simulate a second all-old page); page 3 would be
        // "no more results" but must never be reached if the guard works.
        fetchWithRetryMock.mockImplementation(async (path) =>
            pageOf(path) <= 2 ? CONVICTIONS_PAGE1 : NO_MORE_RESULTS,
        );
        const seenIds = new Set(pageIds);
        const { ids, allIdsThisRun } = await fetchListingIds('convictions', 100, seenIds, true);
        expect(ids).toEqual([]);
        expect(allIdsThisRun.length).toBe(pageIds.length * 2);
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(2); // proves it stopped before a 3rd fetch
    });

    it('onlyNew=true with a mixed page (some new, some known): returns only the new ones and does not re-walk past end of listing', async () => {
        // Real pagination never repeats a page's ids, so page 2 here is
        // "no more results" (not the same fixture again) - this is what a
        // single real page of mixed new/known content looks like in
        // production, distinct from the "still more history" case above.
        fetchWithRetryMock.mockImplementation(async (path) =>
            pageOf(path) === 1 ? CONVICTIONS_PAGE1 : NO_MORE_RESULTS,
        );
        const seenIds = new Set(pageIds.slice(1)); // everything except the newest id
        const { ids, allIdsThisRun } = await fetchListingIds('convictions', 100, seenIds, true);
        expect(ids).toEqual([pageIds[0]]);
        expect(allIdsThisRun).toEqual(pageIds);
    });
});
