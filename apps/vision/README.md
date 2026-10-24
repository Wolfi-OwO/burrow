# apps/vision

The isolated AI service: Python 3.11, FastAPI, ONNX Runtime. It receives an image and returns numbers: a 512-dim
OpenCLIP ViT-B/32 embedding (`POST /embed`), zero-shot probabilities against labels the caller sends
(`POST /classify`), and an NSFW probability from a separate small model (`POST /nsfw`). It has no database, no
persisted state and keeps no upload. It refuses to start if a model file is missing.

```bash
pip install -r requirements-export.txt && python scripts/export_models.py   # once; writes models/ (~630 MB)
pip install -r requirements-dev.txt && python -m pytest
uvicorn app.main:app --port 8000
taskset -c 0-3 python scripts/benchmark.py                                  # latency and memory
```

Measured numbers and the choices behind them are in `organizational/adr/0004-vision-model.md`.
