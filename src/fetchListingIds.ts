import { log } from 'apify';
import * as cheerio from 'cheerio';

import { fetchWithRetry } from './http.js';
import { parseListingIds, parseTotalPages } from './parsers/listing.js';
import type { DatasetName } from './types.js';
import { listingPath } from './urls.js';

export interface ListingIdsResult {
    ids: string[];
    allIdsThisRun: string[];
}

// Both registers sort newest-first (see urls.ts), so this always returns
// the most recent N ids - exactly what a recurring monitor needs to check
// "what's new since last run". When `onlyNew` is set, pagination stops
// early once two consecutive pages contain no id outside `seenIds` (a
// one-page safety margin against minor reordering) - this is what makes a
// delta run resolve in seconds instead of walking the whole register.
export async function fetchListingIds(
    dataset: DatasetName,
    maxItems: number,
    seenIds: ReadonlySet<string>,
    onlyNew: boolean,
): Promise<ListingIdsResult> {
    const ids: string[] = [];
    const allIdsThisRun: string[] = [];
    let page = 1;
    let consecutiveFullyKnownPages = 0;
    for (;;) {
        const html = await fetchWithRetry(listingPath(dataset, page));
        const $ = cheerio.load(html);
        const pageIds = parseListingIds($);
        if (pageIds.length === 0) {
            log.info(`${dataset}: no more results at page ${page}.`);
            break;
        }

        let pageHasNew = false;
        for (const id of pageIds) {
            allIdsThisRun.push(id);
            const isNew = !seenIds.has(id);
            if (isNew) pageHasNew = true;
            if (!onlyNew || isNew) {
                ids.push(id);
                if (ids.length >= maxItems) return { ids, allIdsThisRun };
            }
        }

        if (onlyNew) {
            consecutiveFullyKnownPages = pageHasNew ? 0 : consecutiveFullyKnownPages + 1;
            if (consecutiveFullyKnownPages >= 2) {
                log.info(`${dataset}: stopping early at page ${page} - 2 consecutive pages with no new ids.`);
                break;
            }
        }

        const totalPages = parseTotalPages($);
        log.info(`${dataset} page ${page}/${totalPages}: ${pageIds.length} ids (${ids.length} to fetch so far).`);
        if (page >= totalPages) break;
        page += 1;
    }
    return { ids, allIdsThisRun };
}
