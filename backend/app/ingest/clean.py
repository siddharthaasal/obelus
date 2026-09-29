"""Turn extracted rows into clean page text.

Rules, applied per page:

1. Running headers/footers: rows near the top or bottom edge whose text (letters
   only, fuzzy-matched) repeats on several pages.
2. Page numbers: bare numbers or roman numerals in those same edge rows.
3. Footnotes: a run of small-font rows at the bottom of the page, set off by a
   gap or starting with a note mark. Moved to `footnotes`, not dropped.
4. Reflow: rows are joined into paragraphs, and words hyphenated across lines
   are rejoined when the joined form is a real word.

Font-size rules are skipped on scanned pages, whose OCR text layer has
meaningless sizes. Every dropped row is recorded with its reason, which is
what the debug view shows.
"""

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import cache
from statistics import median

from rapidfuzz import fuzz, process

from app.ingest.extract import ExtractedPage, Row

# Edge zones, as fractions of page height. Only the first/last EDGE_ROWS rows count.
HEADER_ZONE = 0.12
FOOTER_ZONE = 0.88
EDGE_ROWS = 2
# A running header must appear on at least this many pages.
MIN_REPEATS = 3
HEADER_MATCH = 85  # rapidfuzz ratio, 0-100
HEADER_MAX_CHARS = 120
HEADING_RATIO = 1.2  # rows this much larger than body text are headings
FOOTNOTE_RATIO = 0.9  # rows this much smaller than body text may be footnotes
FOOTNOTE_MIN_TOP = 0.4  # a footnote block starts below this point on the page

_PAGE_NUMBER = re.compile(
    r"^[\s\-–—\[\](){}|.]*(?:page\s+)?(\d{1,4}|[ivxlcdm]{1,8})[\s\-–—\[\](){}|.]*$", re.I
)
_ROMAN_WORD = re.compile(r"\b[ivxlcdm]+\b")
_NOTE_START = re.compile(r"^\s*(\d{1,3}[.)]?|[*†‡§¶]+)\s")
_TERMINAL = tuple('.?!:;"”’»)]…')
_HYPHENS = ("-", "\u2010")
_SOFT_HYPHEN = "\u00ad"
_WORD = re.compile(r"[^\W\d_]+(?:[-‐][^\W\d_]+)*")
_WS = re.compile(r"\s+")


@dataclass
class CleanPage:
    clean_text: str
    footnotes: str
    needs_ocr: bool
    removed: list[dict] = field(default_factory=list)


def clean_book(pages: Sequence[ExtractedPage]) -> list[CleanPage]:
    body_size = body_font_size(pages)
    edges = find_running_lines(pages, body_size)
    vocab = vocabulary(pages)
    return [clean_page(page, body_size, edges.get(i, {}), vocab) for i, page in enumerate(pages)]


def body_font_size(pages: Sequence[ExtractedPage]) -> float:
    """Most common font size by character count, ignoring scanned pages."""
    sizes: Counter[float] = Counter()
    for page in pages:
        if page.scanned:
            continue
        for row in page.rows:
            sizes[round(row.size * 2) / 2] += len(row.text)
    return sizes.most_common(1)[0][0] if sizes else 10.0


def find_running_lines(
    pages: Sequence[ExtractedPage], body_size: float
) -> dict[int, dict[int, str]]:
    """Map page index -> {row index: "header" | "footer"} for repeated edge rows."""
    found: dict[int, dict[int, str]] = {}
    for zone in ("header", "footer"):
        cands: list[tuple[int, int, str]] = []  # (page index, row index, key)
        for pi, page in enumerate(pages):
            for ri in _edge_rows(page, zone):
                row = page.rows[ri]
                if len(row.text) > HEADER_MAX_CHARS:
                    continue
                if not page.scanned and row.size > HEADING_RATIO * body_size:
                    continue  # a chapter heading, not a running head
                key = _header_key(row.text)
                if len(key) >= 3:
                    cands.append((pi, ri, key))
        # Fuzzy-match distinct keys only; OCR'd headers vary, typeset ones mostly don't.
        pages_by_key: dict[str, set[int]] = {}
        for pi, _, key in cands:
            pages_by_key.setdefault(key, set()).add(pi)
        keys = list(pages_by_key)
        seen_on: dict[str, set[int]] = {}
        for key in keys:
            matches = process.extract(
                key, keys, scorer=fuzz.ratio, score_cutoff=HEADER_MATCH, limit=None
            )
            seen_on[key] = set().union(*(pages_by_key[m] for m, _, _ in matches))
        for pi, ri, key in cands:
            if len(seen_on[key] - {pi}) >= MIN_REPEATS - 1:
                found.setdefault(pi, {})[ri] = zone
    return found


