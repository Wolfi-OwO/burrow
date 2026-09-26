# ADR-0004: Vision model choice

## Status

Accepted

## Context

burrow needs a vision model to classify uploaded files against the
user's own category tree, and separately, to gate NSFW content. Per
ADR-0001, this model must be self-hosted — every mainstream cloud vision
API's terms of service forbid classifying NSFW content, so a hosted API
is not an option on the table to weigh against self-hosting on
convenience; the cloud-ToS constraint is the deciding factor by itself,
not one factor among several that happened to also favor self-hosting.

**Measured, 2026-09-23**, the target VPS: 4 vCPU (AMD EPYC), load average
0.26–0.82 observed idle, 7.8GiB RAM, zero swap. Existing containers on
this box already commit ~6.1GiB of that 7.8GiB with zero swap, which
means the vision container's real budget is **~1GiB total for
everything it runs**, not 1GiB per model.

## Decision

**OpenCLIP ViT-B/32, self-hosted, open weights**, served through
`apps/vision`'s FastAPI/ONNX Runtime service (ADR-0001).

- **Weights**: OpenCLIP's published open-weight checkpoints for
  ViT-B/32 (the standard open-source CLIP reimplementation, not a
  proprietary or closed checkpoint) — the specific checkpoint file and
  its provenance are pinned at implementation time in #45/#46, not
  fixed here.
- **CPU inference**, on the measured host specs above (4 vCPU AMD EPYC,
  load average 0.26–0.82 idle, 7.8GiB RAM, zero swap) — a model this
  size on CPU is what this hardware supports; GPU inference was never on
  the table because the target VPS has no GPU.
- **CLIP zero-shot alone is not sufficient for the SFW/NSFW axis.**
  General-purpose CLIP zero-shot is weak specifically on that
  classification, so it is not used for it. NSFW/SFW gating needs its
  own dedicated classifier, evaluated separately against a labeled
  sample set — that evaluation and choice is issue #48's job, not this
  ADR's.
- **Memory budget: ~1GiB total, for ViT-B/32 and the NSFW model
  together**, not ~1GiB each. This is what remains of the 7.8GiB host
  after ~6.1GiB already committed by other containers, with zero swap to
  fall back on. `apps/vision`'s `mem_limit` in `docker-compose.yml` (#45,
  #46) must be sized against that shared ~1GiB, and running both models
  concurrently within it is a real constraint on model selection for
  #48, not a detail to defer.

**No benchmark has been run yet.** This ADR records the reasoning and
the measured host specs it rests on — it does not record a measured
inference time, and no latency or throughput figure quoted anywhere in
this repository today should be read as a measurement. Issue #46's
first implementation task is to actually time a real inference of
ViT-B/32 on this hardware and amend this ADR with the real number once
it exists. Inventing an estimate here, or anywhere else in this repo, to
fill that gap would wrongly seed the scheduling math in #46 and #50 with
a number nobody measured.

## Consequences

- Every downstream latency-dependent decision (batch sizing in #46, run
  frequency in #50) is provisional until the benchmark in #46 lands —
  this ADR should be revisited with the real number once it exists,
  rather than treated as settled on the estimate-free reasoning alone.
- `apps/vision`'s `docker-compose.yml` `mem_limit` (~1GiB, per #45/#46)
  is a hard ceiling for both models combined; a straightforward
  "one model, one container, one `mem_limit`" mental model does not
  apply here and must not be assumed when #48 picks an NSFW classifier.
- Self-hosting forecloses ever falling back to a cloud vision API for
  this workload, even temporarily — the ToS constraint from ADR-0001
  does not relax for a subset of content, so there is no partial-cloud
  fallback path to design for.
- CPU-only inference means model choice for #48 (the NSFW classifier)
  must weigh CPU cost as heavily as accuracy, inside the shared ~1GiB
  budget — a large, accurate model that does not fit the memory ceiling
  is not a real option regardless of its benchmark scores elsewhere.
