# wp-headless2static

Monorepo boilerplate: WordPress (headless CMS) + Astro static builds. Delivery pipeline complete (webhook → GitHub Actions → deploy). Detailed docs: `README.md` (Japanese). Design spec: `docs/superpowers/specs/2026-08-13-wp-headless2static-design.md`.

## Layout

- `apps/site` — Astro frontend (content loader: `src/lib/content.ts`)
- `packages/wp-client` — WP REST client + content cache (`src/cache.ts`, Vitest)
- `packages/shared` — pure render helpers shared with preview shell (Vitest)
- `wp/plugins/headless-bridge` — preview tokens, CORS, webhook dispatch (PHPUnit)
- `wp/plugins/site-config` — CPT/meta registration
- `tools/deploy` — `deploy.sh` (rsync/lftp/wrangler, `--dry-run`); `tools/smoke` — preview smoke test
- `.github/workflows/build-deploy.yml` — CI (`repository_dispatch: wp-content-update`)

## Commands

- `pnpm bootstrap` (wp-env start + seed) / `pnpm dev` / `pnpm build`
- Tests: `pnpm test` (Vitest) / `cd wp/plugins/headless-bridge && vendor/bin/phpunit` / `bash tools/smoke/preview-endpoint.sh` / `pnpm e2e`
- Deploy: `pnpm site:deploy [-- --dry-run]` (config: `tools/deploy/deploy.config`, gitignored)
- Local WP: `localhost:8888` (admin/password), preview at `localhost:4321`

## Critical Constraints

- **Fail-loud:** builds exit 1 rather than deploy a partial site. The content cache's only allowed fallback is a full fetch.
- **Cache:** 2 layers under `<repo>/.cache/` (content diff-fetch keyed on `modified` + Astro cache). `NO_CACHE=1` bypasses; `CACHE_VERSION` bump wipes.
- **`PREVIEW_MODE`** (`shell`|`ssr`) switches the adapter at config-eval time; `.env` lives at the repo root (astro.config preloads it; shell env wins).
- **workerd-safe:** in ssr mode prerendering runs inside workerd — code reachable from `apps/site/src/lib/content.ts` (incl. wp-client) must not statically import node builtins; use lazy `import()` with a fallback (see `cache.ts`).
- **Deploy:** secrets from env only, never committed config. Rsync keeps `wp/` and `.htaccess` excludes (WP co-located pattern).
- WP meta must use `register_post_meta(..., revisions_enabled: true, show_in_rest: true)` or previews show stale values.

## Conventions

- Commits: English, Conventional Commits `<type>(<scope>): <description>`; scope = package name when applicable; lowercase imperative, no trailing period
- `CLAUDE.md` is English-only (README is Japanese)
