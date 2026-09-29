from fastapi import HTTPException, status

from app.db import SessionDep
from app.models import Book, BookStatus


def get_book_or_404(session: SessionDep, book_id: int) -> Book:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Book not found")
    return book


def require_ready(book: Book) -> None:
    """AI features read a book's extracted text, so they wait until it's ready."""
    if book.status == BookStatus.failed:
        raise HTTPException(status.HTTP_409_CONFLICT, "This book failed to process")
    if book.status != BookStatus.ready:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This book is still being processed. Try again shortly."
        )