def vocabulary(pages: Sequence[ExtractedPage]) -> Counter[str]:
    """Word counts across the book, including hyphenated compounds seen mid-line."""
    counts: Counter[str] = Counter()
    for page in pages:
        for row in page.rows:
            text = row.text.replace(_SOFT_HYPHEN, "")
            counts.update(w.lower() for w in _WORD.findall(text))
    return counts


def clean_page(
    page: ExtractedPage,
    body_size: float,
    edges: dict[int, str],
    vocab: Counter[str],
) -> CleanPage:
    removed: list[dict] = []
    edge_rows = set(_edge_rows(page, "header")) | set(_edge_rows(page, "footer"))
    kept: list[Row] = []
    for ri, row in enumerate(page.rows):
        if ri in edges:
            removed.append({"text": row.text.strip(), "reason": edges[ri]})
        elif ri in edge_rows and _PAGE_NUMBER.match(row.text):
            removed.append({"text": row.text.strip(), "reason": "page_number"})
        else:
            kept.append(row)

    notes: list[Row] = []
    if not page.scanned:
        kept, notes = split_footnotes(kept, body_size)

    em = body_size / page.width if page.width else 0.02
    text = "\n\n".join(reflow(kept, body_size, em, vocab, page.scanned))
    footnotes = "\n\n".join(reflow(notes, body_size, em, vocab, page.scanned))
    return CleanPage(
        clean_text=text,
        footnotes=footnotes,
        needs_ocr=needs_ocr(page),
        removed=removed,
    )


def needs_ocr(page: ExtractedPage) -> bool:
    chars = "".join(r.text for r in page.rows)
    visible = len(chars.replace(" ", ""))
    if visible < 25:
        return page.image_coverage > 0.3
    return chars.count("�") / visible > 0.2


def split_footnotes(rows: list[Row], body_size: float) -> tuple[list[Row], list[Row]]:
    by_y = sorted(rows, key=lambda r: r.y0)
    k = len(by_y)
    while k > 0 and by_y[k - 1].size <= FOOTNOTE_RATIO * body_size:
        k -= 1
    region = by_y[k:]
    if not region or region[0].y0 < FOOTNOTE_MIN_TOP:
        return rows, []
    top = region[0]
    above = [r.y1 for r in by_y[:k] if _x_overlap(r, top)]
    gap = top.y0 - max(above) if above else 1.0
    line_height = median(r.height for r in region)
    if gap <= 0.6 * line_height and not _NOTE_START.match(top.text):
        return rows, []
    ids = {id(r) for r in region}
    return [r for r in rows if id(r) not in ids], [r for r in rows if id(r) in ids]


def reflow(
    rows: list[Row], body_size: float, em: float, vocab: Counter[str], scanned: bool
) -> list[str]:
    """Group rows into paragraphs and join each paragraph's lines."""
    if not rows:
        return []
    left, right = _column_edges(rows)
    paragraphs: list[list[str]] = []
    prev: Row | None = None
    for i, row in enumerate(rows):
        text = _WS.sub(" ", row.text).strip()
        if prev is None or _starts_paragraph(prev, row, i, left, right, body_size, em, scanned):
            paragraphs.append([text])
        else:
            paragraphs[-1].append(text)
        prev = row
    joined = (_join_lines(lines, vocab) for lines in paragraphs)
    return [p for p in (_WS.sub(" ", t.replace(_SOFT_HYPHEN, "")).strip() for t in joined) if p]


