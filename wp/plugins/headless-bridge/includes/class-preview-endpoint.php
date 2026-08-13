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
