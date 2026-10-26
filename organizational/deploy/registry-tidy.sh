#!/usr/bin/env bash
# Deletes old container image versions of burrow-api and burrow-vision from GHCR.
# Needs GH_TOKEN with packages:write (the Actions token has it). Environment:
#   KEEP    space separated tags that must stay (what is deployed now)
#   NEWEST  how many of the newest tagged versions to keep per image (default 3)
#   OWNER   registry owner (default wolfi-owo)
#   DRY_RUN=1 only prints what would go
set -euo pipefail

OWNER="${OWNER:-wolfi-owo}"
NEWEST="${NEWEST:-3}"
KEEP="${KEEP:-}"

for IMAGE in burrow-api burrow-vision; do
    echo "== $IMAGE"
    VERSIONS="$(gh api --paginate "/users/${OWNER}/packages/container/${IMAGE}/versions?per_page=100" \
        --jq '.[] | {id, name, created_at, tags: .metadata.container.tags}' | jq -s 'sort_by(.created_at) | reverse')"

    # Tags to keep: the deployed ones plus the newest few tagged versions.
    KEEP_TAGS="$( (printf '%s\n' $KEEP; jq -r --argjson n "$NEWEST" '[.[] | select(.tags | length > 0)] | .[:$n] | .[].tags[]' <<<"$VERSIONS") | sort -u | grep -v '^$' || true)"
    echo "keeping tags: $(echo $KEEP_TAGS)"

    # Digests those tags point at, including the children of an index, so nothing a kept image needs is removed.
    PROTECTED=""
    for TAG in $KEEP_TAGS; do
        RAW="$(docker buildx imagetools inspect --raw "ghcr.io/${OWNER}/${IMAGE}:${TAG}" 2>/dev/null || true)"
        [ -z "$RAW" ] && continue
        PROTECTED="$PROTECTED $(docker buildx imagetools inspect "ghcr.io/${OWNER}/${IMAGE}:${TAG}" --format '{{.Manifest.Digest}}' 2>/dev/null || true)"
        PROTECTED="$PROTECTED $(jq -r '.manifests[]?.digest' <<<"$RAW" 2>/dev/null || true)"
    done

    jq -c '.[]' <<<"$VERSIONS" | while read -r V; do
        ID="$(jq -r .id <<<"$V")"; NAME="$(jq -r .name <<<"$V")"; TAGS="$(jq -r '.tags | join(",")' <<<"$V")"
        if grep -qwF -- "$NAME" <<<"$PROTECTED"; then continue; fi
        KEPT=false
        for T in $(jq -r '.tags[]' <<<"$V"); do grep -qxF -- "$T" <<<"$KEEP_TAGS" && KEPT=true; done
        [ "$KEPT" = true ] && continue
        echo "delete ${IMAGE} version ${ID} (${TAGS:-untagged}, ${NAME:0:19})"
        [ "${DRY_RUN:-0}" = 1 ] || gh api -X DELETE "/users/${OWNER}/packages/container/${IMAGE}/versions/${ID}" >/dev/null
    done
done
