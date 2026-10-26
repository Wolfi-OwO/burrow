#!/usr/bin/env bash
# Forced-command deploy for burrow. CI's SSH key is installed as
#   command="/opt/burrow/deploy.sh",restrict ssh-ed25519 AAAA...
# so the only thing it can ever run is this script, with whatever it sends as $SSH_ORIGINAL_COMMAND.
#
# Contract, validated strictly before any docker call (nothing from CI reaches a shell unquoted):
#   deploy api=<tag> vision=<tag|keep> version=<release tag> revision=<git sha>
#   status                                  prints the tags that are deployed now
#   <release tag>                           the old form: both images carry that tag
# An image tag is `web-<12 hex>` / `vision-<12 hex>` (a hash of the sources) or a release tag `v1.2.3`.
# `vision=keep` leaves the AI detector exactly as it is: it is only replaced when CI is told to.
set -euo pipefail

cd /opt/burrow
CMD="${SSH_ORIGINAL_COMMAND:-${*:-}}"

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)
RELEASE_RE='^v[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-dev-[0-9]{1,6})?$'
IMAGE_RE='^((web|vision)-[0-9a-f]{12}|v[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-dev-[0-9]{1,6})?)$'

get() { grep -E "^$1=" .env | cut -d= -f2- || true; }

# Older installs carry one IMAGE_TAG for both images: split it once.
if [ -z "$(get API_TAG)" ] && [ -n "$(get IMAGE_TAG)" ]; then
    { cat .env; echo "API_TAG=$(get IMAGE_TAG)"; echo "VISION_TAG=$(get IMAGE_TAG)"; } >.env.new
    cat .env.new >.env && rm -f .env.new
fi

if [ "$CMD" = "status" ]; then
    echo "DEPLOYED api=$(get API_TAG) vision=$(get VISION_TAG)"
    exit 0
fi

API="" VISION="" VERSION="" REVISION=""
if [[ "$CMD" =~ $RELEASE_RE ]]; then
    API="$CMD" VISION="$CMD" VERSION="$CMD" REVISION=""
elif [[ "$CMD" == deploy\ * ]]; then
    for part in ${CMD#deploy }; do
        case "$part" in
            api=*) API="${part#api=}" ;;
            vision=*) VISION="${part#vision=}" ;;
            version=*) VERSION="${part#version=}" ;;
            revision=*) REVISION="${part#revision=}" ;;
            *) echo "refusing to deploy: unknown field '${part%%=*}'" >&2; exit 64 ;;
        esac
    done
else
    echo "refusing to deploy: '${CMD}' is not a deploy command" >&2
    exit 64
fi

[[ "$API" =~ $IMAGE_RE ]] || { echo "refusing to deploy: bad api tag '${API}'" >&2; exit 64; }
if [ "$VISION" = "keep" ]; then VISION="$(get VISION_TAG)"; fi
[[ "$VISION" =~ $IMAGE_RE ]] || { echo "refusing to deploy: bad vision tag '${VISION}'" >&2; exit 64; }
[[ "$VERSION" =~ $RELEASE_RE ]] || { echo "refusing to deploy: bad version '${VERSION}'" >&2; exit 64; }
[ -z "$REVISION" ] || [[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "refusing to deploy: bad revision" >&2; exit 64; }

PREV_API="$(get API_TAG)"; PREV_VISION="$(get VISION_TAG)"; PREV_VERSION="$(get APP_VERSION)"; PREV_REVISION="$(get APP_REVISION)"

set_vars() {
    # Rewrite in place without sed -i's rename, which would orphan a bind-mounted file.
    local tmp
    tmp="$(mktemp .env.XXXXXX)"
    grep -vE '^(IMAGE_TAG|API_TAG|VISION_TAG|APP_VERSION|APP_REVISION)=' .env >"$tmp" || true
    { echo "API_TAG=$1"; echo "VISION_TAG=$2"; echo "APP_VERSION=$3"; [ -z "$4" ] || echo "APP_REVISION=$4"; } >>"$tmp"
    cat "$tmp" >.env
    rm -f "$tmp"
}

ready() {
    # Three readiness answers in a row, so one lucky response cannot green-light a half-started app.
    local ok=0
    for _ in $(seq 1 60); do
        if "${COMPOSE[@]}" exec -T burrow node -e "fetch('http://127.0.0.1:8080/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
            ok=$((ok + 1))
            [ "$ok" -ge 3 ] && return 0
        else
            ok=0
        fi
        sleep 2
    done
    return 1
}

echo "deploying api=${API} vision=${VISION} as ${VERSION} (was api=${PREV_API:-none} vision=${PREV_VISION:-none})"
set_vars "$API" "$VISION" "$VERSION" "$REVISION"
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --remove-orphans

if ready; then
    echo "burrow ${VERSION} is ready"
    docker image prune -f >/dev/null
    echo "DEPLOYED api=${API} vision=${VISION}"
    exit 0
fi

echo "burrow ${VERSION} never became ready" >&2
"${COMPOSE[@]}" logs --tail 60 burrow >&2 || true
if [ -n "$PREV_API" ] && [ -n "$PREV_VISION" ]; then
    echo "rolling back to api=${PREV_API} vision=${PREV_VISION}" >&2
    set_vars "$PREV_API" "$PREV_VISION" "${PREV_VERSION:-$VERSION}" "$PREV_REVISION"
    "${COMPOSE[@]}" up -d --remove-orphans
fi
exit 1
