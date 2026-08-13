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
