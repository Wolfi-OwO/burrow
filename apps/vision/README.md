# apps/vision

The isolated AI-classification service: Python/FastAPI, ONNX Runtime, a
self-hosted OpenCLIP-based model. Receives a file, returns a category
prediction against the user's tree, holds no user data of its own — mirrors
the two-server split used elsewhere in this account's projects (see
`organizational/adr` once that ADR is written). Self-hosted specifically
because the NSFW content this app is built to sort is against most cloud
vision providers' ToS. Nothing lives here yet — no code, no `pyproject.toml`.
