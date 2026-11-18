#!/bin/sh
# NIGHTGRID multiplayer backend deploy (Cloudflare Workers FREE, workers.dev only). Run by Sameer on his Mac
# AFTER explicit approval. Default is a DRY RUN (bundles locally, uploads nothing).
#   sh scripts/deploy-backend.sh staging            # dry run, staging config
#   sh scripts/deploy-backend.sh staging --deploy   # real deploy of nightgrid-mp-staging (needs `npx wrangler login` once)
#   sh scripts/deploy-backend.sh production --deploy
# Never touches DNS, zones, routes or custom domains (wrangler.toml: workers_dev = true, routes = []).
set -eu
export WRANGLER_SEND_METRICS=false
ENVNAME="${1:-staging}"; MODE="${2:-}"
BUILD="$(node scripts/build-id.mjs)"
case "$ENVNAME" in staging) ENVARG="--env staging";; production) ENVARG="";; *) echo "env must be staging|production"; exit 2;; esac
if grep -Eq '^[[:space:]]*(zone_id|zone_name|custom_domain|route)[[:space:]]*=' wrangler.toml; then echo "REFUSING: wrangler.toml contains a zone/route/custom_domain key"; exit 3; fi
echo "build id: $BUILD   env: $ENVNAME"
if [ "$MODE" != "--deploy" ]; then
  npx wrangler deploy $ENVARG --dry-run --outdir .wrangler-dry --define "__NG_BUILD__:\"$BUILD\""
  echo "DRY RUN only. Nothing uploaded. Re-run with --deploy after approval."; exit 0
fi
npx wrangler whoami
printf "Deploy %s backend (build %s) to workers.dev on the account above? Type yes: " "$ENVNAME" "$BUILD"; read -r ans
[ "$ans" = "yes" ] || { echo "cancelled"; exit 1; }
npx wrangler deploy $ENVARG --define "__NG_BUILD__:\"$BUILD\""
