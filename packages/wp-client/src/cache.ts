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
			return stubs.map((stub) => map(next.items[String(stub.id)]!.data));
		} catch (e) {
			// Cache layer must never produce a partial site: fall back to the plain full fetch.
			console.warn(`content cache disabled for ${type} (${String(e)}) — falling back to full fetch`);
			return (await FULL[type](client)) as T[];
		}
	}

	return { load };
}
