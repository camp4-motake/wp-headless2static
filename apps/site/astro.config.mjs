import { defineConfig } from 'astro/config';

const PREVIEW_MODE = process.env.PREVIEW_MODE ?? 'shell';

// @astrojs/cloudflare pulls in `wrangler`, which — merely by being imported,
// no CLI command or API call required — detects HTTP_PROXY/HTTPS_PROXY and
// installs a global undici dispatcher (`setGlobalDispatcher(new ProxyAgent(...))`)
// that routes ALL subsequent fetch() calls in this Node process through that
// proxy, ignoring NO_PROXY entirely. That breaks our own WP_API_URL fetches
// (typically http://localhost:8888) during prerendering in ssr mode, since a
// dev/CI proxy set up for genuine outbound traffic doesn't allow localhost.
// Hiding the proxy env vars for the moment of the import keeps wrangler from
// touching the dispatcher at all, so Node's own built-in proxy handling
// (NODE_USE_ENV_PROXY, which does honor NO_PROXY) is left in place.
async function loadCloudflareAdapter() {
	const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
	const saved = Object.fromEntries(proxyVars.map((key) => [key, process.env[key]]));
	for (const key of proxyVars) delete process.env[key];
	try {
		const { default: cloudflare } = await import('@astrojs/cloudflare');
		return cloudflare();
	} finally {
		for (const key of proxyVars) {
			if (saved[key] !== undefined) process.env[key] = saved[key];
		}
	}
}

export default defineConfig(
	PREVIEW_MODE === 'ssr'
		? {
				output: 'server',
				adapter: await loadCloudflareAdapter(),
			}
		: {
				output: 'static',
			},
);
