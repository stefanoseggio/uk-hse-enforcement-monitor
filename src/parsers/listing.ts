import type { CheerioAPI } from 'cheerio';

// Both listing tables link to their detail page as `..._details.asp?SF=CN&SV=<id>`
// (cheerio decodes the `&amp;` entity automatically). No other link on either
// listing page matches this exact `SF=CN` shape, so a single regex is safe
// for both registers.
const DETAIL_LINK_RE = /_details\.asp\?SF=CN&SV=(\d+)/;

export function parseListingIds($: CheerioAPI): string[] {
    const ids: string[] = [];
    $('a[href*="_details.asp"]').each((_i, el) => {
        const href = $(el).attr('href') ?? '';
        const match = href.match(DETAIL_LINK_RE);
        if (match) ids.push(match[1]);
    });
    return ids;
}

// Header text is literally "... Showing Page 1 of 21, results 1 to 10 ..."
// on both registers - verified live on both.
export function parseTotalPages($: CheerioAPI): number {
    const text = $('body').text();
    const match = text.match(/Showing Page \d+ of (\d+)/);
    return match ? parseInt(match[1], 10) : 1;
}
