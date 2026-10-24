"""Shared fixtures. The real exported models are used (no mocks of the thing under test); tests skip
cleanly when `python scripts/export_models.py` has not been run."""

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

MODELS = Path(__file__).resolve().parent.parent / "models"
HAVE_MODELS = all((MODELS / name).is_file() for name in ("clip_visual.onnx", "clip_text.onnx", "clip_tokenizer.json", "nsfw.onnx", "nsfw_config.json"))
needs_models = pytest.mark.skipif(not HAVE_MODELS, reason="run scripts/export_models.py first")


def solid(color: tuple[int, int, int], size: tuple[int, int] = (320, 240), fmt: str = "PNG") -> bytes:
    """A solid-colour image as file bytes."""
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, fmt)
    return buffer.getvalue()


@pytest.fixture(scope="session")
def client():
    """The real app with the real models loaded, as in production."""
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
