# ADR-0002: Storage layout and content addressing

## Status

Accepted

## Context

burrow needs an on-disk/blob layout for uploaded files, and a decision on
where the durable copy of that data actually lives.

**Measured, 2026-09-23** (`df -h /` on the target VPS): 96G filesystem,
20G used, 77G avail, shared with five other stacks (portfolio, nutrilens,
netviz, preussen, metrion) plus a TimescaleDB that grows daily. That
figure has already drifted — `organizational/issue-audit-2026-09.md`
re-verified the box on a later pass and found `~82G` available instead of
77G, ordinary day-to-day disk usage drift, not a correction to the
decision below. Any number quoted here must be re-measured again at
implementation time rather than trusted; what holds is the conclusion it
supports, not the specific figure: burrow cannot plan around "the whole
disk". The local filesystem can hold **at most ~50GB** of blob data as a
bounded cache, not the canonical copy.

**B2 vs Contabo Object Storage.** At 100GB stored, Backblaze B2's
published pricing works out to ~€0.64/month. Contabo Object Storage was
the other option evaluated and rejected: its entry tier is €3.99/month,
above the ~1-2€/month ceiling for this project. B2 wins on both cost and
region (EU-Central keeps data in the EEA).

## Decision

**Backblaze B2 EU-Central (S3-compatible API) is the durable tier.** The
local disk is a bounded ~50GB cache in front of it, never the store of
record.

**Object key shape:** `blobs/<sha256[0:2]>/<sha256[2:4]>/<sha256>` — the
first two hex characters of the SHA-256 digest, then the next two, then
the full digest as the filename. This is the B2 **object key**, not a
directory path on disk, though the local cache mirrors the same nested
shape (`<cache-root>/blobs/<sha256[0:2]>/<sha256[2:4]>/<sha256>`) so the
two tiers use one addressing scheme instead of two.

**Dedup: hash before write, skip if the key exists.** The upload path
hashes the content first, then checks whether an object already exists
at that hash's key — in B2, and in the local cache — before writing
anything. A duplicate upload produces a new file-metadata row (see #30
and #42) but never a new blob write, in either tier.

**The storage metric for issue #55 is B2 bytes used, not local disk
usage.** Local disk is a capped cache and is expected to stay near its
~50GB ceiling by design; it says nothing about how much data burrow
actually holds. The number that matters for onboarding/monitoring is
bytes stored in B2.

**Credential, bucket-privacy and lifecycle decisions are recorded
separately** in
[`organizational/deploy/b2-credential-security.md`](../deploy/b2-credential-security.md)
and are not restated here — this ADR is the layout and tiering decision,
that document is the security posture built against it.

## Consequences

- Every read/write path in `apps/api` must go through a
  hash-then-check-then-write flow; there is no code path where a client
  chooses the object key directly (see the credential-security doc's
  point on why pre-signed PUT is rejected for the same reason).
- The local cache can be evicted and rebuilt from B2 at any time — cache
  loss is a performance problem, not a data-loss problem. B2 loss is data
  loss.
- Disk-usage monitoring on the VPS (metrion, issue #55) must report B2
  bytes used for burrow's storage metric; reading local disk usage there
  instead would silently under- or over-report and would not track
  actual data growth once the cache is at steady state.
- The ~50GB cache ceiling, not the specific `df -h` figure quoted above,
  is the number every later capacity decision should build against — that
  figure is already known-stale and will drift again before
  implementation.
