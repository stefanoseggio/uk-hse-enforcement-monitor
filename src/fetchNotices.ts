import * as cheerio from 'cheerio';

import { fetchListingIds } from './fetchListingIds.js';
import { fetchWithRetry } from './http.js';
import { extractIdParam, firstHrefMatching, parseLabelValueRows } from './parsers/labelValueTable.js';
import { parseNoticeBreachList } from './parsers/noticeBreachList.js';
import type { NoticeRecord } from './types.js';
import { noticeBreachListPath, noticeDetailPath } from './urls.js';

// The header row reads e.g. "Notice 316005113 served against <a>Recipient
// Name</a> on 25/07/2026" - recipient name/id come from the embedded link,
// the served date from a trailing "on DD/MM/YYYY". Verified live 2026-09-06.
const SERVED_DATE_RE = /on (\d{2}\/\d{2}\/\d{4})\s*$/;

async function fetchNoticeDetail(noticeNumber: string, fetchBreachDetail: boolean): Promise<NoticeRecord> {
    const path = noticeDetailPath(noticeNumber);
    const html = await fetchWithRetry(path);
    const $ = cheerio.load(html);
    const fields = parseLabelValueRows($);

    const headerText = $('table').first().find('th').first().text().replace(/\s+/g, ' ').trim();
    const servedDate = headerText.match(SERVED_DATE_RE)?.[1] ?? null;

    const recipientHref = firstHrefMatching($, 'recipient_details.asp');
    const recipientId = recipientHref ? extractIdParam(recipientHref) : null;
    const recipientName = $('a[href*="recipient_details.asp"]').first().text().trim() || null;

    const breaches = fetchBreachDetail
        ? parseNoticeBreachList(cheerio.load(await fetchWithRetry(noticeBreachListPath(noticeNumber))))
        : [];

    return {
        recordType: 'notice',
        noticeNumber,
        recipientName,
        recipientId,
        noticeType: fields['Notice Type'] || null,
        servedDate,
        description: fields.Description || null,
        complianceDate: fields['Compliance Date'] || null,
        revisedComplianceDate: fields['Revised Compliance Date'] || null,
        result: fields.Result || null,
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
        detailUrl: `https://resources.hse.gov.uk${path}`,
        scrapedAt: new Date().toISOString(),
    };
}

export async function fetchNotices(maxItems: number, fetchBreachDetail: boolean): Promise<NoticeRecord[]> {
    const noticeNumbers = await fetchListingIds('notices', maxItems);
    const records: NoticeRecord[] = [];
    for (const noticeNumber of noticeNumbers) {
        records.push(await fetchNoticeDetail(noticeNumber, fetchBreachDetail));
    }
    return records;
}
