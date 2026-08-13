# Plan 2: Frontend (wp-client + shared + Astro site + Preview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Astro static site that renders the seeded WordPress content (posts, pages, works CPT, taxonomy archives), plus the preview system in both modes: the static preview shell (works on any host) and the Cloudflare SSR variant — ending with a Playwright E2E proving an editor's draft renders in the preview shell.

**Architecture:** Three workspace packages. `packages/shared` holds types and pure data→HTML render functions callable at build time AND from the preview shell's browser JS (the spec's 共有描画関数 convention). `packages/wp-client` is the injected-fetch REST data layer with retry/backoff and fail-loud semantics. `apps/site` is one Astro app: `output: 'static'` by default; `PREVIEW_MODE=ssr` switches to `output: 'server'` + Cloudflare adapter where every content page carries `export const prerender = true` and only `/preview/` renders on demand. One task hardens the Plan-1 WP plugin per the final review's carry-overs.

**Tech Stack:** TypeScript (strict), Astro ^5, @astrojs/cloudflare ^12, Vitest ^3, Playwright ^1, pnpm workspaces. Local WP from Plan 1 (wp-env, seeded).

**Spec:** `docs/superpowers/specs/2026-08-13-wp-headless2static-design.md`

## Global Constraints

- Commit messages: English, Conventional Commits, lowercase imperative, no trailing period, no Co-Authored-By trailer (`CLAUDE.md`)
- Env vars (exact names, from spec): `WP_API_URL` (default `http://localhost:8888`), `PREVIEW_MODE` = `shell` (default) | `ssr`
- Preview URL (both modes): `/preview/?id={post_id}&token={token}`
- Preview endpoint contract (Plan 1, do not change shape): `GET {WP_API_URL}/wp-json/headless-bridge/v1/preview/{id}?token=…` → `{ id, type, title, content, excerpt, date, modified, featured_image: {url, alt}|null, terms: {[taxonomy]: {id,name,slug}[]}, meta: object }`; invalid token → HTTP 403
- wp-client retry: 3 attempts total, exponential backoff base 250ms (×4 per retry), retry on network error and 5xx only; 4xx fails immediately; final failure must make the build exit non-zero
- Editor-facing preview error messages (exact strings, from spec):
  - 403: `プレビューの有効期限が切れました。WordPress 管理画面からプレビューを開き直してください。`
  - fetch/CORS failure: `WordPress に接続できません。`
- Workspace package names: `@repo/shared`, `@repo/wp-client`; internal deps use `workspace:*`; packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`, no build step)
- Content pages all carry a literal `export const prerender = true`; `/preview/` has NO prerender export (static by default in shell mode, on-demand in ssr mode)
- Sandbox note (this environment only): before any `wp-env`/`wp` cli usage export `NODE_OPTIONS="--require <scratchpad>/dns-shim.cjs"`; WordPress from Plan 1 is running at localhost:8888 already seeded

---

### Task 1: packages/shared — types + renderWorkMeta (TDD)

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`, `packages/shared/src/escape.ts`, `packages/shared/src/render/work-meta.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/work-meta.test.ts`
- Modify: root `package.json` (add `"test": "pnpm -r --if-present test"` script)

**Interfaces:**
- Produces: types `Term`, `FeaturedImage`, `Post`, `Page`, `Work`, `WorkMeta`, `PreviewData`; functions `escapeHtml(s: string): string`, `renderWorkMeta(meta: WorkMeta): string`. Consumed by wp-client (types), Astro pages (Task 6) and the preview shell (Task 8).

- [ ] **Step 1: Scaffold package**

`packages/shared/package.json`:

```json
{
  "name": "@repo/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`packages/shared/src/types.ts`:

```ts
export interface Term {
	id: number;
	name: string;
	slug: string;
}

export interface FeaturedImage {
	url: string;
	alt: string;
}

export interface Post {
	id: number;
	slug: string;
	title: string;
	content: string;
	excerpt: string;
	date: string;
	modified: string;
	featuredImage: FeaturedImage | null;
	categories: Term[];
	tags: Term[];
}

export interface Page {
	id: number;
	slug: string;
	title: string;
	content: string;
	modified: string;
}

export interface WorkMeta {
	client_name?: string;
	project_url?: string;
}

export interface Work {
	id: number;
	slug: string;
	title: string;
	content: string;
	excerpt: string;
	date: string;
	featuredImage: FeaturedImage | null;
	meta: WorkMeta;
}

/** Mirrors the headless-bridge preview endpoint response (snake_case = wire format). */
export interface PreviewData {
	id: number;
	type: string;
	title: string;
	content: string;
	excerpt: string;
	date: string;
	modified: string;
	featured_image: { url: string; alt: string } | null;
	terms: Record<string, Term[]>;
	meta: Record<string, unknown>;
}
```

`packages/shared/src/escape.ts`:

```ts
const MAP: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => MAP[c]);
}
```

`packages/shared/src/index.ts`:

```ts
export * from './types.ts';
export { escapeHtml } from './escape.ts';
export { renderWorkMeta } from './render/work-meta.ts';
```

- [ ] **Step 2: Write the failing test**

`packages/shared/test/work-meta.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderWorkMeta } from '../src/render/work-meta.ts';

