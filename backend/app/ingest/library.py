"""Files in DATA_DIR/library: hashing, registering books, and scanning for new PDFs."""

import hashlib
import logging
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.config import get_settings
from app.ingest.extract import PdfError, read_info
from app.ingest.jobs import enqueue
from app.models import Book, BookStatus

log = logging.getLogger("uvicorn.error")

# A dropped file must sit unchanged this long before we pick it up (it may still be copying).
SETTLE_SECONDS = 3.0
_CHUNK = 1 << 20

# (path, size, mtime) of files we've hashed and found to duplicate a book, so each
# library scan doesn't re-hash them.
_known_duplicates: set[tuple[str, int, float]] = set()


@dataclass
class ScanResult:
    added: int = 0
    duplicates: int = 0


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def save_stream(src: BinaryIO, dest: Path) -> tuple[str, int]:
    """Copy `src` to `dest`, returning (sha256, size)."""
    h = hashlib.sha256()
    size = 0
    with dest.open("wb") as out:
        while chunk := src.read(_CHUNK):
            h.update(chunk)
            out.write(chunk)
            size += len(chunk)
    return h.hexdigest(), size


def library_path(book: Book) -> Path:
    return get_settings().library_dir / book.file_path


def safe_filename(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"[^\w\s.,()'&+-]", "", stem).strip(" .") or "book"
    return f"{stem[:150]}.pdf"


def unique_path(path: Path) -> Path:
    candidate, n = path, 2
    while candidate.exists():
        candidate = path.with_name(f"{path.stem} ({n}){path.suffix}")
        n += 1
    return candidate


def title_from_filename(path: Path) -> str:
    return re.sub(r"[_\s]+", " ", path.stem).strip() or path.name


def find_by_hash(session: Session, file_hash: str) -> Book | None:
    return session.exec(select(Book).where(Book.file_hash == file_hash)).first()


def book_from_pdf(pdf: Path, dest: Path, file_hash: str, size: int) -> Book:
    """Build a Book whose file will live at `dest` (inside the library dir).

    Metadata is read from `pdf`, which is `dest` itself for dropped-in files and
    a temp file for uploads. Raises PdfError if it can't be opened as a PDF.
    """
    info = read_info(pdf)
    return Book(
        title=info.title or title_from_filename(dest),
        author=info.author,
        file_path=dest.relative_to(get_settings().library_dir).as_posix(),
        file_hash=file_hash,
        file_size=size,
        page_count=info.page_count,
    )


def add_book(session: Session, book: Book) -> Book:
    """Insert a book and queue its ingestion. The caller commits."""
    session.add(book)
    session.flush()
    enqueue(session, "ingest", book_id=book.id)
    return book


def scan_library(session: Session) -> ScanResult:
    """Register PDFs dropped into the library folder that aren't books yet."""
    root = get_settings().library_dir
    known = set(session.exec(select(Book.file_path)).all())
    result = ScanResult()
    now = time.time()
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if path.suffix.lower() != ".pdf" or not path.is_file():
            continue
        if rel.as_posix() in known:
            continue
        stat = path.stat()
        if now - stat.st_mtime < SETTLE_SECONDS:
            continue
        marker = (rel.as_posix(), stat.st_size, stat.st_mtime)
        if marker in _known_duplicates:
            continue

        file_hash = sha256_file(path)
        if find_by_hash(session, file_hash):
            _known_duplicates.add(marker)
            result.duplicates += 1
            log.info("library scan: %s duplicates a book already in the library", rel)
            continue
        try:
            book = book_from_pdf(path, path, file_hash, stat.st_size)
        except PdfError as e:
            # Keep it visible in the library instead of silently skipping it.
            book = Book(
                title=title_from_filename(path),
                file_path=rel.as_posix(),
                file_hash=file_hash,
                file_size=stat.st_size,
                status=BookStatus.failed,
                error=str(e),
            )
            session.add(book)
        else:
            add_book(session, book)
        try:
            session.commit()
        except IntegrityError:
            # Registered concurrently (an upload or another scan got there first).
            session.rollback()
            continue
        result.added += 1
        log.info("library scan: added %s", rel)
    return result


def move_to_trash(path: Path) -> Path | None:
    """Move a book's file to DATA_DIR/trash, so removing a book is recoverable."""
    if not path.exists():
        return None
    trash = get_settings().data_dir / "trash"
    trash.mkdir(parents=True, exist_ok=True)
    dest = unique_path(trash / path.name)
    shutil.move(path, dest)
    return dest
