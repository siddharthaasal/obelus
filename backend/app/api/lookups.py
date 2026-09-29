from datetime import datetime

from fastapi import APIRouter, HTTPException, Response, status
from sqlmodel import Field, SQLModel, select

from app.ai.gemini import GeminiError
from app.ai.lookups import (
    LookupInputError,
    LookupRequest,
    PageMissing,
    run_lookup,
)
from app.api.deps import get_book_or_404, require_ready
from app.db import SessionDep
from app.models import Lookup, LookupKind

router = APIRouter(prefix="/books/{book_id}/lookups", tags=["lookups"])


class LookupIn(SQLModel):
    kind: LookupKind
    page: int = Field(ge=1)
    # What the reader selected, as PDF.js's text layer has it. The real limits depend on the
    # action and are checked after anchoring, with a message a reader can act on; this bound
    # only keeps absurd requests out.
    text: str = Field(min_length=1, max_length=100_000)
    # A little of the text layer before and after the selection, to anchor it.
    before: str = Field(default="", max_length=500)
    after: str = Field(default="", max_length=500)
    # Ask the model again even if this lookup was answered before.
    refresh: bool = False


class LookupOut(SQLModel):
    id: int
    book_id: int
    page_number: int
    kind: LookupKind
    query_text: str
    context_text: str
    char_start: int | None
    char_end: int | None
    response: dict
    model: str
    context_mode: str
    usage: dict
    created_at: datetime


@router.get("")
def list_lookups(book_id: int, session: SessionDep) -> list[LookupOut]:
    """A book's lookups, newest first."""
    get_book_or_404(session, book_id)
    rows = session.exec(
        select(Lookup)
        .where(Lookup.book_id == book_id)
        .order_by(Lookup.created_at.desc(), Lookup.id.desc())
    ).all()
    return [LookupOut.model_validate(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_lookup(
    book_id: int, body: LookupIn, session: SessionDep, response: Response
) -> LookupOut:
    """Define a term, say who a name is, or explain a passage. A lookup asked before in this
    book comes back from the lookups table (200) unless `refresh` is set."""
    book = get_book_or_404(session, book_id)
    require_ready(book)
    try:
        lookup, reused = run_lookup(session, book, LookupRequest(**body.model_dump()))
    except PageMissing as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except LookupInputError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    except GeminiError as e:
        raise HTTPException(e.http_status, e.message) from e
    if reused:
        response.status_code = status.HTTP_200_OK
    return LookupOut.model_validate(lookup)


@router.delete("/{lookup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lookup(book_id: int, lookup_id: int, session: SessionDep) -> None:
    lookup = session.get(Lookup, lookup_id)
    if lookup is None or lookup.book_id != book_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lookup not found")
    session.delete(lookup)
    session.commit()
