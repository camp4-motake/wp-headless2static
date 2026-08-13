# Plan 1: Foundation (Monorepo + Local WP + headless-bridge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo skeleton, a local WordPress (wp-env) with the `headless-bridge` plugin (preview tokens, preview REST endpoint, CORS, health check), the `headless-minimal` theme, an example CPT plugin, and seed data — so that `pnpm setup` produces a WP where the preview endpoint serves draft content to a token-bearing client.

**Architecture:** pnpm-workspaces monorepo. WP-side code lives under `wp/` (plugins, theme, wp-env config, seed script). The `headless-bridge` plugin isolates pure token logic (`Token` class, no WP dependencies, PHPUnit-tested) from WP integration (REST routes, filters, CORS). Preview URLs are `{FRONTEND_URL}/preview/?id=…&token=…` regardless of mode.

**Tech Stack:** pnpm 9 / Node 22, @wordpress/env (Docker), PHP 8.2, PHPUnit 10, wp-cli (via wp-env).

**Spec:** `docs/superpowers/specs/2026-08-13-wp-headless2static-design.md`

## Global Constraints

- Commit messages: English, Conventional Commits (`<type>(<scope>): <description>`, lowercase imperative, no trailing period) — see `CLAUDE.md`
- WordPress 6.4+ (needs `revisions_enabled` meta), PHP 8.1+ syntax allowed
- Preview token TTL: **600 seconds (10 min)**, HMAC-SHA256, stateless, secret = WP `AUTH_KEY`
- REST namespace: `headless-bridge/v1`
- Preview URL format (both modes): `{FRONTEND_URL}/preview/?id={post_id}&token={token}`
- Option name for frontend URL: `headless_bridge_frontend_url`
- Local WP port: 8888; local Astro dev URL (seeded as FRONTEND_URL): `http://localhost:4321`
- All WP REST responses for drafts go ONLY through the token-guarded preview endpoint

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitignore`

**Interfaces:**
- Produces: root scripts `wp:start`, `wp:stop`, `setup` used by later tasks; workspace globs `apps/*`, `packages/*` used by Plan 2.

- [ ] **Step 1: Create root files**

`package.json`:

```json
{
  "name": "wp-headless2static",
  "private": true,
  "engines": { "node": ">=22", "pnpm": ">=9" },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "wp:start": "cd wp && wp-env start",
    "wp:stop": "cd wp && wp-env stop",
    "wp:destroy": "cd wp && wp-env destroy",
    "setup": "pnpm wp:start && bash wp/seed.sh"
  },
  "devDependencies": {
    "@wordpress/env": "^10.17.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`.nvmrc`:

```
22
```

`.gitignore`:

```
node_modules/
dist/
.cache/
.env
vendor/
.wp-env.override.json
```

- [ ] **Step 2: Verify install works**

Run: `pnpm install`
Expected: succeeds, creates `pnpm-lock.yaml` and installs `wp-env` binary (`pnpm exec wp-env --version` prints a version).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-workspace.yaml .nvmrc .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo with wp-env"
```

---

### Task 2: headless-bridge plugin skeleton + PHPUnit setup

**Files:**
- Create: `wp/plugins/headless-bridge/headless-bridge.php`
- Create: `wp/plugins/headless-bridge/composer.json`
- Create: `wp/plugins/headless-bridge/phpunit.xml`
- Create: `wp/plugins/headless-bridge/includes/class-token.php` (empty class shell only)
- Test: `wp/plugins/headless-bridge/tests/TokenTest.php` (created in Task 3)

**Interfaces:**
- Produces: `HeadlessBridge\Plugin::secret(): string` (used by preview endpoint, link filter, smoke tests); constant `HEADLESS_BRIDGE_VERSION`; autoloading of `includes/` classes.

- [ ] **Step 1: Ensure PHP + Composer are available**

Run: `php --version && composer --version`
If missing: `sudo apt-get update && sudo apt-get install -y php-cli php-xml composer` (sandbox has sudo). Expected: PHP >= 8.1.

- [ ] **Step 2: Write plugin main file**

`wp/plugins/headless-bridge/headless-bridge.php`:

```php
<?php
/**
 * Plugin Name: Headless Bridge
 * Description: Preview tokens, preview REST endpoint, CORS and build webhooks for the headless frontend.
 * Version: 0.1.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 */

