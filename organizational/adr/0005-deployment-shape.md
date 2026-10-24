# ADR-0005: One instance, readiness-gated rollout, API streams the bytes

## Status

Accepted

## Context

The VPS conventions give the stateless web apps blue-green deploys, and the original storage design gave reads as
pre-signed object-store URLs (`organizational/deploy/b2-credential-security.md`, now historical). burrow is single-tenant, so two choices from that pattern need
a second look, and a third came up while building the API.

## Decision

**No blue-green.** Blue-green exists to avoid a gap in traffic. burrow has one user, who is not waiting on the
site at the instant of a release, and its vision container carries ~1.07 GiB of models (ADR-0004): a second live
slot would cost memory the host does not have for no visible benefit. `deploy.sh` instead restarts the stack, waits
for `/readyz` three times in a row, and restores the previous tag if that never happens. The outage is the few
seconds of a container restart. If burrow ever gets more than one user, revisit this, not before.

**The API streams file bytes instead of handing out pre-signed object-store URLs.** Every read already passes through an
authenticated, ownership-checked route, so the bucket stays private and no URL that works without a session ever
exists (a pre-signed URL keeps working until it expires, wherever it was pasted). The cost is that downloads
cross the VPS instead of going straight from an object store; at one user, over a metered link, that is acceptable. The response
carries `Content-Security-Policy: sandbox` and `nosniff`, so an uploaded HTML or SVG file cannot run as part of
burrow's origin. If bandwidth ever matters, pre-signed URLs with a very short expiry are the upgrade.

**Refresh tokens live in an HttpOnly cookie, access tokens in memory.** The earlier nutrilens design kept its token
in `localStorage`, readable by any script on the page; that is the open design question there. Here the access token
is short-lived (10 minutes) and never stored, the refresh token rotates on every use, and logout revokes the
session row, so a stolen token stops working at once instead of at expiry.

## Consequences

- A release is not zero-downtime; the cost is accepted and bounded by the readiness gate and automatic rollback.
- Download bandwidth is a VPS cost. Watch it in metrion once request and byte metrics exist (see the onboarding note).
- Auth never touches browser storage, which closes the class of bug a stored token has, but means every page load
  makes one refresh call before anything else.
