# wp-headless2static

English | [日本語](README.ja.md)

A monorepo boilerplate that uses WordPress as a headless CMS and delivers the site as a static build made with Astro (or as SSR on Cloudflare Workers). The same build and the same deploy script can target either a traditional shared/rental host (rsync / FTPS) or Cloudflare Pages / Workers.

## Architecture

The data flow at a glance:

```
WordPress (Headless CMS)
   │  REST API (wp-json)
   ▼
Astro build (apps/site)
   │
   ▼
dist/ (static HTML, or server+client for SSR)
   │
   ├─▶ Rental/shared hosting (rsync / lftp)
   └─▶ Cloudflare Pages / Workers (wrangler)
```

WordPress only manages posts, pages, and custom post types (CPTs) and serves the REST API; it never renders the public site. Astro owns the front end: at build time it fetches all content from the WP REST API and generates static HTML.

Previews (checking drafts) come in two modes:

- **shell mode**: renders the preview with a static HTML shell plus client-side JS. Works on any host, including plain static hosting on a rental server.
- **ssr mode**: server-side renders the same Astro components as production on Cloudflare Workers, giving a preview closer to the real thing.

The mode is selected with the `PREVIEW_MODE` environment variable (details below).

## Requirements

- Node.js 22.12+ (`.nvmrc` is `22`)
- pnpm 11+
- Docker (to run the local `wp-env`)
- WordPress 7.0.4+ (when installing the plugins on an existing WordPress instead of wp-env)
- PHP 8.3+ and Composer (only for running the PHP tests in `wp/plugins/headless-bridge`)

## Quick start

```bash
pnpm install
pnpm bootstrap   # start wp-env and seed sample posts, pages, and works (CPT)
pnpm dev         # start the Astro dev server
```

`pnpm bootstrap` combines `wp-env start` (starts the local WordPress containers) with `wp/seed.sh`, which activates the plugins and theme and seeds sample posts and works. It is named `bootstrap` because pnpm has a built-in `pnpm setup` command (for the same reason, the deploy script is `site:deploy` rather than `deploy`).

Once it is running, the WordPress admin is available at:

- Admin: http://localhost:8888/wp-admin
- Username / password: `admin` / `password`

Clicking "Preview" from the post list or editor opens a production-equivalent preview (drafts included) against http://localhost:4321, served by `pnpm dev`.

## Environment variables and `.env`

Put the `.env` file at the **repository root** (next to this file). Start from `.env.example`:

```bash
cp .env.example .env
```

Precedence is "shell environment > `.env` file". `.env` only provides defaults for local development; anything explicitly exported in CI or your terminal always wins.

The main variables:

