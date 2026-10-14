from pathlib import Path

import pytest

from app import config
from app.config import Settings
from app.extraction.cubicasa.weights_manager import DEFAULT_WEIGHTS_FILENAME, get_weights_path


def test_default_artifact_paths_stay_in_backend(monkeypatch):
    monkeypatch.delenv("HEPHAESTUS_DATA_DIR", raising=False)
    monkeypatch.delenv("CUBICASA_MODEL_PATH", raising=False)
    data_dir = Path(__file__).resolve().parents[1] / "data"
    assert Settings().data_dir == data_dir
    assert get_weights_path() == data_dir / "models" / DEFAULT_WEIGHTS_FILENAME


@pytest.mark.parametrize("mode", [0o600, 0o644])
def test_env_is_loaded_from_repository_root(tmp_path, monkeypatch, mode):
    monkeypatch.setattr(config, "__file__", str(tmp_path / "backend" / "app" / "config.py"))
    monkeypatch.delenv("HEPHAESTUS_INFERENCE_ENGINE", raising=False)
    monkeypatch.delenv("OPENROUTER_BASE_URL", raising=False)
    env = tmp_path / ".env"
    env.write_text("HEPHAESTUS_INFERENCE_ENGINE=openrouter\n")
    env.chmod(mode)
    if mode == 0o600:
        assert Settings.from_env().inference_engine == "openrouter"
    else:
        with pytest.raises(RuntimeError, match="owner-readable only"):
            Settings.from_env()
