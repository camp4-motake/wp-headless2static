const redact = (url: string) => url.replace(/([?&]token=)[^&]+/g, '$1***');

export class WpClientError extends Error {
	constructor(
		message: string,
		public readonly url: string,
		public readonly status: number | null,
	) {
		super(message);
		this.name = 'WpClientError';
	}
}

export interface RetryOptions {
	fetchFn?: typeof fetch;
	retries?: number;
	baseDelayMs?: number;
	sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchJsonWithRetry<T>(url: string, opts: RetryOptions = {}): Promise<T> {
	const { fetchFn = fetch, retries = 3, baseDelayMs = 250, sleepFn = defaultSleep } = opts;
	let lastError: WpClientError | null = null;

	for (let attempt = 0; attempt < retries; attempt++) {
		if (attempt > 0) {
			await sleepFn(baseDelayMs * 4 ** (attempt - 1));
		}
		try {
			const res = await fetchFn(url);
			if (res.ok) {
				return (await res.json()) as T;
			}
			const err = new WpClientError(`HTTP ${res.status} for ${redact(url)}`, url, res.status);
			if (res.status >= 400 && res.status < 500) {
				throw err; // client errors are not retryable
			}
			lastError = err;
		} catch (e) {
			if (e instanceof WpClientError && e.status !== null && e.status < 500) {
				throw e;
			}
			lastError = e instanceof WpClientError ? e : new WpClientError(`network error for ${redact(url)}: ${String(e)}`, url, null);
		}
	}
	throw lastError ?? new WpClientError(`unreachable: ${redact(url)}`, url, null);
}
