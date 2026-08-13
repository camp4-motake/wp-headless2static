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
		register_setting( 'headless_bridge', 'headless_bridge_github_repo', [
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		] );
		register_setting( 'headless_bridge', 'headless_bridge_github_token', [
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
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
					<tr>
						<th scope="row"><label for="headless_bridge_github_repo">GitHub Repository</label></th>
						<td>
							<input name="headless_bridge_github_repo" id="headless_bridge_github_repo"
								type="text" class="regular-text code"
								value="<?php echo esc_attr( get_option( 'headless_bridge_github_repo', '' ) ); ?>"
								placeholder="owner/repo" />
							<p class="description">公開時にビルドを起動するリポジトリ(owner/repo 形式)。</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="headless_bridge_github_token">GitHub Token</label></th>
						<td>
							<input name="headless_bridge_github_token" id="headless_bridge_github_token"
								type="password" class="regular-text code" autocomplete="off"
								value="<?php echo esc_attr( get_option( 'headless_bridge_github_token', '' ) ); ?>" />
							<p class="description">fine-grained PAT(このリポジトリの repository_dispatch のみ許可)。</p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
