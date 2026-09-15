<?php
use HeadlessBridge\Preview_Link;
use PHPUnit\Framework\TestCase;

final class PreviewLinkTest extends TestCase {

	public function test_build_url_shape(): void {
		$this->assertSame(
			'http://localhost:4321/preview/?id=42&token=abc.def',
			Preview_Link::build_url( 'http://localhost:4321', 42, 'abc.def' )
		);
	}

	public function test_build_url_encodes_token(): void {
		$this->assertStringEndsWith( '&token=a%2Bb%3D', Preview_Link::build_url( 'https://example.com', 1, 'a+b=' ) );
	}

	public function test_preview_post_id_from_post_draft_link(): void {
		$this->assertSame( 12, Preview_Link::preview_post_id( [ 'p' => '12', 'preview' => 'true' ] ) );
	}

	public function test_preview_post_id_from_page_draft_link(): void {
		$this->assertSame( 34, Preview_Link::preview_post_id( [ 'page_id' => '34', 'preview' => 'true' ] ) );
	}

	public function test_preview_post_id_prefers_preview_id(): void {
		$this->assertSame( 56, Preview_Link::preview_post_id( [ 'preview_id' => '56', 'p' => '99' ] ) );
	}

	public function test_preview_post_id_ignores_invalid_values(): void {
		$this->assertSame( 0, Preview_Link::preview_post_id( [] ) );
		$this->assertSame( 0, Preview_Link::preview_post_id( [ 'p' => [ '1' ], 'page_id' => 'abc' ] ) );
	}
}
