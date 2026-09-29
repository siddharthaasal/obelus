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
