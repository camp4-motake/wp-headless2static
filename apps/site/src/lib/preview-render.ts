import { renderWorkMeta, type PreviewData, type WorkMeta } from '@repo/shared';

/** Renders the preview body (meta block + content HTML). Pure; runs in browser AND on the server. */
export function renderPreviewHtml(data: PreviewData): string {
	const metaHtml = data.type === 'work' ? renderWorkMeta(data.meta as WorkMeta) : '';
	return `${metaHtml}${data.content}`;
}
