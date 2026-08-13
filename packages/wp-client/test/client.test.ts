import { describe, expect, it, vi } from 'vitest';
import { createWpClient } from '../src/client.ts';
import { WpClientError } from '../src/http.ts';

const json = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const WP_POST = {
	id: 1,
	slug: 'hello',
	date_gmt: '2026-01-01T00:00:00',
	modified_gmt: '2026-01-02T00:00:00',
	title: { rendered: 'Hello' },
	content: { rendered: '<p>Body</p>' },
	excerpt: { rendered: '<p>Ex</p>' },
	_embedded: {
		'wp:featuredmedia': [{ source_url: 'http://x/img.jpg', alt_text: 'Alt' }],
		'wp:term': [
			[{ id: 2, name: 'News', slug: 'news', taxonomy: 'category' }],
			[{ id: 3, name: 'T', slug: 't', taxonomy: 'post_tag' }],
		],
	},
};

function clientWith(handler: (url: string) => Response | Promise<Response>) {
	return createWpClient({ baseUrl: 'http://wp', fetchFn: vi.fn(async (u: RequestInfo | URL) => handler(String(u))) });
}

describe('createWpClient', () => {
	it('maps posts incl. featured image and terms', async () => {
		const client = clientWith(() => json([WP_POST]));
		const posts = await client.getAllPosts();
		expect(posts).toHaveLength(1);
		expect(posts[0]).toMatchObject({
			id: 1,
			slug: 'hello',
			title: 'Hello',
			content: '<p>Body</p>',
			featuredImage: { url: 'http://x/img.jpg', alt: 'Alt' },
			categories: [{ id: 2, name: 'News', slug: 'news' }],
			tags: [{ id: 3, name: 'T', slug: 't' }],
		});
	});

	it('paginates until a short page', async () => {
		const page1 = Array.from({ length: 100 }, (_, i) => ({ ...WP_POST, id: i + 1, slug: `p${i + 1}` }));
		const calls: string[] = [];
		const client = clientWith((url) => {
			calls.push(url);
			return json(url.includes('page=2') ? [WP_POST] : page1);
		});
		const posts = await client.getAllPosts();
		expect(posts).toHaveLength(101);
		expect(calls[0]).toContain('page=1');
		expect(calls[1]).toContain('page=2');
	});

	it('maps works meta and handles missing featured media', async () => {
		const work = { ...WP_POST, _embedded: {}, meta: { client_name: 'ACME Inc.', project_url: 'https://example.com' } };
		const client = clientWith(() => json([work]));
		const works = await client.getAllWorks();
		expect(works[0].featuredImage).toBeNull();
		expect(works[0].meta).toEqual({ client_name: 'ACME Inc.', project_url: 'https://example.com' });
	});

	it('getPreview hits the headless-bridge endpoint with encoded token', async () => {
		const calls: string[] = [];
		const client = clientWith((url) => {
			calls.push(url);
			return json({ id: 9, type: 'post', title: 'D', content: '<p>d</p>', excerpt: '', date: '', modified: '', featured_image: null, terms: {}, meta: {} });
		});
		const data = await client.getPreview(9, 'ab.cd/=+');
		expect(data.title).toBe('D');
		expect(calls[0]).toBe('http://wp/wp-json/headless-bridge/v1/preview/9?token=ab.cd%2F%3D%2B');
	});

	it('health returns version', async () => {
		const client = clientWith(() => json({ version: '0.1.0' }));
		await expect(client.health()).resolves.toEqual({ version: '0.1.0' });
	});

	it('treats an out-of-range page 400 as end of collection', async () => {
		const page1 = Array.from({ length: 100 }, (_, i) => ({ ...WP_POST, id: i + 1, slug: `p${i + 1}` }));
		const client = clientWith((url) =>
			url.includes('page=2')
				? new Response('{"code":"rest_post_invalid_page_number"}', { status: 400 })
				: json(page1),
		);
		const posts = await client.getAllPosts();
		expect(posts).toHaveLength(100);
	});

	it('rejects on unbounded pagination (endpoint always returns full page)', async () => {
		const page = Array.from({ length: 100 }, (_, i) => ({ ...WP_POST, id: i + 1, slug: `p${i + 1}` }));
		const client = clientWith(() => json(page));
		const err = await client.getAllPosts().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(WpClientError);
		if (err instanceof WpClientError) {
			expect(err.message).toContain('pagination exceeded');
		}
	});
});
