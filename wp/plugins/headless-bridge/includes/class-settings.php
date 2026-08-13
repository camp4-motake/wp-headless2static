<?php
namespace HeadlessBridge;

class Settings {

	public static function boot(): void {
		add_action( 'admin_menu', [ self::class, 'add_page' ] );
		add_action( 'admin_init', [ self::class, 'register' ] );
	}

	public static function register(): void {
		register_setting( 'headless_bridge', 'headless_bridge_frontend_url', [
			'type'              => 'string',
			'sanitize_callback' => 'esc_url_raw',
			'default'           => '',
		] );
	}

	public static function add_page(): void {
		add_options_page(
			'Headless Bridge',
			'Headless Bridge',
			'manage_options',
			'headless-bridge',
			[ self::class, 'render' ]
		);
	}

	public static function render(): void {
		?>
		<div class="wrap">
			<h1>Headless Bridge</h1>
			<form method="post" action="options.php">
				<?php settings_fields( 'headless_bridge' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="headless_bridge_frontend_url">Frontend URL</label></th>
						<td>
							<input name="headless_bridge_frontend_url" id="headless_bridge_frontend_url"
								type="url" class="regular-text code"
								value="<?php echo esc_attr( get_option( 'headless_bridge_frontend_url', '' ) ); ?>"
								placeholder="https://example.com" />
							<p class="description">Static site origin. Used for preview links, front-end redirects and CORS.</p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
