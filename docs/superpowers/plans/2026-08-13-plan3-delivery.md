# Plan 3: Delivery (Webhook + Cache + Deploy + CI + README) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the boilerplate's delivery pipeline: WP publish events trigger GitHub Actions via `repository_dispatch`; builds use the 2-layer cache; deploys go to Cloudflare or Japanese rental servers (rsync/FTPS) from one script used by both CI and local runs; a Japanese README documents setup, conventions, and the Cloudflare SSR manual checklist.

**Architecture:** `headless-bridge` gains a `Webhook` class (pure `build_request` unit-tested with PHPUnit; WP-integrated dispatch with admin-notice failure surfacing). `packages/wp-client` gains a content cache (`_fields=id,modified` stub listing → fetch changed only, version-stamped, `NO_CACHE=1` bypass) wired into the site's content loader; Astro's `cacheDir` moves under the repo-root `.cache/` so both cache layers share one CI-persisted directory. `tools/deploy/deploy.sh` is the single deploy entry (rsync / lftp / wrangler, `--dry-run` support); the GitHub Actions workflow calls the same scripts.

**Tech Stack:** PHP 8.2 / PHPUnit 10 (existing), TypeScript / Vitest 4 (existing), bash, GitHub Actions, wrangler 4, rsync, lftp.

**Spec:** `docs/superpowers/specs/2026-08-13-wp-headless2static-design.md`

## Global Constraints

- Commit messages: English, Conventional Commits, lowercase imperative, no trailing period, no Co-Authored-By trailer (`CLAUDE.md`)
- Webhook: `repository_dispatch` with `event_type: wp-content-update`; PAT + `owner/repo` stored in plugin options `headless_bridge_github_token` / `headless_bridge_github_repo`; fires on publish/update/unpublish/delete of post types `post`, `page`, `work` (filterable); failures shown as WP admin notice (Japanese, editor-facing); URL overridable via filter `headless_bridge_webhook_url` (testability)
- Content cache: stub listing via `?_fields=id,modified`; only changed/new items re-fetched; deleted items evicted; global/site data always fetched fresh; cache format carries `CACHE_VERSION` (bump = wipe); `NO_CACHE=1` env bypasses entirely; cache lives in `<repo>/.cache/content/`; Astro image/build cache in `<repo>/.cache/astro/`
- Fail-loud principle unchanged: cache failures fall back to full fetch, never to a partial site
- Deploy: one entry `tools/deploy/deploy.sh` (+ `--dry-run`); config from `tools/deploy/deploy.config` (gitignored; `.example` committed); rental rsync uses `--delete` with excludes `wp/` and `.htaccess`; secrets only from env, never in config files that get committed
- CI: `.github/workflows/build-deploy.yml` triggers on `repository_dispatch` (types: `[wp-content-update]`) + `workflow_dispatch`; `concurrency` group `build-deploy` with `cancel-in-progress: true`; caches `.cache/` via `actions/cache`
- README: Japanese, at repo root (`CLAUDE.md` stays English-only per project rule — the rule does not apply to README)
- Sandbox notes: WP running seeded at localhost:8888; NODE_OPTIONS dns-shim + repo `node_modules/.bin` on PATH before wp-env/smoke/e2e; never start/stop wp-env; api.github.com is reachable

---

### Task 1: Webhook (settings fields + dispatch class, TDD for request building)

**Files:**
- Modify: `wp/plugins/headless-bridge/includes/class-settings.php` (two new fields)
- Create: `wp/plugins/headless-bridge/includes/class-webhook.php`
- Modify: `wp/plugins/headless-bridge/headless-bridge.php` (require + boot)
- Test: `wp/plugins/headless-bridge/tests/WebhookTest.php`

**Interfaces:**
- Produces: options `headless_bridge_github_repo`, `headless_bridge_github_token`; `Webhook::build_request( string $repo, string $token, array $payload ): array` returning `[ $url, $args ]` (pure, unit-tested); action hooks that call `Webhook::dispatch()`; filter `headless_bridge_webhook_url`. Consumed by Task 6's workflow (event name) and README.

- [ ] **Step 1: Extend settings**

In `class-settings.php` `register()`, add after the existing `register_setting` call:

```php
		register_setting( 'headless_bridge', 'headless_bridge_github_repo', [
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		] );
		register_setting( 'headless_bridge', 'headless_bridge_github_token', [
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		] );
```

In `render()`, add two rows to the form table after the Frontend URL row:

```php
					<tr>
						<th scope="row"><label for="headless_bridge_github_repo">GitHub Repository</label></th>
						<td>
							<input name="headless_bridge_github_repo" id="headless_bridge_github_repo"
								type="text" class="regular-text code"
								value="<?php echo esc_attr( get_option( 'headless_bridge_github_repo', '' ) ); ?>"
								placeholder="owner/repo" />
							<p class="description">公開時にビルドを起動するリポジトリ(owner/repo 形式)。</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="headless_bridge_github_token">GitHub Token</label></th>
						<td>
							<input name="headless_bridge_github_token" id="headless_bridge_github_token"
								type="password" class="regular-text code" autocomplete="off"
								value="<?php echo esc_attr( get_option( 'headless_bridge_github_token', '' ) ); ?>" />
							<p class="description">fine-grained PAT(このリポジトリの repository_dispatch のみ許可)。</p>
						</td>
					</tr>
```

