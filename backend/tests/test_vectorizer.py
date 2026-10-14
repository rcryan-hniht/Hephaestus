"""CubiCasa post-processing and checkpoint safety regressions."""

import io

import pytest
import torch
from PIL import Image
from shapely.geometry import Polygon

import vectorizer
import weights_manager


def png():
    output = io.BytesIO()
    Image.new("RGB", (100, 60), "white").save(output, format="PNG")
    return output.getvalue()


def fake_inference(monkeypatch, polygons, types, rooms=(), room_types=()):
    monkeypatch.setattr(vectorizer, "get_cubicasa_model", lambda device: lambda tensor: tensor)
    monkeypatch.setattr(vectorizer, "split_prediction", lambda *args: (None, None, None))
    monkeypatch.setattr(
        vectorizer,
        "get_polygons",
        lambda *args: (polygons, types, rooms, room_types),
    )


def test_icon_openings_are_typed_and_disconnected_candidates_reported(monkeypatch):
    wall = [(6.4, 5.333333), (32, 5.333333), (32, 16), (6.4, 16)]
    window = [(10, 8), (14, 8), (14, 12), (10, 12)]
    door = [(20, 8), (24, 8), (24, 12), (20, 12)]
    disconnected = [(40, 20), (44, 20), (44, 24), (40, 24)]
    fake_inference(
        monkeypatch,
        [wall, window, door, disconnected],
        [
            {"type": "wall", "class": 2},
            {"type": "icon", "class": 1, "prob": 0.7},
            {"type": "icon", "class": 2, "prob": 0.8},
            {"type": "icon", "class": 1, "prob": 0.4},
        ],
    )

    proposal = vectorizer.vectorize_floorplan(png(), "job1", "a" * 64, max_side=64)

    assert [component.type for component in proposal.components] == ["wall", "window", "door"]
    assert proposal.job_id == "job1" and proposal.source_hash == "a" * 64
    assert proposal.coordinate_frame.width == 100
    assert proposal.coordinate_frame.height == 60
    assert proposal.coordinate_frame.preprocessing_transform == [0.64, 0, 0, 32 / 60, 0, 0]
    assert proposal.components[0].polygon[0] == pytest.approx((10, 10), abs=1e-5)
    assert all(component.confidence is None for component in proposal.components)
    assert any("opening" in issue.lower() and "3" in issue for issue in proposal.validation_issues)


@pytest.mark.parametrize("rooms", [(), (Polygon([(1, 1), (20, 1), (20, 20), (1, 20)]),)])
def test_no_detected_walls_never_generates_a_model(monkeypatch, rooms):
    fake_inference(monkeypatch, [], [], rooms, [{"class": 3}] if rooms else [])

    with pytest.raises(ValueError, match="wall"):
        vectorizer.vectorize_floorplan(png(), "job2", "b" * 64, max_side=64)


def test_invalid_opening_is_reported_without_poisoning_valid_geometry(monkeypatch):
    wall = [(1, 1), (20, 1), (20, 20), (1, 20)]
    malformed = [(float("nan"), 2), (8, 2), (8, 5), (2, 5)]
    fake_inference(
        monkeypatch,
        [wall, malformed],
        [{"type": "wall", "class": 2}, {"type": "icon", "class": 1}],
    )

    proposal = vectorizer.vectorize_floorplan(png(), "job3", "c" * 64, max_side=64)

    assert [component.type for component in proposal.components] == ["wall"]
    assert any("opening" in issue.lower() and "1" in issue for issue in proposal.validation_issues)


def test_missing_checkpoint_requires_explicit_download_opt_in(tmp_path, monkeypatch):
    path = tmp_path / "absent.pkl"
    monkeypatch.delenv("HEPHAESTUS_ALLOW_WEIGHT_DOWNLOAD", raising=False)
    import gdown

    monkeypatch.setattr(
        gdown, "download", lambda **kwargs: pytest.fail("unexpected weight download")
    )

    with pytest.raises(RuntimeError, match="CUBICASA_MODEL_PATH"):
        weights_manager.ensure_weights(path)

    assert not path.exists()


def test_cache_is_scoped_to_checkpoint_and_device(tmp_path, monkeypatch):
    paths = [tmp_path / "one.pkl", tmp_path / "two.pkl"]
    selected = [paths[0]]
    loaded = []

    class Model:
        def __init__(self, n_classes):
            assert n_classes == 44

        def load_state_dict(self, state, strict):
            assert state == {"weights": 1} and strict

        def to(self, device):
            return self

        def eval(self):
            return self

    def load(path, *, map_location, weights_only):
        assert weights_only is True
        loaded.append((path, map_location))
        return {"model_state": {"weights": 1}}

    monkeypatch.setattr(weights_manager, "ensure_weights", lambda: selected[0])
    monkeypatch.setattr(weights_manager, "HourglassNet", Model)
    monkeypatch.setattr(torch, "load", load)
    monkeypatch.setattr(weights_manager, "_CACHED_MODEL", None)
    monkeypatch.setattr(weights_manager, "_CACHED_DEVICE", None)

    first = weights_manager.get_cubicasa_model("cpu")
    assert weights_manager.get_cubicasa_model("cpu") is first
    selected[0] = paths[1]
    assert weights_manager.get_cubicasa_model("cpu") is not first
    weights_manager.get_cubicasa_model("cuda")
    assert loaded == [(paths[0], "cpu"), (paths[1], "cpu"), (paths[1], "cuda")]


def test_relative_checkpoint_path_reloads_after_working_directory_changes(tmp_path, monkeypatch):
    first_dir = tmp_path / "first"
    second_dir = tmp_path / "second"
    first_dir.mkdir()
    second_dir.mkdir()
    loaded = []

    class Model:
        def __init__(self, n_classes):
            pass

        def load_state_dict(self, state, strict):
            pass

        def to(self, device):
            return self

        def eval(self):
            return self

    def load(path, *, map_location, weights_only):
        loaded.append(path)
        return {"model_state": {}}

    monkeypatch.setattr(
        weights_manager, "ensure_weights", lambda: weights_manager.Path("model.pkl")
    )
    monkeypatch.setattr(weights_manager, "HourglassNet", Model)
    monkeypatch.setattr(torch, "load", load)
    monkeypatch.setattr(weights_manager, "_CACHED_MODEL", None)
    monkeypatch.setattr(weights_manager, "_CACHED_DEVICE", None)
    monkeypatch.chdir(first_dir)
    weights_manager.get_cubicasa_model()
    monkeypatch.chdir(second_dir)
    weights_manager.get_cubicasa_model()

    assert loaded == [first_dir / "model.pkl", second_dir / "model.pkl"]


def test_default_checkpoint_uses_backend_artifact_directory(tmp_path, monkeypatch):
    monkeypatch.delenv("CUBICASA_MODEL_PATH", raising=False)
    monkeypatch.setenv("HEPHAESTUS_DATA_DIR", str(tmp_path))
    assert (
        weights_manager.get_weights_path()
        == tmp_path / "models" / weights_manager.DEFAULT_WEIGHTS_FILENAME
    )
