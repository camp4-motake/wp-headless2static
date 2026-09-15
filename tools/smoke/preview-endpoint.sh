#!/usr/bin/env bash
# End-to-end check of the preview chain: draft -> token -> endpoint -> draft JSON.
set -euo pipefail
cd "$(dirname "$0")/../../wp"

cli() { wp-env run cli wp "$@"; }
WP_URL="http://localhost:8888"

DRAFT_ID=$(cli post create --post_title="Smoke Draft" --post_status=draft \
  --post_content="<p>smoke-draft-body</p>" --porcelain)
TOKEN=$(cli eval "echo \HeadlessBridge\Token::issue( $DRAFT_ID, \HeadlessBridge\Plugin::secret(), time() );")

cleanup() { cli post delete "$DRAFT_ID" --force > /dev/null 2>&1 || true; }
trap cleanup EXIT

echo "1) valid token returns draft content..."
curl -fsS "$WP_URL/?rest_route=/headless-bridge/v1/preview/$DRAFT_ID&token=$TOKEN" | grep -q "smoke-draft-body"
echo "   OK"

echo "2) invalid token is rejected with 403..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WP_URL/?rest_route=/headless-bridge/v1/preview/$DRAFT_ID&token=invalid")
[ "$CODE" = "403" ]
echo "   OK"

echo "3) default REST does not leak the draft..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WP_URL/?rest_route=/wp/v2/posts/$DRAFT_ID")
[ "$CODE" = "401" ] || [ "$CODE" = "403" ]
echo "   OK"

echo "4) preview link points at the frontend..."
cli eval "echo get_preview_post_link( $DRAFT_ID );" | grep -q "http://localhost:4321/preview/?id=$DRAFT_ID&token="
echo "   OK"

echo "4b) block-editor draft preview (?p=ID&preview=true) redirects to the frontend..."
JAR=$(mktemp)
trap 'cleanup; rm -f "$JAR"' EXIT
curl -fsS -o /dev/null -c "$JAR" -b "wordpress_test_cookie=WP%20Cookie%20check" \
  --data "log=admin&pwd=password&testcookie=1" "$WP_URL/wp-login.php"
LOCATION=$(curl -sS -o /dev/null -b "$JAR" -w "%{redirect_url}" "$WP_URL/?p=$DRAFT_ID&preview=true")
case "$LOCATION" in
  "http://localhost:4321/preview/?id=$DRAFT_ID&token="*) ;;
  *) echo "FAIL: unexpected redirect: $LOCATION"; exit 1 ;;
esac
echo "   OK"

echo "4c) anonymous front-end preview does not issue a token..."
LOCATION=$(curl -sS -o /dev/null -w "%{redirect_url}" "$WP_URL/?p=$DRAFT_ID&preview=true")
case "$LOCATION" in
  *"token="*) echo "FAIL: token issued to anonymous request: $LOCATION"; exit 1 ;;
esac
echo "   OK"

echo "5) cors allows the configured frontend origin..."
curl -fsS -H "Origin: http://localhost:4321" -D - -o /dev/null "$WP_URL/?rest_route=/headless-bridge/v1/health" | grep -qi "access-control-allow-origin: http://localhost:4321"
echo "   OK"

echo "6) cors denies other origins..."
HEADERS=$(curl -fsS -H "Origin: http://evil.example" -D - -o /dev/null "$WP_URL/?rest_route=/headless-bridge/v1/health")
if echo "$HEADERS" | grep -qi "access-control-allow-origin"; then
  echo "FAIL: access-control-allow-origin leaked for disallowed origin"
  exit 1
fi
echo "$HEADERS" | grep -qi "vary: origin"
echo "   OK"

echo "SMOKE PASS"
