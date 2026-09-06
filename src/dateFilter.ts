export type DateRangePreset = '24h' | '7d' | '30d';

const WINDOW_MS: Record<DateRangePreset, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};

// Both HSE date fields (Offence Date, served-on date) are rendered as
// DD/MM/YYYY - verified against real fixtures.
export function parseUkDate(value: string | null): Date | null {
    if (!value) return null;
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
}

export function isWithinDateRange(date: Date | null, preset: DateRangePreset | undefined, now: Date): boolean {
    if (!preset) return true;
    if (!date) return false;
    return now.getTime() - date.getTime() <= WINDOW_MS[preset];
}
