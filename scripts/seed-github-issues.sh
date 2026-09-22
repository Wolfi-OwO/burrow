#!/usr/bin/env bash
# Seeds the epic-tracking issues and the M1-M8 work issues on Wolfi-OwO/burrow.
# Idempotent by title: re-running skips any issue whose exact title already
# exists (open or closed) instead of creating a duplicate.
set -euo pipefail

REPO="Wolfi-OwO/burrow"

issue_count_with_title() {
  local title="$1"
  gh issue list --repo "$REPO" --state all --search "\"$title\" in:title" \
    --json title --jq '.[].title' | grep -Fxc "$title" || true
}

# create_issue TITLE LABELS [MILESTONE] < body-on-stdin
create_issue() {
  local title="$1" labels="$2" milestone="${3:-}"
  local body
  body="$(cat)"
  if [[ "$(issue_count_with_title "$title")" -gt 0 ]]; then
    echo "skip (exists): $title"
    return
  fi
  if [[ -n "$milestone" ]]; then
    gh issue create --repo "$REPO" --title "$title" --body "$body" --label "$labels" --milestone "$milestone" >/dev/null
  else
    gh issue create --repo "$REPO" --title "$title" --body "$body" --label "$labels" >/dev/null
  fi
  echo "created: $title"
}

HARDCODE_NOTE='Hard-coding is fine here — a single hard-coded user, no migrations, no auth — the point of this milestone is a working shape, not a design.'

# ============================================================
# Epics (Task 7)
# ============================================================

create_issue "Epic: Prototype walking skeleton" "epic,area:organizational,phase:prototype" <<'EOF'
Tracks the 12 M1 issues: a hard-coded, single-user, no-auth, no-migrations
walking skeleton that proves upload -> browse -> classify -> file works end
to end, before any of the full-application design work begins.

## Child issues
EOF

create_issue "Epic: Specs and organizational design" "epic,area:organizational,phase:full-app" <<'EOF'
Tracks the M2 issues: functional requirements, the four foundational ADRs
(API/vision split, storage layout, category-tree model, vision model
choice), the bulk-sort scheduling design, and the upload/classify/file
activity diagrams. Everything downstream (M3-M8) is built against this.

## Child issues
EOF

create_issue "Epic: Storage and metadata index" "epic,area:database,phase:full-app" <<'EOF'
Tracks the M3 issues: the Postgres 16 schema and migration tooling, the
`ltree` category tree, content-addressed blob storage with SHA-256 dedup,
full-text search, the deferred `pgvector` embedding column, and the
100GB backup/restore runbook.

## Child issues
EOF

create_issue "Epic: Authentication and identity" "epic,area:api,phase:full-app" <<'EOF'
Tracks the M4 issues: credentials auth with Argon2id, session/token design,
OIDC via GitHub/Microsoft/Google, and account linking across providers.

## Child issues
EOF

create_issue "Epic: Drive and category tree" "epic,area:frontend,phase:full-app" <<'EOF'
Tracks the M5 issues: the user-editable category tree (arbitrary depth,
move/rename with subtree integrity), upload with dedup-on-ingest, the user
profile, and the search UI over the index built in M3.

## Child issues
EOF

create_issue "Epic: Vision classification and bulk sorts" "epic,area:vision,phase:full-app" <<'EOF'
Tracks the M6 issues: the `apps/vision` FastAPI/ONNX skeleton, the OpenCLIP
ViT-B/32 embed endpoint, zero-shot classification against user-defined
categories, a dedicated NSFW classifier, recursive descent into leaf
subcategories, the volume-driven scheduler, and the human-review queue.

## Child issues
EOF

create_issue "Epic: Infrastructure, DNS and observability" "epic,area:infra,phase:full-app" <<'EOF'
Tracks the M7 issues: the Docker Compose deploy runbook for the Contabo
VPS, the GoDaddy DNS record, the Caddy reverse-proxy vhost, onboarding
burrow into the existing `metrion` monitoring tool, and the nightly
backup timer for the blob store.

## Child issues
EOF

create_issue "Epic: Hardening and release" "epic,area:infra,phase:full-app" <<'EOF'
Tracks the M8 issues: the gitleaks/Trivy/CodeQL security workflows, rate
limiting and upload-size caps, finishing the legal-document TODOs, the
e2e smoke suite, and the v0.1.0 release checklist.

## Child issues
EOF

