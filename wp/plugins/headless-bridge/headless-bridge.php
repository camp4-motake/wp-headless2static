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
require_once __DIR__ . '/includes/class-settings.php';
require_once __DIR__ . '/includes/class-preview-endpoint.php';
require_once __DIR__ . '/includes/class-preview-link.php';
require_once __DIR__ . '/includes/class-cors.php';

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
		Settings::boot();
		Preview_Endpoint::boot();
		Preview_Link::boot();
		Cors::boot();
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
