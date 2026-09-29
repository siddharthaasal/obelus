from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    gemini_api_key: str = ""
    database_url: str = "postgresql+psycopg://obelus:obelus@127.0.0.1:5433/obelus"
    data_dir: Path = Path("~/ObelusData")
    app_host: str = "127.0.0.1"
    app_port: int = 8420

    model_fast: str = ""
    model_deep: str = ""
    embed_model: str = ""
    embed_dim: int = 768
    cache_ttl_minutes: int = 60

    @field_validator("data_dir", mode="after")
    @classmethod
    def _expand_data_dir(cls, v: Path) -> Path:
        return v.expanduser().resolve()

    @property
    def library_dir(self) -> Path:
        return self.data_dir / "library"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"


@lru_cache
def get_settings() -> Settings:
    return Settings()
