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
		header( 'Vary: Origin' );
		$origin  = get_http_origin();
		$allowed = self::origin_of( Plugin::frontend_url() );
		if ( $origin && $allowed && self::origin_of( $origin ) === $allowed ) {
			header( 'Access-Control-Allow-Origin: ' . $origin );
			header( 'Access-Control-Allow-Methods: GET, OPTIONS' );
		}
		return $served;
	}

	/** Reduces a URL to scheme://host[:port] so a configured path can't silently break matching. */
	private static function origin_of( string $url ): string {
		$parts = wp_parse_url( $url );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}
		$origin = strtolower( $parts['scheme'] . '://' . $parts['host'] );
		return isset( $parts['port'] ) ? $origin . ':' . $parts['port'] : $origin;
	}
}