- [ ] **Step 2: Write the failing PHPUnit test**

`wp/plugins/headless-bridge/tests/WebhookTest.php`:

```php
<?php
use HeadlessBridge\Webhook;
use PHPUnit\Framework\TestCase;

final class WebhookTest extends TestCase {

	public function test_build_request_shape(): void {
		[ $url, $args ] = Webhook::build_request( 'acme/site', 'tok123', [ 'action' => 'publish_or_update', 'post_id' => 7, 'post_type' => 'post' ] );

		$this->assertSame( 'https://api.github.com/repos/acme/site/dispatches', $url );
		$this->assertSame( 'Bearer tok123', $args['headers']['Authorization'] );
		$this->assertSame( 'application/vnd.github+json', $args['headers']['Accept'] );
		$this->assertSame( 10, $args['timeout'] );

		$body = json_decode( $args['body'], true );
		$this->assertSame( 'wp-content-update', $body['event_type'] );
		$this->assertSame( 7, $body['client_payload']['post_id'] );
		$this->assertSame( 'publish_or_update', $body['client_payload']['action'] );
	}

	public function test_build_request_encodes_body_as_json(): void {
		[ , $args ] = Webhook::build_request( 'a/b', 't', [ 'action' => 'delete', 'post_id' => 1, 'post_type' => 'work' ] );
		$this->assertJson( $args['body'] );
	}
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd wp/plugins/headless-bridge && vendor/bin/phpunit`
Expected: FAIL — class `HeadlessBridge\Webhook` not found (existing 8 tests keep passing: 6 Token + these 2 fail).

Note: `build_request` must not call any WP function (`wp_json_encode` etc.) so it runs under plain PHPUnit — use `json_encode`.

- [ ] **Step 4: Implement**

`wp/plugins/headless-bridge/includes/class-webhook.php`:

```php
<?php
namespace HeadlessBridge;

class Webhook {

	const EVENT_TYPE = 'wp-content-update';

	public static function boot(): void {
		add_action( 'transition_post_status', [ self::class, 'on_transition' ], 10, 3 );
		add_action( 'deleted_post', [ self::class, 'on_delete' ], 10, 2 );
		add_action( 'admin_notices', [ self::class, 'maybe_notice' ] );
	}

	private static function relevant( string $post_type ): bool {
		$types = apply_filters( 'headless_bridge_webhook_post_types', [ 'post', 'page', 'work' ] );
		return in_array( $post_type, $types, true );
	}

	public static function on_transition( string $new_status, string $old_status, \WP_Post $post ): void {
		if ( 'publish' !== $new_status && 'publish' !== $old_status ) {
			return; // neither entering nor leaving publish — draft churn, ignore
		}
		if ( $new_status === $old_status && 'publish' !== $new_status ) {
			return;
		}
		if ( ! self::relevant( $post->post_type ) ) {
			return;
		}
		$action = 'publish' === $new_status ? 'publish_or_update' : 'unpublish';
		self::dispatch( [ 'action' => $action, 'post_id' => $post->ID, 'post_type' => $post->post_type ] );
	}

	public static function on_delete( int $post_id, \WP_Post $post ): void {
		if ( ! self::relevant( $post->post_type ) || 'publish' !== $post->post_status ) {
			return;
		}
		self::dispatch( [ 'action' => 'delete', 'post_id' => $post_id, 'post_type' => $post->post_type ] );
	}

	/** Pure request builder — no WP functions, unit-tested. */
	public static function build_request( string $repo, string $token, array $payload ): array {
		$url  = "https://api.github.com/repos/{$repo}/dispatches";
		$args = [
			'headers' => [
				'Authorization'        => 'Bearer ' . $token,
				'Accept'               => 'application/vnd.github+json',
				'X-GitHub-Api-Version' => '2022-11-28',
				'Content-Type'         => 'application/json',
			],
			'body'    => json_encode( [ 'event_type' => self::EVENT_TYPE, 'client_payload' => $payload ] ),
			'timeout' => 10,
		];
		return [ $url, $args ];
	}

	public static function dispatch( array $payload ): void {
		$repo  = (string) get_option( 'headless_bridge_github_repo', '' );
		$token = (string) get_option( 'headless_bridge_github_token', '' );
		if ( '' === $repo || '' === $token ) {
			return; // webhook not configured — silently skip (manual-deploy workflow)
		}
		[ $url, $args ] = self::build_request( $repo, $token, $payload );
		$url            = apply_filters( 'headless_bridge_webhook_url', $url );

		$res  = wp_remote_post( $url, $args );
		$code = is_wp_error( $res ) ? 0 : (int) wp_remote_retrieve_response_code( $res );
		if ( $code < 200 || $code >= 300 ) {
			$detail = is_wp_error( $res ) ? $res->get_error_message() : "HTTP {$code}";
			set_transient( 'headless_bridge_webhook_error', $detail, DAY_IN_SECONDS );
		} else {
			delete_transient( 'headless_bridge_webhook_error' );
		}
	}

	public static function maybe_notice(): void {
		$error = get_transient( 'headless_bridge_webhook_error' );
		if ( ! $error ) {
			return;
		}
		echo '<div class="notice notice-error"><p>Headless Bridge: ビルドの起動に失敗しました。公開した内容がサイトに反映されていない可能性があります(' . esc_html( $error ) . ')</p></div>';
	}
}
```

