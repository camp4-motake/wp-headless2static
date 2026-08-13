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
