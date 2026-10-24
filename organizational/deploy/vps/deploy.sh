#!/usr/bin/env bash
# Forced-command deploy for burrow. CI's SSH key is installed as
#   command="/opt/burrow/deploy.sh",restrict ssh-ed25519 AAAA...
# so the only thing it can ever run is this script, with whatever it sends as $SSH_ORIGINAL_COMMAND.
#
# Contract: the command is exactly one image tag. Everything else is rejected before any docker call.
set -euo pipefail

cd /opt/burrow
TAG="${SSH_ORIGINAL_COMMAND:-${1:-}}"

# Strictly validated: a tag is `v1.2.3`, optionally `-dev-<n>`. Nothing from CI reaches a shell unquoted.
if ! [[ "$TAG" =~ ^v[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-dev-[0-9]{1,6})?$ ]]; then
    echo "refusing to deploy: '${TAG}' is not a release tag" >&2
    exit 64
fi

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)
PREVIOUS="$(grep -E '^IMAGE_TAG=' .env | cut -d= -f2- || true)"

set_tag() {
    # Rewrite in place without sed -i's rename, which would orphan a bind-mounted file.
    local tmp
    tmp="$(mktemp .env.XXXXXX)"
    grep -vE '^IMAGE_TAG=' .env >"$tmp" || true
    echo "IMAGE_TAG=$1" >>"$tmp"
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

echo "deploying ${TAG} (was ${PREVIOUS:-none})"
set_tag "$TAG"
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --remove-orphans

if ready; then
    echo "burrow ${TAG} is ready"
    docker image prune -f >/dev/null
    exit 0
fi

echo "burrow ${TAG} never became ready" >&2
"${COMPOSE[@]}" logs --tail 60 burrow >&2 || true
if [ -n "$PREVIOUS" ]; then
    echo "rolling back to ${PREVIOUS}" >&2
    set_tag "$PREVIOUS"
    "${COMPOSE[@]}" up -d --remove-orphans
fi
exit 1