Wire into `headless-bridge.php`: `require_once __DIR__ . '/includes/class-webhook.php';` after the existing requires, `Webhook::boot();` in `Plugin::boot()`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd wp/plugins/headless-bridge && composer dump-autoload && vendor/bin/phpunit`
Expected: 8 tests pass (6 Token + 2 Webhook).

- [ ] **Step 6: Live behavior check (failure path + notice)**

Configure a deliberately-invalid repo/token and publish a post; the dispatch must fail (GitHub 404/401) and set the transient:

```bash
cd wp
wp-env run cli wp option update headless_bridge_github_repo "invalid/invalid"
wp-env run cli wp option update headless_bridge_github_token "dummy-token"
wp-env run cli wp post create --post_title="Webhook Test" --post_status=publish --porcelain
wp-env run cli wp transient get headless_bridge_webhook_error
```

Expected: transient prints `HTTP 404` (or 401). Then clean up: delete the created post (`--force`), `wp option update headless_bridge_github_repo ""`, `wp transient delete headless_bridge_webhook_error`. (Success path against real GitHub needs a real PAT — covered by README's setup docs and the filter override; not automatable here.)

- [ ] **Step 7: Commit**

```bash
git add wp/plugins/headless-bridge
git commit -m "feat(headless-bridge): dispatch github builds on publish with admin notice on failure"
```

---

### Task 2: Content cache in wp-client (TDD)

**Files:**
- Create: `packages/wp-client/src/cache.ts`
- Modify: `packages/wp-client/src/client.ts` (add stub-listing + single-item methods)
- Modify: `packages/wp-client/src/index.ts` (export new API)
- Test: `packages/wp-client/test/cache.test.ts`

**Interfaces:**
- Consumes: `createWpClient` internals, `fetchJsonWithRetry`.
- Produces:
  - New client methods: `getPostStubs(type: 'posts'|'pages'|'works'): Promise<{id:number; modified:string}[]>` (paginated `?_fields=id,modified`), `getPostById(type, id): Promise<WpRestPost-mapped item>` (single fetch with `_embed=1` for posts/works)
  - `CACHE_VERSION` constant (number)
  - `createCachedContent({ client, cacheDir, disabled?, log? })` → `{ load(type, map): Promise<T[]> }` used by Task 3's loader. Semantics: read `<cacheDir>/<type>.json` (`{version, items: Record<id, {modified, data}>}`); wrong/missing version → treat as empty; fetch stubs; reuse entries whose `modified` matches; fetch changed/new by id; evict absent ids; write back; on ANY cache-layer error fall back to the client's full `getAll*` fetch (fail-safe, never partial); `disabled` → straight full fetch; `log(reused, fetched)` callback for build output.

- [ ] **Step 1: Write the failing tests**

`packages/wp-client/test/cache.test.ts` — use `node:fs` with a temp dir (`fs.mkdtempSync(os.tmpdir()+'/cache-test-')`); count fetch calls via an injected `fetchFn` that serves: stub listings (`_fields=id,modified`), full collections, and single items. Six tests:

```ts
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/wp-client && pnpm test`
Expected: FAIL — cannot resolve `../src/cache.ts` (existing 13 tests keep passing).

- [ ] **Step 3: Implement**

Add to `client.ts` (inside `createWpClient`'s returned object, plus a small helper):

```ts
		getPostStubs: (type: 'posts' | 'pages' | 'works') =>
			allPages(`/wp-json/wp/v2/${type}?_fields=id,modified&`, (p) => ({
				id: p.id,
				modified: (p as unknown as { modified: string }).modified ?? p.modified_gmt,
			})),
		getPostById: (type: 'posts' | 'pages' | 'works', id: number) =>
			fetchJsonWithRetry<WpRestPost>(
				`${base}/wp-json/wp/v2/${type}/${id}${type === 'pages' ? '' : '?_embed=1'}`,
				opts,
			),
```

`packages/wp-client/src/cache.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WpClient } from './client.ts';
import type { WpRestPost } from './map.ts';

