#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cli() { wp-env run cli wp "$@"; }

echo "Seeding options..."
cli option update headless_bridge_frontend_url "http://localhost:4321"
cli option update blogname "Headless Demo"
cli theme activate headless-minimal
cli rewrite structure '/%postname%/' --hard

echo "Seeding taxonomy..."
cli term create category News --slug=news --porcelain || true
cli term create category Tech --slug=tech --porcelain || true

echo "Seeding posts..."
cli post create --post_title="Hello Headless" --post_name=hello-headless --post_status=publish \
  --post_content="<p>First published post.</p><h2>Section</h2><p>Body text.</p>" --porcelain || true
cli post create --post_title="Second Post" --post_name=second-post --post_status=publish \
  --post_content="<p>Another published post.</p>" --porcelain || true
cli post create --post_title="Draft In Progress" --post_status=draft \
  --post_content="<p>This draft is only visible via preview.</p>" --porcelain || true

echo "Seeding pages..."
cli post create --post_type=page --post_title="About" --post_name=about --post_status=publish \
  --post_content="<p>About this site.</p>" --porcelain || true

echo "Seeding works (CPT)..."
WORK_ID=$(cli post create --post_type=work --post_title="Corporate Site Renewal" --post_status=publish \
  --post_content="<p>Case study body.</p>" --porcelain || true)
if [ -n "${WORK_ID:-}" ]; then
  cli post meta update "$WORK_ID" client_name "ACME Inc." || true
  cli post meta update "$WORK_ID" project_url "https://example.com" || true
fi

echo "Seed complete. WP: http://localhost:8888/wp-admin (admin/password)"
