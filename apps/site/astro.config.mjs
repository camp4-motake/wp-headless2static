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
