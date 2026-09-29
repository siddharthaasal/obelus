"""SQLModel tables.

Import every table module here so `SQLModel.metadata` is complete when
Alembic autogenerates migrations.
"""

from app.models.book import Book, BookStatus
from app.models.gemini_cache import GeminiCache
from app.models.job import Job, JobStatus
from app.models.lookup import Lookup, LookupKind
from app.models.page import Page

__all__ = [
    "Book",
    "BookStatus",
    "GeminiCache",
    "Job",
    "JobStatus",
    "Lookup",
    "LookupKind",
    "Page",
]
