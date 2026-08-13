<?php
/**
 * Plugin Name: Site Config
 * Description: Project-specific content model: example "work" CPT with revision-enabled meta.
 * Version: 0.1.0
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', static function (): void {
	register_post_type( 'work', [
		'label'        => 'Works',
		'public'       => true,
		'show_in_rest' => true,
		'rest_base'    => 'works',
		'menu_icon'    => 'dashicons-portfolio',
		'has_archive'  => true,
		'rewrite'      => [ 'slug' => 'works' ],
		'supports'     => [ 'title', 'editor', 'thumbnail', 'excerpt', 'revisions', 'custom-fields' ],
	] );

	// Convention: ALL project meta keys are registered with revisions_enabled
	// so drafts/autosaves preview correctly (requires WP 6.4+).
	foreach ( [ 'client_name', 'project_url' ] as $key ) {
		register_post_meta( 'work', $key, [
			'type'              => 'string',
			'single'            => true,
			'show_in_rest'      => true,
			'revisions_enabled' => true,
		] );
	}
} );
