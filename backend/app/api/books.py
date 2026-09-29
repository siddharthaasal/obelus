import shutil
from datetime import datetime
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import field_validator
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field, SQLModel, select, update

from app.ai.context import delete_remote_caches
from app.api.deps import get_book_or_404
from app.config import get_settings
from app.db import SessionDep
from app.ingest.extract import PdfError, render_page_png
from app.ingest.jobs import enqueue
from app.ingest.library import (
    add_book,
    book_from_pdf,
    find_by_hash,
    library_path,
    move_to_trash,
    safe_filename,
    save_stream,
    unique_path,
)
from app.ingest.worker import worker
from app.models import Book, BookStatus, GeminiCache, Page

router = APIRouter(prefix="/books", tags=["books"])


class BookOut(SQLModel):
    id: int
    title: str
    author: str | None
    file_name: str
    file_size: int
    page_count: int | None
    status: BookStatus
    error: str | None
    needs_ocr_pages: int
    last_read_page: int | None
    created_at: datetime
    updated_at: datetime
    ingested_at: datetime | None

    @classmethod
    def of(cls, book: Book) -> "BookOut":
        return cls.model_validate(book, update={"file_name": Path(book.file_path).name})


class UploadOut(SQLModel):
    book: BookOut
    duplicate: bool


class BookUpdate(SQLModel):
    title: str | None = None
    author: str | None = None

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("title can't be blank")
        return v.strip() if v else v


class PositionIn(SQLModel):
    page: int = Field(ge=1)


class PageOut(SQLModel):
    page_number: int
    label: str | None
    raw_text: str
    clean_text: str
    footnotes: str
    removed_lines: list[dict]
    needs_ocr: bool
    is_ocr: bool


@router.get("")
def list_books(session: SessionDep) -> list[BookOut]:
    books = session.exec(select(Book).order_by(Book.created_at.desc(), Book.id.desc())).all()
    return [BookOut.of(b) for b in books]


@router.post("", status_code=status.HTTP_201_CREATED)
def upload_book(file: UploadFile, session: SessionDep, response: Response) -> UploadOut:
    """Add a PDF to the library. Uploading a file that's already there returns that book."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only PDF files can be added")
    settings = get_settings()
    settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp = settings.tmp_dir / f"upload-{uuid4().hex}.pdf"
    try:
        file_hash, size = save_stream(file.file, tmp)
        if existing := find_by_hash(session, file_hash):
            response.status_code = status.HTTP_200_OK
            return UploadOut(book=BookOut.of(existing), duplicate=True)

        dest = unique_path(settings.library_dir / safe_filename(file.filename))
        try:
            book = book_from_pdf(tmp, dest, file_hash, size)
        except PdfError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
        add_book(session, book)
        # Move before committing: if the commit fails the file is still in the
        # library, and the next scan registers it.
        shutil.move(tmp, dest)
        try:
            session.commit()
        except IntegrityError:
            # The same file was added concurrently.
            session.rollback()
            dest.unlink(missing_ok=True)
            if existing := find_by_hash(session, file_hash):
                response.status_code = status.HTTP_200_OK
                return UploadOut(book=BookOut.of(existing), duplicate=True)
            raise
    finally:
        tmp.unlink(missing_ok=True)

    session.refresh(book)
    worker.notify()
    return UploadOut(book=BookOut.of(book), duplicate=False)


@router.get("/{book_id}")
def get_book(book_id: int, session: SessionDep) -> BookOut:
    return BookOut.of(get_book_or_404(session, book_id))


@router.patch("/{book_id}")
def update_book(book_id: int, changes: BookUpdate, session: SessionDep) -> BookOut:
    book = get_book_or_404(session, book_id)
    for key, value in changes.model_dump(exclude_unset=True).items():
        setattr(book, key, value or None if key == "author" else value)
    session.commit()
    session.refresh(book)
    return BookOut.of(book)


@router.put("/{book_id}/position", status_code=status.HTTP_204_NO_CONTENT)
def save_position(book_id: int, position: PositionIn, session: SessionDep) -> None:
    """Remember the page the reader is on, so the book reopens there."""
    book = get_book_or_404(session, book_id)
    if book.page_count is not None and position.page > book.page_count:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"The book has {book.page_count} pages"
        )
    # Reading isn't editing: pass updated_at through so onupdate leaves it alone.
    session.exec(
        update(Book)
        .where(Book.id == book_id)
        .values(last_read_page=position.page, updated_at=Book.updated_at)
    )
    session.commit()


@router.delete("/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: int, session: SessionDep, background: BackgroundTasks) -> None:
    """Remove a book. Its PDF moves to DATA_DIR/trash rather than being deleted."""
    book = get_book_or_404(session, book_id)
    path = library_path(book)
    caches = session.exec(select(GeminiCache.cache_name).where(GeminiCache.book_id == book_id))
    cache_names = list(caches.all())
    session.delete(book)
    session.flush()
    trashed = move_to_trash(path)
    try:
        session.commit()
    except Exception:
        if trashed:
            shutil.move(trashed, path)
        raise
    # Stop paying to store the book's Gemini caches instead of waiting for them to expire.
    if cache_names:
        background.add_task(delete_remote_caches, cache_names)


@router.post("/{book_id}/reprocess", status_code=status.HTTP_202_ACCEPTED)
def reprocess_book(book_id: int, session: SessionDep) -> BookOut:
    """Re-run extraction and cleanup, e.g. after changing cleanup rules."""
    book = get_book_or_404(session, book_id)
    enqueue(session, "ingest", book_id=book.id)
    if book.status in (BookStatus.ready, BookStatus.failed):
        book.status = BookStatus.queued
        book.error = None
    session.commit()
    session.refresh(book)
    worker.notify()
    return BookOut.of(book)


@router.get("/{book_id}/file")
def book_file(book_id: int, session: SessionDep) -> FileResponse:
    book = get_book_or_404(session, book_id)
    path = library_path(book)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The PDF is missing from the library")
    return FileResponse(
        path, media_type="application/pdf", filename=path.name, content_disposition_type="inline"
    )


@router.get("/{book_id}/pages/{page_number}")
def get_page(book_id: int, page_number: int, session: SessionDep) -> PageOut:
    get_book_or_404(session, book_id)
    # Explicit columns: skip the tsvectors.
    row = session.exec(
        select(
            Page.page_number,
            Page.label,
            Page.raw_text,
            Page.clean_text,
            Page.footnotes,
            Page.removed_lines,
            Page.needs_ocr,
            Page.is_ocr,
        ).where(Page.book_id == book_id, Page.page_number == page_number)
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Page not extracted")
    return PageOut.model_validate(row._asdict())


@router.get("/{book_id}/pages/{page_number}/image")
def page_image(
    book_id: int,
    page_number: int,
    session: SessionDep,
    dpi: Annotated[int, Query(ge=36, le=300)] = 110,
) -> Response:
    path = library_path(get_book_or_404(session, book_id))
    try:
        png = render_page_png(path, page_number, dpi)
    except (IndexError, PdfError) as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Page not available") from e
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})
