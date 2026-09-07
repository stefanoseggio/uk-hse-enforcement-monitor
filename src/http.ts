import { log } from 'apify';

import { absoluteUrl } from './urls.js';

// resources.hse.gov.uk is a classic-ASP site on IIS 7.5 with no WAF, no
// JavaScript challenge and no required cookie (verified live 2026-09-07: a
// request with no User-Agent at all still gets HTTP 200). A browser UA is
// sent anyway so the site's logs identify a normal client. Native fetch(),
// no proxy.
const BROWSER_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
};

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly url: string,
    ) {
        super(`HTTP ${status} for ${url}`);
        this.name = 'HttpError';
    }
}

export interface FetchOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
}

const DEFAULTS: Required<FetchOptions> = {
    maxRetries: 4,
    baseDelayMs: 1000,
    // Pages answer in 0.3-2.5 s; the register has no slow "deep page" case
    // because a page past the end is a cheap empty page.
    timeoutMs: 30_000,
};

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function isRetriableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * GET a site path and return the body. Retries with jittered exponential
 * backoff on network errors, timeouts, 408/425/429 and 5xx; every other
 * status is deterministic and surfaces immediately as HttpError so the
 * caller can decide (fail the run vs. degrade one record).
 */
export async function fetchWithRetry(path: string, options: FetchOptions = {}): Promise<string> {
    const { maxRetries, baseDelayMs, timeoutMs } = { ...DEFAULTS, ...options };
    const url = absoluteUrl(path);
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                headers: BROWSER_HEADERS,
                redirect: 'follow',
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (response.ok) return await response.text();
            if (!isRetriableStatus(response.status)) throw new HttpError(response.status, url);
            lastError = new HttpError(response.status, url);
        } catch (error) {
            if (error instanceof HttpError && !isRetriableStatus(error.status)) throw error;
            lastError = error instanceof Error ? error : new Error(String(error));
        }
        if (attempt < maxRetries) {
            const delay = Math.min(baseDelayMs * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
            log.debug(`Retrying ${url} in ${delay}ms after: ${lastError.message}`);
            await sleep(delay);
        }
    }
    throw lastError;
}

/**
 * Like fetchWithRetry but resolves to null when the record is gone. The
 * site answers HTTP 500 (not 404) for an unknown case/notice/breach id
 * (verified live: SV=1 -> 500), so for record pages a 500 that survives one
 * retry is treated as "missing" rather than as an outage - one withdrawn
 * record then degrades instead of aborting the run.
 */
export async function fetchOptional(path: string, options: FetchOptions = {}): Promise<string | null> {
    try {
        return await fetchWithRetry(path, { maxRetries: 1, ...options });
    } catch (error) {
        if (error instanceof HttpError && (error.status === 404 || error.status === 410 || error.status === 500)) {
            return null;
        }
        throw error;
    }
}

/**
 * Run `fn` over `items` with at most `concurrency` calls in flight, preserving
 * input order in the result. Errors propagate after in-flight calls settle.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    let firstError: unknown = null;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
        while (next < items.length && firstError === null) {
            const index = next++;
            try {
                results[index] = await fn(items[index], index);
            } catch (error) {
                firstError ??= error;
            }
        }
    });
    await Promise.all(workers);
    if (firstError !== null) throw firstError;
    return results;
}
