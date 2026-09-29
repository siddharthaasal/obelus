"""Selection actions: define a term in context, say who a name is, explain a passage.

A lookup anchors the selection in the page's clean text (for the exact wording and the
paragraph around it), answers from the lookups table when the same query was asked before in
this book, and otherwise asks the fast model with the book in context.
"""

import hashlib
import re
import unicodedata
from dataclasses import dataclass

from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, select

from app.ai import context
from app.ai.gemini import CacheMissing, Gemini, Generated, require_gemini
from app.ai.prompts import render
from app.ai.schemas import RESULTS
from app.anchor import anchor, paragraph_context
from app.config import get_settings
from app.models import Book, Lookup, LookupKind, Page
from app.models.base import utcnow
from app.search.fts import TermHits, term_pages

MAX_TERM_CHARS = 100
MAX_PASSAGE_CHARS = 5000
UNANCHORED_CONTEXT_CHARS = 4000

_EDGE_PUNCTUATION = re.compile(r"^[\W_]+|[\W_]+$")
_POSSESSIVE = re.compile(r"(?<=\w)['’]s$", re.I)
_LINE_HYPHEN = re.compile(r"(\w)[-­]\s*\n\s*(?=[a-z])")


class LookupInputError(ValueError):
    """The selection can't be looked up as asked (empty, or too long for the action)."""


class PageMissing(LookupError):
    pass


@dataclass(frozen=True)
class LookupRequest:
    kind: LookupKind
    page: int
    text: str
    before: str = ""
    after: str = ""
    refresh: bool = False


@dataclass(frozen=True)
class Selection:
    query: str
    context: str
    start: int | None  # offsets in pages.clean_text, when anchored there
    end: int | None


def run_lookup(session: Session, book: Book, req: LookupRequest) -> tuple[Lookup, bool]:
    """Answer a lookup. Returns it, and whether it came from the lookups table."""
    page = session.exec(
        select(Page.clean_text, Page.footnotes).where(
            Page.book_id == book.id, Page.page_number == req.page
        )
    ).first()
    if page is None:
        raise PageMissing(f"Page {req.page} has no extracted text")
    sel = resolve_selection(req.kind, page.clean_text, page.footnotes, req)
    key = query_key(req.kind, sel.query)
    existing = session.exec(
        select(Lookup).where(
            Lookup.book_id == book.id, Lookup.kind == req.kind, Lookup.query_key == key
        )
    ).first()
    if existing and not req.refresh:
        return existing, True

    gemini = require_gemini()
    model = get_settings().model_fast
    hits = None if req.kind == LookupKind.explain else term_pages(session, book.id, sel.query)
    prompt = _prompt(req.kind, sel, req.page, hits)
    focus = [req.page, *(hits.pages if hits else [])]
    generated, ctx = _generate(session, gemini, book, model, RESULTS[req.kind], prompt, focus)

    values = {
        "book_id": book.id,
        "page_number": req.page,
        "kind": req.kind,
        "query_text": sel.query,
        "query_key": key,
        "context_text": sel.context,
        "char_start": sel.start,
        "char_end": sel.end,
        "response": _tidy(generated.result, book.page_count),
        "model": model,
        "context_mode": ctx.mode,
        "usage": generated.usage.as_dict(),
        "created_at": utcnow(),
    }
    # An upsert: a regenerate replaces the old answer, and two identical lookups racing
    # each other end up as one row.
    stmt = insert(Lookup).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["book_id", "kind", "query_key"], set_=values
    ).returning(Lookup.id)
    lookup_id = session.exec(stmt).scalar_one()
    session.commit()
    return session.get_one(Lookup, lookup_id), False


