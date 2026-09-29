from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.base import created_at_field


class LookupKind(StrEnum):
    define = "define"
    who = "who"
    explain = "explain"


class Lookup(SQLModel, table=True):
    """A selection action's answer. Doubles as a cache: the same query in the same book is
    answered from here instead of asking the model again."""

    __tablename__ = "lookups"
    __table_args__ = (sa.UniqueConstraint("book_id", "kind", "query_key"),)

    id: int | None = Field(default=None, primary_key=True)
    book_id: int = Field(foreign_key="books.id", ondelete="CASCADE")
    page_number: int
    kind: LookupKind = Field(sa_type=sa.String(20))
    # The term, name, or passage, taken from the clean text when the selection was anchored.
    query_text: str = Field(sa_type=sa.Text)
    # sha256 of the kind and normalized query: the cache key (passages are too long to index).
    query_key: str = Field(max_length=64)
    context_text: str = Field(default="", sa_type=sa.Text)
    # Offsets of the selection in pages.clean_text, when anchoring found it.
    char_start: int | None = None
    char_end: int | None = None
    # The model's structured answer (app.ai.schemas).
    response: dict = Field(sa_column=sa.Column(JSONB, nullable=False))
    model: str
    # How the book reached the model: "cached", "inline", or "excerpt" (app.ai.context).
    context_mode: str = Field(max_length=20)
    # Token counts: {"input", "cached", "output", "thinking"}.
    usage: dict = Field(
        default_factory=dict,
        sa_column=sa.Column(JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    created_at: datetime = created_at_field()
