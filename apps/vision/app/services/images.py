"""Image decoding and the two preprocessing pipelines (CLIP and the NSFW classifier)."""

import io

import numpy as np
from PIL import Image, ImageOps

# Decompression-bomb guard: Pillow raises above this many pixels instead of allocating gigabytes.
Image.MAX_IMAGE_PIXELS = 100_000_000


class UnreadableImage(ValueError):
    """The bytes are not an image Pillow can decode."""


def decode(data: bytes) -> Image.Image:
    """Decodes upload bytes to an RGB image, honouring EXIF rotation.

    Args:
        data: The raw file.

    Returns:
        The image in RGB.

    Raises:
        UnreadableImage: When the bytes are not a decodable image.
    """
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as error:  # Pillow raises a wide range of types for bad input
        raise UnreadableImage("not a readable image") from error
    return ImageOps.exif_transpose(image).convert("RGB")


def resize_center_crop(image: Image.Image, size: int) -> Image.Image:
    """Resizes the shorter side to `size` (bicubic) and center-crops a square, as CLIP was trained."""
    width, height = image.size
    scale = size / min(width, height)
    resized = image.resize((max(size, round(width * scale)), max(size, round(height * scale))), Image.BICUBIC)
    left = (resized.width - size) // 2
    top = (resized.height - size) // 2
    return resized.crop((left, top, left + size, top + size))


def to_tensor(image: Image.Image, mean: tuple[float, ...], std: tuple[float, ...]) -> np.ndarray:
    """Converts a square RGB image to a normalised float32 NCHW batch of one."""
    array = np.asarray(image, dtype=np.float32) / 255.0
    array = (array - np.array(mean, dtype=np.float32)) / np.array(std, dtype=np.float32)
    return array.transpose(2, 0, 1)[None, ...].astype(np.float32)
