# Security assessment: the Backblaze B2 credential path

Status: assessment, 2026-09-23. Scope: how burrow's B2 application key is
scoped, stored, and served from, now that ADR-0002 (#23) makes B2
EU-Central the canonical tier for user-uploaded files and the local disk
only a bounded ~50GB cache.

This is a design review, not a code review — no application code exists
yet. Everything below is a decision to build against, not a finding in
shipped code. The existing house convention (mode-600 env file, `scp`
under `umask 077`, `deploy`-owned, documented in metrion's
`organizational/agent-deployment-runbook.md`) is followed, not replaced.

## Threat model in one paragraph

burrow is private and single-tenant, but the content is not low-value:
real household files, plus an NSFW category that the compliance checklist
already treats as Art 9-adjacent. The blob store is the canonical copy —
losing it is losing the data, not losing a cache. The internet-facing
component is `apps/api`, which must hold a B2 credential to do its job, so
that credential is the one an attacker reaches first. Everything below
follows from: *assume the app key leaks, and make that survivable.*

## 1. Bucket-scoped application keys, never the account master key

**Decision: the B2 account master key never touches the VPS, never
touches this repository, and never appears in any `.env`.** It lives only
in the operator's password manager and is used interactively, from the
operator's own machine, for exactly one job: minting the scoped
application keys below.

Why this is not pedantry: B2's master key cannot be scoped. Its `keyID`
*is* the account ID, it carries account-level capability including
`deleteKeys`, `writeKeys` and `deleteBucket`, and it can act on every
bucket in the account — including metrion's. A master key in
`/opt/burrow/.env` turns any burrow API compromise into "attacker deletes
the account", with no recovery and no per-bucket blast-radius limit.

Application keys, by contrast, are restricted at creation time to one
bucket, an explicit capability list, and optionally a filename prefix.
Three keys, three jobs:

| Key | Bucket | Capabilities | Stored in |
| --- | --- | --- | --- |
| `burrow-app` | `burrow-blobs` | `listFiles`, `readFiles`, `writeFiles`, `shareFiles`, `deleteFiles` | `/opt/burrow/.env` |
| `burrow-backup` | `burrow-backups` | `listFiles`, `readFiles`, `writeFiles`, `deleteFiles` | `/etc/burrow-backup/backup.env` |
| metrion's offsite key | metrion's own bucket | metrion's business | not burrow's concern |

Additional scoping on `burrow-app`, both free:

- **`namePrefix=blobs/`** — matches ADR-0002's object key shape
  (`blobs/<sha[0:2]>/<sha[2:4]>/<sha>`). Costs one flag at key creation,
  and means a leaked app key cannot read or write anything outside the
  blob prefix even inside its own bucket.
- **`shareFiles` is required** and is what makes point 4 work — it is the
  capability that permits issuing download authorizations. It is not a
  read capability in itself.

`deleteFiles` on `burrow-app` is unavoidable: #30 requires that deleting
the last reference to a blob removes the object. It is also the single
most dangerous capability here, for two independent reasons — a leaked
key can wipe the canonical store, and burrow's *own* refcount logic is
new code that has never run. See "lifecycle as the real delete guard"
under point 5.

## 2. Separation from metrion's offsite-backup key

**Decision: burrow and metrion get separate B2 application keys, in
separate buckets. Neither key can see the other's bucket. No key is ever
shared between the two projects, and no key is reused across burrow's own
two jobs either.**

The requirement as stated — "one key compromise must not expose both" —
is satisfied by bucket-scoping alone, since a key scoped to
`burrow-blobs` returns `401 unauthorized` against metrion's bucket. The
part worth stating explicitly is the *third* separation, inside burrow:

**`burrow-app` must have no access whatsoever to `burrow-backups`.** If
one key covered both, an RCE in the internet-facing API would let an
attacker delete the blobs *and* the backups of the database describing
them, in one pass. That is the ransomware path, and it is the reason the
backup bucket is a separate bucket rather than a prefix inside the blob
bucket — a prefix-scoped key is only as good as the prefix check, a
separate bucket is enforced by B2's own authorization.

Practical consequence for provisioning: the operator creates two buckets
and three keys (two of burrow's, one of metrion's, when metrion's offsite
leg is finally provisioned — see "Live findings" below, it still is not).
Record the key IDs, not the secrets, in the deploy runbook (#52) so a
revocation can be done without guessing which key is which.

## 3. Storage on the box: mode 600, `scp` under `umask 077`, `deploy`-owned

**Decision: follow the existing convention exactly — mode 600, owner
`deploy`, transferred by `scp` of a file created under `umask 077`, never
typed into a shell command directly.** The one adaptation is the *path*,
and it is not cosmetic.

burrow deploys as a Docker Compose stack, not as a systemd-native
service. That changes which live precedent applies:

- **`burrow-app`'s key goes in `/opt/burrow/.env`, mode 600, owner
  `deploy`, directory mode 700** — matching `/opt/nutrilens/.env` and
  `/opt/metrion/.env`, both verified on the box today at `600
  deploy:deploy`, and consumed by Compose (`env_file:` / `--env-file`),
  which is read by the *invoking user*. This must be `deploy`-owned, not
  root-owned: a `root:root` file here would simply fail to load under a
  `deploy`-invoked `docker compose up`.
- **`burrow-backup`'s key goes in `/etc/burrow-backup/backup.env`, mode
  600, directory mode 700**, loaded by `EnvironmentFile=` in the backup
  unit from #56 — matching `/etc/vps-metrics-collector/collector.env` and
  `/etc/nutrilens-db-backup/backup.env`. Here, and only here, `root:root`
  is also viable (systemd reads `EnvironmentFile=` as PID 1 before
  dropping to `User=deploy`), which is what
  `/etc/nutrilens-db-backup/backup.env` actually does today.

Transfer, unchanged from the runbook:

```bash
umask 077
cat > /tmp/burrow.env <<'EOF'
B2_KEY_ID=...
B2_APPLICATION_KEY=...
B2_BUCKET=burrow-blobs
B2_ENDPOINT=s3.eu-central-003.backblazeb2.com
EOF
scp /tmp/burrow.env deploy@<vps>:/tmp/burrow.env
ssh deploy@<vps> '
  install -o deploy -g deploy -m 600 /tmp/burrow.env /opt/burrow/.env
  rm -f /tmp/burrow.env
'
rm -f /tmp/burrow.env
```

**What mode 600 does and does not buy here, measured.** The `deploy` user
is a member of the `docker` group on this box. Docker group membership is
root-equivalent — `docker run -v /:/host` reads any file on the host
regardless of its mode. So file permissions are a guard against accident
and against an unprivileged process, not a containment boundary against a
compromised `deploy` account. This is not an argument for adding a
secrets manager: a secrets manager on the same box, reachable by the same
`deploy` account, would not change that calculus either, and would add a
daemon to own, patch and debug. It *is* the argument for why points 1 and
2 carry the real weight — when permissions cannot contain a compromised
key, narrow scope and a small blast radius are what remain. Mode 600 is
the right amount of effort; anything more elaborate on this box is
theatre.

Also unchanged and worth restating: the key never goes in `.env.example`,
never in `docker-compose.yml` as a default, and never in a
`NEXT_PUBLIC_*`/`VITE_*`-style frontend variable. The frontend must never
hold a B2 credential in any form — see point 4 for how uploads work
without one.

## 4. Bucket privacy: private with pre-signed URLs, not public-read

**Decision: `burrow-blobs` is created as a private bucket. Every read is
served through a short-lived pre-signed URL issued by `apps/api` after an
ownership check. Public-read is rejected outright, and this is not a
close call.**

The tempting argument for public-read is that the object keys are SHA-256
hashes, so they are unguessable — 2^256 is not brute-forced. That
argument is wrong for this specific store, for three reasons:

1. **A leaked URL is permanently unrevocable, and revoking it harms other
   users.** URLs leak through browser history, `Referer` headers, chat
   clients that unfurl links, screenshots, and anything a user pastes
   into a third-party tool. With a public bucket the only way to revoke a
   leaked object URL is to delete the object — and under content-addressed
   dedup (#30) that object is shared by every file row with the same
   bytes, belonging to any user. Revoking one person's leaked link
   deletes another person's file. A pre-signed URL just expires.
2. **The NSFW category raises the cost of one accidental public URL** from
   embarrassing to a personal-data breach with a DSGVO Art 33 notification
   question attached. That is a `legal` question, not one to settle here,
   but it is the reason the margin must be wide.
3. **Public-read gives away the metering and abuse controls too** —
   unauthenticated, unlimited, unattributable egress billed to the
   account, with no per-user cap possible.

Implementation constraints that must land with it:

- **TTL: 300s for inline media and thumbnails, 900s for large
  downloads.** Long enough to start a download on a slow link, short
  enough that a leaked URL is stale before it is useful. B2's native
  `b2_get_download_authorization` permits up to 7 days — do not use
  anything near that.
- **Authorize on the file-metadata row, never on the blob hash.** This is
  the single most likely bug in this design. Dedup makes file→blob
  many-to-one, so "user may read hash X" is not a well-formed question —
  several users can legitimately share hash X, and an endpoint that signs
  any hash handed to it is an IDOR that bypasses every ACL in the app. The
  handler must resolve `fileId → owner`, check the session owns it, and
  only then look up the hash and sign. There must be no route that accepts
  a hash directly from the client.
- **Uploads go through the API. Do not issue pre-signed PUT URLs to the
  client.** Pre-signed PUT would save VPS bandwidth, and it breaks #30
  outright: the server cannot hash content it never sees, so the client
  would be choosing the object key. A malicious or buggy client could then
  write arbitrary bytes under a key claiming to be some other file's hash
  — poisoning the content-addressed store for every user whose file
  deduped to it. Server-side hash-then-write is what makes dedup safe.
  Pair this with the upload-size cap from #58.
- **Pre-signed URL issuance is itself a rate-limited endpoint** (#58). It
  is an egress-spending operation.

## 5. Pre-upload encryption: no for blobs, yes for the database backup

**Decision: burrow does not GPG-encrypt blobs before uploading them to
B2. It enables B2's server-side encryption (SSE-B2) on both buckets, and
it relies on restic's built-in repository encryption for the Postgres
backup in #56 — which is the direct equivalent of what metrion's GPG step
achieves, using a tool already installed on the box.**

Why metrion's pattern does not transfer to blobs. metrion GPG-encrypts
with a keypair whose private half is deliberately *not* on the VPS, so a
VPS compromise cannot decrypt past backups. That works because metrion's
plaintext is written once and never read back by the running service.
burrow's blobs are read back on every download, by the same online
service, so any key capable of decrypting them must live on the VPS —
next to the ciphertext, in the same `/opt/burrow/.env` an attacker
already has. It defends against nothing that the app key compromise does
not already defeat.

Why not convergent encryption (deriving the key from the plaintext hash,
the usual trick for keeping dedup): it reintroduces dedup at the cost of a
known-plaintext confirmation-of-a-file attack, and makes this project the
permanent owner of a bespoke crypto scheme. Not worth it at this scale,
for this threat model.

What is actually enabled instead:

- **SSE-B2 on both buckets** — provider-managed AES-256, one setting at
  bucket creation, no cost, no key management, no effect on dedup or
  pre-signed URLs. Be honest about what it buys: it protects against
  Backblaze losing a physical disk. It does not protect against Backblaze
  itself, nor against a leaked app key. It is free, so take it; do not
  count it as a mitigation for anything in points 1–4.
- **SSE-C (customer-supplied key) was evaluated and rejected**: it would
  defend against a B2-side breach, but it requires the key header on every
  GET, which a browser following a pre-signed URL cannot supply without
  the key being handed to the browser. It is incompatible with point 4.
- **restic handles the backup half** (#56). restic encrypts its
  repository by design, with a repo password — so the Postgres dump
  reaches B2 encrypted with no GPG step, no second tool, and no extra
  script. This is the metrion-GPG property, obtained for free from a tool
  already chosen and already installed.
  **Caveat, and it is the one that bites:** the restic repo password must
  exist somewhere other than the VPS. Store it in the operator's password
  manager *and* in `/etc/burrow-backup/backup.env`. If it lives only on
  the box, losing the box loses the ability to decrypt the backup, and the
  backup is a brick at the exact moment it is needed. metrion got this
  right by keeping the private GPG half off-box; match that.

**Lifecycle as the real delete guard.** Set both buckets to keep prior
versions for **7 days** rather than `keepOnlyLastVersion`. This is the
cheapest control in this document and it covers two distinct failure
modes: a leaked `burrow-app` key issuing mass deletes, and a bug in
burrow's own unproven refcount logic dropping a blob that is still
referenced. At burrow's volume the extra storage cost is cents. Without
it, `deleteFiles` on the app key is a single-step, irreversible path to
losing the canonical copy.

## Live findings from this pass

Not burrow bugs, but they sit on the path this assessment covers and were
verified on the box on 2026-09-23 rather than read out of a document.

1. **metrion's offsite backup still has never left the box.** No
   `offsite.env`, and the `b2` CLI is not installed. The unit exits 0
   every night while the one property it exists for has never been true —
   a false green. Already documented in metrion's runbook; re-confirmed
   here because burrow's design must not assume this credential path is
   proven in production. It is not. Only the *pattern* (mode-600 env file,
   `scp` under `umask 077`) is established.
2. **metrion does not need the `b2` CLI at all.** `restic` 0.16.4 is
   already installed on this box, and per #56 its `b2` backend works
   here. metrion's offsite leg could use it and skip installing a second
   tool. One less thing to own.
3. **Documentation/reality divergence in the credential convention.** The
   runbook describes these files as `deploy`-owned;
   `/etc/nutrilens-db-backup/backup.env` is in fact `root:root` (which is
   fine and marginally stronger for a systemd `EnvironmentFile=`, as
   explained in point 3), and `/etc/metrion-evaluator/evaluator.env` is
   documented but does not exist. Worth correcting there so the convention
   burrow is matching is stated precisely.
4. **ADR-0002's disk measurement is already stale**: 77G available when
   #23 was written, 82G today. The ~50GB cache ceiling still holds, but
   the figure should be re-measured at implementation rather than treated
   as fixed.
5. **Backblaze's own acceptable-use terms have not been checked.** The
   compliance checklist analysed Contabo's terms for the NSFW category,
   but the B2 adoption moved the *canonical* copy to a different provider
   whose terms were never reviewed. An AUP takedown at B2 is not only a
   legal event — it is loss of the store of record. A DPA (processor
   agreement) with Backblaze is separately needed before real user files
   land there. Both are questions for `legal`, not for this document.

## What this assessment did not cover

- No code review — `apps/api`, `apps/vision` and `apps/frontend` are
  empty. Every decision above is a specification to build against and must
  be re-verified against the implementation.
- No B2 account, bucket or key was created, and nothing was tested against
  the live B2 API. Capability names and the
  `b2_get_download_authorization` limits above come from B2's documented
  API and should be confirmed at provisioning time.
- Session, token and OIDC design (#34–#39) — the ownership check in point
  4 assumes a trustworthy session; whether it is one is a separate review.
- Rate limiting (#58) beyond naming the two endpoints that need it.
- The vision service's handling of file content, and any prompt-injection
  surface in the classification path (#46–#48).
- The other five stacks on this VPS, and the `deploy` account's own
  key/SSH hygiene beyond noting the `docker`-group consequence.
- Backblaze's acceptable-use policy and DPA text — flagged above, routed
  to `legal`, not analysed here.

## Checklist for provisioning

- [ ] Master key created, recorded in the password manager, never copied
      to the VPS.
- [ ] Buckets `burrow-blobs` and `burrow-backups` created **private**,
      EU-Central, SSE-B2 on, keep-prior-versions 7 days.
- [ ] `burrow-app` key: `burrow-blobs` only, `namePrefix=blobs/`,
      capabilities per the table in point 1.
- [ ] `burrow-backup` key: `burrow-backups` only. No overlap with
      `burrow-app`.
- [ ] `/opt/burrow/.env` — mode 600, owner `deploy`, dir 700, delivered by
      `scp` under `umask 077`, `/tmp` copy removed both ends.
- [ ] `/etc/burrow-backup/backup.env` — mode 600, dir 700, same delivery.
- [ ] restic repo password stored off-box as well as on it.
- [ ] Key IDs (not secrets) recorded in the deploy runbook (#52) so
      revocation does not require guesswork.
