"""Backend-only runtime configuration. Never expose credentials in API responses."""

import os
import stat
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path(__file__).resolve().parent / "data"
    api_key: str | None = None
    base_url: str = "https://openrouter.ai/api/v1"
    model: str = "qwen/qwen2.5-vl-72b-instruct"
    inference_engine: str = "cubicasa"
    max_upload_bytes: int = 10 * 1024 * 1024
    max_response_bytes: int = 2 * 1024 * 1024
    max_image_pixels: int = 20_000_000
    max_image_side: int = 1536
    request_timeout: float = 90
    job_timeout: float = 300
    max_attempts: int = 2
    max_tokens: int = 8192
    max_jobs: int = 1000
    max_pending_jobs: int = 16
    cors_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    )

    def __post_init__(self):
        if self.inference_engine not in {"cubicasa", "openrouter"}:
            raise ValueError("HEPHAESTUS_INFERENCE_ENGINE must be cubicasa or openrouter")

    @classmethod
    def from_env(cls):
        env = Path(__file__).resolve().parent.parent / ".env"
        if env.exists():
            if stat.S_IMODE(env.stat().st_mode) & 0o077:
                raise RuntimeError("Repository .env must be owner-readable only (chmod 600)")
            load_dotenv(env, override=False)
        base = os.environ.get("OPENROUTER_BASE_URL", cls.base_url).rstrip("/")
        if base != cls.base_url:
            raise RuntimeError("OPENROUTER_BASE_URL must be https://openrouter.ai/api/v1")
        return cls(
            data_dir=Path(os.environ.get("HEPHAESTUS_DATA_DIR", str(cls.data_dir))),
            api_key=os.environ.get("OPENROUTER_API_KEY"),
            base_url=base,
            inference_engine=os.environ.get("HEPHAESTUS_INFERENCE_ENGINE", "cubicasa"),
            cors_origins=tuple(
                filter(
                    None,
                    os.environ.get("HEPHAESTUS_CORS_ORIGINS", ",".join(cls.cors_origins)).split(
                        ","
                    ),
                )
            ),
        )
