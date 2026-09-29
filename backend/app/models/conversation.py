from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.base import created_at_field, updated_at_field


class Role(StrEnum):
    user = "user"
    assistant = "assistant"


class MessageStatus(StrEnum):
    complete = "complete"
    # The reader stopped the answer partway; what was written so far is kept.
    stopped = "stopped"
    # The model ended early (its output limit, or a safety stop).
    truncated = "truncated"


class Conversation(SQLModel, table=True):
    """A chat about one book."""

    __tablename__ = "conversations"
    __table_args__ = (sa.Index("ix_conversations_book_updated", "book_id", "updated_at"),)

    id: int | None = Field(default=None, primary_key=True)
    book_id: int = Field(foreign_key="books.id", ondelete="CASCADE")
    # The first question, shortened.
    title: str = Field(default="", sa_type=sa.Text)
    created_at: datetime = created_at_field()
    # Bumped by each message, so the list shows recent chats first.
    updated_at: datetime = updated_at_field()


class Message(SQLModel, table=True):
    __tablename__ = "messages"

    id: int | None = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversations.id", ondelete="CASCADE", index=True)
    role: Role = Field(sa_type=sa.String(20))
    content: str = Field(sa_type=sa.Text)
    # Questions: the PDF page the reader was on, and its section in the table of contents
    # when the PDF has one, so "here" and "this chapter" keep their meaning later on.
    page_number: int | None = None
    section: str | None = Field(default=None, sa_type=sa.Text)
    # Answers: the pages they cite, in order of first mention: [{"book_id", "page", "end"?}].
    citations: list[dict] = Field(
        default_factory=list,
        sa_column=sa.Column(JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    status: MessageStatus = Field(default=MessageStatus.complete, sa_type=sa.String(20))
    model: str | None = None
    # How the book reached the model: "cached", "inline", or "excerpt" (app.ai.context).
    context_mode: str | None = Field(default=None, max_length=20)
    # Token counts: {"input", "cached", "output", "thinking"}; as far as they got, if stopped.
    usage: dict = Field(
        default_factory=dict,
        sa_column=sa.Column(JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    created_at: datetime = created_at_field()
