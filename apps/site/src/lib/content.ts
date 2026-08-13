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