# ============================================================
# M1 - Prototype (Task 8) — all phase:prototype, milestone M1
# ============================================================
M1="M1 - Prototype"
HARDCODE_NOTE='Hard-coding is fine here — a single hard-coded user, no migrations, no auth — the point of this milestone is a working shape, not a design.'

create_issue "Prototype: upload a file to disk" "type:feature,area:api,priority:medium,phase:prototype" "$M1" <<EOF
A minimal upload endpoint that writes a received file straight to a local
directory. $HARDCODE_NOTE

## Acceptance Criteria
- POST endpoint accepts a file and writes it under a fixed local path.
- Original filename is preserved in the response.
- No content-addressing, no dedup — that's M3.
EOF

create_issue "Prototype: hard-coded folder tree in a JSON file" "type:feature,area:api,priority:medium,phase:prototype" "$M1" <<'EOF'
A fixed category tree (e.g. Photos/Documents/Receipts) defined in a single
committed JSON file, read on startup. Hard-coding is fine here — a single
hard-coded user, no migrations, no auth — the point of this milestone is a
working shape, not a design.

## Acceptance Criteria
- Tree is nested JSON with at least two levels of depth.
- Served by an endpoint the frontend can read.
- No database, no ltree column — that's M3.
EOF

create_issue "Prototype: list and browse the tree" "type:feature,area:frontend,priority:medium,phase:prototype" "$M1" <<EOF
A page that renders the hard-coded tree and lets you click into a folder to
see the files hard-coded-assigned to it. $HARDCODE_NOTE

## Acceptance Criteria
- Clicking a folder shows only files filed under it.
- Breadcrumb or back-navigation to the parent folder.
- No search, no sorting UI beyond a plain list.
EOF

create_issue "Prototype: a single hard-coded login" "type:feature,area:api,priority:medium,phase:prototype" "$M1" <<EOF
One hard-coded username/password pair gates the prototype UI, enough to
prove "logged in" vs "not logged in" as a concept. $HARDCODE_NOTE

## Acceptance Criteria
- Wrong credentials are rejected, correct ones let you in.
- No password hashing, no sessions beyond an in-memory flag or cookie.
- Real Argon2id/session design is M4, not this.
EOF

create_issue "Prototype: thumbnail rendering" "type:feature,area:frontend,priority:medium,phase:prototype" "$M1" <<'EOF'
Render a thumbnail for image files in the tree browser instead of a bare
filename. Hard-coding is fine here — a single hard-coded user, no
migrations, no auth — the point of this milestone is a working shape, not
a design.

## Acceptance Criteria
- Image files show a small preview in the folder listing.
- Non-image files fall back to a generic icon.
- No resizing pipeline or caching layer — browser-native image-tag sizing is enough.
EOF

create_issue "Prototype: run OpenCLIP ViT-B/32 once against a fixed label list" "type:feature,area:vision,priority:medium,phase:prototype" "$M1" <<EOF
A standalone script that loads OpenCLIP ViT-B/32 and zero-shot-classifies
one file against a small, fixed list of category labels, printing the best
match. $HARDCODE_NOTE

## Acceptance Criteria
- Script takes a file path, prints the predicted label and its score.
- Label list is a short hard-coded array matching the M1 folder tree.
- No FastAPI service, no batching — that's M6.
EOF

create_issue "Prototype: manual 'sort now' button" "type:feature,area:api,priority:medium,phase:prototype" "$M1" <<EOF
A button in the UI that calls the classification script from the previous
issue against one unsorted file and shows the suggested folder. $HARDCODE_NOTE

## Acceptance Criteria
- Button triggers the script server-side and returns a prediction.
- Prediction is shown to the user, not auto-applied.
- No scheduler, no bulk run — that's M6.
EOF

create_issue "Prototype: move a file between folders" "type:feature,area:api,priority:medium,phase:prototype" "$M1" <<EOF
Endpoint + UI action to move a file from one hard-coded folder to another,
updating the flat-file/SQLite index. $HARDCODE_NOTE

## Acceptance Criteria
- Moving a file updates which folder it appears under immediately.
- Underlying file on disk is untouched (only its tree assignment changes).
- No subtree-integrity concerns — the tree is flat/fixed at this stage.
EOF

create_issue "Prototype: delete a file" "type:feature,area:api,priority:medium,phase:prototype" "$M1" <<EOF
Endpoint + UI action to remove a file from disk and from the index.
$HARDCODE_NOTE

