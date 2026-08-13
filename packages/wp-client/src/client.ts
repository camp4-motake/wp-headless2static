import type { Page, Post, PreviewData, Work } from '@repo/shared';
import { fetchJsonWithRetry, WpClientError, type RetryOptions } from './http.ts';
import { mapPage, mapPost, mapWork, type WpRestPost } from './map.ts';

export interface WpClientOptions {
	baseUrl: string;
	fetchFn?: typeof fetch;
	sleepFn?: RetryOptions['sleepFn'];
}

const PER_PAGE = 100;
const MAX_PAGES = 100;

export function createWpClient({ baseUrl, fetchFn, sleepFn }: WpClientOptions) {
	const base = baseUrl.replace(/\/$/, '');
	const opts: RetryOptions = { fetchFn, sleepFn };

	async function allPages<T>(path: string, map: (p: WpRestPost) => T): Promise<T[]> {
		const out: T[] = [];
		for (let page = 1; ; page++) {
			if (page > MAX_PAGES) {
				throw new WpClientError(`pagination exceeded ${MAX_PAGES} pages for ${path} — endpoint may be ignoring the page param`, path, null);
			}
			let batch: WpRestPost[];
			try {
				batch = await fetchJsonWithRetry<WpRestPost[]>(
					`${base}${path}per_page=${PER_PAGE}&page=${page}`,
					opts,
				);
			} catch (e) {
				// WP REST returns 400 (rest_post_invalid_page_number) once `page`
				// exceeds the collection's last page — treat that as end-of-collection
				// rather than an error, but only past page 1 (a 400 on the first
				// page is a real failure).
				if (page > 1 && e instanceof WpClientError && e.status === 400) {
					return out;
				}
				throw e;
			}
			out.push(...batch.map(map));
			if (batch.length < PER_PAGE) {
				return out;
			}
		}
	}

	return {
		health: () => fetchJsonWithRetry<{ version: string }>(`${base}/wp-json/headless-bridge/v1/health`, opts),
		getAllPosts: () => allPages('/wp-json/wp/v2/posts?_embed=1&', mapPost),
		getAllPages: () => allPages('/wp-json/wp/v2/pages?', mapPage),
		getAllWorks: () => allPages('/wp-json/wp/v2/works?_embed=1&', mapWork),
		getPreview: (id: number, token: string) =>
			fetchJsonWithRetry<PreviewData>(
				`${base}/wp-json/headless-bridge/v1/preview/${id}?token=${encodeURIComponent(token)}`,
				opts,
			),
	};
}

export type WpClient = ReturnType<typeof createWpClient>;
