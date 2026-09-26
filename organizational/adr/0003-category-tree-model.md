# ADR-0003: Category-tree model — ltree vs adjacency list

## Status

Accepted

## Context

The category tree (`Furry/SFW/WOLF`, `Furry/NSFW`, `Nature`, ...) is
user-editable at arbitrary depth and is the thing four separate pieces
of work depend on getting right:

- **#29** — implement the tree as a Postgres column with the queries
  below, plus a GiST index for descendant lookups.
- **#40** — CRUD on category nodes at any depth, including deleting a
  non-empty node.
- **#41** — moving/renaming a node such that its entire subtree (and the
  files filed under it) stays correctly attached, atomically.
- **#49** — recursive descent from a matched parent category down to the
  most specific matching leaf during classification.

Two models were compared, on exactly the four operations that matter
here — not on general merits:

| Operation | ltree | Adjacency list (`parent_id` self-reference) |
| --- | --- | --- |
| Move a subtree atomically (#41) | One `UPDATE` rewriting the `path` prefix on every descendant row, in one statement, in one transaction. | Either a recursive CTE walk to relabel every descendant row, or an unindexed recursive read at every query time — moving is not a single-row update either way, because there is no materialized path to rewrite in bulk. |
| Recursive descent to the deepest matching leaf (#49) | `path ~ 'parent.*'` or a GiST-indexed prefix range scan finds every descendant of a node in one query; descent is a sequence of narrowing queries over the same indexed column. | A recursive CTE (`WITH RECURSIVE`) per descent step, or *N* round trips walking one level at a time. Correct, but every level is a separate query unless the whole subtree is pulled up front. |
| "All descendants of X" / "direct children of X" (#29) | `path <@ 'x'` (descendants) and `path ~ 'x.*{1}'` (direct children) are both indexed range/prefix operations, backed by a GiST index — #29's own acceptance criteria requires verifying this with `EXPLAIN`. | "All descendants" needs a recursive CTE (no native index support beyond indexing `parent_id` itself, which only speeds up one level at a time). "Direct children" is a single indexed equality lookup on `parent_id` — the one operation adjacency list wins outright. |
| Depth-unbounded CRUD (#40) | Insert/rename at any depth is a single-row write; the `path` value must be computed (append a label to the parent's path) but that computation is cheap and local. | Insert/rename at any depth is also a single-row write — adjacency list has no depth penalty for CRUD itself. |

## Decision

**Use Postgres `ltree` for the category tree**, matching the presumption
already in `README.md`, `docker-compose.yml`'s comment, and issue #29 —
this ADR confirms that presumption with a real comparison rather than
leaving it unexamined, and it holds up: three of the four operations that
matter here (#41, #49, #29's descendant/children queries) are native,
indexed `ltree` operations, while the equivalent adjacency-list queries
need either a recursive CTE or a multi-step application-level walk. Only
the "direct children" half of #29 is a clean win for adjacency list, and
`ltree`'s `~ 'x.*{1}'` still answers it in one indexed query, just not as
directly as a plain `parent_id = x` lookup would.

**The real cost of `ltree`, named concretely.** `ltree` labels are
restricted to the character class `[A-Za-z0-9_]` — no spaces, no
slashes, no umlauts, no emoji. User-entered category names will contain
all of those. This is not a minor formatting detail; it is the actual
price of this decision and it must be paid with an explicit
escaping-or-surrogate-key scheme, not discovered as a bug later.

**Recommended default: a surrogate label, not an escaped one.** Each
category row stores:

- `id` — a surrogate key (an integer or a generated slug), used as the
  `ltree` label at that position in `path`.
- `name` — the real, user-entered display name (`"Furry/SFW"`,
  `"Café Photos"`, `"🐺 Wolf stuff"`), stored as plain `text`, never
  encoded into the path.
- `path ltree` — built from ancestors' surrogate `id`s, e.g. `1.4.17`,
  never from `name`.

This avoids inventing an escaping scheme for arbitrary Unicode into a
restricted label alphabet (round-tripping emoji or umlauts through
`[A-Za-z0-9_]` is exactly the kind of bespoke-encoding problem worth
refusing to own). Every query that needs a human-readable path joins
`path`'s surrogate segments back to `name` through the category table;
every query that needs tree structure (`<@`, `~`, depth, move) operates
on `path` directly and never touches `name`.

**A GiST index on `path` is required**, not optional, for the
descendant/children queries in #29 to be fast rather than a sequential
scan — #29's own acceptance criteria already requires verifying this
with `EXPLAIN`, and this ADR states it as a hard requirement of the
`ltree` choice, not a nice-to-have tuning step.

## Consequences

- #41 (atomic subtree move) becomes a single `UPDATE ... SET path =
  new_parent_path || subpath(path, nlevel(old_parent_path))` inside one
  transaction — no recursive walk, no risk of a partial move leaving the
  tree half-relabeled.
- #49 (recursive descent to the deepest matching leaf) is a sequence of
  indexed `path <@` queries narrowing one level at a time, not *N*
  separate recursive-CTE round trips.
- #29's "direct children" query is one indexed `~ 'x.*{1}'` lookup
  instead of the flat `parent_id = x` equality an adjacency list would
  give for free — accepted, since the other three operations outweigh
  this one case.
- Every category-tree write path (#40's CRUD, #41's move) must build
  `path` from surrogate `id`s, never from `name` — a future contributor
  reaching for `name` directly when constructing a path is the most
  likely way this decision gets silently violated. Category migrations
  and seed data must follow the same rule.
- The `ltree` extension and a GiST index on `path` must both be present
  in #29's migration; a migration that adds the column without the index
  satisfies none of #29's stated acceptance criteria.
- No follow-up correction to #29's title or `README.md`'s stack table is
  needed — both already presumed `ltree`, and that presumption is the
  conclusion this ADR reaches independently.
