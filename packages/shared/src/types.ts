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