export const CACHE_VERSION = 1;

type CollectionType = 'posts' | 'pages' | 'works';

interface CacheFile {
	version: number;
	items: Record<string, { modified: string; data: WpRestPost }>;
}

export interface CachedContentOptions {
	client: WpClient;
	cacheDir: string;
	disabled?: boolean;
	log?: (type: CollectionType, reused: number, fetched: number) => void;
}

const FULL: Record<CollectionType, (c: WpClient) => Promise<unknown[]>> = {
	posts: (c) => c.getAllPosts(),
	pages: (c) => c.getAllPages(),
	works: (c) => c.getAllWorks(),
};

export function createCachedContent({ client, cacheDir, disabled = false, log }: CachedContentOptions) {
	async function load<T>(type: CollectionType, map: (p: WpRestPost) => T): Promise<T[]> {
		if (disabled) {
			return (await FULL[type](client)) as T[];
		}
		try {
			const file = join(cacheDir, `${type}.json`);
			let cache: CacheFile = { version: CACHE_VERSION, items: {} };
			if (existsSync(file)) {
				const parsed = JSON.parse(readFileSync(file, 'utf8')) as CacheFile;
				if (parsed.version === CACHE_VERSION && parsed.items) {
					cache = parsed;
				}
			}

			const stubs = await client.getPostStubs(type);
			const next: CacheFile = { version: CACHE_VERSION, items: {} };
			let reused = 0;
			let fetched = 0;
			for (const stub of stubs) {
				const hit = cache.items[String(stub.id)];
				if (hit && hit.modified === stub.modified) {
					next.items[String(stub.id)] = hit;
					reused++;
				} else {
					const data = await client.getPostById(type, stub.id);
					next.items[String(stub.id)] = { modified: stub.modified, data };
					fetched++;
				}
			}

			mkdirSync(cacheDir, { recursive: true });
			writeFileSync(file, JSON.stringify(next));
			log?.(type, reused, fetched);
			return Object.values(next.items).map((e) => map(e.data));
		} catch (e) {
			// Cache layer must never produce a partial site: fall back to the plain full fetch.
			console.warn(`content cache disabled for ${type} (${String(e)}) — falling back to full fetch`);
			return (await FULL[type](client)) as T[];
		}
	}

	return { load };
}
```

Export from `index.ts`: `export { CACHE_VERSION, createCachedContent } from './cache.ts';` and re-export `mapPost, mapPage, mapWork` from `./map.ts` (the site loader needs them for `load(type, map)`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/wp-client && pnpm test`
Expected: 19 tests pass (13 existing + 6 cache).

- [ ] **Step 5: Commit**

```bash
git add packages/wp-client
git commit -m "feat(wp-client): add versioned content cache with modified-based invalidation"
```

---

### Task 3: Wire cache into the site build

**Files:**
- Modify: `apps/site/src/lib/content.ts`
- Modify: `apps/site/astro.config.mjs` (cacheDir)
- Modify: `.env.example` (NO_CACHE note)

