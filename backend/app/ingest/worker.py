"""Background worker: an asyncio loop inside the FastAPI process.

It polls the jobs table, runs one job at a time in a thread (PyMuPDF is
blocking), and periodically scans DATA_DIR/library for dropped-in PDFs.
There's one app process, so there's one worker.
"""

import asyncio
import logging
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass

from sqlmodel import Session

from app.config import get_settings
from app.db import engine
from app.ingest import jobs, pipeline
from app.ingest.library import scan_library
from app.models import Job

log = logging.getLogger("uvicorn.error")

POLL_SECONDS = 2.0


@dataclass(frozen=True)
class Handler:
    run: Callable[[Job], None]
    on_failure: Callable[[Job, str, bool], None] | None = None


HANDLERS: dict[str, Handler] = {
    "ingest": Handler(pipeline.run_ingest, pipeline.on_ingest_failed),
}


def process_next_job() -> bool:
    """Claim and run one job. Returns False when nothing was ready to run."""
    with Session(engine) as session:
        job = jobs.claim_next(session)
        if job is None:
            return False
        session.expunge(job)

    handler = HANDLERS.get(job.kind)
    try:
        if handler is None:
            raise jobs.PermanentError(f"Unknown job kind: {job.kind}")
        handler.run(job)
    except Exception as e:
        error = str(e) or type(e).__name__
        permanent = isinstance(e, jobs.PermanentError)
        retry = not permanent and job.attempts < job.max_attempts
        if permanent:
            log.warning("job %s (%s) failed: %s", job.id, job.kind, error)
        else:
            log.exception("job %s (%s) failed (retry: %s)", job.id, job.kind, retry)
        with Session(engine) as session:
            jobs.mark_failed(session, job.id, error, retry)
        if handler and handler.on_failure:
            handler.on_failure(job, error, retry)
    else:
        with Session(engine) as session:
            jobs.mark_done(session, job.id)
    return True


def run_scan() -> None:
    with Session(engine) as session:
        scan_library(session)


def recover_interrupted() -> int:
    with Session(engine) as session:
        return jobs.recover_interrupted(session)


class Worker:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._wake: asyncio.Event | None = None
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run(), name="obelus-worker")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
        self._task = None

    def notify(self) -> None:
        """Wake the worker now instead of at the next poll. Safe from any thread."""
        if self._loop and self._wake and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._wake.set)

    async def _run(self) -> None:
        assert self._loop and self._wake
        scan_every = get_settings().library_scan_seconds
        try:
            if n := await asyncio.to_thread(recover_interrupted):
                log.info("worker: requeued %d interrupted job(s)", n)
        except Exception:
            log.exception("worker: could not recover interrupted jobs")

        next_scan = 0.0
        while True:
            self._wake.clear()
            busy = False
            try:
                if scan_every > 0 and self._loop.time() >= next_scan:
                    next_scan = self._loop.time() + scan_every
                    await asyncio.to_thread(run_scan)
                busy = await asyncio.to_thread(process_next_job)
            except Exception:
                log.exception("worker loop error")
            if not busy:
                with suppress(TimeoutError):
                    await asyncio.wait_for(self._wake.wait(), timeout=POLL_SECONDS)


worker = Worker()
