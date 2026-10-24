"""The dedicated NSFW/SFW classifier (FR-036): its own model and its own pass, never CLIP zero-shot."""

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from app.config import Settings
from app.services.images import resize_center_crop, to_tensor


class NsfwModel:
    """A small image classifier exported by scripts/export_models.py together with its preprocessing config."""

    def __init__(self, models_dir: Path, settings: Settings) -> None:
        """Loads the model and its config.

        Raises:
            FileNotFoundError: When a required file is missing, so startup fails loudly (FR-030).
        """
        model, config = models_dir / "nsfw.onnx", models_dir / "nsfw_config.json"
        for path in (model, config):
            if not path.is_file():
                raise FileNotFoundError(f"missing model file: {path}")
        options = ort.SessionOptions()
        options.intra_op_num_threads = settings.intra_op_threads
        self._session = ort.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])
        spec = json.loads(config.read_text())
        self._size: int = spec["input_size"]
        self._mean = tuple(spec["mean"])
        self._std = tuple(spec["std"])
        self._nsfw_index: int = spec["nsfw_index"]

    def score(self, image: Image.Image) -> float:
        """Returns the probability in [0, 1] that an image is NSFW."""
        batch = to_tensor(resize_center_crop(image, self._size), self._mean, self._std)
        logits = self._session.run(None, {"image": batch})[0][0]
        logits = logits - logits.max()
        weights = np.exp(logits)
        return float((weights / weights.sum())[self._nsfw_index])
