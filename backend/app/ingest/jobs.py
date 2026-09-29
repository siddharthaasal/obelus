"""The jobs table: enqueue, claim, and finish background work."""

from datetime import timedelta

from sqlalchemy import func, update
from sqlmodel import Session, select

from app.models import Book, BookStatus, Job, JobStatus
from app.models.base import utcnow

RETRY_BASE_SECONDS = 5


class PermanentError(Exception):
    """A job failure that retrying won't fix (missing file, unreadable PDF)."""


def enqueue(session: Session, kind: str, book_id: int | None = None, payload=None) -> Job:
    """Queue a job unless an identical one is already waiting. The caller commits."""
    existing = session.exec(
        select(Job).where(Job.kind == kind, Job.book_id == book_id, Job.status == JobStatus.queued)
    ).first()
    if existing:
        return existing
    job = Job(kind=kind, book_id=book_id, payload=payload or {})
    session.add(job)
    session.flush()
    return job


def claim_next(session: Session) -> Job | None:
    job = session.exec(
        select(Job)
        .where(Job.status == JobStatus.queued, Job.run_after <= func.now())
        .order_by(Job.id)
        .with_for_update(skip_locked=True)
        .limit(1)
    ).first()
    if job is None:
        return None
    job.status = JobStatus.running
    job.attempts += 1
    job.started_at = utcnow()
    session.commit()
    session.refresh(job)
    return job


def mark_done(session: Session, job_id: int) -> None:
    if job := session.get(Job, job_id):
        job.status = JobStatus.done
        job.error = None
        job.finished_at = utcnow()
        session.commit()


def mark_failed(session: Session, job_id: int, error: str, retry: bool) -> None:
    job = session.get(Job, job_id)
    if job is None:  # deleted with its book while running
        return
    job.error = error
    if retry:
        job.status = JobStatus.queued
        job.run_after = utcnow() + timedelta(seconds=RETRY_BASE_SECONDS * 4 ** (job.attempts - 1))
    else:
        job.status = JobStatus.failed
        job.finished_at = utcnow()
    session.commit()


def recover_interrupted(session: Session) -> int:
    """Requeue jobs left running by a previous process (crash, restart, reload)."""
    result = session.exec(
        update(Job).where(Job.status == JobStatus.running).values(status=JobStatus.queued)
    )
    session.exec(
        update(Book)
        .where(Book.status.in_([BookStatus.extracting, BookStatus.embedding]))
        .values(status=BookStatus.queued)
    )
    session.commit()
    return result.rowcount
