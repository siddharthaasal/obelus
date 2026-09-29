import re
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import field_validator
from sqlmodel import Field, Session, SQLModel, select

from app.anchor import anchor
from app.api.deps import get_book_or_404
from app.db import SessionDep
from app.export import notes_markdown
from app.models import Highlight, HighlightColor, Page

router = APIRouter(prefix="/books/{book_id}", tags=["highlights"])

MAX_TEXT_CHARS = 20_000
MAX_NOTE_CHARS = 20_000
MAX_RECTS = 400
_LINE_HYPHEN = re.compile(r"(\w)[-­]\s*\n\s*(?=[a-z])")


class Rect(SQLModel):
    """A box on the page, as fractions of its width and height."""

    x: float = Field(ge=-0.01, le=1.01)
    y: float = Field(ge=-0.01, le=1.01)
    w: float = Field(gt=0, le=1.02)
    h: float = Field(gt=0, le=1.02)


class HighlightIn(SQLModel):
    page: int = Field(ge=1)
    # What the reader selected, as PDF.js's text layer has it, with a little of the text
    # layer either side to anchor it (as for lookups).
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    before: str = Field(default="", max_length=500)
    after: str = Field(default="", max_length=500)
    rects: list[Rect] = Field(min_length=1, max_length=MAX_RECTS)
    color: HighlightColor = HighlightColor.yellow
    note: str = Field(default="", max_length=MAX_NOTE_CHARS)


class HighlightUpdate(SQLModel):
    color: HighlightColor | None = None
    note: str | None = Field(default=None, max_length=MAX_NOTE_CHARS)

    @field_validator("note")
    @classmethod
    def _trim(cls, v: str | None) -> str | None:
        return v.strip() if v is not None else None


class HighlightOut(SQLModel):
    id: int
    book_id: int
    page_number: int
    selected_text: str
    char_start: int | None
    char_end: int | None
    rects: list[dict]
    color: HighlightColor
    note: str
    created_at: datetime
    updated_at: datetime


@router.get("/highlights")
def list_highlights(book_id: int, session: SessionDep) -> list[HighlightOut]:
    """A book's highlights in reading order."""
    get_book_or_404(session, book_id)
    rows = session.exec(
        select(Highlight)
        .where(Highlight.book_id == book_id)
        .order_by(
            Highlight.page_number,
            Highlight.char_start.asc().nulls_last(),
            Highlight.created_at,
            Highlight.id,
        )
    ).all()
    return [HighlightOut.model_validate(h) for h in rows]


@router.post("/highlights", status_code=status.HTTP_201_CREATED)
def create_highlight(book_id: int, body: HighlightIn, session: SessionDep) -> HighlightOut:
    book = get_book_or_404(session, book_id)
    if book.page_count is not None and body.page > book.page_count:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"The book has {book.page_count} pages"
        )
    text, start, end = _anchored(session, book_id, body)
    if not any(ch.isalnum() for ch in text):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The selection has no words in it"
        )
    rects = [c for r in body.rects if (c := _clamp(r))]
    if not rects:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The highlight is off the page")
    highlight = Highlight(
        book_id=book_id,
        page_number=body.page,
        selected_text=text,
        char_start=start,
        char_end=end,
        rects=rects,
        color=body.color,
        note=body.note.strip(),
    )
    session.add(highlight)
    session.commit()
    session.refresh(highlight)
    return HighlightOut.model_validate(highlight)


@router.patch("/highlights/{highlight_id}")
def update_highlight(
    book_id: int, highlight_id: int, changes: HighlightUpdate, session: SessionDep
) -> HighlightOut:
    """Change a highlight's colour or note. An empty note removes it."""
    highlight = _highlight_or_404(session, book_id, highlight_id)
    for key, value in changes.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(highlight, key, value)
    session.commit()
    session.refresh(highlight)
    return HighlightOut.model_validate(highlight)


@router.delete("/highlights/{highlight_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_highlight(book_id: int, highlight_id: int, session: SessionDep) -> None:
    session.delete(_highlight_or_404(session, book_id, highlight_id))
    session.commit()


@router.get(
    "/notes.md",
    response_class=Response,
    responses={200: {"content": {"text/markdown": {}}, "description": "The notes as Markdown"}},
)
def export_notes(book_id: int, session: SessionDep) -> Response:
    """The book's highlights, notes, and saved lookups as one Markdown file, in page order."""
    book = get_book_or_404(session, book_id)
    return Response(
        notes_markdown(session, book),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": _attachment(f"{book.title} - notes.md")},
    )


def _anchored(
    session: Session, book_id: int, body: HighlightIn
) -> tuple[str, int | None, int | None]:
    """The passage and its offsets in the clean text, found as for lookups. A selection in a
    footnote takes the footnote's wording, without offsets (they index the body text)."""
    page = session.exec(
        select(Page.clean_text, Page.footnotes).where(
            Page.book_id == book_id, Page.page_number == body.page
        )
    ).first()
    if page:
        for text, is_body in ((page.clean_text, True), (page.footnotes, False)):
            if text and (a := anchor(text, body.text, body.before, body.after)):
                start, end = _with_edges(text, a.start, a.end, body.text)
                passage = _tidy(text[start:end])
                return (passage, start, end) if is_body else (passage, None, None)
    return _tidy(_LINE_HYPHEN.sub(r"\1", body.text)), None, None


def _with_edges(text: str, start: int, end: int, selected: str) -> tuple[int, int]:
    """Take in punctuation the reader selected at either end (a closing full stop, an opening
    quote), which anchoring, matching letters and digits, leaves out."""
    selected = selected.strip()
    head = re.match(r"[^\w\s]*", selected).group()
    tail = re.search(r"[^\w\s]*$", selected).group()
    while start > 0 and head and text[start - 1] == head[-1]:
        start, head = start - 1, head[:-1]
    while end < len(text) and tail and text[end] == tail[0]:
        end, tail = end + 1, tail[1:]
    return start, end


def _tidy(text: str) -> str:
    """Paragraph breaks kept, other runs of whitespace made single spaces."""
    paragraphs = (" ".join(p.split()) for p in re.split(r"\n\s*\n", text))
    return "\n\n".join(p for p in paragraphs if p)


def _clamp(r: Rect) -> dict | None:
    """The part of a box that's on the page, or None if none of it is."""
    x, y = min(max(r.x, 0.0), 1.0), min(max(r.y, 0.0), 1.0)
    w, h = min(r.x + r.w, 1.0) - x, min(r.y + r.h, 1.0) - y
    if w <= 0 or h <= 0:
        return None
    return {"x": round(x, 5), "y": round(y, 5), "w": round(w, 5), "h": round(h, 5)}


def _highlight_or_404(session: Session, book_id: int, highlight_id: int) -> Highlight:
    highlight = session.get(Highlight, highlight_id)
    if highlight is None or highlight.book_id != book_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Highlight not found")
    return highlight


def _attachment(filename: str) -> str:
    """A download filename that survives any title: ASCII fallback, UTF-8 for the rest."""
    fallback = re.sub(r'[^\x20-\x7e]|["\\/]', "_", filename)
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
