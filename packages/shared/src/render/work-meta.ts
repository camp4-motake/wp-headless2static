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