## Acceptance Criteria
- Delete removes the file from the folder listing and from disk.
- A confirmation step exists before the delete fires.
- No soft-delete/trash concept — that's out of scope for the prototype.
EOF

create_issue "Prototype: SQLite or flat-file index" "type:feature,area:database,priority:medium,phase:prototype" "$M1" <<EOF
A single SQLite database (or flat JSON file, whichever is faster to stand
up) tracking which file lives in which folder. $HARDCODE_NOTE

## Acceptance Criteria
- Upload, move and delete all read/write through this index.
- Explicitly not Postgres — the real schema and migrations are M3.
- Survives a server restart (persisted to disk, not in-memory only).
EOF

create_issue "Prototype: Vite React page tying it together" "type:feature,area:frontend,priority:medium,phase:prototype" "$M1" <<'EOF'
A single Vite + React page that wires up login, tree browsing, upload,
thumbnails, move, delete and the "sort now" button into one working flow.
Hard-coding is fine here — a single hard-coded user, no migrations, no
auth — the point of this milestone is a working shape, not a design.

## Acceptance Criteria
- One page (no routing framework needed) exercises every M1 issue above.
- No design system, no component library — plain, functional markup.
- Runs with a single npm-run-dev against the prototype backend.
EOF

create_issue "Prototype: prototype/README.md recording findings" "type:docs,area:organizational,priority:medium,phase:prototype" "$M1" <<'EOF'
Write up in prototype/README.md what the walking skeleton proved and what
it deliberately dodged, to hand off into the M2 spec-writing work.

## Acceptance Criteria
- Lists what worked end to end (upload, browse, classify, sort, move, delete).
- Explicitly lists what was hard-coded/skipped and why (auth, migrations, scheduling, pgvector).
- Names the open questions M2's ADRs need to resolve before M3 starts.
EOF

# ============================================================
# M2 - Specs & Organizational Design (Task 9) — phase:full-app
# ============================================================
M2="M2 - Specs & Organizational Design"

create_issue "Write organizational/requirements/functional-requirements.md" "type:docs,area:organizational,priority:high,phase:full-app" "$M2" <<'EOF'
Capture the functional requirements for the full application (drive,
category tree, auth, vision sorting) as numbered FRs, the way nutrilens'
own requirements docs are structured, so every later ADR and issue can
cite a specific FR.

## Acceptance Criteria
- Numbered FR entries (FR-xxx), grouped by area (auth, drive, vision, infra).
- Each FR is testable — a reviewer can say yes/no whether it's met.
- Explicitly marks what's out of scope for v1 (e.g. multi-tenant sharing).
- Cross-referenced by at least the four ADRs below once they exist.
EOF

create_issue "ADR-0001: API and vision service split" "type:docs,area:organizational,priority:high,phase:full-app" "$M2" <<'EOF'
Record why the vision classifier is a separate FastAPI/ONNX service
(apps/vision) rather than living inside apps/api, and the contract between
the two (sync HTTP call, no shared DB access).

## Acceptance Criteria
- States the decision, the alternatives considered, and why they were rejected.
- Covers language mismatch (Python ML stack vs Node API) as a driving factor.
- Defines the request/response contract at a high level (inputs, outputs, timeouts).
- Follows the repo's existing ADR template under organizational/adr/.
EOF

create_issue "ADR-0002: storage layout and content addressing" "type:docs,area:organizational,priority:high,phase:full-app" "$M2" <<'EOF'
Record the on-disk/blob layout for uploaded files: content-addressed by
SHA-256, directory sharding, and how that interacts with dedup.

## Acceptance Criteria
- Decision on directory sharding scheme (e.g. first two hex chars as a bucket).
- States how dedup is detected and what happens to duplicate uploads.
- Notes the storage-usage metric this creates, since M7's metrion issue depends on it.
EOF

create_issue "ADR-0003: category-tree model (ltree vs adjacency list)" "type:docs,area:organizational,priority:high,phase:full-app" "$M2" <<'EOF'
Record the decision between Postgres ltree and a plain adjacency-list
table for the user-editable category tree, and write down the decision —
not just the options.

## Acceptance Criteria
- Compares ltree and adjacency-list on the operations that matter here: move/rename subtree, recursive descent, depth queries.
- States a concrete decision, not just a comparison table.
- Feeds directly into M3's ltree category-tree issue and M5's tree CRUD issue.
EOF

