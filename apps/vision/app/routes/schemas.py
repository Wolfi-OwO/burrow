"""Response models. Declared, not inferred, so the API's contract is one readable file."""

from pydantic import BaseModel, Field


class EmbedResponse(BaseModel):
    """A normalised image embedding."""

    embedding: list[float] = Field(min_length=512, max_length=512)


class LabelScore(BaseModel):
    """One label and its probability among the labels asked about."""

    label: str
    score: float


class ClassifyResponse(BaseModel):
    """Zero-shot scores, in the order the labels were sent."""

    scores: list[LabelScore]


class NsfwResponse(BaseModel):
    """The NSFW probability."""

    nsfw: float
