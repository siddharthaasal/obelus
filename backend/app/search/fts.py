"""Full-text search over pages.

Exact word forms come first (`tsv_simple`): the `english` configuration stems "negation" and
"negate" together and drops words like "being" as stopwords, which is wrong for philosophical
terms. Stemmed matching (`tsv`) fills in when exact matching finds little, so "negations" still
finds "negation".
"""

from dataclasses import dataclass

from sqlalchemy import text
from sqlmodel import Session

_TERM_PAGES = """
    SELECT page_number FROM pages
    WHERE book_id = :book_id AND {column} @@ phraseto_tsquery('{config}', :term)
    ORDER BY page_number
"""

# Any of the question's words (stemmed, stopwords dropped) rather than all of them. ts_rank
# gives diminishing returns for repeats of one word, so pages matching more of the question's
# words rank first.
_QUESTION_PAGES = """
    WITH q AS (
        SELECT replace(plainto_tsquery('english', :question)::text, '&', '|')::tsquery AS query
    )
    SELECT page_number FROM pages, q
    WHERE book_id = :book_id AND tsv @@ q.query
    ORDER BY ts_rank(tsv, q.query) DESC, page_number
    LIMIT :limit
"""


@dataclass(frozen=True)
class TermHits:
    pages: list[int]  # ascending; spread across the book when there are more than the limit
    total: int


def term_pages(session: Session, book_id: int, term: str, limit: int = 40) -> TermHits:
    """Pages of a book where `term` (a word, name, or phrase) appears."""
    pages: list[int] = []
    for column, config in (("tsv_simple", "simple"), ("tsv", "english")):
        sql = text(_TERM_PAGES.format(column=column, config=config))
        found = list(session.exec(sql, params={"book_id": book_id, "term": term}).scalars())
        if len(found) > len(pages):
            pages = found
        if len(pages) >= 2:
            break
    return TermHits(pages=_spread(pages, limit), total=len(pages))


def _spread(items: list[int], limit: int) -> list[int]:
    """At most `limit` items, evenly spaced, keeping the first and last."""
    if len(items) <= limit:
        return items
    step = (len(items) - 1) / (limit - 1)
    return [items[round(i * step)] for i in range(limit)]


def question_pages(session: Session, book_id: int, question: str, limit: int = 12) -> list[int]:
    """The pages of a book that best match a question's words, best first. A stand-in for
    semantic retrieval, which comes with embeddings."""
    if not any(ch.isalnum() for ch in question):
        return []
    params = {"book_id": book_id, "question": question, "limit": limit}
    return list(session.exec(text(_QUESTION_PAGES), params=params).scalars())