def join_hyphenated(left: str, right: str, vocab: Counter[str]) -> str:
    """Join `left` (ending in a hyphen) and the next line `right`."""
    a_match = re.search(r"([^\W\d_]+)[-‐]$", left)
    b_match = re.match(r"([^\W\d_]+)", right)
    keep = left + right
    drop = left[:-1] + right
    if not a_match or not b_match:
        return keep
    a, b = a_match.group(1), b_match.group(1)
    if b[0].isupper():
        return keep  # Anglo-Saxon, Merleau-Ponty
    joined, hyphenated = (a + b).lower(), f"{a}-{b}".lower()
    if vocab[hyphenated] > vocab[joined]:
        return keep
    words = _dictionary()
    if vocab[joined] or joined in words:
        return drop
    if a.lower() in words and b.lower() in words:
        return keep  # both halves are words: likely a compound (well-known)
    return drop  # an ordinary syllable break


def _join_lines(lines: list[str], vocab: Counter[str]) -> str:
    out = lines[0]
    for nxt in lines[1:]:
        if out.endswith(_SOFT_HYPHEN):
            out = out[:-1] + nxt
        elif out.endswith(_HYPHENS) and len(out) > 1 and out[-2].isalpha():
            out = join_hyphenated(out, nxt, vocab)
        elif out.endswith("—") or nxt.startswith("—"):
            out += nxt  # em dashes are set closed up: "something—not"
        else:
            out = f"{out} {nxt}"
    return out


def _starts_paragraph(
    prev: Row,
    row: Row,
    i: int,
    left: list[float],
    right: list[float],
    body_size: float,
    em: float,
    scanned: bool,
) -> bool:
    prev_text = prev.text.rstrip()
    if prev_text.endswith((*_HYPHENS, _SOFT_HYPHEN)):
        return False
    if not scanned and max(prev.size, row.size) > HEADING_RATIO * body_size:
        return prev.size != row.size or row.block != prev.block
    if _x_overlap(prev, row) and row.y0 > prev.y0:
        gap = row.y0 - prev.y1
        if gap > 0.8 * max(prev.height, row.height):
            return True
    j = i - 1
    terminal = prev_text.endswith(_TERMINAL)
    indented = row.x0 - left[i] > 0.8 * em
    prev_short = right[j] - prev.x1 > 2 * em
    prev_centered = prev.x0 - left[j] > 2 * em and prev_short
    return (terminal and (indented or prev_short)) or prev_centered


def _column_edges(rows: list[Row]) -> tuple[list[float], list[float]]:
    """Left and right edge of the text column each row belongs to.

    Percentiles rather than min/max, so indented paragraph starts and stray OCR
    marks in the margin don't move the edge.
    """
    left, right = [], []
    for r in rows:
        same_col = [o for o in rows if _x_overlap(o, r)]
        xs0 = sorted(o.x0 for o in same_col)
        xs1 = sorted(o.x1 for o in same_col)
        left.append(xs0[len(xs0) // 4])
        right.append(xs1[(len(xs1) * 3) // 4])
    return left, right


def _x_overlap(a: Row, b: Row) -> bool:
    return min(a.x1, b.x1) - max(a.x0, b.x0) > 0


def _edge_rows(page: ExtractedPage, zone: str) -> list[int]:
    order = sorted(range(len(page.rows)), key=lambda i: page.rows[i].y0)
    if zone == "header":
        return [i for i in order[:EDGE_ROWS] if page.rows[i].y1 <= HEADER_ZONE]
    return [i for i in order[-EDGE_ROWS:] if page.rows[i].y0 >= FOOTER_ZONE]


def _header_key(text: str) -> str:
    """Letters only, without page numbers or roman numerals, for fuzzy comparison."""
    text = _ROMAN_WORD.sub("", text.lower())
    return "".join(ch for ch in text if ch.isalpha())


@cache
def _dictionary() -> frozenset[str]:
    from spellchecker import SpellChecker

    return frozenset(SpellChecker(language="en").word_frequency.dictionary)
