import hashlib
import json

import pytest
from PIL import Image

from app.contracts import Component, Proposal
from app.evaluation import alignment, compare, create_manifest, evaluate, safe_sample


def test_split_leading_slash_and_path_traversal(tmp_path):
    (tmp_path / "high_quality" / "123").mkdir(parents=True)
    assert safe_sample(tmp_path, "/high_quality/123/") == tmp_path / "high_quality" / "123"
    with pytest.raises(ValueError):
        safe_sample(tmp_path, "/../outside/")
    (tmp_path / "link").symlink_to(tmp_path.parent)
    with pytest.raises(ValueError):
        safe_sample(tmp_path, "/link/")


def test_manifest_is_fixed_and_records_split_hash(tmp_path):
    (tmp_path / "val.txt").write_text("/a/\n/b/\n/c/\n")
    for name in ("a", "b", "c"):
        (tmp_path / name).mkdir()
    first = create_manifest(tmp_path, "val", 2, seed=42)
    assert first == create_manifest(tmp_path, "val", 2, seed=42)
    assert len(first["samples"]) == 2
    assert first["split_hash"] == hashlib.sha256((tmp_path / "val.txt").read_bytes()).hexdigest()
    with pytest.raises(ValueError):
        create_manifest(tmp_path, "val", 4, seed=42)


def test_alignment_records_compatible_frames_without_claiming_verified_pixels(tmp_path):
    Image.new("RGB", (100, 50)).save(tmp_path / "F1_scaled.png")
    Image.new("RGB", (200, 100)).save(tmp_path / "F1_original.png")
    result = alignment(tmp_path, {"width": 100, "height": 50, "origin": [0, 0]})
    assert result["selected_image"] == "F1_scaled.png"
    assert result["status"] == "candidate_dimension_match"
    assert result["verified"] is False
    assert result["images"]["F1_original.png"]["candidate_transform"] == [0.5, 0, 0, 0.5, 0, 0]


def p(offset=0, kinds=("wall", "room")):
    return Proposal(
        job_id="j",
        source_hash="a" * 64,
        source_kind="svg",
        coordinate_frame={"width": 100, "height": 100},
        components=[
            Component(
                id=k,
                type=k,
                polygon=[(offset, 0), (10 + offset, 0), (10 + offset, 10), (offset, 10)],
            )
            for k in kinds
        ],
    )


def test_metrics_report_source_error_and_omissions():
    result = compare(p(1, ("wall",)), p())
    assert result["unit"] == "source"
    assert result["components"]["wall"]["iou"] == pytest.approx(9 / 11)
    assert result["components"]["wall"]["boundary_hausdorff"] == 1
    assert result["components"]["room"]["missing_count"] == 1
    assert result["components"]["room"]["iou"] == 0
    assert result["dimension_readings"]["missing_count"] == 0


@pytest.mark.parametrize("invalid", ["array", "frame", "unit"])
def test_invalid_offline_fixture_is_recorded_without_aborting_batch(tmp_path, invalid):
    root = tmp_path / "dataset"
    sample = root / "a"
    sample.mkdir(parents=True)
    (root / "val.txt").write_text("/a/\n")
    (sample / "model.svg").write_text(
        '<svg viewBox="0 0 100 50"><g class="Wall"><rect width="10" height="2"/></g></svg>'
    )
    Image.new("RGB", (100, 50)).save(sample / "F1_scaled.png")
    digest = hashlib.sha256((sample / "F1_scaled.png").read_bytes()).hexdigest()
    predictions = tmp_path / "predictions"
    predictions.mkdir()
    payload = {
        "sample": "a",
        "image": "F1_scaled.png",
        "proposal": {
            "job_id": "j",
            "source_hash": digest,
            "source_kind": "png",
            "coordinate_frame": {
                "width": 20 if invalid == "frame" else 100,
                "height": 50,
                "unit": "source" if invalid == "unit" else "pixel",
            },
            "components": [
                {"id": "w", "type": "wall", "polygon": [[0, 0], [10, 0], [10, 2], [0, 2]]}
            ],
        },
    }
    (predictions / "00.json").write_text(json.dumps([] if invalid == "array" else payload))
    report = evaluate(
        root,
        create_manifest(root, "val", 1),
        predictions,
        {
            "a": {
                "confirmed": True,
                "source_hash": digest,
                "image_to_svg_transform": [1, 0, 0, 1, 0, 0],
            }
        },
    )
    assert report["invalid_output_rate"] == 1
    assert report["samples"][0]["status"] == "invalid_output"


def test_spatially_displaced_component_counts_as_an_omission():
    result = compare(p(20, ("wall",)), p(0, ("wall",)))
    assert result["components"]["wall"]["missing_count"] == 1
    assert result["components"]["wall"]["extra_count"] == 1
