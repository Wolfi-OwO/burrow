"""Exports the models apps/vision serves to ONNX, and proves each export matches the original.

Run once on a developer machine (needs requirements-export.txt, i.e. torch); the service itself
only ever loads the resulting files from models/.

    python scripts/export_models.py [--out models]

Both CLIP towers stay fp32 on purpose. Measured alternatives for the text tower: int8 dynamic quantisation
(per-tensor and per-channel) drops label-embedding cosine similarity to ~0.78, and fp16 weights crash ONNX
Runtime's CPU provider; neither is usable. See organizational/adr/0004-vision-model.md.

Produces:
    clip_visual.onnx, clip_text.onnx, clip_tokenizer.json   OpenCLIP ViT-B/32 (LAION-2B weights, MIT)
    nsfw.onnx, nsfw_config.json                              Marqo/nsfw-image-detection-384 (Apache-2.0)
"""

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import open_clip
import timm
import torch
from huggingface_hub import hf_hub_download

CLIP_MODEL = "ViT-B-32"
CLIP_WEIGHTS = "laion2b_s34b_b79k"
NSFW_MODEL = "hf_hub:Marqo/nsfw-image-detection-384"
TOKENIZER_REPO = "openai/clip-vit-base-patch32"
# A model that disagrees with its export by more than this is a broken export, not rounding noise.
MAX_ABS_DIFF = 1e-3


class VisualTower(torch.nn.Module):
    """The image encoder alone, without normalisation (the service normalises in numpy)."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        return self.model.encode_image(image, normalize=False)


class TextTower(torch.nn.Module):
    """The text encoder alone, without normalisation."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, text: torch.Tensor) -> torch.Tensor:
        return self.model.encode_text(text, normalize=False)


def export(module: torch.nn.Module, example: torch.Tensor, path: Path, input_name: str) -> None:
    """Exports one module with a dynamic batch axis and checks it against PyTorch on a random input."""
    torch.onnx.export(
        module,
        (example,),
        str(path),
        input_names=[input_name],
        output_names=["features"],
        dynamic_axes={input_name: {0: "batch"}, "features": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    with torch.no_grad():
        expected = module(example).numpy()
    actual = session.run(None, {input_name: example.numpy()})[0]
    diff = float(np.abs(expected - actual).max())
    print(f"{path.name}: max abs diff vs torch {diff:.2e}, {path.stat().st_size / 1e6:.0f} MB")
    assert diff < MAX_ABS_DIFF, f"{path.name} does not match the original model"


def export_clip(out: Path) -> None:
    model, _, _ = open_clip.create_model_and_transforms(CLIP_MODEL, pretrained=CLIP_WEIGHTS)
    model.eval()
    export(VisualTower(model), torch.randn(2, 3, 224, 224), out / "clip_visual.onnx", "image")
    prompts = torch.cat([open_clip.tokenize(["a photo of a wolf", "a photo of a cat"])])
    export(TextTower(model), prompts, out / "clip_text.onnx", "text")

    # The service tokenizes with the `tokenizers` library (no torch), so prove it produces the
    # exact ids open_clip does, rather than assuming two BPE implementations agree.
    tokenizer_path = Path(hf_hub_download(TOKENIZER_REPO, "tokenizer.json"))
    (out / "clip_tokenizer.json").write_bytes(tokenizer_path.read_bytes())
    from tokenizers import Tokenizer

    tokenizer = Tokenizer.from_file(str(out / "clip_tokenizer.json"))
    samples = ["a photo of WOLF", "a photo of Café Photos", "a photo of 🐺 Wolf stuff", "a photo of something else"]
    reference = open_clip.tokenize(samples).numpy()
    for text, ref in zip(samples, reference, strict=True):
        ids = tokenizer.encode(text).ids
        length = int((ref != 0).sum())
        assert ids[:length] == ref[:length].tolist(), f"tokenizer disagrees with open_clip on {text!r}"
    print("clip_tokenizer.json: matches open_clip.tokenize on", len(samples), "samples")


def export_nsfw(out: Path) -> None:
    model = timm.create_model(NSFW_MODEL, pretrained=True).eval()
    config = timm.data.resolve_data_config({}, model=model)
    size = config["input_size"][1]
    export(model, torch.randn(1, 3, size, size), out / "nsfw.onnx", "image")
    labels = list(model.pretrained_cfg["label_names"])
    spec = {
        "input_size": size,
        "mean": list(config["mean"]),
        "std": list(config["std"]),
        "labels": labels,
        "nsfw_index": labels.index("NSFW"),
        "source": NSFW_MODEL,
    }
    (out / "nsfw_config.json").write_text(json.dumps(spec, indent=2) + "\n")
    print("nsfw_config.json:", spec)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "models")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    export_clip(args.out)
    export_nsfw(args.out)
