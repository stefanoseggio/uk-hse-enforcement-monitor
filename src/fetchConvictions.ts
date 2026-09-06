import * as cheerio from 'cheerio';

import type { DateRangePreset } from './dateFilter.js';
import { isWithinDateRange, parseUkDate } from './dateFilter.js';
import { fetchListingIds } from './fetchListingIds.js';
import { fetchWithRetry } from './http.js';
import { allHrefsMatching, extractIdParam, parseLabelValueRows } from './parsers/labelValueTable.js';
import type { ConvictionBreach, ConvictionRecord } from './types.js';
import { convictionBreachDetailPath, convictionDetailPath } from './urls.js';

async function fetchBreach(breachId: string): Promise<ConvictionBreach> {
    const html = await fetchWithRetry(convictionBreachDetailPath(breachId));
    const $ = cheerio.load(html);
    const fields = parseLabelValueRows($);
    return {
        breachId,
        court: fields['Court Name'] || null,
        courtLevel: fields['Court Level'] || null,
        act: fields.Act || null,
        regulation: fields.Regulation || null,
        dateOfHearing: fields['Date of Hearing'] || null,
        result: fields.Result || null,
        fine: fields.Fine || null,
    };
}

async function fetchConvictionDetail(
    caseNumber: string,
    fetchBreachDetail: boolean,
    isNew: boolean,
    scrapedAt: string,
): Promise<ConvictionRecord> {
    const path = convictionDetailPath(caseNumber);
    const html = await fetchWithRetry(path);
    const $ = cheerio.load(html);
    const fields = parseLabelValueRows($);

    const defendantHref = allHrefsMatching($, 'defendant_details.asp')[0];
    const defendantId = defendantHref ? extractIdParam(defendantHref) : null;

    const breachIds = [
        ...new Set(
            allHrefsMatching($, 'breach_details.asp')
                .map((href) => extractIdParam(href))
                .filter((id): id is string => id !== null),
        ),
    ];

    const breaches: ConvictionBreach[] = fetchBreachDetail
        ? await Promise.all(breachIds.map(async (id) => fetchBreach(id)))
        : breachIds.map((breachId) => ({
              breachId,
              court: null,
              courtLevel: null,
              act: null,
              regulation: null,
              dateOfHearing: null,
              result: null,
              fine: null,
          }));

    return {
        recordType: 'conviction',
        caseNumber,
        defendantName: fields.Defendant || null,
        defendantId,
        description: fields.Description || null,
        offenceDate: fields['Offence Date'] || null,
        totalFine: fields['Total Fine'] || null,
        totalCosts: fields['Total Costs Awarded to HSE'] || null,
        address: fields.Address || null,
        region: fields.Region || null,
        localAuthority: fields['Local Authority'] || null,
        industry: fields.Industry || null,
        mainActivity: fields['Main Activity'] || null,
        typeOfLocation: fields['Type of Location'] || null,
        hseGroup: fields['HSE Group'] || null,
        hseDirectorate: fields['HSE Directorate'] || null,
        hseArea: fields['HSE Area'] || null,
        hseDivision: fields['HSE Division'] || null,
        breaches,
        record_id: caseNumber,
        event_type: 'SANCTION',
        scraped_at: scrapedAt,
        is_new: isNew,
        source_url: `https://resources.hse.gov.uk${path}`,
    };
}

export async function fetchConvictions(
    maxItems: number,
    fetchBreachDetail: boolean,
    seenIds: ReadonlySet<string>,
    onlyNew: boolean,
    dateRange: DateRangePreset | undefined,
    now: Date,
): Promise<{ records: ConvictionRecord[]; allIdsThisRun: string[] }> {
    const { ids: caseNumbers, allIdsThisRun } = await fetchListingIds('convictions', maxItems, seenIds, onlyNew);
    const scrapedAt = now.toISOString();
    const records: ConvictionRecord[] = [];
    for (const caseNumber of caseNumbers) {
        const record = await fetchConvictionDetail(caseNumber, fetchBreachDetail, !seenIds.has(caseNumber), scrapedAt);
        if (dateRange && !isWithinDateRange(parseUkDate(record.offenceDate), dateRange, now)) continue;
        records.push(record);
    }
    return { records, allIdsThisRun };
}
