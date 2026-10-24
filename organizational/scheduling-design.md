# Bulk-sort scheduling design

How burrow decides when to sort, how much, and how it keeps two runs from colliding. Implements FR-040 to FR-042;
the code is `apps/api/src/services/scheduler-service.ts`.

## The unit of work

A file waits in the **backlog** while `classified_at IS NULL` and its status is `unsorted`. A run takes the oldest
`SCHEDULER_BATCH_SIZE` (default 100) files and, for each one, calls `apps/vision` for an embedding and an NSFW score,
then walks the category tree from the top (see the activity diagram). Whatever the outcome (filed, sent to review,
or left unsorted) the file gets `classified_at`, so no later run looks at it again (FR-041). A file whose vision
call failed keeps `classified_at` empty and is retried by the next run.

## How often

The brief asks for 10 to 30 runs a day, scaled by how much is waiting (FR-040). The schedule is linear:

```text
runs_per_day(backlog) = round(10 + 20 * min(backlog / 500, 1))
interval              = 24 h / runs_per_day
```

| Backlog | Runs a day | Time between runs |
| - | - | - |
| 1 | 10 | 144 min |
| 250 | 20 | 72 min |
| 500 or more | 30 | 48 min |
| 0 | none | nothing to do |

An empty backlog never triggers a run. The bounds and the 500 are environment variables
(`SCHEDULER_MIN_RUNS_PER_DAY`, `SCHEDULER_MAX_RUNS_PER_DAY`, `SCHEDULER_BACKLOG_FOR_MAX`), not constants in the code.
A one-minute tick asks "is a run due?" by comparing the stored time of the last run with the interval; "Sort now"
on the Review page skips that check.

## Why these numbers hold up

From ADR-0004's measurement (4 cores, 12 MP photos): about 0.33 s per file, so a full batch of 100 is roughly
35 seconds, and the largest backlog the schedule is tuned for (500 files) clears in three minutes, well inside the
48-minute interval. The bound that matters is memory, not time: both models together peak near 1.07 GiB, which is
why there is exactly one vision worker and no parallel runs.

## One scheduler at a time (FR-042)

Each run happens inside a transaction that first takes `pg_try_advisory_xact_lock`. Whoever gets it runs; anyone
else returns immediately without waiting. The lock is released when the transaction ends, including when the process
dies, so a crashed run cannot block the next one the way a flag in a table could. `SCHEDULER_ENABLED=false` turns the
timer off on an instance that should never sort. A test starts two simultaneous runs against five files and checks
that exactly five are processed, once.

## What a run never does

- It never reprocesses a file it already decided, and a resolved review item never returns (FR-045).
- It never auto-files an NSFW file into a category marked `public_preview` (FR-037); that file goes to review.
- It never deletes or moves a file the user filed by hand: only files with `classified_at IS NULL` are candidates.

## Open

Per-user batching is not needed while there is one user. With several, the batch should take files round-robin by
owner so one large upload cannot starve the others.
