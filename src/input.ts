import { log } from 'apify';

import { ACTS, COUNTRIES, DEFENDANT_STATUSES, HSE_DIVISIONS, INDUSTRIES, NOTICE_TYPES, REGIONS } from './codes.js';
import { addDays, isoToSiteDate, sanitizeFreeText, shortHash, siteCalendarDate } from './normalize.js';
import type { ActorInput, Criterion, DatasetName, EventType, RegisterQuery, TriState } from './types.js';
import { WALK_SORT } from './urls.js';

export interface RunOptions {
    datasets: DatasetName[];
    maxItems: number;
    fetchDetail: boolean;
    fetchBreachDetail: boolean;
    fetchPartyDetail: boolean;
    onlyNew: boolean;
    recheckDays: number;
    maxConcurrency: number;
    eventTypes: ReadonlySet<EventType>;
    deltaStateName: string;
    resetState: boolean;
}

export interface ResolvedInput {
    queries: Record<DatasetName, RegisterQuery>;
    options: RunOptions;
    /** Stable hash of everything that changes WHICH records a run returns (used to name the delta store). */
    filtersSignature: string;
    /** true when no server-side filter is set (the only case in which a v1 delta store is adopted). */
    hasFilters: boolean;
}

const ALL_DATASETS: DatasetName[] = ['convictions', 'notices'];
const ALL_EVENT_TYPES: EventType[] = ['NEW_LISTING', 'SANCTION', 'UPDATED'];

export const MAX_ITEMS_HARD_CAP = 100_000;
export const MAX_CONCURRENCY_HARD_CAP = 10;
export const MAX_RECHECK_DAYS = 3650;

export class InputError extends Error {
    constructor(message: string) {
        super(`Invalid input: ${message}`);
        this.name = 'InputError';
    }
}

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return v === '' ? null : v;
}

function code(value: unknown, table: Record<string, string>, field: string): string | null {
    const v = text(value);
    if (!v) return null;
    if (!table[v]) {
        const byLabel = Object.entries(table).find(([, label]) => label.toLowerCase() === v.toLowerCase());
        if (byLabel) return byLabel[0];
        throw new InputError(`${field} "${v}" is not one of the site's codes: ${Object.keys(table).join(', ')}`);
    }
    return v;
}

function tri(value: unknown, field: string): 'Yes' | 'No' | null {
    if (value === undefined || value === null || value === '') return null;
    if (value === 'yes') return 'Yes';
    if (value === 'no') return 'No';
    if (value === 'any') return null;
    throw new InputError(`${field} must be one of any, yes, no (got "${String(value as TriState)}")`);
}

function money(value: unknown, field: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new InputError(`${field} must be a non-negative number (GBP)`);
    return Math.round(n);
}

function digits(value: unknown, field: string): string | null {
    const v = text(value);
    if (!v) return null;
    if (!/^\d+$/.test(v)) throw new InputError(`${field} must be a number (digits only), got "${v}"`);
    return v;
}

/**
 * Accepts the Apify datepicker's absolute ("2026-07-01") and relative
 * ("7 days", "2 weeks", "3 months", "1 year") forms, plus the legacy v1
 * presets ("24h" | "7d" | "30d"). Relative windows count back from today's
 * calendar date in London (the register's own civil dates). Returns YYYY-MM-DD.
 */
export function resolveDate(value: unknown, now: Date, field: string): string | null {
    const v = text(value);
    if (!v) return null;
    const absolute = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (absolute) {
        const [, , m, d] = absolute.map(Number);
        if (m < 1 || m > 12 || d < 1 || d > 31) throw new InputError(`${field} "${v}" is not a valid date`);
        return v;
    }
    const legacy = v.match(/^(\d+)([hd])$/i);
    const relative = v.match(/^(\d+)\s*(day|week|month|year)s?$/i);
    let amount: number;
    let unit: string;
    if (legacy) {
        amount = legacy[2].toLowerCase() === 'h' ? Math.max(1, Math.ceil(Number(legacy[1]) / 24)) : Number(legacy[1]);
        unit = 'day';
    } else if (relative) {
        amount = Number(relative[1]);
        unit = relative[2].toLowerCase();
    } else {
        throw new InputError(`${field} must be YYYY-MM-DD or a relative window like "7 days" (got "${v}")`);
    }
    const [y, m, d] = siteCalendarDate(now).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (unit === 'day') date.setUTCDate(date.getUTCDate() - amount);
    else if (unit === 'week') date.setUTCDate(date.getUTCDate() - amount * 7);
    else if (unit === 'month') date.setUTCMonth(date.getUTCMonth() - amount);
    else date.setUTCFullYear(date.getUTCFullYear() - amount);
    return date.toISOString().slice(0, 10);
}

interface ResolvedFilters {
    nameContains: string | null;
    descriptionContains: string | null;
    localAuthorityContains: string | null;
    mainActivityContains: string | null;
    region: string | null;
    country: string | null;
    industry: string | null;
    hseDivision: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    hseReference: string | null;
    recordNumber: string | null;
    defendantStatus: string | null;
    resultingFromFatality: 'Yes' | 'No' | null;
    minTotalFineGbp: number | null;
    maxTotalFineGbp: number | null;
    noticeTypes: string[];
    act: string | null;
}

