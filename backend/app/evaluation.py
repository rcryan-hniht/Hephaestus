"""Read-only CubeCasa subset evaluation. This CLI never makes inference requests."""

import argparse
import hashlib
import json
import math
import random
import time
from collections import Counter
from pathlib import Path

from PIL import Image
from shapely.geometry import Polygon
from shapely.ops import unary_union

from app.contracts import Proposal
from app.extraction.svg import extract_svg


def safe_sample(root: Path, entry: str) -> Path:
    root = root.expanduser().resolve()
    sample = (root / entry.lstrip("/")).resolve()
    if not sample.is_relative_to(root) or sample == root or not sample.is_dir():
        raise ValueError("Split entry must resolve to a sample directory inside dataset root")
    return sample


def safe_artifact(sample, name):
    path = (sample / name).resolve()
    if not path.is_relative_to(sample):
        raise ValueError("Sample artifact resolves outside sample directory")
    return path


def create_manifest(root, split, count, seed=42):
    if split not in {"val", "test"} or not 1 <= count <= 100:
        raise ValueError("Choose a val/test subset of 1 to 100 samples")
    split_path = root / (split + ".txt")
    data = split_path.read_bytes()
    entries = sorted(
        {
            str(safe_sample(root, line).relative_to(root.resolve()))
            for line in data.decode().splitlines()
            if line.strip()
        }
    )
    if count > len(entries):
        raise ValueError("Subset count exceeds available split samples")
    return {
        "version": "cubicasa-evaluation.v1",
        "split": split,
        "split_hash": hashlib.sha256(data).hexdigest(),
        "seed": seed,
        "samples": random.Random(seed).sample(entries, count),
    }


def alignment(sample, frame):
    width, height = frame["width"], frame["height"]
    origin = frame.get("origin", [0, 0])
    images = {}
    selected = None
    for name in ("F1_scaled.png", "F1_original.png"):
        path = safe_artifact(sample, name)
        if not path.exists():
            continue
        data = path.read_bytes()
        with Image.open(path) as image:
            w, h = image.size
        images[name] = {
            "width": w,
            "height": h,
            "source_hash": hashlib.sha256(data).hexdigest(),
            "candidate_transform": [width / w, 0, 0, height / h, origin[0], origin[1]],
            "dimension_match": abs(width - w) < 1 and abs(height - h) < 1,
        }
        if images[name]["dimension_match"] and selected is None:
            selected = name
    return {
        "images": images,
        "selected_image": selected,
        "status": "candidate_dimension_match" if selected else "needs_alignment_confirmation",
        "verified": False,
        "reason": "Matching dimensions do not verify pixel/vector registration. Confirm an overlay transform before scoring PNG boundaries.",
    }


def compare(prediction: Proposal, reference: Proposal, confirmed_meters_per_unit=None):
    if confirmed_meters_per_unit is not None and (
        type(confirmed_meters_per_unit) not in {int, float}
        or not math.isfinite(confirmed_meters_per_unit)
        or confirmed_meters_per_unit <= 0
    ):
        raise ValueError("Physical metrics require a finite positive confirmed scale")
    if (
        prediction.coordinate_frame.width != reference.coordinate_frame.width
        or prediction.coordinate_frame.height != reference.coordinate_frame.height
        or prediction.coordinate_frame.origin != reference.coordinate_frame.origin
    ):
        raise ValueError(
            "Comparison needs matching coordinate frames or an explicitly applied alignment"
        )
    result = {
        "unit": "m" if confirmed_meters_per_unit else "source",
        "components": {},
        "component_matching": "greedy one-to-one footprint IoU >= 0.05; exploratory threshold",
    }
    scale = confirmed_meters_per_unit or 1
    for kind in ("wall", "room", "door", "window", "column"):
        predicted = [Polygon(c.polygon) for c in prediction.components if c.type == kind]
        actual = [Polygon(c.polygon) for c in reference.components if c.type == kind]
        p, r = unary_union(predicted), unary_union(actual)
        union = p.union(r).area
        matches = sorted(
            [
                (a.intersection(b).area / a.union(b).area, i, j)
                for i, a in enumerate(predicted)
                for j, b in enumerate(actual)
                if a.intersection(b).area > 0
            ],
            reverse=True,
        )
        used_predicted, used_actual = set(), set()
        for score, i, j in matches:
            if score >= 0.05 and i not in used_predicted and j not in used_actual:
                used_predicted.add(i)
                used_actual.add(j)
        result["components"][kind] = {
            "predicted_count": len(predicted),
            "reference_count": len(actual),
            "missing_count": len(actual) - len(used_actual),
            "extra_count": len(predicted) - len(used_predicted),
            "matched_count": len(used_predicted),
            "count_deficit": max(0, len(actual) - len(predicted)),
            "count_excess": max(0, len(predicted) - len(actual)),
            "iou": p.intersection(r).area / union if union else None,
            "boundary_hausdorff": p.boundary.hausdorff_distance(r.boundary) * scale
            if not p.is_empty and not r.is_empty
            else None,
        }
    recognized = Counter(d.text for d in prediction.dimensions if d.visible)
    actual = Counter(d.text for d in reference.dimensions if d.visible)
    result["dimension_readings"] = {
        "matched_count": sum((recognized & actual).values()),
        "missing_count": sum((actual - recognized).values()),
        "extra_count": sum((recognized - actual).values()),
    }
    return result


