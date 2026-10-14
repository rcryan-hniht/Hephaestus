"""Local browser-test API. MockTransport never sends drawings or keys to OpenRouter."""

import argparse
import json
import sys
import tempfile
from pathlib import Path

import httpx
import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings
from app.extraction.inference import OpenRouter
from app.main import create_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--mock-ai", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="hephaestus-browser-") as data_dir:
        settings = Settings(
            data_dir=Path(data_dir),
            api_key="fixture-only" if args.mock_ai else None,
            inference_engine="openrouter",
        )

        def handler(request):
            if request.url.path.endswith("/models"):
                return httpx.Response(
                    200,
                    json={
                        "data": [
                            {"id": settings.model, "architecture": {"input_modalities": ["image"]}}
                        ]
                    },
                )
            assert request.url.path.endswith("/chat/completions")
            payload = json.loads(request.content)
            instruction = json.loads(payload["messages"][1]["content"][0]["text"])
            proposal = {
                key: instruction[key]
                for key in ("job_id", "source_hash", "source_kind", "coordinate_frame")
            }
            proposal["components"] = [
                {
                    "id": "wall",
                    "type": "wall",
                    "polygon": [[1, 1], [19, 1], [19, 3], [1, 3]],
                    "uncertainty": "Mock browser fixture, not an AI prediction.",
                }
            ]
            return httpx.Response(
                200,
                json={
                    "id": "browser-fixture",
                    "model": settings.model,
                    "provider": "mocktransport",
                    "choices": [
                        {"finish_reason": "stop", "message": {"content": json.dumps(proposal)}}
                    ],
                },
            )

        mock = OpenRouter(settings, httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        uvicorn.run(
            create_app(settings, inference=mock if args.mock_ai else None),
            host="127.0.0.1",
            port=args.port,
            log_level="warning",
        )


if __name__ == "__main__":
    main()
