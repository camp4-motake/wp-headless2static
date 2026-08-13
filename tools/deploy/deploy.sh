#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

DIST="apps/site/dist"
CONFIG="${DEPLOY_CONFIG:-tools/deploy/deploy.config}"
DRY_RUN=0
[ "${1:-}" = "--" ] && shift
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

[ -f "$CONFIG" ] || { echo "設定ファイルがありません: $CONFIG (deploy.config.example をコピーしてください)"; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG"
[ -d "$DIST" ] || { echo "ビルド出力がありません: $DIST (先に pnpm build を実行してください)"; exit 1; }

run() {
	if [ "$DRY_RUN" = "1" ]; then
		printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'
	else
		"$@"
	fi
}

case "${DEPLOY_TARGET:?DEPLOY_TARGET is required}" in
	rental)
		case "${DEPLOY_METHOD:-rsync}" in
			rsync)
				EXCLUDE_ARGS=()
				for e in ${RSYNC_EXCLUDES:-}; do EXCLUDE_ARGS+=( "--exclude=$e" ); done
				run rsync -az --delete "${EXCLUDE_ARGS[@]}" \
					-e "ssh -p ${RENTAL_PORT:-22}" \
					"$DIST/" "${RENTAL_USER:?}@${RENTAL_HOST:?}:${RENTAL_PATH:?}/"
				;;
			lftp)
				: "${FTP_PASSWORD:?FTP_PASSWORD env var is required for lftp deploys}"
				run lftp -u "${FTP_USER:?},${FTP_PASSWORD}" -e \
					"set ftp:ssl-force true; mirror -R --delete --parallel=4 $DIST ${RENTAL_PATH:?}; quit" \
					"${FTP_HOST:?}"
				;;
			*) echo "unknown DEPLOY_METHOD: $DEPLOY_METHOD"; exit 1 ;;
		esac
		;;
	cloudflare)
		if [ -d "$DIST/server" ]; then
			run pnpm --filter site exec wrangler deploy
		else
			run pnpm --filter site exec wrangler pages deploy "$DIST" --project-name "${CF_PAGES_PROJECT:?}"
		fi
		;;
	*) echo "unknown DEPLOY_TARGET: $DEPLOY_TARGET"; exit 1 ;;
esac
echo "deploy: done (target=$DEPLOY_TARGET dry_run=$DRY_RUN)"