create_issue "ADR-0004: vision model choice" "type:docs,area:organizational,priority:high,phase:full-app" "$M2" <<'EOF'
Record why OpenCLIP ViT-B/32 (self-hosted, open weights) was chosen over a
cloud vision API for classification, with the cloud provider's terms of
service as the deciding factor for a private personal-file drive.

## Acceptance Criteria
- States the cloud-ToS constraint explicitly (most cloud vision APIs reserve
  rights to inspect/retain uploaded images) as the reason self-hosting wins
  over a hosted API, even though a hosted API would be simpler to run.
- Names the specific model (OpenCLIP ViT-B/32) and where its weights come from.
- Flags that the NSFW/SFW split needs a dedicated classifier, not CLIP zero-shot alone — feeds M6.
EOF

create_issue "Design the bulk-sort scheduling approach" "type:docs,area:organizational,priority:medium,phase:full-app" "$M2" <<'EOF'
Design how the classifier runs against the backlog of unsorted files: not
a fixed cron interval, but a volume-driven schedule running roughly 10-30
times a day depending on how much is queued.

## Acceptance Criteria
- Specifies how "unsorted volume" is measured and how it maps to run frequency.
- Covers the low end (near-empty queue, infrequent runs) and high end (backlog spike, up to ~30 runs/day) explicitly.
- Feeds directly into M6's scheduler issue.
EOF

create_issue "Activity diagrams for upload, classify and file" "type:docs,area:organizational,priority:medium,phase:full-app" "$M2" <<'EOF'
Draw the end-to-end activity diagram(s) covering a file from upload
through classification to being filed into the category tree, including
the human-review branch for low-confidence predictions.

## Acceptance Criteria
- Diagram(s) committed under organizational/ (e.g. Mermaid in the ADR/requirements docs).
- Covers the happy path and the low-confidence-review branch.
- Matches the contract defined in ADR-0001 and the FRs in functional-requirements.md.
EOF

# ============================================================
# M3 - Data Model & Storage (Task 9) — phase:full-app
# ============================================================
M3="M3 - Data Model & Storage"

create_issue "Postgres 16 schema and migration tooling" "type:feature,area:database,priority:high,phase:full-app" "$M3" <<'EOF'
Stand up the real Postgres 16 schema (pgvector/pgvector:pg16 image, per
docker-compose.yml) and a migration tool, replacing the prototype's
SQLite/flat-file index entirely.

## Acceptance Criteria
- Migration tool is checked in (e.g. node-pg-migrate or Drizzle migrations) with an up/down pair per change.
- Core tables exist: users, files, category tree join.
- `npm run migrate` (or equivalent) runs clean against a fresh docker-compose Postgres.
EOF

create_issue "ltree category tree" "type:feature,area:database,priority:high,phase:full-app" "$M3" <<'EOF'
Implement the category tree as a Postgres ltree column per ADR-0003,
including the GiST index needed for efficient subtree queries.

## Acceptance Criteria
- ltree extension enabled via migration.
- Query for "all descendants of node X" and "direct children of X" both covered by tests.
- GiST index present and used (verified with EXPLAIN) for descendant queries.
EOF

create_issue "Content-addressed blob store with SHA-256 dedup" "type:feature,area:database,priority:high,phase:full-app" "$M3" <<'EOF'
Implement the blob storage layer from ADR-0002: files are written keyed by
their SHA-256 hash, and a second upload of identical bytes reuses the
existing blob instead of writing a duplicate.

## Acceptance Criteria
- Upload path hashes content before writing and checks for an existing blob with that hash.
- Duplicate upload creates a new file-metadata row but no new blob.
- Deleting the last reference to a blob removes the blob from disk (no orphaned data, no premature deletion while still referenced).
EOF

create_issue "tsvector and GIN full-text search" "type:feature,area:database,priority:medium,phase:full-app" "$M3" <<'EOF'
Add a generated tsvector column over filename/metadata with a GIN index,
so the M5 search UI has something real to query against.

## Acceptance Criteria
- Generated column stays in sync automatically on insert/update (no app-side trigger to keep in sync by hand).
- GIN index present and used for search queries (verified with EXPLAIN).
- Search query supports basic ranking (ts_rank) so results aren't returned in arbitrary order.
EOF

create_issue "pgvector embedding column (HNSW deferred)" "type:feature,area:database,priority:medium,phase:full-app" "$M3" <<'EOF'
Add a vector column (pgvector) to hold the CLIP embedding produced by
apps/vision for each file, sized for ViT-B/32's 512-dim output.

