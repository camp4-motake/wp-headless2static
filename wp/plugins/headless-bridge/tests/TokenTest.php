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
