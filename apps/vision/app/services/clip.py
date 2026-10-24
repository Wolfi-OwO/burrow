"""OpenCLIP ViT-B/32 on ONNX Runtime: image embeddings and zero-shot scoring (ADR-0004)."""

from collections import OrderedDict
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

from app.config import Settings
from app.services.images import resize_center_crop, to_tensor

CONTEXT_LENGTH = 77
IMAGE_SIZE = 224
MEAN = (0.48145466, 0.4578275, 0.40821073)
STD = (0.26862954, 0.26130258, 0.27577711)
# open_clip's logit scale after training (exp of the learned temperature), fixed for ViT-B/32.
LOGIT_SCALE = 100.0
TEXT_CACHE_SIZE = 4096


class ClipModel:
    """Holds both ONNX sessions and the tokenizer; thread-safe for concurrent inference."""

    def __init__(self, models_dir: Path, settings: Settings) -> None:
        """Loads the model files.

        Raises:
            FileNotFoundError: When a required file is missing, so startup fails loudly (FR-030).
        """
        options = ort.SessionOptions()
        options.intra_op_num_threads = settings.intra_op_threads
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        paths = {name: models_dir / name for name in ("clip_visual.onnx", "clip_text.onnx", "clip_tokenizer.json")}
        for path in paths.values():
            if not path.is_file():
                raise FileNotFoundError(f"missing model file: {path}")
        self._visual = ort.InferenceSession(str(paths["clip_visual.onnx"]), options, providers=["CPUExecutionProvider"])
        self._text = ort.InferenceSession(str(paths["clip_text.onnx"]), options, providers=["CPUExecutionProvider"])
        self._tokenizer = Tokenizer.from_file(str(paths["clip_tokenizer.json"]))
        self._template = settings.prompt_template
        # Label embeddings are reused across files: a sorting run asks about the same category names again and again.
        self._label_cache: OrderedDict[str, np.ndarray] = OrderedDict()

    def tokenize(self, text: str) -> np.ndarray:
        """Turns text into CLIP's fixed-length int64 token row: <sot> ... <eot>, zero padded, truncated to 77."""
        ids = self._tokenizer.encode(text).ids[:CONTEXT_LENGTH]
        eot = self._tokenizer.token_to_id("<|endoftext|>")
        if ids[-1] != eot:
            ids[-1] = eot
        row = np.zeros(CONTEXT_LENGTH, dtype=np.int64)
        row[: len(ids)] = ids
        return row

    def embed_image(self, image: Image.Image) -> np.ndarray:
        """Returns the L2-normalised 512-dimensional embedding of an image (FR-032)."""
        batch = to_tensor(resize_center_crop(image, IMAGE_SIZE), MEAN, STD)
        features = self._visual.run(None, {"image": batch})[0][0]
        return features / np.linalg.norm(features)

    def embed_labels(self, labels: list[str]) -> np.ndarray:
        """Returns one normalised text embedding per label, computing only the ones not cached."""
        missing = [label for label in dict.fromkeys(labels) if label not in self._label_cache]
        if missing:
            tokens = np.stack([self.tokenize(self._template.format(label=label)) for label in missing])
            features = self._text.run(None, {"text": tokens})[0]
            features = features / np.linalg.norm(features, axis=1, keepdims=True)
            for label, row in zip(missing, features, strict=True):
                self._label_cache[label] = row
            while len(self._label_cache) > TEXT_CACHE_SIZE:
                self._label_cache.popitem(last=False)
        for label in labels:
            self._label_cache.move_to_end(label)
        return np.stack([self._label_cache[label] for label in labels])

    def classify(self, image_embedding: np.ndarray, labels: list[str]) -> list[float]:
        """Zero-shot probabilities of an image against the given labels (FR-033, FR-034): a softmax over all labels."""
        logits = LOGIT_SCALE * (self.embed_labels(labels) @ image_embedding)
        logits -= logits.max()
        weights = np.exp(logits)
        return (weights / weights.sum()).tolist()