namespace HeadlessBridge;

defined( 'ABSPATH' ) || exit;

const HEADLESS_BRIDGE_VERSION = '0.1.0';

require_once __DIR__ . '/includes/class-token.php';

final class Plugin {

	public static function secret(): string {
		if ( defined( 'AUTH_KEY' ) && AUTH_KEY ) {
			return AUTH_KEY;
		}
		return wp_salt( 'auth' );
	}

	public static function frontend_url(): string {
		return rtrim( (string) get_option( 'headless_bridge_frontend_url', '' ), '/' );
	}

	public static function boot(): void {
		add_action( 'rest_api_init', [ self::class, 'register_health_route' ] );
	}

	public static function register_health_route(): void {
		register_rest_route( 'headless-bridge/v1', '/health', [
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => static fn() => [ 'version' => HEADLESS_BRIDGE_VERSION ],
		] );
	}
}

Plugin::boot();
```

`wp/plugins/headless-bridge/includes/class-token.php` (shell only — implemented via TDD in Task 3):

```php
<?php
namespace HeadlessBridge;

class Token {
}
```

- [ ] **Step 3: Write composer + phpunit config**

`wp/plugins/headless-bridge/composer.json`:

```json
{
  "name": "wp-headless2static/headless-bridge",
  "require-dev": { "phpunit/phpunit": "^10.5" },
  "autoload": {
    "classmap": [ "includes/" ]
  }
}
```

`wp/plugins/headless-bridge/phpunit.xml`:

```xml
<?xml version="1.0"?>
<phpunit bootstrap="vendor/autoload.php" colors="true">
  <testsuites>
    <testsuite name="unit">
      <directory>tests</directory>
    </testsuite>
  </testsuites>
</phpunit>
```

- [ ] **Step 4: Verify PHPUnit runs (0 tests)**

Run: `cd wp/plugins/headless-bridge && composer install && vendor/bin/phpunit`
Expected: "No tests executed" (exit 0 or warning — both fine at this point).

- [ ] **Step 5: Commit**

```bash
git add wp/plugins/headless-bridge
git commit -m "feat(headless-bridge): add plugin skeleton with health endpoint"
```

---

### Task 3: Token class (TDD)

**Files:**
- Modify: `wp/plugins/headless-bridge/includes/class-token.php`
- Test: `wp/plugins/headless-bridge/tests/TokenTest.php`

**Interfaces:**
- Produces: `Token::issue( int $post_id, string $secret, int $now, int $ttl = 600 ): string` and `Token::verify( string $token, int $post_id, string $secret, int $now ): bool`. Pure functions — secret and clock injected, no WP dependency. Used by preview endpoint (Task 6), link filter (Task 7), smoke test (Task 10).

- [ ] **Step 1: Write the failing tests**

`wp/plugins/headless-bridge/tests/TokenTest.php`:

```php
<?php
use HeadlessBridge\Token;
use PHPUnit\Framework\TestCase;

final class TokenTest extends TestCase {
	private const SECRET = 'test-secret-key';
	private const NOW    = 1_700_000_000;

	public function test_valid_token_roundtrip(): void {
		$token = Token::issue( 123, self::SECRET, self::NOW );
		$this->assertTrue( Token::verify( $token, 123, self::SECRET, self::NOW + 60 ) );
	}

	public function test_expired_token_is_rejected(): void {
		$token = Token::issue( 123, self::SECRET, self::NOW, 600 );
		$this->assertFalse( Token::verify( $token, 123, self::SECRET, self::NOW + 601 ) );
	}

	public function test_token_for_another_post_is_rejected(): void {
		$token = Token::issue( 123, self::SECRET, self::NOW );
		$this->assertFalse( Token::verify( $token, 456, self::SECRET, self::NOW ) );
	}

	public function test_tampered_payload_is_rejected(): void {
		$token = Token::issue( 123, self::SECRET, self::NOW );
		[ $payload, $sig ] = explode( '.', $token );
		$forged = rtrim( strtr( base64_encode( '456.' . ( self::NOW + 600 ) ), '+/', '-_' ), '=' );
		$this->assertFalse( Token::verify( $forged . '.' . $sig, 456, self::SECRET, self::NOW ) );
	}

