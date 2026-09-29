from functools import lru_cache
from pathlib import Path

from pydantic import ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # A blank line in .env (MODEL_FAST=) means "use the default", not "empty string".
        env_ignore_empty=True,
    )

    gemini_api_key: str = ""
    database_url: str = "postgresql+psycopg://obelus:obelus@127.0.0.1:5433/obelus"
    data_dir: Path = Path("~/ObelusData")
    app_host: str = "127.0.0.1"
    app_port: int = 8420

    model_fast: str = "gemini-3.8-flash"
    model_deep: str = "gemini-3.1-pro-preview"
    embed_model: str = "gemini-embedding-001"
    embed_dim: int = 768
    cache_ttl_minutes: int = 60
    # Thinking level for lookups and for chat (low, medium, high), or "default" to leave it to
    # the model. Chat thinks harder by default: its answers are open-ended.
    lookup_thinking: str = "low"
    chat_thinking: str = "default"
    # Keep an open book in a Gemini explicit cache. The free tier doesn't offer it on every
    # model; off, the book goes with each request instead.
    context_caching: bool = True
    # Most tokens of book text sent with one request; longer books get excerpts around the
    # selection. Unset or 0: whatever fits the model's context window.
    max_book_tokens: int | None = None

    # Background ingestion. Tests turn the worker off and run jobs directly.
    worker_enabled: bool = True
    library_scan_seconds: float = 10.0

    @field_validator("data_dir", mode="after")
    @classmethod
    def _expand_data_dir(cls, v: Path) -> Path:
        return v.expanduser().resolve()

    @field_validator("lookup_thinking", "chat_thinking", mode="after")
    @classmethod
    def _check_thinking(cls, v: str, info: ValidationInfo) -> str:
        v = v.strip().lower()
        if v not in ("minimal", "low", "medium", "high", "default"):
            name = (info.field_name or "").upper()
            raise ValueError(f"{name} must be minimal, low, medium, high, or default")
        return v

    @property
    def library_dir(self) -> Path:
        return self.data_dir / "library"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"


@lru_cache
def get_settings() -> Settings:
    return Settings()
