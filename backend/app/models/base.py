from datetime import UTC, datetime

import sqlalchemy as sa
from sqlmodel import Field


def utcnow() -> datetime:
    return datetime.now(UTC)


def created_at_field():
    return Field(
        default_factory=utcnow,
        sa_type=sa.DateTime(timezone=True),
        sa_column_kwargs={"server_default": sa.func.now()},
    )


def updated_at_field():
    return Field(
        default_factory=utcnow,
        sa_type=sa.DateTime(timezone=True),
        sa_column_kwargs={"server_default": sa.func.now(), "onupdate": utcnow},
    )


def optional_timestamp_field():
    return Field(default=None, sa_type=sa.DateTime(timezone=True))
