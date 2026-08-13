import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const WP_DIR = new URL('../../../wp', import.meta.url).pathname;

// `wp-env run cli` prints its own status/log lines (e.g. "ℹ Starting ..." and
// "✔ Ran ... in 'cli'.") around the actual wp-cli output. The value we want
// (a --porcelain id, or an eval'd URL) is always the last non-empty line.
function cli(args: string): string {
	const output = execSync(`wp-env run cli wp ${args}`, { cwd: WP_DIR, encoding: 'utf8' });
	const lines = output.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
	return lines[lines.length - 1] ?? '';
}

test('editor draft renders in the preview shell', async ({ page }) => {
	const draftId = cli(
		`post create --post_title="E2E Preview Draft" --post_status=draft --post_content="<p>e2e-preview-body</p>" --porcelain`,
	);
	try {
		const previewUrl = cli(`eval "echo get_preview_post_link( ${draftId} );"`);
		const { pathname, search } = new URL(previewUrl);
		await page.goto(pathname + search);
		await expect(page.locator('#preview-title')).toHaveText('E2E Preview Draft');
		await expect(page.locator('#preview-body')).toContainText('e2e-preview-body');
	} finally {
		cli(`post delete ${draftId} --force`);
	}
});
