import { log } from 'apify';
import * as cheerio from 'cheerio';

import { fetchWithRetry } from './http.js';
import { parseListingIds, parseTotalPages } from './parsers/listing.js';
import type { DatasetName } from './types.js';
import { listingPath } from './urls.js';

// Both registers sort newest-first (see urls.ts), so this always returns
// the most recent N ids - exactly what a recurring monitor needs to check
// "what's new since last run".
export async function fetchListingIds(dataset: DatasetName, maxItems: number): Promise<string[]> {
    const ids: string[] = [];
    let page = 1;
    for (;;) {
        const html = await fetchWithRetry(listingPath(dataset, page));
        const $ = cheerio.load(html);
        const pageIds = parseListingIds($);
        if (pageIds.length === 0) {
            log.info(`${dataset}: no more results at page ${page}.`);
            break;
        }

        for (const id of pageIds) {
            ids.push(id);
            if (ids.length >= maxItems) return ids;
        }

        const totalPages = parseTotalPages($);
        log.info(`${dataset} page ${page}/${totalPages}: ${pageIds.length} ids (${ids.length} so far).`);
        if (page >= totalPages) break;
        page += 1;
    }
    return ids;
}
