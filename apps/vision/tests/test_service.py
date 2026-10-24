import json
import math
import tempfile
from pathlib import Path

import numpy as np
import pytest

from app.config import load_settings
from app.services.clip import ClipModel
from app.services.images import UnreadableImage, decode
from tests.conftest import needs_models, solid


def send(client, path, data, labels=None, headers=None):
    fields = {"labels": json.dumps(labels)} if labels is not None else None
    return client.post(path, files={"file": ("x.png", data, "image/png")}, data=fields, headers=headers or {})


def test_startup_fails_loudly_when_a_model_file_is_missing(tmp_path):
    """FR-030: no half-working service."""
    with pytest.raises(FileNotFoundError, match="clip_visual.onnx"):
        ClipModel(tmp_path, load_settings())


def test_decode_rejects_bytes_that_are_not_an_image():
    with pytest.raises(UnreadableImage):
        decode(b"definitely not an image")


@needs_models
def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


@needs_models
def test_embedding_is_512_dimensional_normalised_and_deterministic(client):
    """FR-032."""
    first = send(client, "/embed", solid((200, 30, 30))).json()["embedding"]
    second = send(client, "/embed", solid((200, 30, 30))).json()["embedding"]
    assert len(first) == 512
    assert math.isclose(float(np.linalg.norm(first)), 1.0, abs_tol=1e-4)
    assert first == second


@needs_models
def test_embeddings_differ_between_different_images(client):
    red = np.array(send(client, "/embed", solid((220, 20, 20))).json()["embedding"])
    blue = np.array(send(client, "/embed", solid((20, 20, 220))).json()["embedding"])
    assert float(red @ blue) < 0.99


@needs_models
def test_zero_shot_scores_every_label_and_the_right_one_wins(client):
    """FR-033, FR-034: a confidence per candidate, not only a top pick."""
    labels = ["red", "blue", "green"]
    body = send(client, "/classify", solid((220, 20, 20)), labels).json()
    scores = {s["label"]: s["score"] for s in body["scores"]}
    assert [s["label"] for s in body["scores"]] == labels
    assert math.isclose(sum(scores.values()), 1.0, abs_tol=1e-5)
    assert max(scores, key=scores.get) == "red"
    blue = {s["label"]: s["score"] for s in send(client, "/classify", solid((20, 20, 220)), labels).json()["scores"]}
    assert max(blue, key=blue.get) == "blue"


@needs_models
def test_labels_may_be_any_unicode_the_user_typed(client):
    labels = ["🐺 Wolf stuff", "Café Photos", "something else"]
    body = send(client, "/classify", solid((90, 90, 90)), labels).json()
    assert [s["label"] for s in body["scores"]] == labels


@needs_models
@pytest.mark.parametrize("labels", [[], "nope", [1, 2], [""], ["a"] * 201])
def test_bad_label_lists_are_rejected(client, labels):
    response = client.post("/classify", files={"file": ("x.png", solid((1, 2, 3)), "image/png")}, data={"labels": json.dumps(labels)})
    assert response.status_code == 422


@needs_models
def test_nsfw_returns_a_probability_and_scores_a_plain_image_as_safe(client):
    """FR-036: its own endpoint, its own model."""
    score = send(client, "/nsfw", solid((120, 160, 200))).json()["nsfw"]
    assert 0.0 <= score <= 1.0
    assert score < 0.5


@needs_models
def test_unreadable_image_is_422_and_oversize_is_413(client):
    from app import main

    assert send(client, "/embed", b"garbage").status_code == 422
    original = main.settings.max_image_bytes
    object.__setattr__(main.settings, "max_image_bytes", 10)
    try:
        assert send(client, "/embed", solid((1, 2, 3))).status_code == 413
    finally:
        object.__setattr__(main.settings, "max_image_bytes", original)


@needs_models
def test_service_token_is_required_when_configured(client):
    from app import main

    object.__setattr__(main.settings, "internal_service_token", "s3cret")
    try:
        assert send(client, "/embed", solid((1, 2, 3))).status_code == 401
        assert send(client, "/embed", solid((1, 2, 3)), headers={"X-Internal-Service-Token": "wrong"}).status_code == 401
        assert send(client, "/embed", solid((1, 2, 3)), headers={"X-Internal-Service-Token": "s3cret"}).status_code == 200
        assert client.get("/health").status_code == 200
    finally:
        object.__setattr__(main.settings, "internal_service_token", None)


@needs_models
def test_nothing_is_persisted_after_responding(client):
    """FR-031: no uploaded bytes and no prediction left behind."""
    before = set(Path(tempfile.gettempdir()).rglob("*"))
    send(client, "/embed", solid((10, 20, 30)))
    send(client, "/classify", solid((10, 20, 30)), ["a", "b"])
    send(client, "/nsfw", solid((10, 20, 30)))
    created = {p for p in set(Path(tempfile.gettempdir()).rglob("*")) - before if p.is_file()}
    assert created == set()


@needs_models
def test_the_tokenizer_pads_with_zero_and_ends_with_the_end_token(client):
    from app.main import app

    row = app.state.clip.tokenize("a photo of a wolf")
    assert row.shape == (77,)
    assert row[0] == 49406 and row.max() == 49407 and row[-1] == 0
    long_row = app.state.clip.tokenize("word " * 200)
    assert long_row[-1] == 49407
