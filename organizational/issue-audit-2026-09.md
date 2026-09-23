# Issue audit — 2026-09-23

Every one of the 61 issues in `Wolfi-OwO/burrow` read against what's now
established about the target VPS (4 vCPU EPYC / 7.8GiB RAM / zero swap,
`~82G` disk free, the per-container-only metrics collector, Caddy at
`/opt/portfolio/Caddyfile`, B2 EU-Central canonical storage with a ~50GB
local cache, restic 0.16.4 with a working `b2` backend and a broken `azure`
backend on this box).

Verdict legend: `accurate` — no false premise, not touched. `corrected` —
had a false premise, live body and `scripts/seed-github-issues.sh` both
updated in this pass. `already-corrected` — one of the 9 issues fixed in
commit `5bb7332`, re-verified here and still accurate.

| Issue | Verdict | Note |
| --- | --- | --- |
| #1 | accurate | Epic tracker, no VPS-specific claims. |
| #2 | accurate | Epic tracker, no VPS-specific claims. |
| #3 | corrected | Epic body said "the 100GB backup/restore runbook" — a leftover false premise from before the B2/~50GB-cache decision (issue #33, corrected in `5bb7332`, no longer matches). Reworded to "the backup/restore runbook for Postgres and the B2 blob tier", matching #33's actual title/scope. Missed by the earlier pass since only #33 itself, not the epic referencing it, was touched. |
| #4 | accurate | Epic tracker, no VPS-specific claims. |
| #5 | accurate | Epic tracker, no VPS-specific claims. |
| #6 | accurate | Epic tracker, no VPS-specific claims. |
| #7 | accurate | Epic tracker; describes the M7 issues (Contabo VPS runbook, DNS, Caddy, metrion, backup timer) without asserting any capability or number — no false premise to correct. |
| #8 | accurate | Epic tracker, no VPS-specific claims. |
| #9 | accurate | M1 prototype, disk-write only, no VPS claims. |
| #10 | accurate | M1 prototype, hard-coded JSON tree, no VPS claims. |
| #11 | accurate | M1 prototype UI, no VPS claims. |
| #12 | accurate | M1 prototype auth, no VPS claims. |
| #13 | accurate | M1 prototype thumbnails, no VPS claims. |
| #14 | accurate | M1 prototype CLIP script, no VPS claims. |
| #15 | accurate | M1 prototype button, no VPS claims. |
| #16 | accurate | M1 prototype move, no VPS claims. |
| #17 | accurate | M1 prototype delete, no VPS claims. |
| #18 | accurate | M1 prototype index, no VPS claims. |
| #19 | accurate | M1 prototype frontend, no VPS claims. |
| #20 | accurate | M1 README, no VPS claims. |
| #21 | accurate | Functional-requirements doc, no VPS claims. |
| #22 | accurate | ADR-0001 API/vision split, no VPS claims. |
| #23 | already-corrected | ADR-0002 storage layout, corrected in `5bb7332`. Re-verified: `~50GB` local-cache ceiling, B2 EU-Central as durable tier, "shared with five other stacks" all still match. `df -h /` figure quoted in the body (96G filesystem / 20G used / 77G avail) is a point-in-time measurement close to but not identical to the now-established `~82G` figure — normal disk-usage drift, doesn't change the ~50GB cache decision the ADR is actually about. Not re-edited: chasing a df number that will be stale again tomorrow is exactly the cosmetic-edit this task says not to do; the substantive decision is unaffected. |
| #24 | accurate | ADR-0003 category-tree model, no VPS claims. |
| #25 | already-corrected | ADR-0004 vision model choice, corrected in `5bb7332`. Re-verified: "4 vCPU (AMD EPYC), load average 0.26-0.82 observed idle, 7.8GiB RAM and zero swap" matches established facts; explicitly states no benchmark has been run yet. Still accurate. |
| #26 | accurate | Scheduling design doc, no VPS claims. |
| #27 | accurate | Activity diagrams, no VPS claims. |
| #28 | accurate | Postgres schema/migrations, no VPS claims. |
| #29 | accurate | ltree implementation, no VPS claims. |
| #30 | already-corrected | Content-addressed blob store, corrected in `5bb7332`. Re-verified: B2 EU-Central durable tier, "~50GB ceiling — the VPS disk is shared with five other stacks" matches ADR-0002. Still accurate. |
| #31 | accurate | tsvector/GIN search, no VPS claims. |
| #32 | accurate | pgvector column, HNSW deferred, no VPS claims. |
| #33 | already-corrected | Backup/restore runbook, corrected in `5bb7332`. Re-verified: "~50GB local cache size, not a full disk's worth" and B2-restore framing match ADR-0002/#30. Still accurate. |
| #34 | accurate | Argon2id auth, no VPS claims. |
| #35 | accurate | Session/token design, no VPS claims. |
| #36 | accurate | GitHub OIDC, no VPS claims. |
| #37 | accurate | Microsoft OIDC, no VPS claims. |
| #38 | accurate | Google OIDC, no VPS claims. |
| #39 | accurate | Account linking, no VPS claims. |
| #40 | accurate | Category tree CRUD, no VPS claims. |
| #41 | accurate | Move/rename subtree integrity, no VPS claims. |
| #42 | accurate | Dedup-on-ingest, no VPS claims. |
| #43 | accurate | User profile, no VPS claims. |
| #44 | accurate | Search UI, no VPS claims. |
| #45 | already-corrected | apps/vision FastAPI/ONNX skeleton, corrected in `5bb7332`. Re-verified: "host has 7.8GiB RAM and zero swap (confirmed live: `swapon --show` empty), and existing containers' `mem_limit`s already sum to ~6.1GiB" matches established facts. Still accurate. |
| #46 | already-corrected | OpenCLIP embed endpoint, corrected in `5bb7332`. Confirmed accurate as-is per task brief: "No benchmark has been run yet (see ADR-0004)" is already stated; host specs (4 vCPU AMD EPYC, 7.8GiB RAM, zero swap) match. Not re-edited. |
| #47 | accurate | Zero-shot classification, no VPS claims. |
| #48 | accurate | NSFW classifier, no VPS claims. |
| #49 | accurate | Recursive descent, no VPS claims. |
| #50 | accurate | Volume-driven scheduler, no VPS claims. |
| #51 | accurate | Human-review queue, no VPS claims. |
| #52 | accurate | Deploy runbook; SECURITY NOTE about gitleaks not catching IPs/SSH details matches established gap. No false premise. |
| #53 | accurate | GoDaddy DNS record, no VPS claims beyond "the Contabo VPS", which is correct. |
| #54 | already-corrected | Caddy vhost, corrected in `5bb7332`. Re-verified: `/opt/portfolio/Caddyfile`, reload via `/opt/caddy-reload.sh`, "no request-count collector reads it today (confirmed live: the metrics collector only emits `container.cpu`/`container.memory.*`)" all match established facts. Still accurate. |
| #55 | already-corrected | metrion onboarding, corrected in `5bb7332`. Re-verified: collector emits exactly `container.cpu`/`container.memory.used`/`container.memory.limit`, no box-level disk/network, no per-hostname request counts, dead legacy collector correctly described as dead. Still accurate. |
| #56 | already-corrected | Nightly restic backup timer, corrected in `5bb7332`. Re-verified: "restic with the `b2` backend, not `azure`... Azure backend is excluded from this Ubuntu package build" matches established facts (restic 0.16.4, working b2, broken azure). No `hypr-backup` reference. Still accurate. |
| #57 | accurate | gitleaks/Trivy/CodeQL workflows, no VPS claims. |
| #58 | accurate | Rate limiting/upload caps, no VPS claims. |
| #59 | accurate | Legal document TODOs, no VPS claims. |
| #60 | accurate | E2E smoke suite, no VPS claims. |
| #61 | accurate | v0.1.0 release checklist, no VPS claims. |