/**
 * Column codes per register - all verified live with result counts on
 * 2026-09-07 (see AGENTS.md). `NT IN` must come first in a join.
 */
function criteriaFor(register: DatasetName, f: ResolvedFilters): Criterion[] {
    const c: Criterion[] = [];
    const like = (sf: string, value: string | null): void => {
        if (value) c.push({ sf, sn: 'F', eo: 'LIKE', sv: sanitizeFreeText(value) });
    };
    const pick = (sf: string, value: string | null): void => {
        if (value) c.push({ sf, sn: 'P', eo: '=', sv: value });
    };
    const isConv = register === 'convictions';

    if (!isConv && f.noticeTypes.length > 0) {
        c.push({ sf: 'NT', sn: 'F', eo: 'IN', sv: `${f.noticeTypes.join(';')};` });
    }
    like(isConv ? 'DN' : 'RN', f.nameContains);
    like(isConv ? 'CSUM' : 'NSUM', f.descriptionContains);
    like(isConv ? 'LA' : 'NLAC', f.localAuthorityContains);
    like('SICD', f.mainActivityContains);
    pick('UKR', f.region);
    pick('CTR', f.country);
    pick('GS', f.industry);
    pick('HDV', f.hseDivision);
    if (f.hseReference) c.push({ sf: isConv ? 'DID' : 'RID', sn: 'F', eo: '=', sv: f.hseReference });
    if (f.recordNumber) c.push({ sf: isConv ? 'CN' : 'NN', sn: 'F', eo: '=', sv: f.recordNumber });
    // The site's date operators are strict (> and <; = is an exact day), so the
    // window bounds are shifted by one day to make dateFrom/dateTo inclusive.
    const dateField = isConv ? 'ODS' : 'NIS';
    if (f.dateFrom) c.push({ sf: dateField, sn: 'F', eo: '>', sv: isoToSiteDate(addDays(f.dateFrom, -1)) });
    if (f.dateTo) c.push({ sf: dateField, sn: 'F', eo: '<', sv: isoToSiteDate(addDays(f.dateTo, 1)) });
    if (isConv) {
        pick('CTY', f.defendantStatus);
        if (f.resultingFromFatality) c.push({ sf: 'FAT', sn: 'F', eo: '=', sv: f.resultingFromFatality });
        if (f.minTotalFineGbp !== null) c.push({ sf: 'TF', sn: 'F', eo: '>', sv: String(f.minTotalFineGbp - 1) });
        if (f.maxTotalFineGbp !== null) c.push({ sf: 'TF', sn: 'F', eo: '<', sv: String(f.maxTotalFineGbp + 1) });
    } else {
        pick('ACT', f.act);
    }
    return c;
}

