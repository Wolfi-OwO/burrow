"""Times the real models on a photo-sized image and reports memory, so capacity decisions rest on a number.

    taskset -c 0-3 python scripts/benchmark.py        # pin to 4 cores to approximate a 4 vCPU host
"""

import io
import resource
import statistics
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.services.clip import ClipModel  # noqa: E402
from app.services.images import decode  # noqa: E402
from app.services.nsfw import NsfwModel  # noqa: E402

RUNS = 30
LABELS = ["Furry", "SFW", "NSFW", "WOLF", "Nature", "Landscapes", "Screenshots", "something else"]


def rss_mb() -> float:
    """Peak resident set size in MB."""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def photo(width: int = 4000, height: int = 3000) -> bytes:
    """A 12 MP JPEG with photo-like texture (smooth gradients plus noise), as a phone would produce."""
    rng = np.random.default_rng(1)
    y, x = np.mgrid[0:height, 0:width]
    base = np.stack([x / width * 255, y / height * 255, (x + y) / (width + height) * 255], axis=-1)
    noisy = np.clip(base + rng.normal(0, 12, base.shape), 0, 255).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(noisy).save(buffer, "JPEG", quality=90)
    return buffer.getvalue()


def timed(fn) -> list[float]:
    fn()  # warm-up, excluded
    samples = []
    for _ in range(RUNS):
        start = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - start) * 1000)
    return samples


def report(name: str, samples: list[float]) -> None:
    ordered = sorted(samples)
    print(f"{name:34s} p50 {statistics.median(ordered):7.0f} ms   p95 {ordered[int(len(ordered) * 0.95) - 1]:7.0f} ms")


if __name__ == "__main__":
    data = photo()
    print(f"input: {len(data) / 1e6:.1f} MB JPEG, 4000x3000")
    before = rss_mb()
    clip, nsfw = ClipModel(settings.models_dir, settings), NsfwModel(settings.models_dir, settings)
    print(f"RSS after loading both models: {rss_mb():.0f} MB (was {before:.0f} MB before)")

    image = decode(data)
    embedding = clip.embed_image(image)
    report("decode 12 MP JPEG", timed(lambda: decode(data)))
    report("CLIP image embedding", timed(lambda: clip.embed_image(image)))
    clip._label_cache.clear()
    report("CLIP 8 new labels (text, uncached)", timed(lambda: (clip._label_cache.clear(), clip.embed_labels(LABELS))))
    report("CLIP classify, labels cached", timed(lambda: clip.classify(embedding, LABELS)))
    report("NSFW classifier", timed(lambda: nsfw.score(image)))
    report("one file, whole pipeline", timed(lambda: (lambda im: (clip.classify(clip.embed_image(im), LABELS), nsfw.score(im)))(decode(data))))
    print(f"peak RSS: {rss_mb():.0f} MB")
