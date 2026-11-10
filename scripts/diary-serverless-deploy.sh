#!/usr/bin/env bash
# Deploys the serverless diary (ADR-0027) to Yandex Cloud: bundles serverless.ts for Node, builds the
# amd64 image, pushes it, rolls out a container revision and updates the API Gateway.
#
#   scripts/diary-serverless-deploy.sh            # targets apps/diary-server/deploy/serverless/yandex.env
#   GATEWAY_ONLY=1 scripts/diary-serverless-deploy.sh   # only the API Gateway spec (redirects, routes)
#
# Needs the yc CLI signed in and Docker (OrbStack). The database is never touched beyond the
# numbered migrations the service runs itself on start.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT/apps/diary-server/deploy/serverless"
# shellcheck source=/dev/null
source "$DEPLOY/yandex.env"
# Personal values (the owner's e-mail), ignored by git: yandex.local.env.example.
# shellcheck source=/dev/null
[[ -f "$DEPLOY/yandex.local.env" ]] && source "$DEPLOY/yandex.local.env"
cd "$ROOT"
VERSION="$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("release.json", "utf8")).version)')"
TAG="cr.yandex/$YC_REGISTRY/diary-server:$VERSION-$(git -C "$ROOT" rev-parse --short=9 HEAD)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# The gateway spec with its placeholders filled; only these three, the spec's other text stays.
gateway_spec() {
  DIARY_PAGES_URL="$DIARY_PAGES_URL" CONTAINER_ID="$YC_CONTAINER_ID" INVOKER_SA="$YC_INVOKER_SA" \
    envsubst '$DIARY_PAGES_URL $CONTAINER_ID $INVOKER_SA' <"$DEPLOY/api-gateway.yaml"
}

if [[ "${GATEWAY_ONLY:-}" == 1 ]]; then
  gateway_spec >"$STAGE/gateway.yaml"
  yc serverless api-gateway update "$YC_GATEWAY" --folder-id "$YC_FOLDER" --spec "$STAGE/gateway.yaml" >/dev/null
  echo "API Gateway updated"
  exit 0
fi

bun build "$ROOT/apps/diary-server/src/serverless.ts" --target=node --format=esm --minify \
  --outfile "$STAGE/diary-serverless.mjs" >/dev/null
cp "$DEPLOY/Dockerfile" "$STAGE/"
yc iam create-token | docker login cr.yandex --username iam --password-stdin >/dev/null
# Docker v2 manifest without attestations: the registry refuses OCI indexes with them.
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --output "type=image,name=$TAG,push=true,oci-mediatypes=false" "$STAGE"

yc serverless container revision deploy --folder-id "$YC_FOLDER" --container-name "$YC_CONTAINER" \
  --image "$TAG" --cores 1 --core-fraction 50 --memory 512MB --concurrency 4 \
  --execution-timeout 30s --min-instances 0 --service-account-id "$YC_RUNTIME_SA" \
  --environment "DIARY_MODE=serverless,DIARY_YDB=$DIARY_YDB,YDB_METADATA_CREDENTIALS=1,DIARY_SIGNUP=$DIARY_SIGNUP,DIARY_PUSH_SUBJECT=$DIARY_PUSH_SUBJECT,DIARY_CORS_ORIGINS=$DIARY_CORS_ORIGINS${DIARY_ADMIN_EMAILS:+,DIARY_ADMIN_EMAILS=$DIARY_ADMIN_EMAILS}" \
  >/dev/null

gateway_spec >"$STAGE/gateway.yaml"
yc serverless api-gateway update "$YC_GATEWAY" --folder-id "$YC_FOLDER" --spec "$STAGE/gateway.yaml" >/dev/null

# Older images stay in the registry until removed: keep the newest three.
yc container image list --registry-id "$YC_REGISTRY" --format json |
  bun -e 'Bun.stdin.text().then((text) => { for (const image of JSON.parse(text).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(3)) console.log(image.id); })' |
  while read -r id; do yc container image delete "$id" >/dev/null; done
echo "deployed $TAG"
