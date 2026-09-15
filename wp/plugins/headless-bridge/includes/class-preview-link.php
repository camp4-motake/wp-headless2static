<?php
namespace HeadlessBridge;

class Preview_Link {

	public static function boot(): void {
		add_filter( 'preview_post_link', [ self::class, 'rewrite' ], 10, 2 );
		// Before the theme's catch-all front-end redirect (priority 10).
		add_action( 'template_redirect', [ self::class, 'redirect_front_preview' ], 0 );
	}

	public static function rewrite( string $link, \WP_Post $post ): string {
		$frontend = Plugin::frontend_url();
		if ( '' === $frontend ) {
			return $link;
		}
		return self::build_url( $frontend, $post->ID, Token::issue( $post->ID, Plugin::secret(), time() ) );
	}

	/**
	 * The block editor ignores `preview_post_link` for drafts and opens `{permalink}?preview=true`
	 * on the WP front end instead. Send those requests on to the frontend preview.
	 */
	public static function redirect_front_preview(): void {
		if ( ! is_preview() ) {
			return;
		}
		$frontend = Plugin::frontend_url();
		$post_id  = self::preview_post_id( $_GET ) ?: get_queried_object_id();
		if ( '' === $frontend || ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}
		nocache_headers();
		wp_redirect( self::build_url( $frontend, $post_id, Token::issue( $post_id, Plugin::secret(), time() ) ), 302 );
		exit;
	}

	/** Pure — resolves the previewed post ID from front-end query args. */
	public static function preview_post_id( array $query ): int {
		foreach ( [ 'preview_id', 'p', 'page_id' ] as $key ) {
			$id = isset( $query[ $key ] ) && is_scalar( $query[ $key ] ) ? (int) $query[ $key ] : 0;
			if ( $id > 0 ) {
				return $id;
			}
		}
		return 0;
	}

	/** Pure — no WP functions, unit-tested. */
	public static function build_url( string $frontend, int $post_id, string $token ): string {
		return $frontend . '/preview/?id=' . $post_id . '&token=' . rawurlencode( $token );
	}
}
