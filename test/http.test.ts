import { describe, expect, it } from 'vitest';

import { classifyFinalError, HttpError, UpstreamOutageError } from '../src/http.js';

// Node's native fetch (undici) throws `TypeError('fetch failed', { cause })`
// on a connect-phase failure; `cause` is the raw Node.js system error, whose
// real shape (verified live against this Actor's own actual failed runs,
// 2026-09-14 and 2026-09-15) is a plain object with `.code`, `.address`,
// `.port`, `.syscall` - not necessarily `instanceof Error`.
function fakeConnectError(code: string, address: string, port: number): TypeError {
    const cause = { code, address, port, syscall: 'connect', message: `connect ${code} ${address}:${port}` };
    return new TypeError('fetch failed', { cause });
}

describe('classifyFinalError', () => {
    it('wraps a real EHOSTUNREACH connect failure as UpstreamOutageError with the exact required message format', () => {
        const raw = fakeConnectError('EHOSTUNREACH', '82.1.184.72', 443);
        const result = classifyFinalError(raw, 'https://resources.hse.gov.uk/convictions/case/case_list.asp?PN=1');

        expect(result).toBeInstanceOf(UpstreamOutageError);
        const outage = result as UpstreamOutageError;
        expect(outage.host).toBe('resources.hse.gov.uk');
        expect(outage.address).toBe('82.1.184.72');
        expect(outage.networkCode).toBe('EHOSTUNREACH');
        expect(outage.cause).toBe(raw);
        expect(outage.message).toBe(
            '[UPSTREAM_OUTAGE] UK HSE register target (resources.hse.gov.uk / 82.1.184.72) is unreachable at network level (EHOSTUNREACH). Outage is external to Actor codebase.',
        );
    });

    it('wraps ECONNREFUSED the same way', () => {
        const raw = fakeConnectError('ECONNREFUSED', '82.1.184.72', 443);
        const result = classifyFinalError(raw, 'https://resources.hse.gov.uk/notices/notices/notice_list.asp?PN=1');
        expect(result).toBeInstanceOf(UpstreamOutageError);
        expect((result as UpstreamOutageError).networkCode).toBe('ECONNREFUSED');
    });

    it('wraps ETIMEDOUT the same way', () => {
        const raw = fakeConnectError('ETIMEDOUT', '82.1.184.72', 443);
        const result = classifyFinalError(raw, 'https://resources.hse.gov.uk/convictions/case/case_list.asp?PN=1');
        expect(result).toBeInstanceOf(UpstreamOutageError);
        expect((result as UpstreamOutageError).networkCode).toBe('ETIMEDOUT');
    });

    it('does not reclassify an HttpError (a real HTTP response, not a connect-phase failure)', () => {
        const httpError = new HttpError(500, 'https://resources.hse.gov.uk/convictions/case/case_details.asp?SV=1');
        const result = classifyFinalError(httpError, 'https://resources.hse.gov.uk/convictions/case/case_details.asp?SV=1');
        expect(result).toBe(httpError);
        expect(result).not.toBeInstanceOf(UpstreamOutageError);
    });

    it('does not reclassify an unrelated network error code (e.g. ECONNRESET - a reachable-but-dropped connection, not an outage)', () => {
        const raw = fakeConnectError('ECONNRESET', '82.1.184.72', 443);
        const result = classifyFinalError(raw, 'https://resources.hse.gov.uk/convictions/case/case_list.asp?PN=1');
        expect(result).toBe(raw);
        expect(result).not.toBeInstanceOf(UpstreamOutageError);
    });

    it('does not reclassify a plain error with no cause at all', () => {
        const plain = new Error('unreachable');
        const result = classifyFinalError(plain, 'https://resources.hse.gov.uk/convictions/case/case_list.asp?PN=1');
        expect(result).toBe(plain);
    });
});
