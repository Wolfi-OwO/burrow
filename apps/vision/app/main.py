"""apps/vision: stateless image inference. It receives a file and returns numbers, and keeps nothing (FR-031)."""

import hmac
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

from app.config import settings
from app.routes.schemas import ClassifyResponse, EmbedResponse, LabelScore, NsfwResponse
from app.services.clip import ClipModel
from app.services.images import UnreadableImage, decode
from app.services.nsfw import NsfwModel
import json


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Loads every model before the first request. A missing file raises here, so the process exits (FR-030)."""
    app.state.clip = ClipModel(settings.models_dir, settings)
    app.state.nsfw = NsfwModel(settings.models_dir, settings)
    yield


app = FastAPI(title="burrow vision", version="0.1.0", lifespan=lifespan)


def require_service_token(x_internal_service_token: Annotated[str | None, Header()] = None) -> None:
    """Rejects a request without the shared secret, when one is configured. Compared in constant time."""
    expected = settings.internal_service_token
    if expected and not hmac.compare_digest(x_internal_service_token or "", expected):
        raise HTTPException(status_code=401, detail="missing or invalid service token")


async def read_image(file: UploadFile):
    """Reads and decodes an upload within the size cap. The bytes live only for this request."""
    data = await file.read(settings.max_image_bytes + 1)
    if len(data) > settings.max_image_bytes:
        raise HTTPException(status_code=413, detail="image too large")
    try:
        return decode(data)
    except UnreadableImage as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness and readiness in one: the process only starts once the models are loaded."""
    return {"status": "ok"}


@app.post("/embed", response_model=EmbedResponse, dependencies=[Depends(require_service_token)])
async def embed(file: Annotated[UploadFile, File()]) -> EmbedResponse:
    """The 512-dim OpenCLIP ViT-B/32 embedding of an image; the same input gives the same output (FR-032)."""
    vector = app.state.clip.embed_image(await read_image(file))
    return EmbedResponse(embedding=vector.astype("float32").tolist())


@app.post("/classify", response_model=ClassifyResponse, dependencies=[Depends(require_service_token)])
async def classify(file: Annotated[UploadFile, File()], labels: Annotated[str, Form()]) -> ClassifyResponse:
    """Scores an image against caller-supplied label names (the user's own categories, FR-033).

    `labels` is a JSON array of strings. Every label gets a probability (FR-034); they sum to 1.
    """
    try:
        names = json.loads(labels)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="labels must be a JSON array") from error
    if not isinstance(names, list) or not names or not all(isinstance(n, str) and n.strip() for n in names):
        raise HTTPException(status_code=422, detail="labels must be a non-empty array of non-empty strings")
    if len(names) > settings.max_labels:
        raise HTTPException(status_code=422, detail=f"at most {settings.max_labels} labels")

    clip: ClipModel = app.state.clip
    scores = clip.classify(clip.embed_image(await read_image(file)), names)
    return ClassifyResponse(scores=[LabelScore(label=n, score=s) for n, s in zip(names, scores, strict=True)])


@app.post("/nsfw", response_model=NsfwResponse, dependencies=[Depends(require_service_token)])
async def nsfw(file: Annotated[UploadFile, File()]) -> NsfwResponse:
    """The probability that an image is NSFW, from the dedicated classifier (FR-036)."""
    return NsfwResponse(nsfw=app.state.nsfw.score(await read_image(file)))
