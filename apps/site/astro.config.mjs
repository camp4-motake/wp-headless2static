import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

// Astro only injects the contents of `.env` into `process.env` once Vite's
// buildStart hook runs — but the shell/ssr adapter choice below happens here,
// synchronously, at config-evaluation time, which is before that hook fires.
// `.env.example` documents vars (like PREVIEW_MODE) relative to the repo
// root, so hydrate process.env from that same repo-root `.env` file now,
// via Vite's own loadEnv, so the adapter switch actually sees them. A real
// shell-exported PREVIEW_MODE still takes precedence over the file.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'production', repoRoot, '');
for (const [key, value] of Object.entries(fileEnv)) {
	process.env[key] ??= value; // real shell env always wins
}

const PREVIEW_MODE = process.env.PREVIEW_MODE ?? 'shell';

// Astro 7 changed the default `compressHTML` from `true` (HTML-aware
// compression) to `'jsx'` (JSX-style whitespace stripping), which removes
// meaningful inline whitespace — e.g. the space between a post title link and
// its <time> on the list pages. Pin the pre-v7 behavior to keep the rendered
// HTML unchanged.
const compressHTML = true;

// A proxy-env workaround used to live here: importing `@astrojs/cloudflare`
// pulled in `wrangler`, whose module init replaced undici's global dispatcher
// with a `ProxyAgent` that ignored NO_PROXY, breaking WP_API_URL fetches to
// localhost during ssr-mode prerendering when HTTP(S)_PROXY was set. That is
// fixed upstream: wrangler now installs an `EnvHttpProxyAgent` that honors
// NO_PROXY and excludes localhost by default
// (`noProxy || 'localhost,127.0.0.1,::1'`), and since @astrojs/cloudflare v13
// prerendering runs inside workerd, whose fetch() never goes through Node's
// undici dispatcher anyway. Verified with @astrojs/cloudflare 14.2.1 +
// wrangler 4.122.0: an ssr build with HTTP(S)_PROXY set succeeds without the
// workaround. The import stays lazy so shell-mode builds never load wrangler.
async function loadCloudflareAdapter() {
	const { default: cloudflare } = await import('@astrojs/cloudflare');
	return cloudflare();
}

export default defineConfig(
	PREVIEW_MODE === 'ssr'
		? {
				output: 'server',
				adapter: await loadCloudflareAdapter(),
				compressHTML,
				cacheDir: new URL('../../.cache/astro', import.meta.url).pathname,
			}
		: {
				output: 'static',
				compressHTML,
				cacheDir: new URL('../../.cache/astro', import.meta.url).pathname,
			},
);
