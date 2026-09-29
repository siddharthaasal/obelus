from datetime import datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from app.models.base import created_at_field


class GeminiCache(SQLModel, table=True):
    """A Gemini explicit cache holding a book's text, so an open book reuses it."""

    __tablename__ = "gemini_caches"
    __table_args__ = (sa.UniqueConstraint("book_id", "model"),)

    id: int | None = Field(default=None, primary_key=True)
    book_id: int = Field(foreign_key="books.id", ondelete="CASCADE")
    model: str
    # Gemini's resource name, "cachedContents/...".
    cache_name: str
    # Hash of what went into the cache (system prompt, book version). A mismatch means stale.
    fingerprint: str = Field(max_length=64)
    token_count: int | None = None
    expires_at: datetime = Field(sa_type=sa.DateTime(timezone=True))
    created_at: datetime = created_at_field()
