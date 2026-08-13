<?php
namespace HeadlessBridge;

class Webhook {

	const EVENT_TYPE = 'wp-content-update';

	public static function boot(): void {
		add_action( 'transition_post_status', [ self::class, 'on_transition' ], 10, 3 );
		add_action( 'deleted_post', [ self::class, 'on_delete' ], 10, 2 );
		add_action( 'admin_notices', [ self::class, 'maybe_notice' ] );
	}

	private static function relevant( string $post_type ): bool {
		$types = apply_filters( 'headless_bridge_webhook_post_types', [ 'post', 'page', 'work' ] );
		return in_array( $post_type, $types, true );
	}

	public static function on_transition( string $new_status, string $old_status, \WP_Post $post ): void {
		if ( 'publish' !== $new_status && 'publish' !== $old_status ) {
			return; // neither entering nor leaving publish — draft churn, ignore
		}
		if ( $new_status === $old_status && 'publish' !== $new_status ) {
			return;
		}
		if ( ! self::relevant( $post->post_type ) ) {
			return;
		}
		$action = 'publish' === $new_status ? 'publish_or_update' : 'unpublish';
		self::dispatch( [ 'action' => $action, 'post_id' => $post->ID, 'post_type' => $post->post_type ] );
	}

	public static function on_delete( int $post_id, \WP_Post $post ): void {
		if ( ! self::relevant( $post->post_type ) || 'publish' !== $post->post_status ) {
			return;
		}
		self::dispatch( [ 'action' => 'delete', 'post_id' => $post_id, 'post_type' => $post->post_type ] );
	}

	/** Pure request builder — no WP functions, unit-tested. */
	public static function build_request( string $repo, string $token, array $payload ): array {
		$url  = "https://api.github.com/repos/{$repo}/dispatches";
		$args = [
			'headers' => [
				'Authorization'        => 'Bearer ' . $token,
				'Accept'               => 'application/vnd.github+json',
				'X-GitHub-Api-Version' => '2022-11-28',
				'Content-Type'         => 'application/json',
			],
			'body'    => json_encode( [ 'event_type' => self::EVENT_TYPE, 'client_payload' => $payload ] ),
			'timeout' => 10,
		];
		return [ $url, $args ];
	}

	public static function dispatch( array $payload ): void {
		$repo  = (string) get_option( 'headless_bridge_github_repo', '' );
		$token = (string) get_option( 'headless_bridge_github_token', '' );
		if ( '' === $repo || '' === $token ) {
			return; // webhook not configured — silently skip (manual-deploy workflow)
		}
		[ $url, $args ] = self::build_request( $repo, $token, $payload );
		$url            = apply_filters( 'headless_bridge_webhook_url', $url );

		$res  = wp_remote_post( $url, $args );
		$code = is_wp_error( $res ) ? 0 : (int) wp_remote_retrieve_response_code( $res );
		if ( $code < 200 || $code >= 300 ) {
			$detail = is_wp_error( $res ) ? $res->get_error_message() : "HTTP {$code}";
			set_transient( 'headless_bridge_webhook_error', $detail, DAY_IN_SECONDS );
		} else {
			delete_transient( 'headless_bridge_webhook_error' );
		}
	}

	public static function maybe_notice(): void {
		$error = get_transient( 'headless_bridge_webhook_error' );
		if ( ! $error ) {
			return;
		}
		echo '<div class="notice notice-error"><p>Headless Bridge: ビルドの起動に失敗しました。公開した内容がサイトに反映されていない可能性があります(' . esc_html( $error ) . ')</p></div>';
	}
}
