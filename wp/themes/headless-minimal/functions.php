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
