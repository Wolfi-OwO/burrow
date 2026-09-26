# Activity diagram: upload → classify → file

Covers a file's path from upload through classification to being filed
into the category tree, per issue #27. The `apps/api` ↔ `apps/vision`
call follows ADR-0001's contract exactly: synchronous HTTP, file in,
structured prediction out, no shared database access, a stated timeout.
FR IDs reference `organizational/requirements/functional-requirements.md`.

```mermaid
flowchart TD
    A[Client uploads file to apps/api] --> B[apps/api hashes content — FR-016]
    B --> C{Hash already exists\nin B2 / local cache?}

    C -- "yes: dedup hit" --> D["⚠ New file-metadata row only,\nno new blob write — FR-016.\nMost likely step to implement wrong:\nauthorize/act on the file row,\nnever the blob hash\n(see b2-credential-security.md)"]
    C -- "no: new content" --> E[Write blob to local cache\nand upload to B2 — ADR-0002]

    D --> F[File row created, state = unsorted]
    E --> F

    F --> G[Scheduler picks up unsorted backlog\nFR-040, FR-041, FR-042]
    G --> H[apps/api calls apps/vision\nsynchronous HTTP, file in — ADR-0001]

    H --> I{apps/vision responds\nwithin the stated timeout?}
    I -- "no: timeout" --> J[Leave file unsorted,\nretried on a later scheduler run\nADR-0001 fallback]

    I -- "yes" --> K[apps/vision returns:\nembedding FR-032,\ncategory scores FR-033/FR-034,\nNSFW/SFW result FR-036]
    K --> L{NSFW gate FR-037\nor confidence below\nthreshold FR-035?}

    L -- "yes: low confidence\nor NSFW-gated" --> M[Route to human-review queue\nFR-043]
    M --> N[User accepts, recategorizes,\nor leaves unsorted — FR-044]
    N --> O[Queue item resolved,\nnever reprocessed by scheduler\nFR-045]
    O --> P[File filed at chosen category]

    L -- "no: confident enough" --> Q[Recursive descent to the most\nspecific matching leaf\nFR-038, FR-039]
    Q --> P[File filed at chosen category]
```

## Notes

- The dedup fork (`C`/`D`) is the step most likely to be implemented
  wrong, matching `organizational/deploy/b2-credential-security.md`'s
  own warning: authorization and file operations must resolve through
  the **file-metadata row**, never accept a content hash directly from a
  caller. A dedup hit creates a new row pointing at an existing blob — it
  must never skip creating that row, and no code path may act on the
  hash alone.
- The timeout branch (`I`) exists because `apps/vision` holds no queue
  of its own and no retry state — per ADR-0001, `apps/api` owns the
  timeout and the fallback (leave unsorted, retried on a later scheduler
  run) rather than blocking indefinitely on a stalled call.
- The low-confidence branch (`L`/`M`/`N`/`O`) is the human-review queue
  from issue #51; a resolved queue item is marked so FR-045 holds and the
  scheduler never re-offers it.