def evaluate(root, manifest, predictions=None, confirmations=None):
    if manifest["version"] != "cubicasa-evaluation.v1":
        raise ValueError("Unsupported evaluation manifest version")
    split = manifest["split"]
    if split not in {"val", "test"}:
        raise ValueError("Evaluation must use the validation or test split")
    data = (root / (split + ".txt")).read_bytes()
    if hashlib.sha256(data).hexdigest() != manifest["split_hash"]:
        raise ValueError("Dataset split changed since manifest creation")
    allowed = {
        str(safe_sample(root, line).relative_to(root.resolve()))
        for line in data.decode().splitlines()
        if line.strip()
    }
    samples = manifest["samples"]
    if (
        not 1 <= len(samples) <= 100
        or len(samples) != len(set(samples))
        or any(s not in allowed for s in samples)
    ):
        raise ValueError("Manifest contains duplicate samples or samples outside recorded split")
    reports = []
    for index, entry in enumerate(samples):
        sample = safe_sample(root, entry)
        start = time.monotonic()
        record = {
            "sample": entry,
            "geometry_metrics": None,
            "correction_count": None,
            "missing_data_questions": None,
            "api_latency_seconds": None,
            "reported_token_usage": None,
        }
        try:
            source = safe_artifact(sample, "model.svg").read_bytes()
            record["svg_hash"] = hashlib.sha256(source).hexdigest()
            reference = extract_svg(source, f"reference-{index}", record["svg_hash"])
            record.update(
                status="extracted",
                components=dict(Counter(c.type for c in reference.components)),
                alignment=alignment(sample, reference.coordinate_frame.model_dump(mode="json")),
                visible_text_count=sum(d.visible for d in reference.dimensions),
                hidden_text_count=sum(not d.visible for d in reference.dimensions),
                scale_confirmed=False,
            )
            if predictions is not None:
                path = predictions / f"{index:02d}.json"
                if not path.exists():
                    record.update(status="missing_prediction")
                else:
                    if path.stat().st_size > 2 * 1024 * 1024:
                        raise ValueError("Prediction fixture exceeds 2 MiB limit")
                    payload = json.loads(path.read_bytes())
                    if not isinstance(payload, dict):
                        raise ValueError("Prediction fixture must be a JSON object")
                    proposal = Proposal.model_validate(payload["proposal"])
                    if proposal.source_kind != "png" or payload["sample"] != entry:
                        raise ValueError("Prediction fixture must identify this sample's PNG path")
                    image_name = payload["image"]
                    if image_name not in ("F1_scaled.png", "F1_original.png"):
                        raise ValueError("Unexpected PNG source")
                    image_info = record["alignment"]["images"][image_name]
                    if proposal.source_hash != image_info["source_hash"]:
                        raise ValueError("Prediction hash does not match selected source image")
                    f = proposal.coordinate_frame
                    if (
                        f.width != image_info["width"]
                        or f.height != image_info["height"]
                        or f.unit != "pixel"
                        or f.origin != (0, 0)
                    ):
                        raise ValueError(
                            "Prediction coordinate frame does not match selected original PNG"
                        )
                    confirmation = (confirmations or {}).get(entry)
                    if (
                        not confirmation
                        or confirmation.get("source_hash") != proposal.source_hash
                        or confirmation.get("confirmed") is not True
                    ):
                        record.update(status="needs_alignment_confirmation")
                    else:
                        from app.extraction.svg import point

                        t = confirmation["image_to_svg_transform"]
                        if (
                            len(t) != 6
                            or any(type(v) not in {int, float} or not math.isfinite(v) for v in t)
                            or abs(t[0] * t[3] - t[1] * t[2]) < 1e-12
                        ):
                            raise ValueError("Alignment transform needs six affine coefficients")
                        for c in proposal.components:
                            c.polygon = [point(x, y, t) for x, y in c.polygon]
                            type(c).model_validate(c.model_dump())
                        for d in proposal.dimensions:
                            d.position = point(*d.position, t)
                            if d.reference:
                                d.reference = tuple(point(x, y, t) for x, y in d.reference)
                            type(d).model_validate(d.model_dump())
                        proposal.coordinate_frame = reference.coordinate_frame
                        record.update(
                            status="scored",
                            geometry_metrics=compare(
                                proposal, reference, confirmation.get("meters_per_unit")
                            ),
                            scale_confirmed=confirmation.get("meters_per_unit") is not None,
                            correction_count=payload.get("correction_count"),
                            missing_data_questions=payload.get("missing_data_questions"),
                            api_latency_seconds=payload.get("api_latency_seconds"),
                            reported_token_usage=payload.get("reported_token_usage"),
                        )
        except (ValueError, KeyError, OSError, TypeError, RecursionError) as e:
            record.update(status="invalid_output", error=str(e))
        record["local_elapsed_seconds"] = time.monotonic() - start
        reports.append(record)
    return {
        "version": "cubicasa-evaluation.v1",
        "manifest": manifest,
        "mode": "offline_png_evaluation" if predictions else "vector_extraction_smoke",
        "real_inference_performed": False,
        "samples": reports,
        "invalid_output_rate": sum(r["status"] == "invalid_output" for r in reports) / len(reports),
        "scored_count": sum(r["status"] == "scored" for r in reports),
        "notes": [
            "Vector extraction smoke is not a PNG quality benchmark.",
            "No physical geometry error is reported without confirmed scale.",
            "Image alignment requires an explicit confirmed transform; dimensions alone are insufficient.",
            "PNG predictions must be generated with paired SVG withheld from the predictor.",
        ],
    }


