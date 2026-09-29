from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from app.models.base import created_at_field, optional_timestamp_field, updated_at_field


class BookStatus(StrEnum):
    queued = "queued"
    extracting = "extracting"
    embedding = "embedding"
    ready = "ready"
    failed = "failed"


class Book(SQLModel, table=True):
    __tablename__ = "books"

    id: int | None = Field(default=None, primary_key=True)
    title: str
    author: str | None = None
    # Relative to DATA_DIR/library, so the data directory can move.
    file_path: str = Field(unique=True)
    file_hash: str = Field(unique=True, max_length=64)
    file_size: int = Field(sa_type=sa.BigInteger)
    page_count: int | None = None
    status: BookStatus = Field(default=BookStatus.queued, sa_type=sa.String(20))
    error: str | None = Field(default=None, sa_type=sa.Text)
    needs_ocr_pages: int = 0
    last_read_page: int | None = None
    created_at: datetime = created_at_field()
    updated_at: datetime = updated_at_field()
    ingested_at: datetime | None = optional_timestamp_field()
