"""The ingest job: extract a book's pages, clean them, and store them."""

import logging

from sqlalchemy import delete, insert
from sqlmodel import Session

from app.db import engine
from app.ingest.clean import clean_book
from app.ingest.extract import PdfError, extract_pages
from app.ingest.jobs import PermanentError
from app.ingest.library import library_path
from app.models import Book, BookStatus, Job, Page
from app.models.base import utcnow

log = logging.getLogger("uvicorn.error")

_INSERT_BATCH = 500


def run_ingest(job: Job) -> None:
    with Session(engine) as session:
        book = session.get(Book, job.book_id)
        if book is None:
            return  # removed while queued
        book.status = BookStatus.extracting
        book.error = None
        session.commit()
        path = library_path(book)
        title = book.title

    if not path.exists():
        raise PermanentError(f"File not found: {path}")
    try:
        pages = list(extract_pages(path))
    except PdfError as e:
        raise PermanentError(str(e)) from e
    cleaned = clean_book(pages)

    rows = [
        {
            "book_id": job.book_id,
            "page_number": p.number,
            "label": p.label,
            "raw_text": p.raw_text,
            "clean_text": c.clean_text,
            "footnotes": c.footnotes,
            "removed_lines": c.removed,
            "needs_ocr": c.needs_ocr,
            "is_ocr": False,
        }
        for p, c in zip(pages, cleaned, strict=True)
    ]
    with Session(engine) as session:
        book = session.get(Book, job.book_id)
        if book is None:
            return
        # Replace pages in one transaction, so a reprocess never leaves a half-written book.
        session.exec(delete(Page).where(Page.book_id == book.id))
        for i in range(0, len(rows), _INSERT_BATCH):
            session.exec(insert(Page).values(rows[i : i + _INSERT_BATCH]))
        book.page_count = len(pages)
        book.needs_ocr_pages = sum(c.needs_ocr for c in cleaned)
        book.status = BookStatus.ready
        book.ingested_at = utcnow()
        session.commit()
    log.info("ingested %r: %d pages", title, len(pages))


def on_ingest_failed(job: Job, error: str, will_retry: bool) -> None:
    with Session(engine) as session:
        book = session.get(Book, job.book_id)
        if book is None:
            return
        book.status = BookStatus.queued if will_retry else BookStatus.failed
        book.error = f"Retrying after error: {error}" if will_retry else error
        session.commit()
