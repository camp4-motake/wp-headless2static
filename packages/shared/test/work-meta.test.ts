import { describe, expect, it } from 'vitest';
import { renderWorkMeta } from '../src/render/work-meta.ts';

describe('renderWorkMeta', () => {
	it('renders client name and linked project url', () => {
		const html = renderWorkMeta({ client_name: 'ACME Inc.', project_url: 'https://example.com' });
		expect(html).toContain('<dl class="work-meta">');
		expect(html).toContain('ACME Inc.');
		expect(html).toContain('<a href="https://example.com"');
	});

	it('escapes html in values', () => {
		const html = renderWorkMeta({ client_name: '<script>x</script>' });
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('omits missing fields and returns empty string when meta is empty', () => {
		expect(renderWorkMeta({})).toBe('');
		const html = renderWorkMeta({ client_name: 'A' });
		expect(html).not.toContain('project_url');
		expect(html).not.toContain('<a ');
	});

	it('drops non-http(s) project urls', () => {
		const html = renderWorkMeta({ client_name: 'A', project_url: 'javascript:alert(1)' });
		expect(html).not.toContain('<a ');
	});
});
