# Functional Requirements

IDs are referenced from issues as `FR-xxx` so backlog items trace back to a
concrete requirement, matching nutrilens's own requirements doc
convention. Every entry is testable — a reviewer can answer yes/no
whether it's met.

## Open question this document does not resolve

`README.md` frames burrow as "personal, single-tenant software — I am the
only user". Issue #39 (account linking across GitHub/Microsoft/Google/
credentials) and #43 (a profile with avatar, display name, bio, separate
from login identity) both presume a real multi-provider, multi-account
`users` table — more machinery than one hard-coded account needs. That
tension is real and unresolved in this repo's own docs; this document
does not silently pick a side.

**The FRs below are written against the single-tenant-with-a-`users`-table
default**: one real account exists and is used in v1, but the schema and
the auth FRs (FR-001–FR-009 especially) do not foreclose more accounts
existing later. Every auth FR is **provisional on this open question** —
if burrow is ever confirmed as staying single-account forever, FR-006
through FR-009 (multi-provider linking) become YAGNI and should be
dropped rather than built speculatively.

## Auth (FR-001–FR-009)

- **FR-001** A user can log in with a username and password, hashed with
  Argon2id using vetted parameters, not defaults copied without review.
  [#34]
- **FR-002** The login endpoint rate-limits repeated failed attempts
  against the same account/source. [#34]
- **FR-003** No password, hashed or plaintext, is ever written to logs.
  [#34]
- **FR-004** An authenticated session is represented by a short-lived
  access token plus a refresh mechanism, verified by one shared
  middleware shared across every route (not duplicated per-route). [#35]
- **FR-005** A user can log out, revoking the active session/token
  rather than only letting it expire. [#35]
- **FR-006** *(provisional, see above)* A user can log in via GitHub
  OAuth; a first-time login creates an account, a repeat login with a
  verified-matching email links to the existing one. [#36]
- **FR-007** *(provisional)* A user can log in via Microsoft OAuth,
  sharing the same account-creation/linking logic as FR-006 rather than a
  parallel implementation. [#37]
- **FR-008** *(provisional)* A user can log in via Google OAuth, sharing
  the same account-creation/linking logic as FR-006 and FR-007. [#38]
- **FR-009** *(provisional)* A user can view and remove a linked login
  provider from their profile, provided at least one login method
  remains; linking a second provider is rejected if its email isn't
  verified. [#39]

## Drive & category tree (FR-010–FR-022)

- **FR-010** A user can create a category node at any depth in the tree,
  not only at the top level. [#40]
- **FR-011** A user can rename a category node at any depth. [#40]
- **FR-012** Deleting a non-empty category node requires the user to
  choose what happens to its contents — move them up, or block the
  delete — rather than deleting silently. [#40]
- **FR-013** The tree UI renders directly from the ltree-backed
  structure (ADR-0003); it never reconstructs a tree client-side from a
  flat list. [#40]
- **FR-014** Moving or renaming a category node relocates its entire
  subtree — descendants and the files filed under them — in one atomic
  operation; a failure partway through leaves the tree in its original
  state. [#41]
- **FR-015** After a subtree move, files filed under any descendant of
  the moved node resolve to their new path immediately. [#41]
- **FR-016** Uploading file content byte-identical to an existing file
  (even under a different filename) creates exactly one blob and a new
  file-metadata row; the upload response states whether the content was
  new or a dedup hit. [#42]
- **FR-017** An upload exceeding the configured size cap is rejected
  before any bytes are stored. [#42]
- **FR-018** A user can set an avatar image (stored through the same
  blob store as regular files, no second storage path), a display name,
  and a short bio, editable independently of their login identity.
  [#43]
- **FR-019** A user's profile is readable without exposing that user's
  linked-provider emails from FR-006–FR-009. [#43]
- **FR-020** Full-text search returns results ranked by relevance
  (`ts_rank`), not insertion order. [#44]
- **FR-021** Each search result links to, or highlights, its position in
  the category tree. [#44]
- **FR-022** An empty or no-match search state is shown explicitly, not
  rendered as a silently empty list. [#44]

## Vision & sorting (FR-030–FR-045)

- **FR-030** `apps/vision` exposes a health-check endpoint and fails
  startup loudly if a required model file is missing, rather than
  serving broken predictions. [#45]
- **FR-031** `apps/vision` persists no uploaded file content and no
  prediction after responding to a request. [#45]
- **FR-032** An embedding endpoint returns the 512-dim OpenCLIP ViT-B/32
  embedding for a given file, and the same input produces the same
  embedding across calls. [#46]
- **FR-033** A file is scored against the user's own category names,
  taken directly from the live tree, as the zero-shot label set — no
  separate label-mapping config to keep in sync. [#47]
- **FR-034** Classification returns a confidence score per candidate
  category, not only a top pick. [#47]
- **FR-035** The confidence threshold that decides auto-file vs.
  send-to-review is a named, tunable value, not buried inline in code.
  [#47]
- **FR-036** A dedicated NSFW/SFW classifier runs as its own inference
  pass, alongside (not instead of) category classification. [#48]
- **FR-037** The NSFW/SFW result gates whether a file may ever be
  auto-filed into a category exposed to an unauthenticated preview link,
  independent of the category-classification confidence score. This
  gate is a required safety property of the classification pipeline even
  though issuing unauthenticated preview links is itself out of scope
  for v1 (see below) — the gate must exist before that feature ever
  ships, not be retrofitted once it does. [#48]
- **FR-038** When a file matches a parent category, classification
  descends into its subcategories and files at the most specific
  matching leaf, instead of stopping at the first match. [#49]
- **FR-039** Descent stops and files at the current level when no child
  category scores above the confidence threshold. [#49]
- **FR-040** A scheduled job runs classification against the unsorted
  backlog at a frequency that scales with measured backlog volume,
  rather than a fixed interval. [#50]
- **FR-041** A single scheduler run does not reprocess a file already
  classified in a prior run. [#50]
- **FR-042** Exactly one scheduler process runs at a time — no risk of
  two instances double-triggering the same backlog. [#50]
- **FR-043** A file scoring below the auto-file confidence threshold
  lands in a human-review queue instead of being auto-filed. [#51]
- **FR-044** From the review queue, a user can accept the suggested
  category, pick a different one, or leave the file unsorted. [#51]
- **FR-045** A resolved review-queue item does not reappear in a later
  scheduler run. [#51]

## Out of scope for v1

- **Multi-tenant sharing/collaboration** — no shared drives, no
  per-file access grants between accounts, no team/workspace concept.
  Any future account beyond the one described in FR-006–FR-009's open
  question is still a single owner of their own tree, not a
  collaborator on someone else's.
- **Semantic/vector search** — #32 adds a `vector(512)` column to hold
  the CLIP embedding per file, but that issue's own body explicitly
  defers HNSW (or any ANN) indexing and real nearest-neighbor search
  until there is enough data for it to matter. A plain sequential scan
  is acceptable at this stage; v1 search is FR-020's `tsvector`/GIN
  full-text search only.
- **Public/unauthenticated preview links** — every file access in v1
  goes through an authenticated, ownership-checked pre-signed URL (see
  `organizational/deploy/b2-credential-security.md`). No file is ever
  reachable by an unauthenticated request in v1, which is why FR-037's
  NSFW gate is written as a required property of the pipeline now,
  ahead of a feature that does not yet exist, rather than added
  reactively when it does.
