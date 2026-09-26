# ADR-0001: Split the vision classifier from the main API server

## Status

Accepted

## Context

burrow needs to run an AI-classification model against uploaded files to
sort them into the user-defined category tree. Two options were
considered:

1. Run classification inside the main API server (`apps/api`).
2. Run classification as a standalone service (`apps/vision`).

**Language mismatch.** `apps/api` is Node.js/TypeScript/Express. The
vision stack is Python/FastAPI/ONNX Runtime — there is no shared runtime
to embed one inside the other without either running Python inside the
Node process (not possible) or shelling out per request (not a real
architecture). Keeping them as two services matches the tool each job
actually needs, rather than forcing one language to do both.

**Blast-radius isolation.** The inference stack (ONNX Runtime, model
weights, whatever image-decoding libraries it pulls in) is a large,
fast-moving dependency surface with no inherent need to touch the primary
datastore, session state, or user credentials. Keeping it out of
`apps/api`'s process means a vulnerability or a bad dependency there has
no path to the database or to a user's session.

**The constraint specific to this app.** Beyond the two general
arguments above, burrow has one that forces the outcome rather than
merely favoring it: burrow exists partly to sort NSFW content into its
own branch of the category tree, and every mainstream cloud vision API's
terms of service forbid classifying that kind of content. There is no
cloud vision API on the table here at all — self-hosting the model is
not the preferred option among several, it is the only one available.
`apps/vision` exists because there is nowhere else to run this.

## Decision

Run classification as a standalone Python/FastAPI service
(`apps/vision`), running models via ONNX Runtime, with:

- **No database of its own**, no persistence of uploaded files or
  predictions. It holds nothing at rest.
- **No route reachable from the public internet** — only `apps/api` can
  call it, over an internal network segment.
- **A narrow contract**, matching the isolation goal above:
  - Synchronous HTTP request from `apps/api` to `apps/vision`.
  - Input: a file (the image content), sent once per request.
  - Output: a structured prediction — category confidence scores and,
    separately, the NSFW/SFW classification (see ADR-0004 on why that is
    a second, dedicated pass rather than folded into the same score).
  - `apps/vision` never queries `apps/api`'s database, and `apps/api`
    never hands `apps/vision` a database credential.
  - A stated timeout on the `apps/api` side of the call, so a stalled or
    overloaded vision service degrades to "leave the file unsorted /
    route to human review" rather than blocking the caller indefinitely.

## Consequences

- A vulnerability or compromised dependency in the inference stack
  cannot reach user data directly — it has no database credentials and
  nothing worth exfiltrating, since it persists nothing.
- Self-hosting is mandatory, not a cost/convenience trade-off — there is
  no fallback to "just use a cloud API" if the self-hosted model
  underperforms; see ADR-0004 for the model choice this forces.
- Deployment and scaling are independent: `apps/vision` can be scaled by
  inference load without scaling `apps/api`, and vice versa.
- Adds one network hop and one more service to operate (health checks,
  a timeout, and a defined fallback when that timeout fires) — accepted
  as a deliberate cost, matching the shape of nutrilens's own
  API/AI-server split.
- Local development requires running two services instead of one —
  mitigated with a single `docker compose up` covering both, per the
  repository's Docker Compose skeleton.
