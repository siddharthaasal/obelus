from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.base import created_at_field, optional_timestamp_field, utcnow


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class Job(SQLModel, table=True):
    __tablename__ = "jobs"
    __table_args__ = (
        sa.Index("ix_jobs_queued", "run_after", postgresql_where=sa.text("status = 'queued'")),
    )

    id: int | None = Field(default=None, primary_key=True)
    kind: str = Field(max_length=40)
    book_id: int | None = Field(
        default=None, foreign_key="books.id", ondelete="CASCADE", index=True
    )
    status: JobStatus = Field(default=JobStatus.queued, sa_type=sa.String(20))
    attempts: int = 0
    max_attempts: int = 3
    payload: dict = Field(
        default_factory=dict,
        sa_column=sa.Column(JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    error: str | None = Field(default=None, sa_type=sa.Text)
    run_after: datetime = Field(
        default_factory=utcnow,
        sa_type=sa.DateTime(timezone=True),
        sa_column_kwargs={"server_default": sa.func.now()},
    )
    created_at: datetime = created_at_field()
    started_at: datetime | None = optional_timestamp_field()
    finished_at: datetime | None = optional_timestamp_field()
