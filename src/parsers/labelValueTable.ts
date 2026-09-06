import type { CheerioAPI, Element } from 'cheerio';

// Both the conviction/notice detail pages and the per-breach detail page
// share one shape: a table of <tr>s, most holding one or two label/value
// <td> pairs (label first, e.g. `<td><strong>Total Fine</strong></td><td>...`;
// notices drop the <strong>, so labels are matched by position, not markup).
// A handful of rows are a single spanning <td> (section headers like
// "Location of Offence", or the "Breach involved..." link row) - those have
// an odd cell count and are silently skipped since they have no pair
// partner within the row. Verified live against 3 real page shapes
// (conviction detail, notice detail, breach detail) - see AGENTS.md.
function extractValue($: CheerioAPI, cell: Element): string {
    const $cell = $(cell).clone();
    $cell.find('br').replaceWith(', ');
    return $cell
        .text()
        .replace(/[^\S\n]+/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
        .trim();
}

export function parseLabelValueRows($: CheerioAPI): Record<string, string> {
    const fields: Record<string, string> = {};
    $('table tr').each((_i, row) => {
        const cells = $(row).children('td').toArray();
        for (let i = 0; i + 1 < cells.length; i += 2) {
            const label = $(cells[i]).text().replace(/\s+/g, ' ').trim().replace(/:$/, '');
            if (!label) continue;
            fields[label] = extractValue($, cells[i + 1]);
        }
    });
    return fields;
}

export function firstHrefMatching($: CheerioAPI, hrefContains: string): string | null {
    const href = $(`a[href*="${hrefContains}"]`).first().attr('href');
    return href ?? null;
}

export function allHrefsMatching($: CheerioAPI, hrefContains: string): string[] {
    const hrefs: string[] = [];
    $(`a[href*="${hrefContains}"]`).each((_i, el) => {
        const href = $(el).attr('href');
        if (href) hrefs.push(href);
    });
    return hrefs;
}

export function extractIdParam(href: string, paramName = 'SV'): string | null {
    const re = new RegExp(`[?&]${paramName}=(\\d+)`);
    return href.match(re)?.[1] ?? null;
}
