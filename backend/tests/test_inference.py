import asyncio
import hashlib
import io
import json

import httpx
import pytest
from PIL import Image

from config import Settings
from inference import InferenceError, OpenRouter


def png():
    out = io.BytesIO()
    Image.new("RGB", (20, 10), "white").save(out, format="PNG")
    return out.getvalue()


def run(handler):
    data = png()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    settings = Settings(api_key="test-secret")
    return asyncio.run(
        OpenRouter(settings, client).extract(data, "j", hashlib.sha256(data).hexdigest())
    )


def valid_response():
    data = png()
    return {
        "schema_version": "hephaestus.scene.v1",
        "job_id": "j",
        "source_hash": hashlib.sha256(data).hexdigest(),
        "source_kind": "png",
        "coordinate_frame": {"width": 20, "height": 10, "unit": "pixel"},
        "components": [
            {"id": "wall-1", "type": "wall", "polygon": [[1, 1], [10, 1], [10, 3], [1, 3]]}
        ],
    }


def test_missing_exact_model_never_calls_inference():
    assert Settings().model == "qwen/qwen2.5-vl-72b-instruct"

    def handler(request):
        assert request.url.path == "/api/v1/models"
        return httpx.Response(200, json={"data": [{"id": "qwen/qwen-2.5-vl-7b-instruct"}]})

    with pytest.raises(InferenceError) as err:
        run(handler)
    assert err.value.code == "model_unavailable"


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "invalid_credentials"),
        (402, "insufficient_credit"),
        (429, "rate_limited"),
        (503, "provider_unavailable"),
    ],
)
def test_provider_errors_are_actionable_and_hide_credentials(status, code):
    def handler(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": Settings().model, "architecture": {"input_modalities": ["image"]}}
                    ]
                },
            )
        return httpx.Response(status, text="test-secret should never appear in error")

    with pytest.raises(InferenceError) as err:
        run(handler)
    assert err.value.code == code
    assert "test-secret" not in str(err.value)


def test_malformed_proposal_retries_are_retained_with_actual_provenance():
    count = 0

    def handler(request):
        nonlocal count
        if request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": Settings().model, "architecture": {"input_modalities": ["image"]}}
                    ]
                },
            )
        count += 1
        payload = json.loads(request.content)
        assert payload["model"] == Settings().model
        assert "test-secret" not in request.content.decode()
        return httpx.Response(
            200,
            json={
                "id": "resp",
                "model": Settings().model,
                "provider": "Fixture provider",
                "usage": {"prompt_tokens": 10, "completion_tokens": 20},
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": "bad json" if count == 1 else json.dumps(valid_response())
                        },
                    }
                ],
            },
        )

    result = run(handler)
    assert result.proposal.source_kind == "png"
    assert len(result.attempts) == 2
    assert result.attempts[0]["valid"] is False
    assert result.attempts[1]["usage"]["completion_tokens"] == 20
    assert result.attempts[1]["provider"] == "Fixture provider"
    assert result.attempts[1]["latency_seconds"] >= 0
    assert "gpu" not in result.attempts[1]


def test_invalid_source_binding_is_not_accepted():
    def handler(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": Settings().model, "architecture": {"input_modalities": ["image"]}}
                    ]
                },
            )
        p = valid_response()
        p["source_hash"] = "b" * 64
        return httpx.Response(
            200,
            json={
                "model": Settings().model,
                "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(p)}}],
            },
        )

    with pytest.raises(InferenceError) as err:
        run(handler)
    assert err.value.code == "invalid_ai_output"
    assert len(err.value.attempts) == 2


def test_printed_square_meters_do_not_reject_an_image_proposal():
    def handler(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": Settings().model, "architecture": {"input_modalities": ["image"]}}
                    ]
                },
            )
        p = valid_response()
        p["dimensions"] = [
            {
                "text": "35,0 m²",
                "position": [3, 2],
                "visible": True,
                "value": 35,
                "unit": "m²",
                "reference": [[1, 0], [10, 0]],
            }
        ]
        return httpx.Response(
            200,
            json={
                "model": Settings().model,
                "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(p)}}],
            },
        )

    result = run(handler)
    assert len(result.attempts) == 1
    assert result.attempts[0]["valid"] is True
    assert result.proposal.dimensions[0].unit == "m²"
    assert result.proposal.meters_per_unit is None


def test_null_source_annotations_preserve_image_geometry():
    def handler(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": Settings().model, "architecture": {"input_modalities": ["image"]}}
                    ]
                },
            )
        p = valid_response()
        p["components"][0]["source"] = None
        return httpx.Response(
            200,
            json={
                "model": Settings().model,
                "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(p)}}],
            },
        )

    result = run(handler)
    assert len(result.attempts) == 1
    assert result.proposal.components[0].polygon == [(1, 1), (10, 1), (10, 3), (1, 3)]
    assert result.proposal.components[0].source.element_id == "wall-1"
    assert result.proposal.components[0].source.text is None
