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

/** The three low-level connect-phase error codes that mean "the target host itself is unreachable", as opposed to a slow or malformed response from a reachable one. */
const OUTAGE_NETWORK_CODES = new Set(['EHOSTUNREACH', 'ECONNREFUSED', 'ETIMEDOUT']);

/**
 * Node's native fetch (undici) throws `TypeError('fetch failed', { cause })`
 * on a connect-phase failure, where `cause` is the raw Node.js system error -
 * a plain object (not always `instanceof Error`) carrying `.code`, and for
 * connect errors specifically, `.address`/`.port`.
 */
function networkErrorCause(error: unknown): Record<string, unknown> | undefined {
    if (!(error instanceof Error)) return undefined;
    const { cause } = error as { cause?: unknown };
    return cause && typeof cause === 'object' ? (cause as Record<string, unknown>) : undefined;
}

function networkErrorCode(error: unknown): string | undefined {
    const { code } = networkErrorCause(error) ?? {};
    return typeof code === 'string' ? code : undefined;
}

function networkErrorAddress(error: unknown): string | undefined {
    const { address } = networkErrorCause(error) ?? {};
    return typeof address === 'string' ? address : undefined;
}

/**
 * Thrown by `fetchWithRetry` in place of the raw network error once retries
 * are exhausted, when the underlying failure is one of `OUTAGE_NETWORK_CODES`.
 * Lets `main.ts` classify "the HSE register itself is unreachable" separately
 * from an actual code regression (a selector break, a schema change, an
 * unhandled promise rejection) - both currently surface as a generic "Run
 * failed" otherwise, which reads identically to a real bug in this Actor's
 * own code when it is not one.
 */
export class UpstreamOutageError extends Error {
    constructor(
        public readonly host: string,
        public readonly address: string | undefined,
        public readonly networkCode: string,
        public override readonly cause: Error,
    ) {
        super(
            `[UPSTREAM_OUTAGE] UK HSE register target (${host}${address ? ` / ${address}` : ''}) is unreachable at network level (${networkCode}). Outage is external to Actor codebase.`,
        );
        this.name = 'UpstreamOutageError';
    }
}

/** Wraps `error` as `UpstreamOutageError` when its cause is a connect-phase outage code; otherwise returns it unchanged. Exported for direct unit testing (see test/http.test.ts) without needing to mock global fetch. */
export function classifyFinalError(error: Error, url: string): Error {
    const code = networkErrorCode(error);
    if (!code || !OUTAGE_NETWORK_CODES.has(code)) return error;
    return new UpstreamOutageError(new URL(url).host, networkErrorAddress(error), code, error);
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

// ---------------------------------------------------------------------------
// Global in-flight limit
// ---------------------------------------------------------------------------

/**
 * One request budget for the whole run. Record enrichment fans out (a case
 * page + its breach list + up to N breach pages + party page + two party
 * history lists), so per-record concurrency alone would put several times
 * `maxConcurrency` requests in flight. Every fetch takes a slot here, so the
 * TOTAL number of requests in flight never exceeds the configured limit
 * (default 5, `maxConcurrency` input, hard cap 10). Slots are held only for
 * the duration of one HTTP round trip - never across nested awaits - so the
 * limiter cannot deadlock.
 */
class Semaphore {
    private active = 0;
    private readonly waiting: (() => void)[] = [];

    constructor(public limit: number) {}

    async acquire(): Promise<void> {
        if (this.active < this.limit) {
            this.active += 1;
            return;
        }
        await new Promise<void>((resolve) => {
            this.waiting.push(resolve);
        });
        this.active += 1;
    }

    release(): void {
        this.active -= 1;
        const next = this.waiting.shift();
        if (next) next();
    }

    get inFlight(): number {
        return this.active;
    }
}

export const DEFAULT_MAX_IN_FLIGHT = 5;
const limiter = new Semaphore(DEFAULT_MAX_IN_FLIGHT);

/** Sets the run-wide cap on simultaneous HTTP requests (main.ts calls it with `maxConcurrency`). */
export function setMaxInFlightRequests(limit: number): void {
    limiter.limit = Math.max(1, Math.floor(limit));
}

/** Requests currently in flight (exposed for tests). */
export function inFlightRequests(): number {
    return limiter.inFlight;
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
        await limiter.acquire();
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
        } finally {
            limiter.release();
        }
        if (attempt < maxRetries) {
            const delay = Math.min(baseDelayMs * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
            log.debug(`Retrying ${url} in ${delay}ms after: ${lastError.message}`);
            await sleep(delay);
        }
    }
    throw classifyFinalError(lastError, url);
}

/** Retries before a 500 on a record page is taken as "record missing" (3 attempts over ~3 s). */
export const OPTIONAL_FETCH_RETRIES = 2;

/**
 * Like fetchWithRetry but resolves to null when the record is gone. The
 * site answers HTTP 500 (not 404) for an unknown case/notice/breach id
 * (verified live: SV=1 -> the generic IIS "500 - Internal server error"
 * page, identical for cases and notices), so for record pages a 500 that
 * survives the retries is treated as "missing" rather than as an outage -
 * one withdrawn record then degrades instead of aborting the run.
 *
 * Because that 500 is indistinguishable from a transient server error, the
 * callers never treat a single NOT_FOUND as final: delivery defers such
 * records to the next run(s) and the re-check needs two runs before it
 * stops tracking a record (see delivery.ts / fetchRecords.ts), and a batch
 * where too many listed records "vanish" at once fails the run.
 */
export async function fetchOptional(path: string, options: FetchOptions = {}): Promise<string | null> {
    try {
        return await fetchWithRetry(path, { maxRetries: OPTIONAL_FETCH_RETRIES, ...options });
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
