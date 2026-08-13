<?php
// Intentionally blank: front-end requests are redirected in functions.php.
// This renders only if no frontend URL is configured yet.
http_response_code( 200 );
echo 'Headless WordPress — no frontend URL configured (Settings > Headless Bridge).';
