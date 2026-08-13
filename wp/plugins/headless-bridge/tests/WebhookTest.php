<?php
use HeadlessBridge\Webhook;
use PHPUnit\Framework\TestCase;

final class WebhookTest extends TestCase {

	public function test_build_request_shape(): void {
		[ $url, $args ] = Webhook::build_request( 'acme/site', 'tok123', [ 'action' => 'publish_or_update', 'post_id' => 7, 'post_type' => 'post' ] );

		$this->assertSame( 'https://api.github.com/repos/acme/site/dispatches', $url );
		$this->assertSame( 'Bearer tok123', $args['headers']['Authorization'] );
		$this->assertSame( 'application/vnd.github+json', $args['headers']['Accept'] );
		$this->assertSame( 10, $args['timeout'] );

		$body = json_decode( $args['body'], true );
		$this->assertSame( 'wp-content-update', $body['event_type'] );
		$this->assertSame( 7, $body['client_payload']['post_id'] );
		$this->assertSame( 'publish_or_update', $body['client_payload']['action'] );
	}

	public function test_build_request_encodes_body_as_json(): void {
		[ , $args ] = Webhook::build_request( 'a/b', 't', [ 'action' => 'delete', 'post_id' => 1, 'post_type' => 'work' ] );
		$this->assertJson( $args['body'] );
	}
}
