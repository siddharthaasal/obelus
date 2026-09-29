from datetime import datetime

from fastapi import APIRouter, HTTPException
from sqlmodel import SQLModel

from app.ai import context
from app.ai.gemini import NOT_CONFIGURED, GeminiError, require_gemini
from app.api.deps import get_book_or_404, require_ready
from app.config import get_settings
from app.db import SessionDep

router = APIRouter(tags=["ai"])


class AiStatus(SQLModel):
    configured: bool
    model_fast: str
    problem: str | None


class ContextOut(SQLModel):
    mode: context.Mode
    model: str
    expires_at: datetime | None
    token_count: int | None


@router.get("/ai")
def ai_status() -> AiStatus:
    settings = get_settings()
    configured = bool(settings.gemini_api_key)
    return AiStatus(
        configured=configured,
        model_fast=settings.model_fast,
        problem=None if configured else NOT_CONFIGURED,
    )


@router.post("/books/{book_id}/context")
def prepare_context(book_id: int, session: SessionDep) -> ContextOut:
    """Get the book ready for AI requests: create (or reuse) its Gemini cache. The reader
    calls this when a book opens, so the first lookup doesn't wait for it."""
    book = get_book_or_404(session, book_id)
    require_ready(book)
    model = get_settings().model_fast
    try:
        ctx = context.prepare(session, require_gemini(), book, model)
    except GeminiError as e:
        raise HTTPException(e.http_status, e.message) from e
    return ContextOut(
        mode=ctx.mode,
        model=model,
        expires_at=ctx.cache.expires_at if ctx.cache else None,
        token_count=ctx.cache.token_count if ctx.cache else None,
    )
