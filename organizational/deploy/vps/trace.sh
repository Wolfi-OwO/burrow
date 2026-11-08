#!/usr/bin/env bash
# Finds everything that happened for one trace id: the id a person sees in an error message ("Reference: 3f9a1c04d7e2").
# Usage: /opt/burrow/trace.sh <trace id> [since, default 48h]
# Every log line of burrow written while that request was handled carries "traceId", so one search shows the request
# (method, path, status, time taken) and anything that went wrong inside it.
set -euo pipefail

ID="${1:-}"
SINCE="${2:-48h}"
[[ "$ID" =~ ^[A-Za-z0-9._-]{8,64}$ ]] || { echo "usage: $0 <trace id: 8-64 letters, digits, . _ -> [since]" >&2; exit 64; }
[[ "$SINCE" =~ ^[0-9]{1,4}[smhd]$ ]] || { echo "since must look like 90m, 48h or 7d" >&2; exit 64; }

found=0
for container in burrow-burrow-1 burrow-burrow-vision-1 burrow-burrow-llm-1; do
    lines="$(docker logs --since "$SINCE" "$container" 2>&1 | grep -F -- "$ID" || true)"
    if [ -n "$lines" ]; then
        found=1
        echo "== $container"
        echo "$lines" | cut -c1-600
    fi
done
[ "$found" = 1 ] || echo "Nothing found for $ID in the last $SINCE. Logs are kept for about 3 x 10 MB per container; an id from a request that never reached the server (a dropped connection) has no line."
