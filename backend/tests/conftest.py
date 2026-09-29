"""Test setup: a separate database and a temp DATA_DIR, never your real library.

The environment is set before anything imports app.db, which builds its engine
from settings at import time.
"""

import os
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

_data_dir = Path(tempfile.mkdtemp(prefix="obelus-test-"))
os.environ["DATA_DIR"] = str(_data_dir)
os.environ["WORKER_ENABLED"] = "false"
os.environ["LIBRARY_SCAN_SECONDS"] = "0"

from app.config import Settings  # noqa: E402

_url = make_url(Settings().database_url)
if not _url.database.endswith("_test"):
    _url = _url.set(database=f"{_url.database}_test")
os.environ["DATABASE_URL"] = _url.render_as_string(hide_password=False)


def _ensure_test_database() -> None:
    admin = create_engine(_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": _url.database}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{_url.database}"'))
    admin.dispose()


_ensure_test_database()

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import engine  # noqa: E402
from app.ingest import library  # noqa: E402
from app.ingest.worker import process_next_job  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def app_client():
    # Entering the client runs the lifespan, which applies migrations.
    with TestClient(app) as client:
        yield client
    shutil.rmtree(_data_dir, ignore_errors=True)


@pytest.fixture
def client(app_client: TestClient) -> TestClient:
    """A client with an empty database and empty library folder."""
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE books, jobs RESTART IDENTITY CASCADE"))
    settings = get_settings()
    for d in (settings.library_dir, settings.tmp_dir, settings.data_dir / "trash"):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
    library._known_duplicates.clear()
    return app_client


@pytest.fixture
def run_jobs() -> Callable[[], int]:
    """Run queued jobs synchronously, as the worker would. Returns how many ran."""

    def run() -> int:
        n = 0
        while process_next_job():
            n += 1
        return n

    return run


@pytest.fixture
def library_dir() -> Path:
    return get_settings().library_dir