## Acceptance Criteria
- Column type is vector(512), nullable until a file has been classified.
- No HNSW (or any ANN) index yet — explicitly deferred until there's enough
  data for it to matter; a plain sequential scan is fine at this stage.
- Migration includes a comment stating the HNSW deferral and what would trigger adding it.
EOF

create_issue "Backup and restore runbook for 100GB" "type:docs,area:database,priority:medium,phase:full-app" "$M3" <<'EOF'
Write the runbook for backing up and restoring both the Postgres database
and the blob store at the ~100GB scale this drive is sized for.

## Acceptance Criteria
- Covers both the Postgres dump/restore path and the blob-store backup path (see M7's restic/rsync timer issue) as one coherent procedure.
- Includes a tested restore-from-backup walkthrough, not just the backup half.
- States an expected backup window and restore-time estimate at 100GB.
EOF

# ============================================================
# M4 - Auth (Task 9) — phase:full-app
# ============================================================
M4="M4 - Auth"

create_issue "Credentials auth with Argon2id" "type:security,area:api,priority:high,phase:full-app" "$M4" <<'EOF'
Replace the M1 prototype's plaintext hard-coded login with real
username/password auth, hashing with Argon2id.

## Acceptance Criteria
- Passwords are hashed with Argon2id using vetted parameters (not defaults copied without review).
- Login endpoint rate-limits repeated failed attempts.
- No password (hashed or otherwise) is ever logged.
EOF

create_issue "Session and token design" "type:security,area:api,priority:high,phase:full-app" "$M4" <<'EOF'
Design and implement how an authenticated session is represented and
verified across requests — the JWT_SECRET already wired into
docker-compose.yml is the signing key for this.

## Acceptance Criteria
- States the token type (e.g. short-lived JWT + refresh) and expiry policy.
- Revocation/logout path is defined, not just issuance.
- Token verification is a single shared middleware, not duplicated per-route.
EOF

create_issue "OIDC login via GitHub" "type:feature,area:api,priority:medium,phase:full-app" "$M4" <<'EOF'
Add GitHub as an OIDC/OAuth login provider, using the
GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET already stubbed in docker-compose.yml.

## Acceptance Criteria
- Full authorization-code flow works end to end against real GitHub OAuth app credentials.
- A GitHub login either creates a new account or links to an existing one by verified email.
- Client secret is read from env only, never hard-coded.
EOF

create_issue "OIDC login via Microsoft" "type:feature,area:api,priority:medium,phase:full-app" "$M4" <<'EOF'
Add Microsoft as an OIDC login provider, using the
MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET already stubbed in
docker-compose.yml.

## Acceptance Criteria
- Full authorization-code flow works end to end against a real Microsoft (Entra ID) app registration.
- Shares the same account-creation/linking logic as the GitHub provider, not a parallel implementation.
- Client secret is read from env only, never hard-coded.
EOF

create_issue "OIDC login via Google" "type:feature,area:api,priority:medium,phase:full-app" "$M4" <<'EOF'
Add Google as an OIDC login provider, using the
GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET already stubbed in docker-compose.yml.

## Acceptance Criteria
- Full authorization-code flow works end to end against a real Google OAuth client.
- Shares the same account-creation/linking logic as the other two providers.
- Client secret is read from env only, never hard-coded.
EOF

create_issue "Account linking across providers" "type:feature,area:api,priority:medium,phase:full-app" "$M4" <<'EOF'
Let a single user account be reachable through more than one login method
(credentials + any combination of GitHub/Microsoft/Google), matched by
verified email.

## Acceptance Criteria
- Logging in with a second provider on a verified-matching email links to the existing account instead of creating a duplicate.
- A user can view and remove linked providers from their profile, provided at least one login method remains.
- Linking is rejected if the second provider's email isn't verified.
EOF

# ============================================================
# M5 - Drive & Category Tree (Task 9) — phase:full-app
# ============================================================
M5="M5 - Drive & Category Tree"

create_issue "User-editable category tree CRUD at arbitrary depth" "type:feature,area:frontend,priority:high,phase:full-app" "$M5" <<'EOF'
Replace the M1 fixed JSON tree with a real UI for creating, renaming and
deleting category nodes at any depth, backed by M3's ltree schema.

## Acceptance Criteria
- Create/rename/delete all work at arbitrary depth, not just top-level.
- Deleting a non-empty category requires the user to choose what happens to its contents (move up, or block the delete).
- Tree UI reflects ltree structure directly, no client-side tree reconstruction from a flat list.
EOF

create_issue "Move and rename with subtree integrity" "type:feature,area:api,priority:high,phase:full-app" "$M5" <<'EOF'
Implement moving/renaming a category node such that its entire subtree
(children, grandchildren, and the files filed under them) stays correctly
attached — the concern ADR-0003 exists to settle.

## Acceptance Criteria
- Moving a node with descendants relocates the whole subtree in one atomic operation.
- Files filed under any descendant of the moved node resolve to the new path afterward.
- Operation is transactional — a failure partway through leaves the tree in its original state, not half-moved.
EOF

create_issue "Upload with dedup-on-ingest" "type:feature,area:api,priority:high,phase:full-app" "$M5" <<'EOF'
Wire the real upload endpoint to M3's content-addressed blob store, so a
byte-identical re-upload is recognized at ingest time rather than stored
twice.

## Acceptance Criteria
- Uploading the same file content twice (even under a different filename) creates one blob and two metadata rows.
- Upload response indicates whether the content was new or a dedup hit.
- Upload size is capped (ties into M8's upload-size-caps issue) rather than unbounded.
EOF

create_issue "User profile: avatar, display name, bio" "type:feature,area:frontend,priority:medium,phase:full-app" "$M5" <<'EOF'
A profile page/endpoint letting a user set an avatar image, display name
and short bio, separate from their login identity.

## Acceptance Criteria
- Avatar upload goes through the same blob store as regular files (no second storage path).
- Display name and bio are editable and persisted.
- Profile is readable without exposing the user's linked-provider emails from M4.
EOF

create_issue "Search UI over the index" "type:feature,area:frontend,priority:medium,phase:full-app" "$M5" <<'EOF'
A search box wired to M3's tsvector/GIN full-text index, showing ranked
results with a jump-to-folder action.

## Acceptance Criteria
- Search returns results ranked by relevance, not insertion order.
- Each result links to (or highlights) its position in the category tree.
- Empty/no-match state is explicit, not a silently empty list.
EOF

# ============================================================
# M6 - Vision & Bulk Sorts (Task 9) — phase:full-app
# ============================================================
M6="M6 - Vision & Bulk Sorts"

create_issue "apps/vision FastAPI and ONNX skeleton" "type:feature,area:vision,priority:high,phase:full-app" "$M6" <<'EOF'
Stand up apps/vision as a real FastAPI service running models via ONNX
runtime, replacing the M1 prototype's standalone script, per ADR-0001's
API/vision split.

## Acceptance Criteria
- FastAPI app with a health-check endpoint, runnable via its own Dockerfile (matching docker-compose.yml's `vision` service).
- Holds no persistent user data, per CONTRIBUTING.md's ground rules — receives a file, returns a result, keeps nothing.
- Startup fails loudly if a required model file is missing, rather than serving broken predictions.
EOF

create_issue "OpenCLIP ViT-B/32 embed endpoint" "type:feature,area:vision,priority:high,phase:full-app" "$M6" <<'EOF'
An endpoint that returns the 512-dim OpenCLIP ViT-B/32 embedding for a
given file, to be stored in M3's pgvector column.

## Acceptance Criteria
- Endpoint accepts an image and returns a 512-length float vector.
- Same input produces the same embedding across calls (deterministic inference).
- Documented latency/throughput at the batch size apps/api will realistically send.
EOF

create_issue "Zero-shot classification against user-defined category names" "type:feature,area:vision,priority:high,phase:full-app" "$M6" <<'EOF'
Use CLIP's zero-shot classification to score a file against the user's own
category names (from M5's tree), not a fixed label list.

## Acceptance Criteria
- Category names from the tree are used directly as the zero-shot label set, no separate label-mapping config to keep in sync.
- Returns a confidence score per candidate category, not just a top pick.
- Confidence threshold for "auto-file vs send to review" is a named, tunable value, not buried inline.
EOF

create_issue "Dedicated NSFW classifier for the SFW/NSFW split" "type:feature,area:vision,priority:high,phase:full-app" "$M6" <<'EOF'
Add a dedicated open-weights NSFW/SFW classifier as a separate pass from
the category-name zero-shot classification — CLIP zero-shot is weak on
this specific axis, so it should not be assumed to cover it.

## Acceptance Criteria
- Evaluates at least one existing open NSFW classifier against a labeled sample set before picking one — the choice is measured, not assumed.
- Runs as its own inference pass alongside (not instead of) category classification.
- NSFW result gates auto-filing into any category exposed to unauthenticated preview links, independent of the category confidence score.
EOF

create_issue "Recursive descent into leaf subcategories" "type:feature,area:vision,priority:medium,phase:full-app" "$M6" <<'EOF'
When a file matches a parent category, descend into its subcategories to
find the most specific matching leaf, instead of stopping at the first
match.

## Acceptance Criteria
- Given a tree like Photos > Pets > Cats, a cat photo files under Cats, not just Photos.
- Descent stops and files at the current level if no child scores above the confidence threshold.
- Descent depth/behavior is covered by a test with at least three tree levels.
EOF

create_issue "Scheduler running 10-30 times a day scaled by unsorted volume" "type:feature,area:jobs,priority:high,phase:full-app" "$M6" <<'EOF'
Implement the volume-driven bulk-sort scheduler designed in M2, triggering
classification runs against the unsorted backlog roughly 10-30 times a day
depending on queue size.

## Acceptance Criteria
- Run frequency scales with measured unsorted-file volume per M2's design doc, not a fixed interval.
- A single run processes the backlog without re-processing files already classified in a prior run.
- Scheduler has one owner (one process runs it) — no risk of two instances double-triggering the same backlog.
EOF

create_issue "Human-review queue for low-confidence results" "type:feature,area:frontend,priority:medium,phase:full-app" "$M6" <<'EOF'
A queue UI for files the classifier scored below the auto-file confidence
threshold, letting the user confirm or correct the category by hand.

## Acceptance Criteria
- Files below threshold land in the queue instead of being auto-filed.
- User can accept the suggestion, pick a different category, or leave it unsorted.
- A resolved queue item does not reappear in a later scheduler run.
EOF

# ============================================================
# M7 - Infrastructure, DNS & Observability (Task 9) — phase:full-app
# ============================================================
M7="M7 - Infrastructure, DNS & Observability"

create_issue "Docker Compose and deploy runbook for the Contabo VPS" "type:docs,area:infra,priority:high,phase:full-app" "$M7" <<'EOF'
Write the production deploy runbook for the existing Contabo VPS, covering
how docker-compose.yml is run there and how config/secrets get onto the
box.

## Acceptance Criteria
- Runbook lives under organizational/deploy/ and covers first deploy plus routine redeploys.
- SECURITY NOTE: organizational/deploy/ will contain the VPS's IP and SSH
  details. gitleaks does not catch IPs, hostnames or SSH config — those
  need a human sweep before this runbook is committed, the same gap Task 4
  found for coordinates/addresses/SSIDs.
- States explicitly how JWT_SECRET and OAuth client secrets are supplied on the VPS (env file outside git, not committed).
EOF

create_issue "Set up the GoDaddy DNS record pointing burrow.woofi-developments.at at the VPS" "type:chore,area:infra,priority:high,phase:full-app" "$M7" <<'EOF'
Provision the DNS record at GoDaddy (registrar for woofi-developments.at)
so burrow.woofi-developments.at resolves to the Contabo VPS burrow will be
deployed on.

## Acceptance Criteria
- An A (or AAAA/CNAME, whichever matches the VPS's existing DNS pattern) record for burrow.woofi-developments.at exists at GoDaddy and resolves to the VPS.
- Matches the existing DNS pattern already used for other subdomains on this VPS (same TTL conventions, same record type where applicable).
- Verified with a real DNS lookup (e.g. dig) after propagation, not just "saved in the GoDaddy panel."
EOF

create_issue "Caddy reverse-proxy vhost for burrow" "type:feature,area:infra,priority:high,phase:full-app" "$M7" <<'EOF'
Add a Caddy vhost routing burrow.woofi-developments.at to the burrow
containers, alongside the VPS's existing Caddy-fronted services.

## Acceptance Criteria
- TLS is handled by Caddy's automatic HTTPS, no manual certificate management.
- Vhost proxies to the api container's exposed port from docker-compose.yml.
- Caddy's access log for this vhost is what M7's metrion-onboarding issue depends on for per-hostname request counts — verify it's actually being written.
EOF

create_issue "Onboard burrow into metrion for CPU, RAM, request-count and storage metrics" "type:feature,area:infra,priority:medium,phase:full-app" "$M7" <<'EOF'
Add burrow as a monitored target in the user's existing metrion tool
rather than installing a second monitoring stack.

metrion already collects box-level CPU/RAM/disk/network metrics on this
VPS and derives per-hostname request counts from Caddy's access log — so
once burrow sits behind the same Caddy instance (see the vhost issue
above), request-count metrics come for free. The only genuinely new work
is a blob-directory storage-usage metric for burrow's content-addressed
store. metrion/docs/adr/0002-one-metrics-source.md exists specifically to
forbid adding a second collector (no Netdata/Prometheus/Grafana here).

## Acceptance Criteria
- burrow's host/containers appear in metrion's existing CPU/RAM/disk/network views with no new collector installed.
- Confirm per-hostname request counts for burrow.woofi-developments.at show up, sourced from the same Caddy access log metrion already reads.
- New work is limited to a blob-store storage-usage metric (bytes used under the content-addressed directory); everything else reuses metrion as-is.
EOF

create_issue "Nightly restic/rsync backup timer for the blob store" "type:feature,area:infra,priority:high,phase:full-app" "$M7" <<'EOF'
A systemd timer (matching this account's existing hypr-backup pattern) that
backs up burrow's blob store nightly, complementing M3's backup/restore
runbook.

## Acceptance Criteria
- Timer runs nightly without manual intervention and logs success/failure.
- Backup target is off-box (not just another directory on the same VPS).
- A restore from the nightly backup has been tested at least once, not just the backup path.
EOF

# ============================================================
# M8 - Hardening & Release (Task 9) — phase:full-app
# ============================================================
M8="M8 - Hardening & Release"

create_issue "gitleaks, Trivy and CodeQL workflows" "type:security,area:infra,priority:high,phase:full-app" "$M8" <<'EOF'
Add scheduled/PR-triggered security scanning beyond Task 10's basic
secret-scan job: Trivy for dependency/image vulnerabilities and CodeQL for
static analysis, alongside the existing gitleaks workflow.

## Acceptance Criteria
- Trivy scans both the dependency tree and the built container images.
- CodeQL is configured for the languages actually in the repo (TypeScript, Python).
- Findings above a defined severity fail the workflow rather than being silently logged.
EOF

create_issue "Rate limiting and upload-size caps" "type:security,area:api,priority:high,phase:full-app" "$M8" <<'EOF'
Add request rate limiting and enforce a maximum upload size at the API
boundary, closing the gaps M4's login endpoint and M5's upload endpoint
left open.

## Acceptance Criteria
- Rate limiting applies per-account (or per-IP where unauthenticated) with a documented threshold.
- Upload size cap is enforced server-side, not just in the frontend form.
- Both return a clear, machine-readable error (not a raw 500) when triggered.
EOF

create_issue "Complete the legal document TODOs" "type:legal,area:organizational,priority:high,phase:full-app" "$M8" <<'EOF'
Fill in the TODOs left in PRIVACY.md, IMPRESSUM.md and TERMS_OF_USE.md from
Task 3's legal scaffolding, now that the real auth providers (M4) and data
model (M3) are known.

## Acceptance Criteria
- No remaining TODO/placeholder markers in any of the three documents.
- Privacy policy accurately reflects what's actually collected (accounts, files, embeddings) — not boilerplate that doesn't match the app.
- Reviewed against WEB_APP_COMPLIANCE_CHECKLIST.md from Task 3 before being considered done.
EOF

create_issue "End-to-end smoke suite" "type:test,area:infra,priority:medium,phase:full-app" "$M8" <<'EOF'
A small e2e suite covering the critical path — login, upload, browse,
classify, file, search — run against a real docker-compose stack in CI.

## Acceptance Criteria
- Covers login through at least one full-app auth method (not just the prototype's hard-coded one).
- Exercises upload -> classification -> filing -> search as one flow, not isolated unit tests.
- Runs in CI against docker-compose.yml, not a hand-mocked backend.
EOF

create_issue "v0.1.0 release checklist" "type:chore,area:organizational,priority:medium,phase:full-app" "$M8" <<'EOF'
Write and work through the checklist for cutting burrow's first tagged
release, tying together everything M1-M8 delivered.

## Acceptance Criteria
- Checklist lives in the repo (e.g. alongside CHANGELOG.md) and is followed for the actual v0.1.0 tag, not written after the fact.
- Confirms branch protection, CI, backups and the deploy runbook are all in place before tagging.
- CHANGELOG.md's Unreleased section is rolled into a v0.1.0 entry as part of the checklist.
EOF

echo "Epics, M1 and M2-M8 seeded."
