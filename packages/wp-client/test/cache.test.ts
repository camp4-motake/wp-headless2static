import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWpClient } from '../src/client.ts';
import { CACHE_VERSION, createCachedContent } from '../src/cache.ts';
import { mapPost } from '../src/map.ts';

const POST = (id: number, modified: string) => ({
	id, slug: `p${id}`, date_gmt: '2026-01-01T00:00:00', modified_gmt: modified,
	title: { rendered: `T${id}` }, content: { rendered: '<p>b</p>' }, excerpt: { rendered: '' },
});

function setup(posts: Map<number, string>) {
	const calls: string[] = [];
	const fetchFn = vi.fn(async (u: RequestInfo | URL) => {
		const url = String(u);
		calls.push(url);
		const body = url.includes('_fields=id,modified')
			? [...posts].map(([id, modified]) => ({ id, modified_gmt: modified, modified }))
			: /\/posts\/(\d+)/.test(url)
				? POST(Number(url.match(/\/posts\/(\d+)/)![1]), posts.get(Number(url.match(/\/posts\/(\d+)/)![1]))!)
				: [...posts].map(([id, m]) => POST(id, m));
		return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
	});
	const client = createWpClient({ baseUrl: 'http://wp', fetchFn });
	return { client, calls };
}

let dir: string;
const freshDir = () => (dir = mkdtempSync(join(tmpdir(), 'cache-test-')));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('createCachedContent', () => {
	it('first run fetches every item and writes the cache', async () => {
		const { client, calls } = setup(new Map([[1, 'a'], [2, 'a']]));
		const cached = createCachedContent({ client, cacheDir: freshDir() });
		const out = await cached.load('posts', mapPost);
		expect(out).toHaveLength(2);
		expect(calls.filter((u) => /\/posts\/\d+/.test(u))).toHaveLength(2);
	});

	it('second run with no changes fetches only the stub listing', async () => {
		const { client, calls } = setup(new Map([[1, 'a'], [2, 'a']]));
		const cached = createCachedContent({ client, cacheDir: freshDir() });
		await cached.load('posts', mapPost);
		const before = calls.length;
		const out = await cached.load('posts', mapPost);
		expect(out).toHaveLength(2);
		const newCalls = calls.slice(before);
		expect(newCalls.every((u) => u.includes('_fields=id,modified'))).toBe(true);
	});

	it('re-fetches only the item whose modified changed', async () => {
		const posts = new Map([[1, 'a'], [2, 'a']]);
		const { client, calls } = setup(posts);
		const cached = createCachedContent({ client, cacheDir: freshDir() });
		await cached.load('posts', mapPost);
		posts.set(2, 'b');
		const before = calls.length;
		await cached.load('posts', mapPost);
		const itemFetches = calls.slice(before).filter((u) => /\/posts\/\d+/.test(u));
		expect(itemFetches).toHaveLength(1);
		expect(itemFetches[0]).toContain('/posts/2');
	});

	it('evicts deleted items', async () => {
		const posts = new Map([[1, 'a'], [2, 'a']]);
		const { client } = setup(posts);
		const cached = createCachedContent({ client, cacheDir: freshDir() });
		await cached.load('posts', mapPost);
		posts.delete(2);
		const out = await cached.load('posts', mapPost);
		expect(out.map((p) => p.id)).toEqual([1]);
	});

	it('disabled: always full-fetches and never writes the cache dir', async () => {
		const { client, calls } = setup(new Map([[1, 'a']]));
		const cached = createCachedContent({ client, cacheDir: freshDir(), disabled: true });
		await cached.load('posts', mapPost);
		await cached.load('posts', mapPost);
		expect(calls.filter((u) => u.includes('_fields'))).toHaveLength(0);
	});

	it('version mismatch wipes and refetches everything', async () => {
		const { client, calls } = setup(new Map([[1, 'a']]));
		freshDir();
		const { writeFileSync, mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'posts.json'), JSON.stringify({ version: CACHE_VERSION - 1, items: { 1: { modified: 'a', data: {} } } }));
		const cached = createCachedContent({ client, cacheDir: dir });
		const out = await cached.load('posts', mapPost);
		expect(out).toHaveLength(1);
		expect(calls.filter((u) => /\/posts\/1/.test(u))).toHaveLength(1);
	});

	it('preserves listing order from stubs (not id ascending)', async () => {
		const { client } = setup(new Map([[2, 'a'], [1, 'b'], [3, 'c']]));
		const cached = createCachedContent({ client, cacheDir: freshDir() });
		const out = await cached.load('posts', mapPost);
		expect(out.map((p) => p.id)).toEqual([2, 1, 3]);
	});

	it('falls back to full fetch when node builtins are unavailable (workerd)', async () => {
		const { client, calls } = setup(new Map([[1, 'a']]));
		freshDir();
		vi.resetModules();
		vi.doMock('node:fs', () => {
			throw new Error('No such module "node:fs"');
		});
		vi.doMock('node:path', () => {
			throw new Error('No such module "node:path"');
		});
		try {
			const { createCachedContent: create } = await import('../src/cache.ts');
			const cached = create({ client, cacheDir: '/nowhere' });
			const out = await cached.load('posts', mapPost);
			expect(out).toHaveLength(1);
			expect(calls.filter((u) => u.includes('_fields'))).toHaveLength(0);
		} finally {
			vi.doUnmock('node:fs');
			vi.doUnmock('node:path');
			vi.resetModules();
		}
	});
});
