"""Manager for CubiCasa5k pretrained model weights and singleton lifecycle."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import torch

try:
    from cubicasa_model import HourglassNet
except ImportError:
    from backend.cubicasa_model import HourglassNet

logger = logging.getLogger(__name__)

DEFAULT_GDRIVE_ID = "1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK"
DEFAULT_WEIGHTS_FILENAME = "model_best_val_loss_var.pkl"

_CACHED_MODEL: HourglassNet | None = None
_CACHED_DEVICE: str | None = None


def get_weights_path() -> Path:
    """Return local path to the CubiCasa5k checkpoint."""
    env_path = os.environ.get("CUBICASA_MODEL_PATH")
    if env_path:
        return Path(env_path)
    # Default location: backend/data/models/model_best_val_loss_var.pkl
    base_dir = Path(__file__).resolve().parent
    return base_dir / "data" / "models" / DEFAULT_WEIGHTS_FILENAME


def ensure_weights(weights_path: Path | None = None) -> Path:
    """Ensure weights exist locally, downloading if necessary."""
    path = weights_path or get_weights_path()
    if path.is_file() and path.stat().st_size > 10_000_000:
        return path

    path.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading CubiCasa5k model weights to %s...", path)
    import gdown

    output = gdown.download(id=DEFAULT_GDRIVE_ID, output=str(path), quiet=False)
    if not output or not path.is_file() or path.stat().st_size < 10_000_000:
        raise RuntimeError(f"Failed to download CubiCasa5k weights from Google Drive ({DEFAULT_GDRIVE_ID}) to {path}")
    logger.info("Successfully downloaded CubiCasa5k weights (%d bytes)", path.stat().st_size)
    return path


def get_cubicasa_model(device: str = "cpu") -> HourglassNet:
    """Return cached singleton instance of HourglassNet loaded with pretrained weights."""
    global _CACHED_MODEL, _CACHED_DEVICE
    if _CACHED_MODEL is not None and _CACHED_DEVICE == device:
        return _CACHED_MODEL

    weights_path = ensure_weights()
    logger.info("Loading CubiCasa5k HourglassNet on %s from %s...", device, weights_path)
    model = HourglassNet(n_classes=44)
    checkpoint = torch.load(weights_path, map_location=device)
    state_dict = checkpoint.get("model_state", checkpoint)
    model.load_state_dict(state_dict, strict=True)
    model.to(device)
    model.eval()

    _CACHED_MODEL = model
    _CACHED_DEVICE = device
    logger.info("CubiCasa5k HourglassNet successfully loaded and ready for inference.")
    return _CACHED_MODEL