def write_result(path, root, value):
    path = path.resolve()
    if path.is_relative_to(root.resolve()):
        raise ValueError("Evaluation output must stay outside the original dataset")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def main():
    default_root = Path(__file__).resolve().parents[2] / "cubicasa5k"
    if not default_root.exists():
        default_root = Path.home() / "Downloads" / "cubicasa5k"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=default_root)
    commands = parser.add_subparsers(dest="command", required=True)
    manifest = commands.add_parser("manifest")
    manifest.add_argument("--split", choices=["val", "test"], required=True)
    manifest.add_argument("--count", type=int, default=10)
    manifest.add_argument("--seed", type=int, default=42)
    manifest.add_argument("--output", type=Path, required=True)
    evaluate_cmd = commands.add_parser("evaluate")
    evaluate_cmd.add_argument("--manifest", type=Path, required=True)
    evaluate_cmd.add_argument("--predictions", type=Path)
    evaluate_cmd.add_argument("--alignment-confirmations", type=Path)
    evaluate_cmd.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    if args.command == "manifest":
        value = create_manifest(root, args.split, args.count, args.seed)
    else:
        confirmations = (
            json.loads(args.alignment_confirmations.read_text())
            if args.alignment_confirmations
            else None
        )
        value = evaluate(
            root, json.loads(args.manifest.read_text()), args.predictions, confirmations
        )
    write_result(args.output, root, value)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "samples": len(value["samples"]),
                "invalid_output_rate": value.get("invalid_output_rate"),
            }
        )
    )


if __name__ == "__main__":
    main()
