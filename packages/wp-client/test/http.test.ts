import { describe, expect, it, vi } from 'vitest';
import { WpClientError, fetchJsonWithRetry } from '../src/http.ts';

const ok = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const noSleep = () => Promise.resolve();

describe('fetchJsonWithRetry', () => {
	it('returns parsed json on success', async () => {
		const fetchFn = vi.fn(async () => ok({ a: 1 }));
		await expect(fetchJsonWithRetry('http://x/y', { fetchFn, sleepFn: noSleep })).resolves.toEqual({ a: 1 });
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('retries on 500 then succeeds', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(new Response('boom', { status: 500 }))
			.mockResolvedValueOnce(ok({ a: 2 }));
		await expect(fetchJsonWithRetry('http://x/y', { fetchFn, sleepFn: noSleep })).resolves.toEqual({ a: 2 });
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('retries on network error then succeeds', async () => {
		const fetchFn = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(ok({ a: 3 }));
		await expect(fetchJsonWithRetry('http://x/y', { fetchFn, sleepFn: noSleep })).resolves.toEqual({ a: 3 });
	});

	it('gives up after 3 attempts and throws WpClientError', async () => {
		const fetchFn = vi.fn(async () => new Response('boom', { status: 503 }));
		await expect(fetchJsonWithRetry('http://x/y', { fetchFn, sleepFn: noSleep })).rejects.toBeInstanceOf(WpClientError);
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	it('does NOT retry on 404', async () => {
		const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
		const err = await fetchJsonWithRetry('http://x/y', { fetchFn, sleepFn: noSleep }).catch((e) => e);
		expect(err).toBeInstanceOf(WpClientError);
		expect(err.status).toBe(404);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('backs off exponentially: 250ms then 1000ms', async () => {
		const delays: number[] = [];
		const fetchFn = vi.fn(async () => new Response('boom', { status: 500 }));
		await fetchJsonWithRetry('http://x/y', { fetchFn, sleepFn: async (ms) => void delays.push(ms) }).catch(() => {});
		expect(delays).toEqual([250, 1000]);
	});
});