def resolve_selection(
    kind: LookupKind, clean_text: str, footnotes: str, req: LookupRequest
) -> Selection:
    """The query and its context: from the clean text when the selection is found there
    (the reader may also have selected inside a footnote), else from the raw selection."""
    start = end = None
    if a := anchor(clean_text, req.text, req.before, req.after):
        raw, ctx = clean_text[a.start : a.end], paragraph_context(clean_text, a.start, a.end)
        start, end = a.start, a.end
    elif footnotes and (a := anchor(footnotes, req.text, req.before, req.after)):
        raw, ctx = footnotes[a.start : a.end], paragraph_context(footnotes, a.start, a.end)
    else:
        raw = _LINE_HYPHEN.sub(r"\1", req.text)
        ctx = clean_text[:UNANCHORED_CONTEXT_CHARS]

    if kind == LookupKind.explain:
        query = " ".join(raw.split())
        limit, what = MAX_PASSAGE_CHARS, "passage"
    else:
        query = clean_term(raw)
        limit, what = MAX_TERM_CHARS, "term or name"
    if not any(ch.isalnum() for ch in query):
        raise LookupInputError("The selection has no words in it")
    if len(query) > limit:
        hint = " Use Explain for a passage." if kind != LookupKind.explain else ""
        raise LookupInputError(f"That's too long for a {what} (over {limit} characters).{hint}")
    return Selection(query=query, context=ctx, start=start, end=end)


def clean_term(text: str) -> str:
    """A selected term or name without surrounding punctuation or a possessive:
    '“Hegel’s,' -> 'Hegel'."""
    text = _EDGE_PUNCTUATION.sub("", " ".join(text.split()))
    return _POSSESSIVE.sub("", text)


def query_key(kind: LookupKind, query: str) -> str:
    normalized = " ".join(unicodedata.normalize("NFKC", query).casefold().split())
    return hashlib.sha256(f"{kind}\n{normalized}".encode()).hexdigest()


def _generate[T: BaseModel](
    session: Session,
    gemini: Gemini,
    book: Book,
    model: str,
    schema: type[T],
    prompt: str,
    focus: list[int],
) -> tuple[Generated[T], context.BookContext]:
    thinking = get_settings().lookup_thinking
    for attempt in range(2):
        ctx = context.prepare(session, gemini, book, model)
        try:
            generated = gemini.generate(
                model,
                schema,
                contents=[*ctx.contents(session, focus), prompt],
                system=ctx.system,
                cache_name=ctx.cache.cache_name if ctx.cache else None,
                thinking=None if thinking == "default" else thinking,
            )
            return generated, ctx
        except CacheMissing:
            # Expired or deleted early on Gemini's side: rebuild it once and retry.
            if attempt or ctx.cache is None:
                raise
            context.forget(session, ctx.cache)
    raise AssertionError("unreachable")


def _prompt(kind: LookupKind, sel: Selection, page: int, hits: TermHits | None) -> str:
    if kind == LookupKind.explain:
        return render("explain", page=page, selection=sel.query, context=sel.context)
    noun = "term" if kind == LookupKind.define else "name"
    occurrences = _occurrences(hits, noun)
    if kind == LookupKind.define:
        return render(
            "define", term=sel.query, page=page, passage=sel.context, occurrences=occurrences
        )
    return render("who", name=sel.query, page=page, passage=sel.context, occurrences=occurrences)


def _occurrences(hits: TermHits | None, noun: str) -> str:
    if not hits or not hits.total:
        return (
            f"A full-text search doesn't find the {noun} in the book's text; "
            "it may be spelled differently elsewhere."
        )
    pages = ", ".join(str(p) for p in hits.pages)
    if hits.total > len(hits.pages):
        return (
            f"A full-text search finds the {noun} on {hits.total} pages. "
            f"A sample spread across the book: {pages}."
        )
    if hits.total == 1:
        return f"A full-text search finds the {noun} only on page {pages}."
    return f"A full-text search finds the {noun} on these pages: {pages}."


def _tidy(result: BaseModel, page_count: int | None) -> dict:
    """Trim strings, turn empty optional fields into nulls, and keep only page references
    that exist, in page order."""
    data = result.model_dump()
    for key, value in data.items():
        if isinstance(value, str):
            data[key] = value.strip() or (None if key in ("general", "across_book") else "")
        elif key in ("key_pages", "related_pages"):
            seen: dict[int, dict] = {}
            for item in value:
                ok = item["page"] >= 1 and (page_count is None or item["page"] <= page_count)
                if ok and item["page"] not in seen:
                    seen[item["page"]] = {"page": item["page"], "note": item["note"].strip()}
            data[key] = [seen[p] for p in sorted(seen)]
    return data