describe('renderWorkMeta', () => {
	it('renders client name and linked project url', () => {
		const html = renderWorkMeta({ client_name: 'ACME Inc.', project_url: 'https://example.com' });
		expect(html).toContain('<dl class="work-meta">');
		expect(html).toContain('ACME Inc.');
		expect(html).toContain('<a href="https://example.com"');
	});

	it('escapes html in values', () => {
		const html = renderWorkMeta({ client_name: '<script>x</script>' });
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('omits missing fields and returns empty string when meta is empty', () => {
		expect(renderWorkMeta({})).toBe('');
		const html = renderWorkMeta({ client_name: 'A' });
		expect(html).not.toContain('project_url');
		expect(html).not.toContain('<a ');
	});

	it('drops non-http(s) project urls', () => {
		const html = renderWorkMeta({ client_name: 'A', project_url: 'javascript:alert(1)' });
		expect(html).not.toContain('<a ');
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/shared && pnpm install && pnpm test`
Expected: FAIL — cannot resolve `../src/render/work-meta.ts`.

- [ ] **Step 4: Implement**

`packages/shared/src/render/work-meta.ts`:

```ts
import { escapeHtml } from '../escape.ts';
import type { WorkMeta } from '../types.ts';

/**
 * 共有描画関数の規約 (spec: データ → HTML 文字列の純粋関数):
 * called by Astro at build time AND by the preview shell in the browser,
 * so it must stay dependency-free and side-effect-free.
 */
export function renderWorkMeta(meta: WorkMeta): string {
	const rows: string[] = [];
	if (meta.client_name) {
		rows.push(`<dt>Client</dt><dd>${escapeHtml(meta.client_name)}</dd>`);
	}
	if (meta.project_url && /^https?:\/\//.test(meta.project_url)) {
		const url = escapeHtml(meta.project_url);
		rows.push(`<dt>URL</dt><dd><a href="${url}" rel="noopener" target="_blank">${url}</a></dd>`);
	}
	return rows.length ? `<dl class="work-meta">${rows.join('')}</dl>` : '';
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/shared && pnpm test`
Expected: 4 tests PASS.

- [ ] **Step 6: Add root test script and commit**

In root `package.json` `scripts`, add: `"test": "pnpm -r --if-present test"`.

```bash
git add packages/shared package.json pnpm-lock.yaml
git commit -m "feat(shared): add content types and work meta render function"
```

---

### Task 2: packages/wp-client — fetchJsonWithRetry (TDD)

**Files:**
- Create: `packages/wp-client/package.json`, `packages/wp-client/tsconfig.json`
- Create: `packages/wp-client/src/http.ts`
- Test: `packages/wp-client/test/http.test.ts`

**Interfaces:**
- Produces: `fetchJsonWithRetry<T>(url: string, opts?: { fetchFn?: typeof fetch; retries?: number; baseDelayMs?: number; sleepFn?: (ms: number) => Promise<void> }): Promise<T>` and `class WpClientError extends Error { url: string; status: number | null }`. Consumed by Task 3.

- [ ] **Step 1: Scaffold package**

`packages/wp-client/package.json`:

```json
{
  "name": "@repo/wp-client",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@repo/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/wp-client/tsconfig.json`: same content as `packages/shared/tsconfig.json`.

- [ ] **Step 2: Write the failing tests**

`packages/wp-client/test/http.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/wp-client && pnpm install && pnpm test`
Expected: FAIL — cannot resolve `../src/http.ts`.

- [ ] **Step 4: Implement**

`packages/wp-client/src/http.ts`:

```ts
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
			const err = new WpClientError(`HTTP ${res.status} for ${url}`, url, res.status);
			if (res.status >= 400 && res.status < 500) {
				throw err; // client errors are not retryable
			}
			lastError = err;
		} catch (e) {
			if (e instanceof WpClientError && e.status !== null && e.status < 500) {
				throw e;
			}
			lastError = e instanceof WpClientError ? e : new WpClientError(`network error for ${url}: ${String(e)}`, url, null);
		}
	}
	throw lastError ?? new WpClientError(`unreachable: ${url}`, url, null);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/wp-client && pnpm test`
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/wp-client pnpm-lock.yaml
git commit -m "feat(wp-client): add fetch helper with exponential backoff retry"
```

---

### Task 3: wp-client API surface (TDD)

**Files:**
- Create: `packages/wp-client/src/map.ts`, `packages/wp-client/src/client.ts`, `packages/wp-client/src/index.ts`
- Test: `packages/wp-client/test/client.test.ts`

**Interfaces:**
- Consumes: `fetchJsonWithRetry`, shared types.
- Produces: `createWpClient(opts: { baseUrl: string; fetchFn?: typeof fetch; sleepFn?: (ms:number)=>Promise<void> })` returning:
  - `health(): Promise<{ version: string }>` — hits `/wp-json/headless-bridge/v1/health`
  - `getAllPosts(): Promise<Post[]>` — paginates `/wp-json/wp/v2/posts?_embed=1&per_page=100&page=N`
  - `getAllPages(): Promise<Page[]>` — `/wp-json/wp/v2/pages?per_page=100&page=N`
  - `getAllWorks(): Promise<Work[]>` — `/wp-json/wp/v2/works?_embed=1&per_page=100&page=N`
  - `getPreview(id: number, token: string): Promise<PreviewData>` — `/wp-json/headless-bridge/v1/preview/{id}?token=…`
  Consumed by Astro pages (Tasks 5-8) and the E2E.

- [ ] **Step 1: Write the failing tests**

`packages/wp-client/test/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createWpClient } from '../src/client.ts';

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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/wp-client && pnpm test`
Expected: FAIL — cannot resolve `../src/client.ts` (http tests still pass).

- [ ] **Step 3: Implement**

`packages/wp-client/src/map.ts`:

```ts
import type { FeaturedImage, Page, Post, Term, Work, WorkMeta } from '@repo/shared';

interface WpRendered {
	rendered: string;
}

export interface WpRestPost {
	id: number;
	slug: string;
	date_gmt: string;
	modified_gmt: string;
	title: WpRendered;
	content: WpRendered;
	excerpt: WpRendered;
	meta?: Record<string, unknown>;
	_embedded?: {
		'wp:featuredmedia'?: { source_url?: string; alt_text?: string }[];
		'wp:term'?: { id: number; name: string; slug: string; taxonomy: string }[][];
	};
}

function featured(p: WpRestPost): FeaturedImage | null {
	const media = p._embedded?.['wp:featuredmedia']?.[0];
	return media?.source_url ? { url: media.source_url, alt: media.alt_text ?? '' } : null;
}

function terms(p: WpRestPost, taxonomy: string): Term[] {
	return (p._embedded?.['wp:term'] ?? [])
		.flat()
		.filter((t) => t.taxonomy === taxonomy)
		.map(({ id, name, slug }) => ({ id, name, slug }));
}

export function mapPost(p: WpRestPost): Post {
	return {
		id: p.id,
		slug: p.slug,
		title: p.title.rendered,
		content: p.content.rendered,
		excerpt: p.excerpt.rendered,
		date: p.date_gmt,
		modified: p.modified_gmt,
		featuredImage: featured(p),
		categories: terms(p, 'category'),
		tags: terms(p, 'post_tag'),
	};
}

export function mapPage(p: WpRestPost): Page {
	return { id: p.id, slug: p.slug, title: p.title.rendered, content: p.content.rendered, modified: p.modified_gmt };
}

export function mapWork(p: WpRestPost): Work {
	return {
		id: p.id,
		slug: p.slug,
		title: p.title.rendered,
		content: p.content.rendered,
		excerpt: p.excerpt.rendered,
		date: p.date_gmt,
		featuredImage: featured(p),
		meta: (p.meta ?? {}) as WorkMeta,
	};
}
```

`packages/wp-client/src/client.ts`:

```ts
import type { Page, Post, PreviewData, Work } from '@repo/shared';
import { fetchJsonWithRetry, type RetryOptions } from './http.ts';
import { mapPage, mapPost, mapWork, type WpRestPost } from './map.ts';

export interface WpClientOptions {
	baseUrl: string;
	fetchFn?: typeof fetch;
	sleepFn?: RetryOptions['sleepFn'];
}

const PER_PAGE = 100;

export function createWpClient({ baseUrl, fetchFn, sleepFn }: WpClientOptions) {
	const base = baseUrl.replace(/\/$/, '');
	const opts: RetryOptions = { fetchFn, sleepFn };

	async function allPages<T>(path: string, map: (p: WpRestPost) => T): Promise<T[]> {
		const out: T[] = [];
		for (let page = 1; ; page++) {
			const batch = await fetchJsonWithRetry<WpRestPost[]>(
				`${base}${path}per_page=${PER_PAGE}&page=${page}`,
				opts,
			);
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
```

`packages/wp-client/src/index.ts`:

```ts
export { createWpClient, type WpClient, type WpClientOptions } from './client.ts';
export { WpClientError, fetchJsonWithRetry } from './http.ts';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/wp-client && pnpm test`
Expected: 11 tests PASS (6 http + 5 client).

- [ ] **Step 5: Commit**

```bash
git add packages/wp-client
git commit -m "feat(wp-client): add rest client with pagination and mapping"
```

---

### Task 4: apps/site scaffold — Astro config, base layout, content loader

**Files:**
- Create: `apps/site/package.json`, `apps/site/astro.config.mjs`, `apps/site/tsconfig.json`
- Create: `apps/site/src/lib/content.ts`, `apps/site/src/layouts/BaseLayout.astro`, `apps/site/src/styles/global.css`, `apps/site/src/pages/index.astro` (placeholder, replaced in Task 5)
- Create: `.env.example`
- Modify: root `package.json` scripts (`dev`, `build`, `site:preview`)

**Interfaces:**
- Produces: `loadContent(): Promise<{ posts: Post[]; pages: Page[]; works: Work[] }>` — memoized, health-checks first, exits 1 with a Japanese message when WP is unreachable. `BaseLayout` with props `{ title: string }`. Root scripts: `pnpm dev`, `pnpm build`, `pnpm site:preview`.

- [ ] **Step 1: Scaffold app**

`apps/site/package.json`:

```json
{
  "name": "site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "@repo/shared": "workspace:*",
    "@repo/wp-client": "workspace:*",
    "astro": "^5.0.0"
  },
  "devDependencies": {
    "@astrojs/cloudflare": "^12.0.0",
    "typescript": "^5.7.0"
  }
}
```

`apps/site/astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';

const PREVIEW_MODE = process.env.PREVIEW_MODE ?? 'shell';

export default defineConfig(
	PREVIEW_MODE === 'ssr'
		? {
				output: 'server',
				adapter: (await import('@astrojs/cloudflare')).default(),
			}
		: {
				output: 'static',
			},
);
```

`apps/site/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "src"]
}
```

`.env.example` (repo root):

```bash
# WP REST API の場所(ローカル wp-env / レンサバ / 任意)
WP_API_URL=http://localhost:8888
# プレビュー方式: shell(静的シェル・どこでも動く) | ssr(Cloudflare Workers)
PREVIEW_MODE=shell
```

- [ ] **Step 2: Content loader with fail-loud health check**

`apps/site/src/lib/content.ts`:

```ts
import type { Page, Post, Work } from '@repo/shared';
import { WpClientError, createWpClient } from '@repo/wp-client';

export const WP_API_URL = (process.env.WP_API_URL ?? 'http://localhost:8888').replace(/\/$/, '');

export const wp = createWpClient({ baseUrl: WP_API_URL });

export interface SiteContent {
	posts: Post[];
	pages: Page[];
	works: Work[];
}

let cache: Promise<SiteContent> | null = null;

async function load(): Promise<SiteContent> {
	try {
		await wp.health();
	} catch (e) {
		console.error(`\nビルド中止: WordPress に接続できません (${WP_API_URL})`);
		console.error('確認: WP が起動しているか / WP_API_URL が正しいか / headless-bridge プラグインが有効か');
		console.error(String(e));
		process.exit(1);
	}
	try {
		const [posts, pages, works] = await Promise.all([wp.getAllPosts(), wp.getAllPages(), wp.getAllWorks()]);
		return { posts, pages, works };
	} catch (e) {
		console.error('\nビルド中止: コンテンツ取得に失敗しました(不完全なサイトはデプロイしない方針のため失敗させます)');
		console.error(e instanceof WpClientError ? `${e.message}` : String(e));
		process.exit(1);
	}
}

export function loadContent(): Promise<SiteContent> {
	cache ??= load();
	return cache;
}
```

- [ ] **Step 3: Base layout + placeholder index**

`apps/site/src/styles/global.css`:

```css
:root {
	--fg: #1a1a1a;
	--bg: #ffffff;
	--muted: #6b7280;
	--accent: #2563eb;
	--max-width: 44rem;
}

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	color: var(--fg);
	background: var(--bg);
	font-family: system-ui, -apple-system, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
	line-height: 1.8;
}

.container {
	max-width: var(--max-width);
	margin: 0 auto;
	padding: 1.5rem;
}

.site-header {
	border-bottom: 1px solid #e5e7eb;
}

.site-header a {
	color: inherit;
	text-decoration: none;
	font-weight: 700;
}

.site-footer {
	border-top: 1px solid #e5e7eb;
	color: var(--muted);
	font-size: 0.85rem;
	margin-top: 3rem;
}

article img {
	max-width: 100%;
	height: auto;
}

.work-meta {
	background: #f8fafc;
	border: 1px solid #e5e7eb;
	border-radius: 6px;
	padding: 1rem;
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 0.25rem 1rem;
}

.work-meta dt {
	color: var(--muted);
}

.work-meta dd {
	margin: 0;
}
```

`apps/site/src/layouts/BaseLayout.astro`:

```astro
---
import '../styles/global.css';

interface Props {
	title: string;
}

const { title } = Astro.props;
---

<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>{title}</title>
	</head>
	<body>
		<header class="site-header">
			<div class="container"><a href="/">Headless Demo</a></div>
		</header>
		<main class="container">
			<slot />
		</main>
		<footer class="site-footer">
			<div class="container">Built with Astro + WordPress</div>
		</footer>
	</body>
</html>
```

`apps/site/src/pages/index.astro` (placeholder — Task 5 replaces it):

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';

export const prerender = true;
---

<BaseLayout title="Headless Demo">
	<p>scaffold ok</p>
</BaseLayout>
```

- [ ] **Step 4: Root scripts**

In root `package.json` `scripts`, add:

```json
"dev": "pnpm --filter site dev",
"build": "pnpm --filter site build",
"site:preview": "pnpm --filter site preview"
```

- [ ] **Step 5: Verify build**

Run: `pnpm install && pnpm build`
Expected: Astro build succeeds; `apps/site/dist/index.html` contains `scaffold ok`. (No WP fetch yet — placeholder page only.)

- [ ] **Step 6: Commit**

```bash
git add apps/site .env.example package.json pnpm-lock.yaml
git commit -m "feat(site): scaffold astro app with mode-switching config and content loader"
```

---

### Task 5: Posts — list and detail pages

**Files:**
- Create: `apps/site/src/layouts/ArticleLayout.astro`, `apps/site/src/pages/posts/[slug].astro`
- Modify: `apps/site/src/pages/index.astro` (replace placeholder with post list)

**Interfaces:**
- Consumes: `loadContent()`, `BaseLayout`.
- Produces: `ArticleLayout` with props `{ title: string; dateISO?: string; terms?: Term[] }` and a default slot for article body HTML — reused by pages/works (Task 6) and the SSR preview (Task 8). Routes `/` and `/posts/{slug}/`.

- [ ] **Step 1: Article layout**

`apps/site/src/layouts/ArticleLayout.astro`:

```astro
---
import type { Term } from '@repo/shared';
import BaseLayout from './BaseLayout.astro';

interface Props {
	title: string;
	dateISO?: string;
	terms?: Term[];
}

const { title, dateISO, terms = [] } = Astro.props;
---

<BaseLayout title={title}>
	<article>
		<header>
			<h1 set:html={title} />
			{dateISO && <time datetime={dateISO}>{dateISO.slice(0, 10)}</time>}
			{terms.length > 0 && (
				<ul class="terms">
					{terms.map((t) => (
						<li><a href={`/category/${t.slug}/`}>{t.name}</a></li>
					))}
				</ul>
			)}
		</header>
		<div class="article-body">
			<slot />
		</div>
	</article>
</BaseLayout>

<style>
	.terms {
		list-style: none;
		display: flex;
		gap: 0.5rem;
		padding: 0;
	}
	.terms a {
		font-size: 0.8rem;
		background: #eef2ff;
		border-radius: 999px;
		padding: 0.1rem 0.7rem;
		text-decoration: none;
	}
</style>
```

- [ ] **Step 2: Post detail page**

`apps/site/src/pages/posts/[slug].astro`:

```astro
---
import ArticleLayout from '../../layouts/ArticleLayout.astro';
import { loadContent } from '../../lib/content';

export const prerender = true;

export async function getStaticPaths() {
	const { posts } = await loadContent();
	return posts.map((post) => ({ params: { slug: post.slug }, props: { post } }));
}

const { post } = Astro.props;
---

<ArticleLayout title={post.title} dateISO={post.date} terms={post.categories}>
	<Fragment set:html={post.content} />
</ArticleLayout>
```

- [ ] **Step 3: Post list (replace placeholder index)**

`apps/site/src/pages/index.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { loadContent } from '../lib/content';

export const prerender = true;

const { posts } = await loadContent();
---

<BaseLayout title="Headless Demo">
	<h1>記事一覧</h1>
	<ul class="post-list">
		{posts.map((post) => (
			<li>
				<a href={`/posts/${post.slug}/`} set:html={post.title} />
				<time datetime={post.date}>{post.date.slice(0, 10)}</time>
			</li>
		))}
	</ul>
</BaseLayout>
```

- [ ] **Step 4: Verify against the live seeded WP**

Run: `pnpm build`
Expected: build succeeds. Then:

```bash
grep -l "Hello Headless" apps/site/dist/posts/hello-headless/index.html
grep -c "post-list" apps/site/dist/index.html
```

Expected: both hit (detail page exists with content; index lists posts). Also confirm the DRAFT is absent: `ls apps/site/dist/posts/` must NOT contain a draft slug.

- [ ] **Step 5: Commit**

```bash
git add apps/site
git commit -m "feat(site): render post list and detail pages from wordpress"
```

---

### Task 6: Fixed pages + works pages

**Files:**
- Create: `apps/site/src/pages/[slug].astro` (WP fixed pages), `apps/site/src/pages/works/index.astro`, `apps/site/src/pages/works/[slug].astro`

**Interfaces:**
- Consumes: `loadContent()`, `ArticleLayout`, `renderWorkMeta` from `@repo/shared`.
- Produces: routes `/{page-slug}/`, `/works/`, `/works/{slug}/`. The works detail page is the reference use of the 共有描画関数 convention (same function the preview shell uses in Task 8).

- [ ] **Step 1: Fixed pages**

`apps/site/src/pages/[slug].astro`:

```astro
---
import ArticleLayout from '../layouts/ArticleLayout.astro';
import { loadContent } from '../lib/content';

export const prerender = true;

export async function getStaticPaths() {
	const { pages } = await loadContent();
	return pages.map((page) => ({ params: { slug: page.slug }, props: { page } }));
}

const { page } = Astro.props;
---

<ArticleLayout title={page.title}>
	<Fragment set:html={page.content} />
</ArticleLayout>
```

(Static routes like `/works/` take priority over `[slug]` in Astro, so there is no collision.)

- [ ] **Step 2: Works list + detail**

`apps/site/src/pages/works/index.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { loadContent } from '../../lib/content';

export const prerender = true;

const { works } = await loadContent();
---

<BaseLayout title="Works">
	<h1>実績</h1>
	<ul class="post-list">
		{works.map((work) => (
			<li><a href={`/works/${work.slug}/`} set:html={work.title} /></li>
		))}
	</ul>
</BaseLayout>
```

`apps/site/src/pages/works/[slug].astro`:

```astro
---
import { renderWorkMeta } from '@repo/shared';
import ArticleLayout from '../../layouts/ArticleLayout.astro';
import { loadContent } from '../../lib/content';

export const prerender = true;

export async function getStaticPaths() {
	const { works } = await loadContent();
	return works.map((work) => ({ params: { slug: work.slug }, props: { work } }));
}

const { work } = Astro.props;
const metaHtml = renderWorkMeta(work.meta);
---

<ArticleLayout title={work.title} dateISO={work.date}>
	<Fragment set:html={metaHtml} />
	<Fragment set:html={work.content} />
</ArticleLayout>
```

- [ ] **Step 3: Verify against the live seeded WP**

Run: `pnpm build` then:

```bash
grep -l "About this site" apps/site/dist/about/index.html
grep -l "ACME Inc." apps/site/dist/works/corporate-site-renewal/index.html
```

Expected: both hit (the works detail contains the shared-render meta block). If the seeded work slug differs, list `apps/site/dist/works/` and grep the actual directory.

- [ ] **Step 4: Commit**

```bash
git add apps/site
git commit -m "feat(site): render fixed pages and works with shared meta renderer"
```

---

### Task 7: Category and tag archives

**Files:**
- Create: `apps/site/src/pages/category/[slug].astro`, `apps/site/src/pages/tag/[slug].astro`

**Interfaces:**
- Consumes: `loadContent()` (terms are derived from the posts already loaded — no extra API calls).
- Produces: routes `/category/{slug}/`, `/tag/{slug}/`.

- [ ] **Step 1: Category archive**

`apps/site/src/pages/category/[slug].astro`:

```astro
---
import type { Post, Term } from '@repo/shared';
import BaseLayout from '../../layouts/BaseLayout.astro';
import { loadContent } from '../../lib/content';

export const prerender = true;

export async function getStaticPaths() {
	const { posts } = await loadContent();
	const byTerm = new Map<string, { term: Term; posts: Post[] }>();
	for (const post of posts) {
		for (const term of post.categories) {
			const entry = byTerm.get(term.slug) ?? { term, posts: [] };
			entry.posts.push(post);
			byTerm.set(term.slug, entry);
		}
	}
	return [...byTerm.values()].map(({ term, posts }) => ({ params: { slug: term.slug }, props: { term, posts } }));
}

const { term, posts } = Astro.props;
---

<BaseLayout title={`カテゴリ: ${term.name}`}>
	<h1>カテゴリ: {term.name}</h1>
	<ul class="post-list">
		{posts.map((post) => (
			<li><a href={`/posts/${post.slug}/`} set:html={post.title} /></li>
		))}
	</ul>
</BaseLayout>
```

- [ ] **Step 2: Tag archive**

`apps/site/src/pages/tag/[slug].astro`: same file content as the category archive with these three differences: iterate `post.tags` instead of `post.categories`, title text `タグ: ${term.name}`, heading `タグ: {term.name}`. Full file:

```astro
---
import type { Post, Term } from '@repo/shared';
import BaseLayout from '../../layouts/BaseLayout.astro';
import { loadContent } from '../../lib/content';

export const prerender = true;

export async function getStaticPaths() {
	const { posts } = await loadContent();
	const byTerm = new Map<string, { term: Term; posts: Post[] }>();
	for (const post of posts) {
		for (const term of post.tags) {
			const entry = byTerm.get(term.slug) ?? { term, posts: [] };
			entry.posts.push(post);
			byTerm.set(term.slug, entry);
		}
	}
	return [...byTerm.values()].map(({ term, posts }) => ({ params: { slug: term.slug }, props: { term, posts } }));
}

const { term, posts } = Astro.props;
---

<BaseLayout title={`タグ: ${term.name}`}>
	<h1>タグ: {term.name}</h1>
	<ul class="post-list">
		{posts.map((post) => (
			<li><a href={`/posts/${post.slug}/`} set:html={post.title} /></li>
		))}
	</ul>
</BaseLayout>
```

- [ ] **Step 3: Verify**

The seed assigns no categories to posts by default (`term create` only). Assign one for the check, then build:

```bash
cd wp
POST_ID=$(wp-env run cli wp post list --post_type=post --name=hello-headless --field=ID | tail -1 | tr -dc '0-9')
wp-env run cli wp post term set "$POST_ID" category news
cd ..
pnpm build
grep -l "Hello Headless" apps/site/dist/category/news/index.html
```

(`wp-env run` prefixes its own log lines to stdout, so the ID must be taken from the last line and stripped to digits.)

Expected: hit. (Tag archive builds empty — zero routes — which is valid.)

- [ ] **Step 4: Commit**

```bash
git add apps/site
git commit -m "feat(site): add category and tag archive pages"
```

---

### Task 8: Preview page — static shell + SSR branch in one route

**Files:**
- Create: `apps/site/src/pages/preview/index.astro`, `apps/site/src/lib/preview-render.ts`

**Interfaces:**
- Consumes: preview endpoint contract, `renderWorkMeta`, `escapeHtml`, `ArticleLayout` (SSR branch), `WP_API_URL`.
- Produces: route `/preview/` (NO prerender export — see Global Constraints). `renderPreviewHtml(data: PreviewData): string` — shared between the browser shell and the SSR branch so both modes render identically.

- [ ] **Step 1: Shared preview renderer**

`apps/site/src/lib/preview-render.ts`:

```ts
import { renderWorkMeta, type PreviewData, type WorkMeta } from '@repo/shared';

/** Renders the preview body (meta block + content HTML). Pure; runs in browser AND on the server. */
export function renderPreviewHtml(data: PreviewData): string {
	const metaHtml = data.type === 'work' ? renderWorkMeta(data.meta as WorkMeta) : '';
	return `${metaHtml}${data.content}`;
}
```

- [ ] **Step 2: The preview route**

`apps/site/src/pages/preview/index.astro`:

```astro
---
import { escapeHtml, type PreviewData } from '@repo/shared';
import ArticleLayout from '../../layouts/ArticleLayout.astro';
import BaseLayout from '../../layouts/BaseLayout.astro';
import { WP_API_URL, wp } from '../../lib/content';
import { renderPreviewHtml } from '../../lib/preview-render';

// NOTE: no `export const prerender` here on purpose —
// shell mode (output:'static'): page is prerendered as the static shell;
// ssr mode (output:'server'): page renders on demand per request.
const IS_SSR = (process.env.PREVIEW_MODE ?? 'shell') === 'ssr';

let ssrData: PreviewData | null = null;
let ssrError: string | null = null;

if (IS_SSR) {
	const id = Number(Astro.url.searchParams.get('id'));
	const token = Astro.url.searchParams.get('token') ?? '';
	if (!id || !token) {
		ssrError = 'プレビューの有効期限が切れました。WordPress 管理画面からプレビューを開き直してください。';
	} else {
		try {
			ssrData = await wp.getPreview(id, token);
		} catch (e) {
			ssrError =
				e instanceof Error && 'status' in e && (e as { status: number | null }).status === 403
					? 'プレビューの有効期限が切れました。WordPress 管理画面からプレビューを開き直してください。'
					: 'WordPress に接続できません。';
		}
	}
}
---

{
	IS_SSR ? (
		ssrData ? (
			<ArticleLayout title={ssrData.title} dateISO={ssrData.modified}>
				<Fragment set:html={renderPreviewHtml(ssrData)} />
			</ArticleLayout>
		) : (
			<BaseLayout title="プレビュー">
				<p class="preview-error">{ssrError}</p>
			</BaseLayout>
		)
	) : (
		<BaseLayout title="プレビュー">
			<article>
				<header>
					<h1 id="preview-title">読み込み中…</h1>
					<time id="preview-date" />
				</header>
				<div class="article-body" id="preview-body" />
				<div id="preview-error" hidden>
					<p id="preview-error-message" />
					<details>
						<summary>制作者向けの確認ポイント</summary>
						<ul>
							<li>WP 側 headless-bridge の Frontend URL(CORS 許可オリジン)がこのサイトの URL と一致しているか</li>
							<li>WP_API_URL(ビルド時設定)が正しいか: <code id="preview-wp-url" /></li>
						</ul>
					</details>
				</div>
			</article>
		</BaseLayout>
	)
}

{
	!IS_SSR && (
		<script define:vars={{ wpApiUrl: WP_API_URL }}>
			import('/src/preview-shell.js');
			window.__WP_API_URL__ = wpApiUrl;
		</script>
	)
}
```

**Correction to the snippet above (use this, not a dynamic import):** Astro inlines `define:vars` scripts as classic scripts, so put the whole shell logic inline instead of importing a separate file. Replace the final `{!IS_SSR && (<script …)}` block with:

```astro
{
	!IS_SSR && (
		<script define:vars={{ wpApiUrl: WP_API_URL }}>
			const EXPIRED = 'プレビューの有効期限が切れました。WordPress 管理画面からプレビューを開き直してください。';
			const UNREACHABLE = 'WordPress に接続できません。';

			function showError(message) {
				document.getElementById('preview-title').textContent = 'プレビューを表示できません';
				const box = document.getElementById('preview-error');
				box.hidden = false;
				document.getElementById('preview-error-message').textContent = message;
				document.getElementById('preview-wp-url').textContent = wpApiUrl;
			}

			async function run() {
				const params = new URLSearchParams(location.search);
				const id = Number(params.get('id'));
				const token = params.get('token') ?? '';
				if (!id || !token) {
					showError(EXPIRED);
					return;
				}
				let res;
				try {
					res = await fetch(`${wpApiUrl}/wp-json/headless-bridge/v1/preview/${id}?token=${encodeURIComponent(token)}`);
				} catch {
					showError(UNREACHABLE);
					return;
				}
				if (res.status === 403) {
					showError(EXPIRED);
					return;
				}
				if (!res.ok) {
					showError(UNREACHABLE);
					return;
				}
				const data = await res.json();
				const { renderPreviewHtml } = await import('/src/lib/preview-render.ts');
				document.title = data.title;
				document.getElementById('preview-title').innerHTML = data.title;
				document.getElementById('preview-date').textContent = (data.modified || '').slice(0, 10);
				document.getElementById('preview-body').innerHTML = renderPreviewHtml(data);
			}

			run();
		</script>
	)
}
```

**Implementation note for this step:** `define:vars` scripts are inline and cannot `import` project modules at runtime in a built static site — the `await import('/src/lib/preview-render.ts')` line above will 404 in `dist`. The implementer must solve this with the pattern Astro supports: keep the `define:vars` script for `wpApiUrl` only (`window.__WP_API_URL__ = wpApiUrl`), and put the shell logic in a separate **bundled** module script (`<script>` without `define:vars`, importing `renderPreviewHtml` from `../../lib/preview-render` and reading `window.__WP_API_URL__`). Both scripts live in the same `.astro` file; Astro bundles the module script and its imports into a hashed asset automatically. All user-visible strings and status handling must match the code above exactly.

- [ ] **Step 3: Verify shell build output**

Run: `pnpm build` then:

```bash
ls apps/site/dist/preview/index.html
grep -c "preview-error" apps/site/dist/preview/index.html
grep -rl "renderWorkMeta\|work-meta" apps/site/dist/_astro/ | head -1
```

Expected: shell page exists, error container present, and the bundled module asset containing the shared renderer exists.

- [ ] **Step 4: Manual end-to-end check (shell mode, live WP)**

```bash
pnpm site:preview &   # serves dist at http://localhost:4321
cd wp
DRAFT_ID=$(wp-env run cli wp post create --post_title="Shell Preview Draft" --post_status=draft --post_content="<p>shell-preview-body</p>" --porcelain)
wp-env run cli wp eval "echo get_preview_post_link( $DRAFT_ID );"
```

Open the printed URL with a real fetch: `curl -s "http://localhost:4321/preview/?id=$DRAFT_ID&token=..."` returns the shell (JS does the rendering — full behavioral check is Task 11's Playwright test). Confirm the page HTML contains the module script tag. Kill the preview server and delete the draft afterwards.

- [ ] **Step 5: Commit**

```bash
git add apps/site
git commit -m "feat(site): add preview route with static shell and ssr branches"
```

---

### Task 9: headless-bridge hardening (final-review carry-overs)

**Files:**
- Modify: `wp/plugins/headless-bridge/includes/class-cors.php`
- Modify: `wp/plugins/headless-bridge/includes/class-preview-endpoint.php`
- Modify: `tools/smoke/preview-endpoint.sh`

**Interfaces:**
- Consumes: Plan 1 plugin internals.
- Produces: origin-parsed CORS matching + unconditional `Vary: Origin`; preview endpoint rejects trashed posts and renders content inside proper loop context; smoke covers CORS. No contract changes.

- [ ] **Step 1: CORS — parse origins, always Vary**

Replace `send_headers` in `wp/plugins/headless-bridge/includes/class-cors.php` with:

```php
	public static function send_headers( $served ) {
		header( 'Vary: Origin' );
		$origin  = get_http_origin();
		$allowed = self::origin_of( Plugin::frontend_url() );
		if ( $origin && $allowed && self::origin_of( $origin ) === $allowed ) {
			header( 'Access-Control-Allow-Origin: ' . $origin );
			header( 'Access-Control-Allow-Methods: GET, OPTIONS' );
		}
		return $served;
	}

	/** Reduces a URL to scheme://host[:port] so a configured path can't silently break matching. */
	private static function origin_of( string $url ): string {
		$parts = wp_parse_url( $url );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}
		$origin = strtolower( $parts['scheme'] . '://' . $parts['host'] );
		return isset( $parts['port'] ) ? $origin . ':' . $parts['port'] : $origin;
	}
```

- [ ] **Step 2: Endpoint — trash guard + loop context**

In `wp/plugins/headless-bridge/includes/class-preview-endpoint.php` `handle()`:

Replace the not-found guard with:

```php
		if ( ! $post || 'revision' === $post->post_type || 'trash' === $post->post_status ) {
			return new \WP_Error( 'not_found', 'Post not found.', [ 'status' => 404 ] );
		}
```

Replace the `'content' => apply_filters( 'the_content', $source->post_content ),` line by computing content before the response array, with loop context:

```php
		$GLOBALS['post'] = $source;
		setup_postdata( $source );
		$content = apply_filters( 'the_content', $source->post_content );
		wp_reset_postdata();
```

and use `'content' => $content,` in the response array.

- [ ] **Step 3: Smoke — CORS checks + cleanup trap**

In `tools/smoke/preview-endpoint.sh`, after the `TOKEN=` line add a cleanup trap so failed assertions don't orphan the draft:

```bash
cleanup() { cli post delete "$DRAFT_ID" --force > /dev/null 2>&1 || true; }
trap cleanup EXIT
```

Remove the explicit `cli post delete` line at the bottom (the trap replaces it). Then add before the final `echo "SMOKE PASS"`:

```bash
echo "5) cors allows the configured frontend origin..."
curl -fsS -H "Origin: http://localhost:4321" -D - -o /dev/null "$WP_URL/?rest_route=/headless-bridge/v1/health" | grep -qi "access-control-allow-origin: http://localhost:4321"
echo "   OK"

echo "6) cors denies other origins..."
HEADERS=$(curl -fsS -H "Origin: http://evil.example" -D - -o /dev/null "$WP_URL/?rest_route=/headless-bridge/v1/health")
! echo "$HEADERS" | grep -qi "access-control-allow-origin"
echo "$HEADERS" | grep -qi "vary: origin"
echo "   OK"
```

- [ ] **Step 4: Verify**

```bash
cd wp/plugins/headless-bridge && vendor/bin/phpunit          # 6 tests still pass
bash tools/smoke/preview-endpoint.sh                          # 6 checks, SMOKE PASS
```

Also verify the trash guard live: trash a draft (`wp post delete <ID>` without `--force` trashes it), mint a token for it, curl the endpoint → expect 404. Restore or force-delete afterwards.

- [ ] **Step 5: Commit**

```bash
git add wp/plugins/headless-bridge tools/smoke/preview-endpoint.sh
git commit -m "fix(headless-bridge): harden cors matching, trash guard and loop context"
```

---

### Task 10: SSR mode build verification

**Files:**
- Modify: none expected — this task VERIFIES the `PREVIEW_MODE=ssr` path built in Tasks 4/8 and fixes what the build surfaces (any fixes stay minimal and are listed in the report).

**Interfaces:**
- Consumes: `astro.config.mjs` mode switch, preview route SSR branch.
- Produces: confirmed `pnpm build` in both modes; documented dist layout differences.

- [ ] **Step 1: SSR build**

Run: `PREVIEW_MODE=ssr pnpm build`
Expected: build succeeds with the Cloudflare adapter; `apps/site/dist/_worker.js/` (or `_worker.js`) exists; prerendered content pages exist as static HTML (e.g. `apps/site/dist/posts/hello-headless/index.html`); there is NO `dist/preview/index.html` (preview is on-demand).

- [ ] **Step 2: Shell build unaffected**

Run: `pnpm build` (no env override)
Expected: static output as before, `dist/preview/index.html` present, no worker output.

- [ ] **Step 3: Record limitation + commit (only if fixes were needed)**

The Workers runtime is not executed locally in this plan — runtime verification of the SSR preview happens on a real Cloudflare deploy in Plan 3. If Step 1 required code fixes, commit them as `fix(site): make ssr build pass with cloudflare adapter`; otherwise nothing to commit.

---

### Task 11: Playwright E2E — preview shell renders a draft

**Files:**
- Create: `apps/site/e2e/preview-shell.spec.ts`, `apps/site/playwright.config.ts`
- Modify: `apps/site/package.json` (add `@playwright/test` devDep + `"e2e": "playwright test"` script), root `package.json` (`"e2e": "pnpm --filter site e2e"`)

**Interfaces:**
- Consumes: built `dist` (shell mode), live seeded WP, wp-cli.
- Produces: one E2E scenario proving the editor flow: draft → preview URL → shell fetches and renders the draft body.

**Sandbox note:** `npx playwright install chromium` downloads the browser from Playwright's CDN. If it fails with 403, ask the user to run on the host: `sbx policy allow network cdn.playwright.dev,playwright.azureedge.net` — report BLOCKED with the exact blocked host from the error rather than guessing.

- [ ] **Step 1: Config**

`apps/site/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	use: { baseURL: 'http://localhost:4321' },
	webServer: {
		command: 'pnpm preview',
		url: 'http://localhost:4321',
		reuseExistingServer: true,
	},
});
```

- [ ] **Step 2: The scenario**

`apps/site/e2e/preview-shell.spec.ts`:

```ts
import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const WP_DIR = new URL('../../../wp', import.meta.url).pathname;

function cli(args: string): string {
	return execSync(`wp-env run cli wp ${args}`, { cwd: WP_DIR, encoding: 'utf8' }).trim();
}

test('editor draft renders in the preview shell', async ({ page }) => {
	const draftId = cli(
		`post create --post_title="E2E Preview Draft" --post_status=draft --post_content="<p>e2e-preview-body</p>" --porcelain`,
	);
	try {
		const previewUrl = cli(`eval "echo get_preview_post_link( ${draftId} );"`);
		const { pathname, search } = new URL(previewUrl);
		await page.goto(pathname + search);
		await expect(page.locator('#preview-title')).toHaveText('E2E Preview Draft');
		await expect(page.locator('#preview-body')).toContainText('e2e-preview-body');
	} finally {
		cli(`post delete ${draftId} --force`);
	}
});
```

(`wp-env run cli` output may include wp-env's own log lines — the implementer must strip them: take the LAST non-empty line of stdout for `--porcelain`/`eval` values. Adjust `cli()` accordingly and keep the assertions unchanged.)

- [ ] **Step 3: Install and run**

```bash
pnpm --filter site add -D @playwright/test
pnpm --filter site exec playwright install chromium
pnpm build            # fresh shell-mode dist
pnpm --filter site e2e
```

Expected: 1 test PASS. (Requires WP running and the frontend URL option set to `http://localhost:4321` — both true since Plan 1 seed.)

- [ ] **Step 4: Add root script and commit**

Root `package.json` scripts: `"e2e": "pnpm --filter site e2e"`.

```bash
git add apps/site package.json pnpm-lock.yaml
git commit -m "test(site): add playwright e2e for preview shell draft rendering"
```

---

### Task 12: Full-suite integration pass

**Files:**
- Modify: only what the checks below surface (any fix committed with a matching conventional message).

- [ ] **Step 1: Run everything**

```bash
pnpm test                                  # vitest: shared + wp-client (15 tests)
cd wp/plugins/headless-bridge && vendor/bin/phpunit && cd ../../..   # 6 tests
bash tools/smoke/preview-endpoint.sh       # 6 checks SMOKE PASS
pnpm build && pnpm e2e                     # build + 1 e2e PASS
PREVIEW_MODE=ssr pnpm build                # ssr build passes
pnpm build                                 # leave a shell-mode dist behind
```

Expected: all green.

- [ ] **Step 2: Commit (only if fixes were needed)**

```bash
git add -A && git commit -m "fix(site): <what the integration pass surfaced>"
```

---

## Out of scope for this plan (→ Plan 3)

- Webhook trigger (`class-webhook.php`), GitHub Actions, deploy scripts (rsync/FTPS/wrangler), `.htaccess` 雛形
- 2-layer build cache (content cache in wp-client, Astro image cache persistence)
- README (setup guide, conventions: bare-origin frontend URL, `revisions_enabled` meta, non-revisioned-meta fallback)
- Cloudflare runtime verification of the SSR preview (needs a real deploy)
