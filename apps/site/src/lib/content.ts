import type { Page, Post, Work } from '@repo/shared';
import { fileURLToPath } from 'node:url';
import { WpClientError, createCachedContent, createWpClient, mapPage, mapPost, mapWork } from '@repo/wp-client';

export const WP_API_URL = (process.env.WP_API_URL ?? 'http://localhost:8888').replace(/\/$/, '');

export const wp = createWpClient({ baseUrl: WP_API_URL });

export interface SiteContent {
	posts: Post[];
	pages: Page[];
	works: Work[];
}

let cache: Promise<SiteContent> | null = null;

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

const cached = createCachedContent({
	client: wp,
	cacheDir: `${repoRoot}/.cache/content`,
	disabled: process.env.NO_CACHE === '1',
	log: (type, reused, fetched) => console.log(`content cache [${type}]: ${reused} reused, ${fetched} fetched`),
});

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
		const [posts, pages, works] = await Promise.all([
			cached.load('posts', mapPost),
			cached.load('pages', mapPage),
			cached.load('works', mapWork),
		]);
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
