async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

// resources.hse.gov.uk is fully stateless for these registers - verified
// live 2026-09-05/06: no session cookie is required (a bare curl with zero
// prior requests and zero cookies returns the exact same result set as one
// warmed up with a session), no Cloudflare/WAF, robots.txt on this exact
// subdomain 404s (no restrictions declared). Native fetch(), no proxy.
const BASE_URL = 'https://resources.hse.gov.uk';

export async function fetchWithRetry(path: string, maxRetries = 4, baseDelayMs = 1000): Promise<string> {
    const url = `${BASE_URL}${path}`;
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, { redirect: 'follow' });
            if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
            return await response.text();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries) {
                await sleep(baseDelayMs * 2 ** attempt);
            }
        }
    }
    throw lastError;
}