export function resolveInput(raw: ActorInput, now: Date): ResolvedInput {
    const datasetsRaw = Array.isArray(raw.datasets) && raw.datasets.length > 0 ? raw.datasets : ALL_DATASETS;
    for (const d of datasetsRaw) {
        if (!ALL_DATASETS.includes(d)) throw new InputError(`datasets contains unknown value "${String(d)}"`);
    }
    const datasets = ALL_DATASETS.filter((d) => datasetsRaw.includes(d));

    let dateFrom = resolveDate(raw.dateFrom, now, 'dateFrom');
    if (!dateFrom && raw.dateRange) {
        dateFrom = resolveDate(raw.dateRange, now, 'dateRange');
        log.warning(`dateRange is deprecated - use dateFrom (interpreted as dateFrom=${dateFrom}).`);
    }
    const dateTo = resolveDate(raw.dateTo, now, 'dateTo');
    if (dateFrom && dateTo && dateFrom > dateTo) throw new InputError('dateFrom is after dateTo');

    const minFine = money(raw.minTotalFineGbp, 'minTotalFineGbp');
    const maxFine = money(raw.maxTotalFineGbp, 'maxTotalFineGbp');
    if (minFine !== null && maxFine !== null && minFine > maxFine) {
        throw new InputError('minTotalFineGbp is greater than maxTotalFineGbp');
    }

    const noticeTypes = [
        ...new Set(
            (Array.isArray(raw.noticeTypes) ? raw.noticeTypes : [])
                .map((t) => String(t).trim())
                .filter((t) => t !== '')
                .map((t) => (t.length === 1 ? `0${t}` : t)),
        ),
    ].sort();
    for (const t of noticeTypes) {
        if (!NOTICE_TYPES[t]) throw new InputError(`noticeTypes contains unknown code "${t}" (valid: 01-09)`);
    }

    const filters: ResolvedFilters = {
        nameContains: text(raw.nameContains),
        descriptionContains: text(raw.descriptionContains),
        localAuthorityContains: text(raw.localAuthorityContains),
        mainActivityContains: text(raw.mainActivityContains),
        region: code(raw.region, REGIONS, 'region'),
        country: code(raw.country, COUNTRIES, 'country'),
        industry: code(raw.industry, INDUSTRIES, 'industry'),
        hseDivision: code(raw.hseDivision, HSE_DIVISIONS, 'hseDivision'),
        dateFrom,
        dateTo,
        hseReference: digits(raw.hseReference, 'hseReference'),
        recordNumber: digits(raw.recordNumber, 'recordNumber'),
        defendantStatus: code(raw.defendantStatus, DEFENDANT_STATUSES, 'defendantStatus'),
        resultingFromFatality: tri(raw.resultingFromFatality, 'resultingFromFatality'),
        minTotalFineGbp: minFine,
        maxTotalFineGbp: maxFine,
        noticeTypes,
        act: code(raw.act, ACTS, 'act'),
    };
    for (const [field, value] of Object.entries(filters)) {
        if (typeof value === 'string' && sanitizeFreeText(value) === '' && /Contains$/.test(field)) {
            throw new InputError(`${field} contains no searchable characters`);
        }
    }

    const convOnly = ['defendantStatus', 'resultingFromFatality', 'minTotalFineGbp', 'maxTotalFineGbp'] as const;
    if (!datasets.includes('convictions')) {
        for (const k of convOnly) {
            if (filters[k] !== null) log.warning(`${k} only applies to the convictions register - ignored.`);
        }
    }
    if (!datasets.includes('notices')) {
        if (filters.noticeTypes.length > 0) log.warning('noticeTypes only applies to the notices register - ignored.');
        if (filters.act) log.warning('act only applies to the notices register - ignored.');
    }

    const eventTypesRaw = Array.isArray(raw.eventTypes) && raw.eventTypes.length > 0 ? raw.eventTypes : ALL_EVENT_TYPES;
    for (const t of eventTypesRaw) {
        if (!ALL_EVENT_TYPES.includes(t)) throw new InputError(`eventTypes contains unknown value "${String(t)}"`);
    }

    const maxItemsRaw =
        raw.maxItemsPerDataset === undefined || raw.maxItemsPerDataset === null ? 100 : Number(raw.maxItemsPerDataset);
    if (!Number.isFinite(maxItemsRaw) || maxItemsRaw < 1) {
        throw new InputError('maxItemsPerDataset must be a positive integer');
    }
    const maxItems = Math.min(Math.floor(maxItemsRaw), MAX_ITEMS_HARD_CAP);
    const concurrencyRaw =
        raw.maxConcurrency === undefined || raw.maxConcurrency === null ? 5 : Number(raw.maxConcurrency);
    const maxConcurrency = Math.max(
        1,
        Math.min(MAX_CONCURRENCY_HARD_CAP, Math.floor(Number.isFinite(concurrencyRaw) ? concurrencyRaw : 5)),
    );
    const recheckRaw = raw.recheckDays === undefined || raw.recheckDays === null ? 180 : Number(raw.recheckDays);
    if (!Number.isFinite(recheckRaw) || recheckRaw < 0)
        throw new InputError('recheckDays must be 0 or a positive integer');
    const recheckDays = Math.min(Math.floor(recheckRaw), MAX_RECHECK_DAYS);

    const fetchDetail = raw.fetchDetail !== false;
    const fetchBreachDetail = fetchDetail && raw.fetchBreachDetail !== false;
    const fetchPartyDetail = fetchDetail && raw.fetchPartyDetail !== false;
    if (!fetchDetail && (raw.fetchBreachDetail === true || raw.fetchPartyDetail === true)) {
        log.warning('fetchDetail=false - breach and party pages are not fetched either (listing-only records).');
    }

    const queries: Record<DatasetName, RegisterQuery> = {
        convictions: {
            register: 'convictions',
            criteria: criteriaFor('convictions', filters),
            sort: WALK_SORT.convictions,
        },
        notices: { register: 'notices', criteria: criteriaFor('notices', filters), sort: WALK_SORT.notices },
    };

    // Everything that changes which rows come back - but not how many
    // (maxItems), how rich they are (fetch* flags) or which registers are
    // walked (each register has its own map inside the store) - names the
    // delta store. A recency window moves every day and must not fork it.
    const signatureSource = JSON.stringify({
        ...filters,
        dateFrom: null,
        dateTo: null,
        eventTypes: [...eventTypesRaw].sort(),
    });
    const filtersSignature = shortHash(signatureSource);
    const hasFilters = Object.entries(filters).some(([k, v]) => {
        if (k === 'dateFrom' || k === 'dateTo') return false;
        return Array.isArray(v) ? v.length > 0 : v !== null;
    });
    const deltaStateName = text(raw.deltaStateName) ?? `auto-${filtersSignature}`;
    if (!/^[A-Za-z0-9-]{1,30}$/.test(deltaStateName)) {
        throw new InputError('deltaStateName must be 1-30 letters, digits or hyphens');
    }

    return {
        queries,
        options: {
            datasets,
            maxItems,
            fetchDetail,
            fetchBreachDetail,
            fetchPartyDetail,
            onlyNew: raw.onlyNew === true,
            recheckDays,
            maxConcurrency,
            eventTypes: new Set(eventTypesRaw),
            deltaStateName,
            resetState: raw.resetState === true,
        },
        filtersSignature,
        hasFilters,
    };
}
