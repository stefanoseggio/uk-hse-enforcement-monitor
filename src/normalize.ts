// Pure normalisation helpers for the raw strings the HSE registers render.
// Every function is total: invalid input yields null, never throws.
import { createHash } from 'node:crypto';

// The registers only ever show civil dates (DD/MM/YYYY, no time-of-day),
// entered by HSE staff in the UK. "Today" for day counts and relative date
// windows is therefore the calendar date in London, not UTC.
export const SITE_TIME_ZONE = 'Europe/London';

const siteDateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) of an instant as seen from London. */
export function siteCalendarDate(instant: Date): string {
    const parts = Object.fromEntries(siteDateParts.formatToParts(instant).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

/** "26/09/2025" -> "2025-09-26" (the register's only date format). */
export function parseUkDate(value: string | null | undefined): string | null {
    if (!value) return null;
    const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    const [, d, m, y] = match.map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "2025-09-26" -> "26/09/2025" (the format the search criteria expect). */
export function isoToSiteDate(isoDate: string): string {
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
}

/** Shift an ISO date by whole days (UTC arithmetic on a date-only value). */
export function addDays(isoDate: string, days: number): string {
    const [y, m, d] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/** Signed whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: string | null, toIso: string | null): number | null {
    if (!fromIso || !toIso) return null;
    const a = Date.parse(`${fromIso}T00:00:00Z`);
    const b = Date.parse(`${toIso}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / 86_400_000);
}

/** "£1,000.00" / "20,000.00" / "£0.00" -> 1000 / 20000 / 0. */
export function parseGbp(value: string | null | undefined): number | null {
    if (!value) return null;
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : null;
}

/** "38320 - RECOVERY OF SORTED MATERIALS" -> { code: "38320", description: "RECOVERY OF SORTED MATERIALS" }. */
export function splitSic(value: string | null | undefined): { code: string | null; description: string | null } {
    if (!value) return { code: null, description: null };
    const match = value.trim().match(/^(\d{4,5})\s*-\s*(.+)$/);
    if (!match) return { code: null, description: value.trim() || null };
    return { code: match[1], description: match[2].trim() || null };
}

// UK postcode (outward + inward), tolerant of the register's spacing quirks
// ("S W17" is rendered for SW17 in at least one record; that one is left as is).
const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const OUTWARD_ONLY_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\b(?=\s*(?:,|$))/i;

/** Full postcode if present, else the outward code alone (e.g. "UB9"), else null. */
export function extractPostcode(address: string | null | undefined): string | null {
    if (!address) return null;
    const full = address.match(POSTCODE_RE);
    if (full) return `${full[1].toUpperCase()} ${full[2].toUpperCase()}`;
    const outward = address.match(OUTWARD_ONLY_RE);
    return outward ? outward[1].toUpperCase() : null;
}

const COUNTRIES = ['England', 'Scotland', 'Wales', 'Jersey', 'Northern Ireland', 'Guernsey', 'Isle of Man'];

/** The register ends every offence address with the country name. */
export function extractCountry(address: string | null | undefined): string | null {
    if (!address) return null;
    const parts = address
        .split(/,\s*/)
        .map((p) => p.trim())
        .filter(Boolean);
    const last = parts.at(-1);
    if (!last) return null;
    const hit = COUNTRIES.find((c) => c.toLowerCase() === last.toLowerCase());
    return hit ?? null;
}

/**
 * "Employers Liability Compulsory Insurance Act 1969, Section 1, Sub Section 1"
 * -> { name, section: "1", subSection: "1" }.
 */
export function parseActReference(value: string | null | undefined): {
    name: string | null;
    section: string | null;
    subSection: string | null;
} {
    if (!value || !value.trim()) return { name: null, section: null, subSection: null };
    const parts = value.split(',').map((p) => p.trim());
    const name = parts[0] || null;
    let section: string | null = null;
    let subSection: string | null = null;
    for (const part of parts.slice(1)) {
        const sub = part.match(/^Sub\s*Section\s+(.+)$/i);
        const sec = part.match(/^Section\s+(.+)$/i);
        if (sub) subSection = sub[1].trim() || null;
        else if (sec) section = sec[1].trim() || null;
    }
    return { name, section, subSection };
}

/**
 * "Construction (Design and Management) Regulations 2015 (No 15) para 2"
 * -> { name, number: "15", paragraph: "2" }.
 */
export function parseRegulationReference(value: string | null | undefined): {
    name: string | null;
    number: string | null;
    paragraph: string | null;
} {
    if (!value || !value.trim()) return { name: null, number: null, paragraph: null };
    const match = value.trim().match(/^(.*?)\s*(?:\(No\s+([^)]+)\))?\s*(?:para\s+(.+))?$/i);
    if (!match) return { name: value.trim(), number: null, paragraph: null };
    return {
        name: match[1].trim() || null,
        number: match[2]?.trim() || null,
        paragraph: match[3]?.trim() || null,
    };
}

/** Notices breach rows: "Health and Safety At Work Act 1974 / 2 / " -> { legislation, provision: "2", paragraph: null }. */
export function splitNoticeBreach(value: string | null | undefined): {
    legislation: string | null;
    provision: string | null;
    paragraph: string | null;
} {
    if (!value) return { legislation: null, provision: null, paragraph: null };
    const parts = value.split('/').map((p) => p.trim());
    return {
        legislation: parts[0] || null,
        provision: parts[1] || null,
        paragraph: parts[2] || null,
    };
}

export type ResultCategory = 'fine' | 'custodial' | 'suspended_custodial' | 'no_separate_penalty' | 'other';

/**
 * Breach results appear as "Fine", "Prison Suspended", "No Sep Penalty" on
 * breach pages and "Guilty-Fine" etc. on breach lists; both forms are mapped.
 */
export function classifyBreachResult(result: string | null | undefined): ResultCategory | null {
    if (!result) return null;
    const r = result.toLowerCase();
    if (r.includes('suspend')) return 'suspended_custodial';
    if (/prison|custod|imprison|detention/.test(r)) return 'custodial';
    if (r.includes('fine')) return 'fine';
    if (r.includes('no sep')) return 'no_separate_penalty';
    return 'other';
}

export type PartyEntityType = 'company' | 'individual' | 'partnership' | 'public_body' | 'other';

/** Party Status ("Private Company", "Individual", "Self Employed (Sole Trader)", ...) -> coarse entity class. */
export function classifyPartyStatus(status: string | null | undefined): PartyEntityType | null {
    if (!status) return null;
    const s = status.toLowerCase();
    if (/individual|sole trader|self employed/.test(s)) return 'individual';
    if (/company|limited liability/.test(s)) return 'company';
    if (s.includes('partnership')) return 'partnership';
    if (/government|authority|nhs|crown|police|council/.test(s)) return 'public_body';
    return 'other';
}

export interface NoticeTypeFlags {
    category: 'Improvement' | 'Prohibition' | null;
    isProhibition: boolean | null;
    isImprovement: boolean | null;
    isImmediate: boolean | null;
    isDeferred: boolean | null;
    isCrown: boolean | null;
    isComah: boolean | null;
    isFepa: boolean | null;
}

/** Notice type text ("Immediate Prohibition Notice", "Prohibition Notice Immediate", "Improvement Notice") -> flags. */
export function classifyNoticeType(value: string | null | undefined): NoticeTypeFlags {
    if (!value) {
        return {
            category: null,
            isProhibition: null,
            isImprovement: null,
            isImmediate: null,
            isDeferred: null,
            isCrown: null,
            isComah: null,
            isFepa: null,
        };
    }
    const v = value.toLowerCase();
    const isProhibition = v.includes('prohibition');
    const isImprovement = v.includes('improvement');
    let category: NoticeTypeFlags['category'] = null;
    if (isProhibition) category = 'Prohibition';
    else if (isImprovement) category = 'Improvement';
    return {
        category,
        isProhibition,
        isImprovement,
        isImmediate: isProhibition ? v.includes('immediate') : false,
        isDeferred: isProhibition ? v.includes('deferred') : false,
        isCrown: v.includes('crown'),
        isComah: v.includes('comah'),
        isFepa: v.includes('fepa'),
    };
}

/** Notice results seen live: "Ongoing", "Complied with", blank (prohibition notices carry no result at all). */
export function isOpenNoticeResult(result: string | null | undefined): boolean {
    if (!result) return true;
    return /^ongoing$/i.test(result.trim());
}

/** Per-item notice numbers embedded in multi-item descriptions ("IN/090626/LPEC/MG20 - 316005195"). */
export function extractNoticeItemIds(description: string | null | undefined): string[] {
    if (!description) return [];
    const ids = new Set<string>();
    for (const match of description.matchAll(/\b(\d{9})\b/g)) ids.add(match[1]);
    return [...ids];
}

/** Stable short hash (FNV-1a) used to derive a delta-state store name from the filter set. */
export function shortHash(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        // eslint-disable-next-line no-bitwise
        h ^= input.charCodeAt(i);
        // eslint-disable-next-line no-bitwise
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** Content hash (SHA-1, 16 hex chars) of a canonical JSON serialisation - the delta engine's change key. */
export function contentHash(value: unknown): string {
    return createHash('sha1').update(canonicalJson(value)).digest('hex').slice(0, 16);
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return `{${Object.keys(obj)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/** Free-text criterion values are interpolated into SQL by the site; quotes break the query (verified: O'Brien -> SQL error page). */
export function sanitizeFreeText(value: string): string {
    // `_` is the single-character LIKE wildcard, so "O_Brien" still matches "O'Brien".
    // A literal "+" would be decoded as a space by the site, so it becomes a wildcard too.
    return value
        .replace(/['"`+]/g, '_')
        .replace(/[\\;|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Orders register ids (case / notice numbers) the way the site's entry-order
 * sort does: numerically. Both registers use plain decimal ids, but a
 * non-numeric id falls back to a string comparison rather than NaN.
 */
export function compareRecordIds(a: string, b: string): number {
    const numeric = /^\d+$/.test(a) && /^\d+$/.test(b);
    if (numeric) {
        const ta = a.replace(/^0+(?=\d)/, '');
        const tb = b.replace(/^0+(?=\d)/, '');
        if (ta.length !== tb.length) return ta.length - tb.length;
        return ta.localeCompare(tb, 'en');
    }
    return a.localeCompare(b, 'en');
}

/** The lowest id of a set (null for an empty set) - the top of a coverage gap in a newest-first walk. */
export function lowestRecordId(ids: readonly (string | null | undefined)[]): string | null {
    let lowest: string | null = null;
    for (const id of ids) {
        if (!id) continue;
        if (lowest === null || compareRecordIds(id, lowest) < 0) lowest = id;
    }
    return lowest;
}
