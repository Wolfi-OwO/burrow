"""Configuration, read once from the environment. Nothing else in the service touches os.environ."""

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    """Everything tunable about the service.

    Attributes:
        models_dir: Directory holding the exported ONNX files and their config.
        internal_service_token: When set, every request must send it as X-Internal-Service-Token.
            Defense in depth on top of the network isolation (the service is never published).
        max_image_bytes: Upper bound on an uploaded image, checked before decoding.
        max_labels: Upper bound on labels per classification request.
        intra_op_threads: ONNX Runtime threads per inference (0 lets it decide).
        prompt_template: How a category name becomes the text CLIP is asked about.
    """

    models_dir: Path
    internal_service_token: str | None
    max_image_bytes: int
    max_labels: int
    intra_op_threads: int
    prompt_template: str


def load_settings() -> Settings:
    """Builds Settings from environment variables, with defaults that work for local development."""
    return Settings(
        models_dir=Path(os.environ.get("MODELS_DIR", Path(__file__).resolve().parent.parent / "models")),
        internal_service_token=os.environ.get("INTERNAL_SERVICE_TOKEN") or None,
        max_image_bytes=int(os.environ.get("MAX_IMAGE_BYTES", 25 * 1024 * 1024)),
        max_labels=int(os.environ.get("MAX_LABELS", 200)),
        intra_op_threads=int(os.environ.get("INTRA_OP_THREADS", 0)),
        prompt_template=os.environ.get("PROMPT_TEMPLATE", "a photo of {label}"),
    )


settings = load_settings()
