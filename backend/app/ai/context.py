"""How a book's text reaches the model. Each request picks one of three modes:

- cached: a Gemini explicit cache holds the system prompt and the whole book, so a request
  sends only the question and the book is paid for in full once per session. The cache is
  made when a book is opened (or at its first lookup), extended while it's in use, and
  replaced when the book is reprocessed or the system prompt changes.
- inline: a book too small for a cache (Gemini has a minimum size), or any book with
  CONTEXT_CACHING off, goes whole with each request.
- excerpt: a book too long for the model's context window (or for MAX_BOOK_TOKENS) sends the
  pages around the reader's place and the pages that bear on the request: where a looked-up
  term appears, or what a chat question matches. Retrieval over embeddings replaces this later.
"""

import hashlib
import logging
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from sqlalchemy import func
from sqlmodel import Session, select

from app.ai.gemini import CacheMissing, Gemini, GeminiError, gemini_client
from app.ai.prompts import render
from app.config import get_settings
from app.models import Book, GeminiCache, Page
from app.models.base import utcnow

log = logging.getLogger("uvicorn.error")

Mode = Literal["cached", "inline", "excerpt"]

# Gemini's minimum cache size for current models, with a margin for the token estimate.
MIN_CACHE_TOKENS = 5_000
CHARS_PER_TOKEN = 4  # an estimate, only for choosing a mode; English prose runs about 4
HEADROOM_TOKENS = 64_000  # context window left for the question, thinking, and the answer
MIN_LEFT = timedelta(minutes=2)  # a cache closer than this to expiring is treated as gone
EXTEND_BELOW = 0.5  # extend a cache's TTL once less than this share of it is left
EXCERPT_NEIGHBOURS = 2  # pages either side of the selection
EXCERPT_MAX_PAGES = 40

# Caches Gemini refused to create (book, model, fingerprint), so each request doesn't retry.
_uncacheable: set[tuple[int, str, str]] = set()
_locks: dict[tuple[int, str], threading.Lock] = {}
_locks_guard = threading.Lock()


@dataclass
class BookContext:
    book_id: int
    model: str
    mode: Mode
    system: str
    cache: GeminiCache | None = None

    def contents(
        self, session: Session, focus_pages: Iterable[int], excerpts: str = "excerpts"
    ) -> list[str]:
        """What goes ahead of the question: nothing when the book is cached. `excerpts` names
        the prompt that introduces a long book's excerpts."""
        if self.mode == "inline":
            return [book_text(session, self.book_id)]
        if self.mode == "excerpt":
            return [excerpt_text(session, self.book_id, focus_pages, excerpts)]
        return []


def prepare(session: Session, gemini: Gemini, book: Book, model: str) -> BookContext:
    """Pick the mode for this book and model, creating or extending its cache as needed."""
    system = render("system", book=_book_name(book))
    tokens = _book_chars(session, book.id) // CHARS_PER_TOKEN
    context = BookContext(book_id=book.id, model=model, mode="inline", system=system)
    settings = get_settings()
    limit = gemini.input_token_limit(model) - HEADROOM_TOKENS
    if settings.max_book_tokens:
        limit = min(limit, settings.max_book_tokens)
    if tokens > limit:
        context.mode = "excerpt"
        return context
    if tokens < MIN_CACHE_TOKENS or not settings.context_caching:
        return context
    fingerprint = _fingerprint(book, model, system)
    if (book.id, model, fingerprint) in _uncacheable:
        return context
    with _lock(book.id, model):
        try:
            context.cache = _ensure_cache(session, gemini, book, model, system, fingerprint)
        except GeminiError as e:
            if e.code != 400:
                raise
            # Rejected rather than failed (too small by Gemini's count, or the model can't
            # cache). Sending the book with each request still works.
            log.warning(
                "gemini: can't cache book %s on %s, sending it inline: %s", book.id, model, e
            )
            _uncacheable.add((book.id, model, fingerprint))
            return context
    context.mode = "cached"
    return context


def forget(session: Session, cache: GeminiCache) -> None:
    """Drop a cache row whose Gemini cache has gone, so the next request makes a new one."""
    session.delete(cache)
    session.commit()