	public function test_wrong_secret_is_rejected(): void {
		$token = Token::issue( 123, self::SECRET, self::NOW );
		$this->assertFalse( Token::verify( $token, 123, 'other-secret', self::NOW ) );
	}

	public function test_garbage_token_is_rejected(): void {
		$this->assertFalse( Token::verify( 'not-a-token', 123, self::SECRET, self::NOW ) );
		$this->assertFalse( Token::verify( '', 123, self::SECRET, self::NOW ) );
		$this->assertFalse( Token::verify( 'a.b.c', 123, self::SECRET, self::NOW ) );
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wp/plugins/headless-bridge && vendor/bin/phpunit`
Expected: FAIL — `Token::issue` not defined.

- [ ] **Step 3: Implement Token**

`wp/plugins/headless-bridge/includes/class-token.php`:

```php
<?php
namespace HeadlessBridge;

/**
 * Stateless HMAC preview token: base64url("{post_id}.{expires}") . "." . hmac_sha256(payload).
 */
class Token {

	public static function issue( int $post_id, string $secret, int $now, int $ttl = 600 ): string {
		$payload = $post_id . '.' . ( $now + $ttl );
		$sig     = hash_hmac( 'sha256', $payload, $secret );
		return rtrim( strtr( base64_encode( $payload ), '+/', '-_' ), '=' ) . '.' . $sig;
	}

	public static function verify( string $token, int $post_id, string $secret, int $now ): bool {
		$parts = explode( '.', $token );
		if ( count( $parts ) !== 2 ) {
			return false;
		}
		$payload = base64_decode( strtr( $parts[0], '-_', '+/' ), true );
		if ( false === $payload ) {
			return false;
		}
		if ( ! hash_equals( hash_hmac( 'sha256', $payload, $secret ), $parts[1] ) ) {
			return false;
		}
		$pieces = explode( '.', $payload );
		if ( count( $pieces ) !== 2 ) {
			return false;
		}
		[ $tid, $expires ] = $pieces;
		return (int) $tid === $post_id && (int) $expires >= $now;
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd wp/plugins/headless-bridge && composer dump-autoload && vendor/bin/phpunit`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add wp/plugins/headless-bridge/includes/class-token.php wp/plugins/headless-bridge/tests/TokenTest.php
git commit -m "feat(headless-bridge): add stateless hmac preview token"
```

---

### Task 4: headless-minimal theme + wp-env boot

**Files:**
- Create: `wp/.wp-env.json`
- Create: `wp/themes/headless-minimal/style.css`
- Create: `wp/themes/headless-minimal/index.php`
- Create: `wp/themes/headless-minimal/functions.php`

**Interfaces:**
- Consumes: `headless_bridge_frontend_url` option (empty until seeded in Task 10 — theme must no-op when empty).
- Produces: running local WP at `http://localhost:8888` with headless-bridge active; used by every later task.

- [ ] **Step 1: Write theme files**

`wp/themes/headless-minimal/style.css`:

```css
/*
Theme Name: Headless Minimal
Description: Redirects all front-end requests to the static frontend. No visual output.
Version: 0.1.0
*/
```

`wp/themes/headless-minimal/index.php`:

```php
<?php
// Intentionally blank: front-end requests are redirected in functions.php.
// This renders only if no frontend URL is configured yet.
http_response_code( 200 );
echo 'Headless WordPress — no frontend URL configured (Settings > Headless Bridge).';
```

`wp/themes/headless-minimal/functions.php`:

```php
<?php
// Redirect any front-end request to the static site, preserving the path.
add_action( 'template_redirect', function (): void {
	$frontend = rtrim( (string) get_option( 'headless_bridge_frontend_url', '' ), '/' );
	if ( '' === $frontend ) {
		return;
	}
	$path = $_SERVER['REQUEST_URI'] ?? '/';
	wp_redirect( $frontend . $path, 302 );
	exit;
} );
```

- [ ] **Step 2: Write wp-env config**

`wp/.wp-env.json`:

```json
{
  "core": null,
  "phpVersion": "8.2",
  "plugins": [ "./plugins/headless-bridge" ],
  "themes": [ "./themes/headless-minimal" ],
  "port": 8888,
  "config": {
    "WP_DEBUG": true
  }
}
```

(`"core": null` = latest stable WordPress. `site-config` plugin is added to this file in Task 9.)

- [ ] **Step 3: Boot and verify**

Run: `pnpm wp:start`
Expected: wp-env pulls Docker images and starts. Then:

Run: `curl -fsS http://localhost:8888/?rest_route=/headless-bridge/v1/health`
Expected: `{"version":"0.1.0"}` — proves WP is up AND the plugin is active.

Run: `cd wp && wp-env run cli wp theme list --status=active --field=name`
Expected: `headless-minimal`

- [ ] **Step 4: Commit**

```bash
git add wp/.wp-env.json wp/themes/headless-minimal
git commit -m "feat(wp): add wp-env config and headless-minimal redirect theme"
```

---

### Task 5: Settings page (frontend URL)

**Files:**
- Create: `wp/plugins/headless-bridge/includes/class-settings.php`
- Modify: `wp/plugins/headless-bridge/headless-bridge.php` (require + boot)

**Interfaces:**
- Produces: option `headless_bridge_frontend_url` editable at Settings → Headless Bridge; consumed by `Plugin::frontend_url()`, theme redirect, CORS (Task 8), link filter (Task 7).

- [ ] **Step 1: Write settings class**

`wp/plugins/headless-bridge/includes/class-settings.php`:

```php
<?php
namespace HeadlessBridge;

class Settings {

	public static function boot(): void {
		add_action( 'admin_menu', [ self::class, 'add_page' ] );
		add_action( 'admin_init', [ self::class, 'register' ] );
	}

	public static function register(): void {
		register_setting( 'headless_bridge', 'headless_bridge_frontend_url', [
			'type'              => 'string',
			'sanitize_callback' => 'esc_url_raw',
			'default'           => '',
		] );
	}

	public static function add_page(): void {
		add_options_page(
			'Headless Bridge',
			'Headless Bridge',
			'manage_options',
			'headless-bridge',
			[ self::class, 'render' ]
		);
	}

	public static function render(): void {
		?>
		<div class="wrap">
			<h1>Headless Bridge</h1>
			<form method="post" action="options.php">
				<?php settings_fields( 'headless_bridge' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="headless_bridge_frontend_url">Frontend URL</label></th>
						<td>
							<input name="headless_bridge_frontend_url" id="headless_bridge_frontend_url"
								type="url" class="regular-text code"
								value="<?php echo esc_attr( get_option( 'headless_bridge_frontend_url', '' ) ); ?>"
								placeholder="https://example.com" />
							<p class="description">Static site origin. Used for preview links, front-end redirects and CORS.</p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
```

- [ ] **Step 2: Wire into main file**

In `wp/plugins/headless-bridge/headless-bridge.php`, after the existing `require_once` line add:

```php
require_once __DIR__ . '/includes/class-settings.php';
```

and inside `Plugin::boot()` add:

```php
Settings::boot();
```

- [ ] **Step 3: Verify via wp-cli**

Run (from `wp/`):

```bash
wp-env run cli wp option update headless_bridge_frontend_url "http://localhost:4321"
wp-env run cli wp option get headless_bridge_frontend_url
```

Expected: `http://localhost:4321`. Then verify the theme redirect now works:

Run: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:8888/hello-world/`
Expected: `302 http://localhost:4321/hello-world/`

- [ ] **Step 4: Commit**

```bash
git add wp/plugins/headless-bridge
git commit -m "feat(headless-bridge): add settings page for frontend url"
```

---

### Task 6: Preview REST endpoint

**Files:**
- Create: `wp/plugins/headless-bridge/includes/class-preview-endpoint.php`
- Modify: `wp/plugins/headless-bridge/headless-bridge.php` (require + boot)

**Interfaces:**
- Consumes: `Token::verify`, `Plugin::secret()`.
- Produces: `GET /wp-json/headless-bridge/v1/preview/{id}?token=…` returning JSON:
  `{ id, type, title, content, excerpt, date, modified, featured_image: {url, alt} | null, terms: { category: [{id,name,slug}], post_tag: [...] }, meta: {…} }`.
  This response shape is the contract Plan 2's preview shell and SSR route render from.

- [ ] **Step 1: Write endpoint class**

`wp/plugins/headless-bridge/includes/class-preview-endpoint.php`:

```php
<?php
namespace HeadlessBridge;

class Preview_Endpoint {

	public static function boot(): void {
		add_action( 'rest_api_init', [ self::class, 'register_route' ] );
	}

	public static function register_route(): void {
		register_rest_route( 'headless-bridge/v1', '/preview/(?P<id>\d+)', [
			'methods'             => 'GET',
			'permission_callback' => [ self::class, 'check_token' ],
			'callback'            => [ self::class, 'handle' ],
			'args'                => [
				'token' => [ 'type' => 'string', 'required' => true ],
			],
		] );
	}

	public static function check_token( \WP_REST_Request $request ): bool|\WP_Error {
		$ok = Token::verify(
			(string) $request['token'],
			(int) $request['id'],
			Plugin::secret(),
			time()
		);
		if ( ! $ok ) {
			return new \WP_Error( 'invalid_token', 'Preview token is invalid or expired.', [ 'status' => 403 ] );
		}
		return true;
	}

	public static function handle( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$post = get_post( (int) $request['id'] );
		if ( ! $post || 'revision' === $post->post_type ) {
			return new \WP_Error( 'not_found', 'Post not found.', [ 'status' => 404 ] );
		}

		// Prefer the newest autosave so unsaved editor changes appear in the preview.
		$autosave = wp_get_post_autosave( $post->ID );
		$source   = ( $autosave && strtotime( $autosave->post_modified_gmt ) >= strtotime( $post->post_modified_gmt ) )
			? $autosave
			: $post;

		$thumb_id       = get_post_thumbnail_id( $post );
		$featured_image = null;
		if ( $thumb_id ) {
			$featured_image = [
				'url' => wp_get_attachment_image_url( $thumb_id, 'large' ),
				'alt' => (string) get_post_meta( $thumb_id, '_wp_attachment_image_alt', true ),
			];
		}

		return new \WP_REST_Response( [
			'id'             => $post->ID,
			'type'           => $post->post_type,
			'title'          => get_the_title( $source ),
			'content'        => apply_filters( 'the_content', $source->post_content ),
			'excerpt'        => $source->post_excerpt,
			'date'           => $post->post_date_gmt,
			'modified'       => $source->post_modified_gmt,
			'featured_image' => $featured_image,
			'terms'          => self::resolve_terms( $post ),
			'meta'           => self::resolve_meta( $post, $source ),
		] );
	}

	private static function resolve_terms( \WP_Post $post ): array {
		$out = [];
		foreach ( get_object_taxonomies( $post->post_type, 'names' ) as $tax ) {
			$terms       = get_the_terms( $post, $tax ) ?: [];
			$out[ $tax ] = array_map(
				static fn( $t ) => [ 'id' => $t->term_id, 'name' => $t->name, 'slug' => $t->slug ],
				is_array( $terms ) ? $terms : []
			);
		}
		return $out;
	}

	private static function resolve_meta( \WP_Post $post, \WP_Post $source ): array {
		// ACF: field values are stored on autosaves/revisions, so read from $source first.
		if ( function_exists( 'get_fields' ) ) {
			$fields = get_fields( $source->ID );
			if ( ! $fields && $source->ID !== $post->ID ) {
				$fields = get_fields( $post->ID );
			}
			return is_array( $fields ) ? $fields : [];
		}

		// Plain post meta: registered keys only. Keys registered with
		// 'revisions_enabled' resolve from the autosave; others fall back to the parent.
		$meta = [];
		foreach ( get_registered_meta_keys( 'post', $post->post_type ) as $key => $args ) {
			if ( empty( $args['show_in_rest'] ) ) {
				continue;
			}
			$value = get_post_meta( $source->ID, $key, true );
			if ( '' === $value && $source->ID !== $post->ID ) {
				$value = get_post_meta( $post->ID, $key, true );
			}
			$meta[ $key ] = $value;
		}
		return $meta;
	}
}
```

- [ ] **Step 2: Wire into main file**

In `headless-bridge.php` add the require and boot call:

```php
require_once __DIR__ . '/includes/class-preview-endpoint.php';
```

and in `Plugin::boot()`:

```php
Preview_Endpoint::boot();
```

- [ ] **Step 3: Verify against a live draft (manual smoke)**

Run (from `wp/`):

```bash
DRAFT_ID=$(wp-env run cli wp post create --post_title="Secret draft" --post_status=draft --post_content="<p>draft body</p>" --porcelain)
TOKEN=$(wp-env run cli wp eval "echo \HeadlessBridge\Token::issue( $DRAFT_ID, \HeadlessBridge\Plugin::secret(), time() );")
curl -fsS "http://localhost:8888/?rest_route=/headless-bridge/v1/preview/$DRAFT_ID&token=$TOKEN"
```

Expected: JSON containing `"title":"Secret draft"` and `"content":"<p>draft body<\/p>…"`.

Negative checks:

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8888/?rest_route=/headless-bridge/v1/preview/$DRAFT_ID&token=bad"
```

Expected: `403`. And the default REST API must NOT leak the draft:

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8888/?rest_route=/wp/v2/posts/$DRAFT_ID"
```

Expected: `401` (or `403`).

- [ ] **Step 4: Commit**

```bash
git add wp/plugins/headless-bridge
git commit -m "feat(headless-bridge): add token-guarded preview endpoint with autosave and meta resolution"
```

---

### Task 7: Preview link filter

**Files:**
- Create: `wp/plugins/headless-bridge/includes/class-preview-link.php`
- Modify: `wp/plugins/headless-bridge/headless-bridge.php` (require + boot)

**Interfaces:**
- Consumes: `Token::issue`, `Plugin::secret()`, `Plugin::frontend_url()`.
- Produces: WP "Preview" button pointing at `{FRONTEND_URL}/preview/?id={id}&token={token}`.

- [ ] **Step 1: Write filter class**

`wp/plugins/headless-bridge/includes/class-preview-link.php`:

```php
<?php
namespace HeadlessBridge;

class Preview_Link {

	public static function boot(): void {
		add_filter( 'preview_post_link', [ self::class, 'rewrite' ], 10, 2 );
	}

	public static function rewrite( string $link, \WP_Post $post ): string {
		$frontend = Plugin::frontend_url();
		if ( '' === $frontend ) {
			return $link;
		}
		$token = Token::issue( $post->ID, Plugin::secret(), time() );
		return $frontend . '/preview/?id=' . $post->ID . '&token=' . rawurlencode( $token );
	}
}
```

- [ ] **Step 2: Wire into main file**

Add to `headless-bridge.php`:

```php
require_once __DIR__ . '/includes/class-preview-link.php';
```

and in `Plugin::boot()`:

```php
Preview_Link::boot();
```

- [ ] **Step 3: Verify**

Run (from `wp/`, reusing `$DRAFT_ID` from Task 6 or create a new draft):

```bash
wp-env run cli wp eval "echo get_preview_post_link( $DRAFT_ID );"
```

Expected: `http://localhost:4321/preview/?id=<ID>&token=<base64url>.<hex>`

- [ ] **Step 4: Commit**

```bash
git add wp/plugins/headless-bridge
git commit -m "feat(headless-bridge): rewrite preview links to frontend preview url"
```

---

### Task 8: CORS for the preview shell

**Files:**
- Create: `wp/plugins/headless-bridge/includes/class-cors.php`
- Modify: `wp/plugins/headless-bridge/headless-bridge.php` (require + boot)

**Interfaces:**
- Consumes: `Plugin::frontend_url()`.
- Produces: `Access-Control-Allow-Origin` on REST responses when the request `Origin` exactly matches the configured frontend URL origin. Plan 2's shell fetch depends on this.

- [ ] **Step 1: Write CORS class**

`wp/plugins/headless-bridge/includes/class-cors.php`:

```php
<?php
namespace HeadlessBridge;

class Cors {

	public static function boot(): void {
		add_action( 'rest_api_init', static function (): void {
			remove_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );
			add_filter( 'rest_pre_serve_request', [ self::class, 'send_headers' ] );
		}, 15 );
	}

	public static function send_headers( $served ) {
		$origin  = get_http_origin();
		$allowed = Plugin::frontend_url();
		if ( $origin && $allowed && rtrim( $origin, '/' ) === $allowed ) {
			header( 'Access-Control-Allow-Origin: ' . esc_url_raw( $origin ) );
			header( 'Access-Control-Allow-Methods: GET, OPTIONS' );
			header( 'Vary: Origin' );
		}
		return $served;
	}
}
```

- [ ] **Step 2: Wire into main file**

Add to `headless-bridge.php`:

```php
require_once __DIR__ . '/includes/class-cors.php';
```

and in `Plugin::boot()`:

```php
Cors::boot();
```

- [ ] **Step 3: Verify**

```bash
curl -fsS -H "Origin: http://localhost:4321" -D - -o /dev/null "http://localhost:8888/?rest_route=/headless-bridge/v1/health" | grep -i access-control-allow-origin
```

Expected: `Access-Control-Allow-Origin: http://localhost:4321`

```bash
curl -fsS -H "Origin: http://evil.example" -D - -o /dev/null "http://localhost:8888/?rest_route=/headless-bridge/v1/health" | grep -ci access-control-allow-origin || echo "no header"
```

Expected: `no header`

- [ ] **Step 4: Commit**

```bash
git add wp/plugins/headless-bridge
git commit -m "feat(headless-bridge): restrict rest cors to configured frontend origin"
```

---

### Task 9: Example CPT plugin (site-config)

**Files:**
- Create: `wp/plugins/site-config/site-config.php`
- Modify: `wp/.wp-env.json` (add plugin)

**Interfaces:**
- Produces: CPT `work` (REST base `works`) with meta keys `client_name`, `project_url` registered with `revisions_enabled` — the boilerplate's reference implementation of the "register meta with revisions_enabled" convention. Plan 2's CPT pages consume `/wp-json/wp/v2/works`.

- [ ] **Step 1: Write plugin**

`wp/plugins/site-config/site-config.php`:

```php
<?php
/**
 * Plugin Name: Site Config
 * Description: Project-specific content model: example "work" CPT with revision-enabled meta.
 * Version: 0.1.0
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', static function (): void {
	register_post_type( 'work', [
		'label'        => 'Works',
		'public'       => true,
		'show_in_rest' => true,
		'rest_base'    => 'works',
		'menu_icon'    => 'dashicons-portfolio',
		'has_archive'  => true,
		'rewrite'      => [ 'slug' => 'works' ],
		'supports'     => [ 'title', 'editor', 'thumbnail', 'excerpt', 'revisions', 'custom-fields' ],
	] );

	// Convention: ALL project meta keys are registered with revisions_enabled
	// so drafts/autosaves preview correctly (requires WP 6.4+).
	foreach ( [ 'client_name', 'project_url' ] as $key ) {
		register_post_meta( 'work', $key, [
			'type'              => 'string',
			'single'            => true,
			'show_in_rest'      => true,
			'revisions_enabled' => true,
		] );
	}
} );
```

- [ ] **Step 2: Add to wp-env and restart**

In `wp/.wp-env.json` change the plugins line to:

```json
"plugins": [ "./plugins/headless-bridge", "./plugins/site-config" ],
```

Run: `pnpm wp:start` (wp-env picks up config changes on start)
Expected: restart succeeds.

- [ ] **Step 3: Verify**

```bash
cd wp && wp-env run cli wp post create --post_type=work --post_title="Sample Work" --post_status=publish --porcelain
curl -fsS "http://localhost:8888/?rest_route=/wp/v2/works" | grep "Sample Work"
```

Expected: the published work appears in REST.

- [ ] **Step 4: Commit**

```bash
git add wp/plugins/site-config wp/.wp-env.json
git commit -m "feat(wp): add site-config plugin with example work cpt and revisioned meta"
```

---

### Task 10: Seed script + end-to-end smoke

**Files:**
- Create: `wp/seed.sh`
- Create: `tools/smoke/preview-endpoint.sh`

**Interfaces:**
- Consumes: everything above.
- Produces: `pnpm setup` = boot + seed; `bash tools/smoke/preview-endpoint.sh` = pass/fail check of the whole preview chain. Plan 2 assumes a seeded WP.

- [ ] **Step 1: Write seed script**

`wp/seed.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cli() { wp-env run cli wp "$@"; }

echo "Seeding options..."
cli option update headless_bridge_frontend_url "http://localhost:4321"
cli option update blogname "Headless Demo"
cli rewrite structure '/%postname%/' --hard

echo "Seeding taxonomy..."
cli term create category News --slug=news --porcelain || true
cli term create category Tech --slug=tech --porcelain || true

echo "Seeding posts..."
cli post create --post_title="Hello Headless" --post_name=hello-headless --post_status=publish \
  --post_content="<p>First published post.</p><h2>Section</h2><p>Body text.</p>" --porcelain || true
cli post create --post_title="Second Post" --post_name=second-post --post_status=publish \
  --post_content="<p>Another published post.</p>" --porcelain || true
cli post create --post_title="Draft In Progress" --post_status=draft \
  --post_content="<p>This draft is only visible via preview.</p>" --porcelain || true

echo "Seeding pages..."
cli post create --post_type=page --post_title="About" --post_name=about --post_status=publish \
  --post_content="<p>About this site.</p>" --porcelain || true

echo "Seeding works (CPT)..."
WORK_ID=$(cli post create --post_type=work --post_title="Corporate Site Renewal" --post_status=publish \
  --post_content="<p>Case study body.</p>" --porcelain || true)
if [ -n "${WORK_ID:-}" ]; then
  cli post meta update "$WORK_ID" client_name "ACME Inc." || true
  cli post meta update "$WORK_ID" project_url "https://example.com" || true
fi

echo "Seed complete. WP: http://localhost:8888/wp-admin (admin/password)"
```

Note: wp-cli `post create` has no natural idempotency; `|| true` keeps re-runs harmless (duplicates are acceptable in a dev sandbox, `wp:destroy` resets).

- [ ] **Step 2: Write smoke test script**

`tools/smoke/preview-endpoint.sh`:

```bash
#!/usr/bin/env bash
# End-to-end check of the preview chain: draft -> token -> endpoint -> draft JSON.
set -euo pipefail
cd "$(dirname "$0")/../../wp"

cli() { wp-env run cli wp "$@"; }
WP_URL="http://localhost:8888"

DRAFT_ID=$(cli post create --post_title="Smoke Draft" --post_status=draft \
  --post_content="<p>smoke-draft-body</p>" --porcelain)
TOKEN=$(cli eval "echo \HeadlessBridge\Token::issue( $DRAFT_ID, \HeadlessBridge\Plugin::secret(), time() );")

echo "1) valid token returns draft content..."
curl -fsS "$WP_URL/?rest_route=/headless-bridge/v1/preview/$DRAFT_ID&token=$TOKEN" | grep -q "smoke-draft-body"
echo "   OK"

echo "2) invalid token is rejected with 403..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WP_URL/?rest_route=/headless-bridge/v1/preview/$DRAFT_ID&token=invalid")
[ "$CODE" = "403" ]
echo "   OK"

echo "3) default REST does not leak the draft..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WP_URL/?rest_route=/wp/v2/posts/$DRAFT_ID")
[ "$CODE" = "401" ] || [ "$CODE" = "403" ]
echo "   OK"

echo "4) preview link points at the frontend..."
cli eval "echo get_preview_post_link( $DRAFT_ID );" | grep -q "http://localhost:4321/preview/?id=$DRAFT_ID&token="
echo "   OK"

cli post delete "$DRAFT_ID" --force > /dev/null
echo "SMOKE PASS"
```

- [ ] **Step 3: Run the full flow**

```bash
chmod +x wp/seed.sh tools/smoke/preview-endpoint.sh
pnpm setup
bash tools/smoke/preview-endpoint.sh
```

Expected: seed completes; smoke prints `SMOKE PASS`.

- [ ] **Step 4: Run unit tests one last time**

Run: `cd wp/plugins/headless-bridge && vendor/bin/phpunit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add wp/seed.sh tools/smoke/preview-endpoint.sh
git commit -m "feat(wp): add seed script and preview smoke test"
```

---

## Out of scope for this plan

- `packages/wp-client`, `packages/shared`, `apps/site` (Astro, preview shell, ssr mode) — **Plan 2**
- Webhook to GitHub (`class-webhook.php`), deploy scripts, CI workflows, build cache, Playwright E2E — **Plan 3**
- ACF is supported by the endpoint code path but not installed locally; the plain-meta path is what seed/smoke exercise
