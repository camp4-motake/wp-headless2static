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
