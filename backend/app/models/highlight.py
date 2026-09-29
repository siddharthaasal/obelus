from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.base import created_at_field, updated_at_field


class HighlightColor(StrEnum):
    yellow = "yellow"
    green = "green"
    blue = "blue"
    pink = "pink"


class Highlight(SQLModel, table=True):
    """A highlighted passage on a page, with an optional note."""

    __tablename__ = "highlights"
    __table_args__ = (sa.Index("ix_highlights_book_page", "book_id", "page_number"),)

    id: int | None = Field(default=None, primary_key=True)
    book_id: int = Field(foreign_key="books.id", ondelete="CASCADE")
    page_number: int
    # The passage as the clean text has it when the selection was found there, else as
    # selected. Paragraph breaks are kept; other whitespace is collapsed.
    selected_text: str = Field(sa_type=sa.Text)
    # Offsets of the passage in pages.clean_text, when anchoring found it: for ordering, and
    # for logic that needs the text rather than the picture.
    char_start: int | None = None
    char_end: int | None = None
    # Where to draw it: [{"x", "y", "w", "h"}] as fractions of the page's width and height,
    # so it lands in the same place at any zoom.
    rects: list[dict] = Field(sa_column=sa.Column(JSONB, nullable=False))
    color: HighlightColor = Field(default=HighlightColor.yellow, sa_type=sa.String(20))
    note: str = Field(default="", sa_type=sa.Text)
    created_at: datetime = created_at_field()
    updated_at: datetime = updated_at_field()
