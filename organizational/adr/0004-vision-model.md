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

**Measured 2026-10-24 (`apps/vision/scripts/benchmark.py`).** One developer machine
with the process pinned to 4 cores (`taskset -c 0-3`) as an approximation of the
4 vCPU host — a stand-in, not the VPS itself, so the numbers below are an upper
bound on what to expect there until the benchmark is rerun on the real host.
Input: a 12 MP (4000x3000) JPEG, 30 runs after one warm-up, ONNX Runtime CPU, fp32.

| Step | p50 | p95 |
| - | - | - |
| Decode the 12 MP JPEG | 72 ms | 74 ms |
| OpenCLIP ViT-B/32 image embedding | 82 ms | 85 ms |
| Text embeddings for 8 new labels (cached afterwards) | 138 ms | 214 ms |
| Zero-shot scoring with cached labels | under 1 ms | under 1 ms |
| NSFW classifier | 94 ms | 128 ms |
| **One file, whole pipeline** | **334 ms** | **374 ms** |

That is about 3 files per second per core group, so a 500-file backlog clears in
roughly three minutes of inference — the scheduler's batch size (`SCHEDULER_BATCH_SIZE`,
default 100) is therefore a ~35 second run, comfortably inside one request timeout budget
per file and far below the 10 to 30 runs a day of #50.

**Memory: 1,072 MB peak RSS with both models loaded** (CLIP visual 352 MB, text 254 MB and
NSFW 23 MB of weights, plus the runtime). That is slightly above the "~1 GiB" this ADR
planned, so `mem_limit` is set to 1280 MB, which still leaves about 0.4 GiB of the ~1.7 GiB
that remains on the host. Shrinking the models was tried and rejected, by measurement:
dynamic int8 quantisation of the text tower (per-tensor and per-channel) drops the cosine
similarity of label embeddings to the fp32 original to ~0.78 (an unusable zero-shot
classifier), and fp16 weights crash ONNX Runtime's CPU provider. fp32 stays.

**The NSFW classifier (#48) is `Marqo/nsfw-image-detection-384`** (Apache-2.0, a tiny ViT,
23 MB exported): small enough to share the budget, and run as its own pass beside CLIP
(FR-036). It is a binary NSFW/SFW detector with no SFW sub-labels, which is all the gate
in FR-037 needs. Evaluating it against a labelled sample of the user's own content remains
open: no such set is in the repository, and one must not be committed.

## Consequences

- The latency figures above come from a 4-core stand-in; batch sizing and run
  frequency (#50) should be revisited once the benchmark has been run on the real host.
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