**Interfaces:**
- Consumes: `createCachedContent`, `mapPost/mapPage/mapWork`, `CACHE_VERSION`.
- Produces: builds that reuse `<repo>/.cache/content/`; Astro cache at `<repo>/.cache/astro/`; `NO_CACHE=1 pnpm build` full-fetches. Fail-loud behavior unchanged (health check first; total failure still exits 1 — the cache's internal fallback only covers cache-layer errors, and its full fetch failing propagates to the existing catch).

- [ ] **Step 1: Rewire the loader**

In `apps/site/src/lib/content.ts`, replace the `Promise.all([wp.getAllPosts(), ...])` block with the cached loader (keep everything else — health-first, both catch blocks, exact Japanese messages, memoization):

```ts
import { fileURLToPath } from 'node:url';
import { createCachedContent, mapPage, mapPost, mapWork } from '@repo/wp-client';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

const cached = createCachedContent({
	client: wp,
	cacheDir: `${repoRoot}.cache/content`,
	disabled: process.env.NO_CACHE === '1',
	log: (type, reused, fetched) => console.log(`content cache [${type}]: ${reused} reused, ${fetched} fetched`),
});
```

and in `load()`:

```ts
		const [posts, pages, works] = await Promise.all([
			cached.load('posts', mapPost),
			cached.load('pages', mapPage),
			cached.load('works', mapWork),
		]);
		return { posts, pages, works };
```

(`content.ts` is at `apps/site/src/lib/`, so `../../../..` resolves to the repo root — verify with a `console.log` during Step 3 if in doubt.)

- [ ] **Step 2: Astro cacheDir + env docs**

In `astro.config.mjs`, add to BOTH config branches: `cacheDir: new URL('../../.cache/astro', import.meta.url).pathname,`
In `.env.example`, append:

```bash
# 1 でコンテンツキャッシュを無効化(常にフル取得)
# NO_CACHE=1
```

- [ ] **Step 3: Verify against the live WP**

```bash
rm -rf .cache
pnpm build 2>&1 | grep "content cache"   # first run: 0 reused, N fetched (per type)
pnpm build 2>&1 | grep "content cache"   # second run: N reused, 0 fetched
NO_CACHE=1 pnpm build 2>&1 | grep -c "content cache" # 0 lines (cache bypassed)
```

Also confirm the second build's output equals the first (spot-check `dist/posts/hello-headless/index.html` still contains "Hello Headless") and `.cache/astro/` exists after a build.

- [ ] **Step 4: Commit**

```bash
git add apps/site .env.example
git commit -m "feat(site): use content cache and persist astro cache under repo cache dir"
```

---

### Task 4: Deploy scripts (rsync / lftp / wrangler + dry-run)

**Files:**
- Create: `tools/deploy/deploy.sh`, `tools/deploy/deploy.config.example`, `tools/deploy/htaccess-wp-admin.example`
- Modify: `.gitignore` (add `tools/deploy/deploy.config`), root `package.json` (`"site:deploy": "bash tools/deploy/deploy.sh"`), spec dev-flow line
- **Naming ruling:** the spec's `pnpm deploy` is SHADOWED by pnpm's built-in `deploy` subcommand (same trap as `pnpm setup` → `bootstrap` in Plan 1). The root script is therefore named `site:deploy` (consistent with `site:preview`), and the spec's dev-flow line `pnpm deploy     # tools/deploy 経由でデプロイ(手動ルート)` is updated to `pnpm site:deploy # tools/deploy 経由でデプロイ(手動ルート)` in the same commit.

**Interfaces:**
- Produces: `pnpm site:deploy [-- --dry-run]`; config contract consumed by CI (Task 5) and README. Secrets (SSH key, FTP pass, CF token) come from env only.

- [ ] **Step 1: Config example**

`tools/deploy/deploy.config.example`:

```bash
# コピーして tools/deploy/deploy.config を作成(gitignore 済み)
DEPLOY_TARGET=rental            # rental | cloudflare
DEPLOY_METHOD=rsync             # rsync | lftp (rental のみ)

# --- rental (rsync over SSH) ---
RENTAL_HOST=example.jp
RENTAL_USER=youruser
RENTAL_PATH=/home/youruser/example.jp/public_html
RENTAL_PORT=22
# WP 同居時(パターン①)は wp/ と .htaccess を必ず exclude に残すこと
RSYNC_EXCLUDES="wp/ .htaccess"

# --- rental (lftp / FTPS: SSH 非対応サーバー向け) ---
FTP_HOST=ftp.example.jp
FTP_USER=youruser
# パスワードは環境変数 FTP_PASSWORD で渡す(このファイルに書かない)

# --- cloudflare ---
CF_PAGES_PROJECT=your-project   # shell モード(静的)の Pages プロジェクト名
# 認証は環境変数 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID で渡す
```

- [ ] **Step 2: Deploy script**

`tools/deploy/deploy.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

DIST="apps/site/dist"
CONFIG="${DEPLOY_CONFIG:-tools/deploy/deploy.config}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

[ -f "$CONFIG" ] || { echo "設定ファイルがありません: $CONFIG (deploy.config.example をコピーしてください)"; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG"
[ -d "$DIST" ] || { echo "ビルド出力がありません: $DIST (先に pnpm build を実行してください)"; exit 1; }

run() {
	if [ "$DRY_RUN" = "1" ]; then
		printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'
	else
		"$@"
	fi
}

case "${DEPLOY_TARGET:?DEPLOY_TARGET is required}" in
	rental)
		case "${DEPLOY_METHOD:-rsync}" in
			rsync)
				EXCLUDE_ARGS=()
				for e in ${RSYNC_EXCLUDES:-}; do EXCLUDE_ARGS+=( "--exclude=$e" ); done
				run rsync -az --delete "${EXCLUDE_ARGS[@]}" \
					-e "ssh -p ${RENTAL_PORT:-22}" \
					"$DIST/" "${RENTAL_USER:?}@${RENTAL_HOST:?}:${RENTAL_PATH:?}/"
				;;
			lftp)
				: "${FTP_PASSWORD:?FTP_PASSWORD env var is required for lftp deploys}"
				run lftp -u "${FTP_USER:?},${FTP_PASSWORD}" -e \
					"set ftp:ssl-force true; mirror -R --delete --parallel=4 $DIST ${RENTAL_PATH:?}; quit" \
					"${FTP_HOST:?}"
				;;
			*) echo "unknown DEPLOY_METHOD: $DEPLOY_METHOD"; exit 1 ;;
		esac
		;;
	cloudflare)
		if [ -d "$DIST/server" ]; then
			run pnpm --filter site exec wrangler deploy
		else
			run pnpm --filter site exec wrangler pages deploy "$DIST" --project-name "${CF_PAGES_PROJECT:?}"
		fi
		;;
	*) echo "unknown DEPLOY_TARGET: $DEPLOY_TARGET"; exit 1 ;;
esac
echo "deploy: done (target=$DEPLOY_TARGET dry_run=$DRY_RUN)"
```

`tools/deploy/htaccess-wp-admin.example` (spec's 雛形 for pattern ③, WP side):

```apache
# WP 側 .htaccess に追記する雛形:
# 管理画面(/wp-admin, wp-login.php)のみ Basic 認証、REST API は素通し。
# .htpasswd は各サーバーの案内に従って生成すること。
<IfModule mod_setenvif.c>
	SetEnvIf Request_URI "^/wp-json/" allow_rest
</IfModule>
<FilesMatch "wp-login\.php">
	AuthType Basic
	AuthName "Restricted"
	AuthUserFile /home/youruser/.htpasswd
	Require valid-user
</FilesMatch>
```

- [ ] **Step 3: Verify (dry-run + local rsync)**

```bash
chmod +x tools/deploy/deploy.sh
echo "tools/deploy/deploy.config" # add to .gitignore
cp tools/deploy/deploy.config.example tools/deploy/deploy.config
pnpm build > /dev/null
pnpm site:deploy -- --dry-run          # prints the rsync command with excludes
```

Local end-to-end rsync check (simulates a rental server dir with WP living inside):

```bash
TARGET=$(mktemp -d)
mkdir -p "$TARGET/wp" && echo "wp-config" > "$TARGET/wp/wp-config.php" && echo "old" > "$TARGET/stale.html"
rsync -az --delete --exclude=wp/ --exclude=.htaccess apps/site/dist/ "$TARGET/"
test -f "$TARGET/wp/wp-config.php" && test ! -f "$TARGET/stale.html" && test -f "$TARGET/index.html" && echo "RSYNC SEMANTICS OK"
rm -rf "$TARGET" tools/deploy/deploy.config
```

Expected: `RSYNC SEMANTICS OK` (wp/ preserved, stale file deleted, site synced). lftp/wrangler branches are validated via `--dry-run` output only (no live servers here).

- [ ] **Step 4: Commit**

```bash
git add tools/deploy .gitignore package.json
git commit -m "feat(deploy): add unified deploy script for rsync lftp and wrangler targets"
```

---

### Task 5: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/build-deploy.yml`

**Interfaces:**
- Consumes: webhook event `wp-content-update` (Task 1), `tools/deploy/deploy.sh` (Task 4), cache dirs (Task 3).
- Produces: CI pipeline. Repository configuration contract (documented in README): Variables `DEPLOY_TARGET` (`rental`|`cloudflare`), `WP_API_URL`, `PREVIEW_MODE`; Secrets `RENTAL_SSH_KEY`, `RENTAL_HOST`, `RENTAL_USER`, `RENTAL_PATH`, `FTP_PASSWORD`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

- [ ] **Step 1: Write the workflow**

`.github/workflows/build-deploy.yml`:

```yaml
name: build-deploy

on:
  repository_dispatch:
    types: [wp-content-update]
  workflow_dispatch:
    inputs:
      no_cache:
        description: "キャッシュを使わずフルビルド"
        type: boolean
        default: false

concurrency:
  group: build-deploy
  cancel-in-progress: true

jobs:
  build-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Restore build caches
        if: ${{ !inputs.no_cache }}
        uses: actions/cache@v4
        with:
          path: .cache
          key: build-cache-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
          restore-keys: build-cache-${{ runner.os }}-

      - name: Build
        run: pnpm build
        env:
          WP_API_URL: ${{ vars.WP_API_URL }}
          PREVIEW_MODE: ${{ vars.PREVIEW_MODE }}
          NO_CACHE: ${{ inputs.no_cache && '1' || '' }}

      - name: Set up SSH (rental rsync)
        if: ${{ vars.DEPLOY_TARGET == 'rental' }}
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.RENTAL_SSH_KEY }}

      - name: Deploy
        run: |
          cat > tools/deploy/deploy.config <<EOF
          DEPLOY_TARGET=${{ vars.DEPLOY_TARGET }}
          DEPLOY_METHOD=${{ vars.DEPLOY_METHOD || 'rsync' }}
          RENTAL_HOST=${{ secrets.RENTAL_HOST }}
          RENTAL_USER=${{ secrets.RENTAL_USER }}
          RENTAL_PATH=${{ secrets.RENTAL_PATH }}
          RENTAL_PORT=${{ secrets.RENTAL_PORT || 22 }}
          RSYNC_EXCLUDES="wp/ .htaccess"
          FTP_HOST=${{ secrets.FTP_HOST }}
          FTP_USER=${{ secrets.FTP_USER }}
          CF_PAGES_PROJECT=${{ vars.CF_PAGES_PROJECT }}
          EOF
          bash tools/deploy/deploy.sh
        env:
          FTP_PASSWORD: ${{ secrets.FTP_PASSWORD }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Add `known_hosts` handling note as a comment in the SSH step if `ssh-keyscan` is needed: insert a step `run: ssh-keyscan -p "${{ secrets.RENTAL_PORT || 22 }}" "${{ secrets.RENTAL_HOST }}" >> ~/.ssh/known_hosts` guarded by the same `if`.

- [ ] **Step 2: Validate YAML**

Run: `pnpm dlx js-yaml .github/workflows/build-deploy.yml > /dev/null && echo "YAML OK"`
Expected: `YAML OK`. (CI cannot run in this environment — the workflow's live validation happens on the first real push; README documents the required Variables/Secrets.)

- [ ] **Step 3: Commit**

```bash
git add .github
git commit -m "ci: add build and deploy workflow triggered by wordpress publishes"
```

---

### Task 6: Housekeeping — token redaction + spec wording

**Files:**
- Modify: `packages/wp-client/src/http.ts` (redact token in error messages)
- Test: `packages/wp-client/test/http.test.ts` (one new test)
- Modify: `docs/superpowers/specs/2026-08-13-wp-headless2static-design.md` (wording)

**Interfaces:**
- Produces: `WpClientError.message` never contains a live preview token (parked finding #7 from Plan 2 final review); spec uses 「WordPress 管理画面」/「WordPress に接続できません」 consistently (parked finding #8 — plan wording is canon).

- [ ] **Step 1: Failing test**

Add to `http.test.ts`:

```ts
	it('redacts token values in error messages', async () => {
		const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
		const err = await fetchJsonWithRetry('http://x/y?token=secret123', { fetchFn, sleepFn: noSleep }).catch((e) => e);
		expect(err.message).not.toContain('secret123');
		expect(err.message).toContain('token=***');
	});
```

Run: `cd packages/wp-client && pnpm test` → this test FAILS.

- [ ] **Step 2: Implement**

In `http.ts`, add near the top:

```ts
const redact = (url: string) => url.replace(/([?&]token=)[^&]+/g, '$1***');
```

and use `redact(url)` in BOTH message constructions (`HTTP ${res.status} for ${redact(url)}` and the network-error message). The `WpClientError.url` property keeps the raw URL (needed programmatically; only messages are redacted).

Run: `pnpm test` → 20 wp-client tests pass.

- [ ] **Step 3: Spec wording**

In the spec, replace the two Japanese UI strings to match the implemented canon:
- 「プレビューの有効期限が切れました。WP 管理画面からプレビューを開き直してください」 → 「プレビューの有効期限が切れました。WordPress 管理画面からプレビューを開き直してください。」
- 「WP に接続できません」 → 「WordPress に接続できません。」

- [ ] **Step 4: Commit**

```bash
git add packages/wp-client docs/superpowers/specs/2026-08-13-wp-headless2static-design.md
git commit -m "fix(wp-client): redact preview tokens in error messages"
```

---

### Task 7: README (Japanese)

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything. Produces: the boilerplate's front door. MUST cover every item the spec and prior-plan reviews assigned to the README (listed in Step 1). Written in Japanese (CLAUDE.md's English-only rule applies to CLAUDE.md, not README).

- [ ] **Step 1: Write README.md**

Required sections and REQUIRED facts (write full prose around them — structure below is binding, wording is the implementer's):

```markdown
# wp-headless2static
- 概要: WordPress (Headless CMS) + Astro 静的ビルドのモノレポボイラープレート。構成図(テキストで可): WP → (REST/build) → Astro → dist → CF Pages / レンサバ。プレビューは shell(静的シェル+JS)/ ssr(CF Workers)の 2 モード。
- 必要環境: Node >= 22.12, pnpm >= 9, Docker (ローカル WP 用), PHP 8.1+ & Composer (プラグイン開発時のみ)

## クイックスタート
- pnpm install → pnpm bootstrap(wp-env 起動+シード。プラグイン/テーマ自動セット、記事・実績サンプル投入)→ pnpm dev
- 管理画面 http://localhost:8888/wp-admin (admin/password)。「プレビュー」ボタン → localhost:4321 の本番同等プレビュー

## 環境変数と .env
- `.env` は「リポジトリルート」に置く(.env.example コピー)。シェルの環境変数が常に優先
- WP_API_URL / PREVIEW_MODE(shell|ssr)/ NO_CACHE=1
- 重要: PREVIEW_MODE はアダプタ切替に効く(astro.config がルート .env を先読みする実装)

## プレビューの仕組み
- トークン(HMAC, 10分)付き URL /preview/?id=&token=。プラグイン設定「Frontend URL」は必ず **オリジンのみ**(パス禁止・末尾スラッシュ不要)— CORS 照合がオリジン単位のため
- shell: 静的ホスティングだけで動く。カスタムフィールド駆動ブロックは packages/shared の純関数規約(renderWorkMeta 参照)
- ssr: CF Workers で本番同一コンポーネント描画。**Workers 側に WP_API_URL / PREVIEW_MODE 環境変数の設定が必要**

## コンテンツモデル規約
- CPT 追加は wp/plugins/site-config 参照。メタは必ず register_post_meta(..., revisions_enabled: true, show_in_rest: true)(WP 6.4+)
- revisions_enabled なしのメタは「最後に保存された値」でプレビューされる(制約)

## ビルドと 2 層キャッシュ
- 毎回フル HTML 生成だが、コンテンツ取得(modified 差分)と Astro キャッシュは .cache/ に永続化
- 疑わしいときは NO_CACHE=1 pnpm build。キャッシュ形式変更時は自動全破棄(CACHE_VERSION)

## 自動ビルド(webhook)
- WP 設定 → Headless Bridge に owner/repo と fine-grained PAT(repository_dispatch のみ許可)を設定
- 公開/更新/削除 → GitHub Actions が起動。失敗時は WP 管理画面に通知が出る

## デプロイ
- 3 つの配置パターン表(同居サブディレクトリ/同居サブドメイン/完全分離)+ それぞれの注意(rsync exclude, CORS)
- tools/deploy/deploy.config.example をコピーして設定。pnpm site:deploy / pnpm site:deploy -- --dry-run
- rsync は差分同期: 中断しても壊れず古いファイルが残るだけ
- WP 同居時は wp/ と .htaccess の exclude を外さないこと
- WP 管理画面の保護: Basic 認証 or IP 制限を推奨。REST は素通しにする(tools/deploy/htaccess-wp-admin.example)

## CI(GitHub Actions)
- 必要な Variables: DEPLOY_TARGET, DEPLOY_METHOD, WP_API_URL, PREVIEW_MODE, CF_PAGES_PROJECT
- 必要な Secrets: RENTAL_SSH_KEY/HOST/USER/PATH/PORT, FTP_HOST/USER/PASSWORD, CLOUDFLARE_API_TOKEN/ACCOUNT_ID
- concurrency で同時ビルド 1 本化(最新のみ実行)

## Cloudflare SSR の手動検証チェックリスト(初回デプロイ時)
- wrangler ログイン → PREVIEW_MODE=ssr pnpm build → pnpm site:deploy
- Workers の環境変数(WP_API_URL, PREVIEW_MODE=ssr)を設定 → WP からプレビューを開いて描画確認
- WP 側 CORS 設定(Frontend URL)を本番オリジンに更新

## テスト
- pnpm test(Vitest)/ cd wp/plugins/headless-bridge && vendor/bin/phpunit / bash tools/smoke/preview-endpoint.sh / pnpm e2e
- E2E 初回は npx playwright install --with-deps chromium が必要

## スケール上の注意
- 数百〜数千記事想定。それ以上はキャッシュ+分割取得の強化を検討
```

- [ ] **Step 2: Self-check against the carry-over list**

Confirm the README covers ALL of: bare-origin Frontend URL 規約 / .env の場所と優先順位 / PREVIEW_MODE がアダプタ切替に効くこと / Workers 環境変数 / revisions_enabled 規約と非対応メタの制約 / rsync 特性と exclude / PAT スコープ / 管理画面保護と REST 素通し / NO_CACHE 安全弁 / playwright install --with-deps / CF 手動検証チェックリスト。Missing any = incomplete task.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add japanese readme covering setup conventions and operations"
```

---

### Task 8: Full-suite integration pass

**Files:**
- Modify: only what the checks surface.

- [ ] **Step 1: Run everything**

```bash
pnpm test                                    # vitest: 4 shared + 20 wp-client = 24
cd wp/plugins/headless-bridge && vendor/bin/phpunit && cd ../../..   # 8 tests
bash tools/smoke/preview-endpoint.sh         # 6 checks SMOKE PASS
rm -rf .cache && pnpm build 2>&1 | grep "content cache"   # cold: fetched>0
pnpm build 2>&1 | grep "content cache"                     # warm: reused>0, 0 fetched
pnpm e2e                                     # 1 PASS
PREVIEW_MODE=ssr pnpm build                  # worker layout, no dist/preview/index.html
pnpm build                                   # final shell dist
pnpm dlx js-yaml .github/workflows/build-deploy.yml > /dev/null && echo "YAML OK"
cp tools/deploy/deploy.config.example tools/deploy/deploy.config && pnpm site:deploy -- --dry-run && rm tools/deploy/deploy.config
```

Expected: all green. (Env exports for wp-env-touching steps as usual.)

- [ ] **Step 2: Commit (only if fixes were needed)**

---

## Out of scope

- Cloudflare 実機デプロイと Workers ランタイム検証(README のチェックリストとして提供 — 実アカウントが必要)
- lftp の実サーバー検証(dry-run のみ)
- CI の実行検証(初回 push 時)
- WPGraphQL 実装、多言語、検索(スペックのスコープ外リストどおり)