| Variable | Description |
|---|---|
| `WP_API_URL` | Base URL of the WordPress REST API (local wp-env, rental server, or any other environment) |
| `PREVIEW_MODE` | `shell` (static shell + JS, runs anywhere) or `ssr` (Cloudflare Workers). Defaults to `shell` |
| `NO_CACHE` | Set to `1` to bypass the content fetch cache and always do a full fetch (does not affect Astro's own build cache) |

Important: `PREVIEW_MODE` is not just a runtime flag — it **switches the Astro adapter itself**. `apps/site/astro.config.mjs` preloads the root `.env` while the config is evaluated (before Vite injects env vars) and picks the `@astrojs/cloudflare` adapter when `PREVIEW_MODE=ssr`, static output otherwise. Changing `PREVIEW_MODE` and re-running `pnpm build` therefore changes the structure of the generated `dist/` (see below).

## How previews work

When you click "Preview" in the WordPress editor, the `headless-bridge` plugin issues an HMAC-signed token (valid for 10 minutes) and redirects to a URL of this form:

```
{Frontend URL}/preview/?id={post ID}&token={token}
```

The **"Frontend URL" in the `headless-bridge` settings must be an origin only** (scheme + host + port, e.g. `https://example.com`) — no path and no trailing slash. The REST API checks CORS per origin (`scheme://host[:port]`), so a value that includes a path may not work as intended.

The two preview modes differ as follows:

- **shell mode**: works on static hosting alone. The page fetches preview data with JS and renders it. To keep custom-field-driven blocks (such as a work's `client_name` / `project_url`) rendering identically in both modes, the convention is to implement their rendering logic as pure functions in `packages/shared` (see `renderWorkMeta` in `packages/shared/src/render/work-meta.ts`).
- **ssr mode**: server-side renders with the same Astro components as production on Cloudflare Workers. In this mode **you must also set `WP_API_URL` and `PREVIEW_MODE` on the Workers side** — the local `.env` is only read at build time and does not reach the deployed Workers runtime. See "Cloudflare SSR manual verification checklist" below.

## Content model conventions

Use `wp/plugins/site-config` as the reference when adding custom post types (CPTs) or custom fields (meta). It ships the `work` CPT and its meta (`client_name` / `project_url`) as a sample implementation.

Always register meta with `register_post_meta()` and `revisions_enabled: true` (introduced in WordPress 6.4):

```php
register_post_meta( 'work', 'client_name', [
    'type'              => 'string',
    'single'            => true,
    'show_in_rest'      => true,
    'revisions_enabled' => true,
] );
```

Without it, previews of drafts and autosaves show that meta field with its last published/saved value — the title and body preview correctly as revisions while the meta lags behind. Register every custom field you want to check in previews with `revisions_enabled: true`.

## Builds and the two-layer cache

`pnpm build` **regenerates the full HTML every time** (it is not an incremental build). To keep builds fast, two caches are persisted under `.cache/` at the repository root:

1. The WordPress content fetch cache (diff fetch keyed on `modified`)
2. Astro's own build cache

If something looks off, or you suspect the content fetch cache, force a full fetch with `NO_CACHE=1`:

```bash
NO_CACHE=1 pnpm build
```

`NO_CACHE=1` only bypasses the content fetch cache; Astro's build cache (`.cache/astro`) is untouched. To reset everything, including Astro's cache, delete the `.cache/` directory:

```bash
rm -rf .cache
```

When an update changes the cache's internal format, `CACHE_VERSION` is bumped in code and caches in the old format are wiped automatically. You never need to manage cache-format compatibility by hand.

## Automatic builds (webhook)

Publishing, updating, or deleting a post in WordPress can automatically trigger a GitHub Actions build and deploy.

Setup:

1. In the WordPress admin, open Settings → Headless Bridge
2. Set **GitHub Repository** to `owner/repo`
3. Set **GitHub Token** to a fine-grained personal access token (PAT). Keep its scope narrow: it **only needs permission to send `repository_dispatch` events to the target repository**

On publish, update, or delete, a `repository_dispatch` is sent to GitHub, which starts the `.github/workflows/build-deploy.yml` workflow to build and deploy. If either GitHub Repository or GitHub Token is unset, the webhook is skipped. Manual runs via the Actions `workflow_dispatch` trigger are always available regardless of these settings.

If triggering the build (the GitHub API request) fails, the WordPress admin shows a "failed to trigger build" notice. If published content doesn't appear on the site, check for this notice first.

## Deployment

Where the static site is deployed is completely independent of where WordPress lives. The only link between them is that `WP_API_URL` must be reachable over HTTP at build and preview time. Three typical layouts:

| Layout | Static site | WordPress | Notes |
|---|---|---|---|
| ① Co-located, subdirectory | `example.com/` | `example.com/wp/` | Requires the rsync exclude convention |
| ② Co-located, subdomain | `example.com` | `wp.example.com` | Separate DocumentRoots, so no excludes needed. Lowest risk of accidents |
| ③ Fully separate | Rental server A or Cloudflare | Rental server B (an existing WordPress site works too) | Good for migrations that make only the front end of an existing WordPress site static |

### Deploy configuration

Copy `tools/deploy/deploy.config.example` to `tools/deploy/deploy.config` (gitignored) and fill in the target details:

```bash
cp tools/deploy/deploy.config.example tools/deploy/deploy.config
```

The deploy commands are the same for every layout:

```bash
pnpm build
pnpm site:preview               # optional: check the build locally before deploying (astro preview)
pnpm site:deploy                # deploy for real
pnpm site:deploy -- --dry-run   # show what would happen without sending anything
```

The script is named `site:deploy` to avoid clashing with pnpm's built-in `pnpm deploy` command.

### rsync behavior and excludes

Rental servers with SSH access are deployed with `rsync -az --delete` (diff sync). Because it is a diff sync, an interrupted transfer never corrupts the remote — some old files are simply left un-updated, and re-running catches up.

When WordPress and the static site share a document root (layout ①), **never remove `wp/` and `.htaccess` from `RSYNC_EXCLUDES` in `deploy.config`**. Without them, `--delete` wipes WordPress itself and `.htaccess`.

For rental servers without SSH, an FTPS fallback using `lftp` (`DEPLOY_METHOD=lftp`) is provided.

### Protecting the WordPress admin

When WordPress is co-located with the static site, protecting `wp-login.php` / `wp-admin` from unwanted external access is strongly recommended. `tools/deploy/htaccess-wp-admin.example` provides a template, but it is **only a starting point that adds Basic auth to `wp-login.php`**. It does not protect every path under `/wp-admin`, and it has no branching logic to let the REST API (`/wp-json/`) through (the `SetEnvIf` line in the template is not referenced anywhere and currently has no effect). In production, don't use the template as-is — combine it with the IP restriction or access control features of your rental server's control panel for more reliable protection.

## CI (GitHub Actions)

`.github/workflows/build-deploy.yml` can be triggered by both `repository_dispatch` (via the webhook) and `workflow_dispatch` (manual), and deploys the build to the configured target. Manual runs also offer a "full build without cache" option (equivalent to `NO_CACHE`).

Register the following beforehand under the repository's Settings → Secrets and variables → Actions.

**Variables**

- `DEPLOY_TARGET` (`rental` or `cloudflare`)
- `DEPLOY_METHOD` (`rsync` or `lftp`; rental only)
- `WP_API_URL`
- `PREVIEW_MODE` (`shell` or `ssr`)
- `CF_PAGES_PROJECT` (Cloudflare Pages project name)

**Secrets**

- `RENTAL_SSH_KEY` / `RENTAL_HOST` / `RENTAL_USER` / `RENTAL_PATH` / `RENTAL_PORT`
- `FTP_HOST` / `FTP_USER` / `FTP_PASSWORD`
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`

The workflow uses a `concurrency` group so only one run is active: if a new `repository_dispatch` arrives mid-build, the running job is cancelled and only the latest content is built and deployed. Publishing or updating posts in quick succession never lets an older build overwrite a newer one.

## Cloudflare SSR manual verification checklist (first deploy)

When deploying to Cloudflare Workers with `PREVIEW_MODE=ssr`, verify the following by hand the first time:

1. Log in to `wrangler` (e.g. `pnpm --filter site exec wrangler login`)
2. Run `PREVIEW_MODE=ssr pnpm build` to produce the SSR build (`dist/server/` + `dist/client/`)
3. Run `pnpm site:deploy` to deploy to Workers via `wrangler deploy`
4. Set the `WP_API_URL` and `PREVIEW_MODE=ssr` environment variables on the Workers side (via the dashboard or a config file such as `wrangler.jsonc`; the local `.env` is not propagated automatically)
5. Open a preview from the WordPress editor and confirm it renders correctly on Workers
6. Update the **Frontend URL** in the `headless-bridge` settings to the production Cloudflare origin (e.g. `https://example.com`) so CORS matches production

With `PREVIEW_MODE=shell` (static mode), the build output under `dist/` is the complete set of static files and is deployed to Cloudflare Pages with `wrangler pages deploy dist --project-name <CF_PAGES_PROJECT>`. `tools/deploy/deploy.sh` picks the Workers or Pages deploy command automatically based on whether `dist/server/` exists.

## Testing

```bash
pnpm test                                          # Vitest (whole repository)
cd wp/plugins/headless-bridge && vendor/bin/phpunit # PHP unit tests for the headless-bridge plugin
bash tools/smoke/preview-endpoint.sh                # smoke test for the preview endpoint
pnpm e2e                                            # Playwright E2E tests
```

Before running the E2E tests for the first time, install the browser binary:

```bash
npx playwright install --with-deps chromium
```

## Scaling notes

This boilerplate is designed for sites with a few hundred to a few thousand posts. Beyond that, the current "regenerate the full HTML every build" approach can make build times a problem; consider strengthening the caching strategy (introducing incremental builds) or splitting and parallelizing content fetching.
