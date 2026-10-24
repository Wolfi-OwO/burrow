# syntax=docker/dockerfile:1
# Stage 1 exports the models once. It needs torch; the runtime image never sees it.
FROM python:3.11-slim AS export
WORKDIR /export
COPY requirements-export.txt .
RUN pip install --no-cache-dir -r requirements-export.txt
COPY scripts/export_models.py scripts/export_models.py
RUN python scripts/export_models.py --out /export/models

FROM python:3.11-slim AS runtime
# Links the package to the repository, so it inherits the repository's access rules on ghcr.io.
LABEL org.opencontainers.image.source="https://github.com/Wolfi-OwO/burrow"
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 MODELS_DIR=/app/models
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app app
COPY --from=export /export/models models
# Nothing in this image is ever written to, so it runs as nobody on a read-only root filesystem.
RUN useradd --system --uid 10001 --no-create-home vision
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
# One worker: the models are ~1 GiB, a second process would double it (ADR-0004).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