def delete_remote_caches(names: list[str]) -> None:
    """Best-effort cleanup of Gemini caches whose books are gone (they'd expire anyway)."""
    gemini = gemini_client()
    if gemini is None:
        return
    for name in names:
        try:
            gemini.delete_cache(name)
        except GeminiError as e:
            log.warning("gemini: couldn't delete cache %s: %s", name, e)


def book_text(session: Session, book_id: int) -> str:
    rows = session.exec(
        select(Page.page_number, Page.clean_text, Page.footnotes)
        .where(Page.book_id == book_id)
        .order_by(Page.page_number)
    ).all()
    blocks = [_page_block(n, text, notes) for n, text, notes in rows if text or notes]
    return "<book>\n" + "\n\n".join(blocks) + "\n</book>"


def excerpt_text(
    session: Session, book_id: int, focus_pages: Iterable[int], template: str = "excerpts"
) -> str:
    """The pages around the first focus page, then the other focus pages, up to a limit."""
    focus = list(focus_pages)
    wanted: dict[int, None] = {}
    if focus:
        first = focus[0]
        for n in range(first - EXCERPT_NEIGHBOURS, first + EXCERPT_NEIGHBOURS + 1):
            wanted[n] = None
    for n in focus[1:]:
        wanted[n] = None
    pages = sorted([n for n in wanted if n >= 1][:EXCERPT_MAX_PAGES])
    rows = session.exec(
        select(Page.page_number, Page.clean_text, Page.footnotes)
        .where(Page.book_id == book_id, Page.page_number.in_(pages))
        .order_by(Page.page_number)
    ).all()
    blocks = [_page_block(n, text, notes) for n, text, notes in rows if text or notes]
    return render(template, pages="\n\n".join(blocks))


def _ensure_cache(
    session: Session, gemini: Gemini, book: Book, model: str, system: str, fingerprint: str
) -> GeminiCache:
    ttl = get_settings().cache_ttl_minutes * 60
    row = session.exec(
        select(GeminiCache).where(GeminiCache.book_id == book.id, GeminiCache.model == model)
    ).first()
    now = utcnow()
    if row and row.fingerprint == fingerprint and row.expires_at - now > MIN_LEFT:
        if row.expires_at - now > timedelta(seconds=ttl * EXTEND_BELOW):
            return row
        try:
            row.expires_at = gemini.extend_cache(row.cache_name, ttl)
            session.commit()
            return row
        except CacheMissing:
            pass  # expired or deleted early: make a new one

    stale = row.cache_name if row else None
    info = gemini.create_cache(
        model,
        system=system,
        text=book_text(session, book.id),
        ttl_seconds=ttl,
        display_name=f"obelus book {book.id}",
    )
    if row is None:
        row = GeminiCache(book_id=book.id, model=model)
        session.add(row)
    row.cache_name = info.name
    row.fingerprint = fingerprint
    row.token_count = info.token_count
    row.expires_at = info.expires_at
    row.created_at = now
    session.commit()
    log.info("gemini: cached book %s on %s (%s tokens)", book.id, model, info.token_count)
    if stale and stale != info.name:
        delete_remote_caches([stale])
    return row


def _page_block(number: int, text: str, notes: str) -> str:
    block = f"[p. {number}]\n{text}".rstrip()
    return f"{block}\n\nNotes:\n{notes}" if notes else block


def _book_name(book: Book) -> str:
    return f"“{book.title}” by {book.author}" if book.author else f"“{book.title}”"


def _book_chars(session: Session, book_id: int) -> int:
    total = session.exec(
        select(func.sum(func.length(Page.clean_text) + func.length(Page.footnotes))).where(
            Page.book_id == book_id
        )
    ).one()
    return total or 0


def _fingerprint(book: Book, model: str, system: str) -> str:
    """Changes whenever the cache's contents would: a reprocess, a new system prompt, a model."""
    source = f"{model}\n{book.ingested_at.isoformat() if book.ingested_at else ''}\n{system}"
    return hashlib.sha256(source.encode()).hexdigest()


def _lock(book_id: int, model: str) -> threading.Lock:
    """One cache creation per book and model at a time; other requests wait and reuse it."""
    with _locks_guard:
        return _locks.setdefault((book_id, model), threading.Lock())
