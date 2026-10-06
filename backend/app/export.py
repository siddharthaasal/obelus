"""A book's notes as Markdown: highlights with their notes, and saved lookups, in page order,
for Obsidian or anywhere else that reads Markdown.

Pages go by their printed numbers when the PDF has labels, with the PDF page alongside, and
citations in lookup answers are rewritten the same way.
"""

import math
from datetime import date
from itertools import groupby

from sqlmodel import Session, select

from app import citations
from app.models import Book, Highlight, Lookup, LookupKind, Page


def notes_markdown(session: Session, book: Book) -> str:
    labels = dict(
        session.exec(
            select(Page.page_number, Page.label).where(
                Page.book_id == book.id, Page.label.is_not(None)
            )
        ).all()
    )

    def printed(n: int) -> str:
        return labels.get(n) or str(n)

    def cite(text: str | None) -> str:
        return citations.relabel(text or "", book.page_count, printed).strip()

    highlights = session.exec(select(Highlight).where(Highlight.book_id == book.id)).all()
    lookups = session.exec(select(Lookup).where(Lookup.book_id == book.id)).all()
    # Page order, then position on the page when it's known, then when it was made.
    items = sorted(
        [*highlights, *lookups],
        key=lambda x: (
            x.page_number,
            x.char_start if x.char_start is not None else math.inf,
            x.created_at,
        ),
    )

    blocks = [f"# {book.title}"]
    if book.author:
        blocks.append(f"*{book.author}*")
    counts = f"{_count(len(highlights), 'highlight')} and {_count(len(lookups), 'lookup')}"
    blocks.append(f"Notes from Obelus, {date.today():%-d %B %Y}: {counts}.")
    for page, group in groupby(items, key=lambda x: x.page_number):
        name = printed(page)
        blocks.append(f"## p. {name}" + (f" (PDF page {page})" if name != str(page) else ""))
        for item in group:
            if isinstance(item, Highlight):
                blocks.extend(_highlight(item))
            else:
                blocks.extend(_lookup(item, cite, printed))
    return "\n\n".join(blocks) + "\n"


def _highlight(h: Highlight) -> list[str]:
    out = [_quote(h.selected_text)]
    if h.note:
        out.append(h.note)
    return out


def _lookup(lookup: Lookup, cite, printed) -> list[str]:
    r = lookup.response

    def pages(title: str, items: list[dict]) -> list[str]:
        if not items:
            return []
        rows = "\n".join(f"- p. {printed(i['page'])}: {i['note']}" for i in items)
        return [f"*{title}:*\n{rows}"]

    if lookup.kind == LookupKind.define:
        out = [f"**Define: {r.get('term') or lookup.query_text}.** {cite(r.get('in_context'))}"]
        if r.get("general"):
            out.append(f"*Generally:* {cite(r['general'])}")
        if r.get("across_book"):
            out.append(f"*Across the book:* {cite(r['across_book'])}")
        return out + pages("Key pages", r.get("key_pages", []))
    if lookup.kind == LookupKind.who:
        relation = f" ({r['relation_label']})" if r.get("relation_label") else ""
        out = [
            f"**Who: {r.get('name') or lookup.query_text}**{relation}. {cite(r.get('bio'))}",
            f"*To the author:* {cite(r.get('relation'))}",
            f"*Here:* {cite(r.get('here'))}",
        ]
        return out + pages("Other pages", r.get("key_pages", []))
    out = [f"**Explain:**\n{_quote(lookup.query_text)}", cite(r.get("restatement"))]
    if terms := r.get("key_terms"):
        out.append("\n".join(f"- **{t['term']}**: {cite(t['meaning'])}" for t in terms))
    out.append(f"*In the argument:* {cite(r.get('in_argument'))}")
    return out + pages("Related pages", r.get("related_pages", []))


def _quote(text: str) -> str:
    return "\n>\n".join(f"> {p}" for p in text.split("\n\n"))


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}" + ("" if n == 1 else "s")
