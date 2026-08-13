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
