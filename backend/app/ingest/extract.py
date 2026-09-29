"""Read a PDF into per-page visual rows with position and font size (PyMuPDF).

Everything that needs PyMuPDF lives here; cleanup (clean.py) works on the
plain dataclasses below so it can be tested without PDFs.
"""

import re
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pymupdf

# Keep whitespace and clip to the page; drop PRESERVE_LIGATURES so "ﬁ" comes back as "fi".
TEXT_FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP

_LIGATURES = str.maketrans(
    {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}
)
# Unicode spaces (nbsp, em/en/thin spaces, ...) and stray newlines become plain spaces.
_SPACES = re.compile(r"[\s\u00a0\u2000-\u200a\u202f\u205f\u3000]")
# Zero-width characters, and NUL, which Postgres text columns reject.
_INVISIBLE = str.maketrans("", "", "\x00\u200b\u200c\u200d\ufeff")
# Footnote reference marks in body text: short runs of digits or note symbols.
_NOTE_REF = re.compile(r"^[\d*†‡§¶]{1,3}$")
_JUNK_TITLE = re.compile(
    r"^(untitled|document\d*|microsoft word.*)$|\.(docx?|pdf|indd|tex|rtf|qxd)$", re.I
)
# A page this covered by images is a scan; its text (if any) is an OCR layer.
SCANNED_COVERAGE = 0.8


class PdfError(Exception):
    """The file can't be read as a PDF: corrupt, encrypted, or not a PDF."""


@dataclass
class Row:
    """One visual line of text. Coordinates are fractions of the page size."""

    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float  # dominant font size, points
    block: int

    @property
    def height(self) -> float:
        return self.y1 - self.y0


@dataclass
class ExtractedPage:
    number: int  # 1-based
    label: str | None
    width: float  # points
    height: float
    raw_text: str
    rows: list[Row]
    image_coverage: float  # 0..1, fraction of the page covered by images

    @property
    def scanned(self) -> bool:
        return self.image_coverage >= SCANNED_COVERAGE


@dataclass
class PdfInfo:
    page_count: int
    title: str | None
    author: str | None


def open_pdf(path: Path) -> pymupdf.Document:
    try:
        doc = pymupdf.open(path)
    except Exception as e:  # PyMuPDF raises several unrelated types for bad files
        raise PdfError(f"Not a readable PDF: {e}") from e
    if not doc.is_pdf:
        doc.close()
        raise PdfError("Not a PDF")
    if doc.needs_pass:
        doc.close()
        raise PdfError("PDF is password-protected")
    return doc


def read_info(path: Path) -> PdfInfo:
    with open_pdf(path) as doc:
        meta = doc.metadata or {}
        return PdfInfo(
            page_count=doc.page_count,
            title=_meta_value(meta.get("title"), is_title=True),
            author=_meta_value(meta.get("author")),
        )


def extract_pages(path: Path) -> Iterator[ExtractedPage]:
    with open_pdf(path) as doc:
        for page in doc:
            yield _extract_page(page)


def render_page_png(path: Path, page_number: int, dpi: int = 110) -> bytes:
    with open_pdf(path) as doc:
        if not 1 <= page_number <= doc.page_count:
            raise IndexError(page_number)
        return doc[page_number - 1].get_pixmap(dpi=dpi).tobytes("png")


def _meta_value(value: str | None, is_title: bool = False) -> str | None:
    value = " ".join((value or "").split())
    if len(value) < 2 or (is_title and _JUNK_TITLE.search(value)):
        return None
    return value


def _extract_page(page: pymupdf.Page) -> ExtractedPage:
    coverage = _image_coverage(page)
    rows = _rows(page, scanned=coverage >= SCANNED_COVERAGE)
    raw = page.get_text("text", flags=TEXT_FLAGS).translate(_LIGATURES).translate(_INVISIBLE)
    return ExtractedPage(
        number=page.number + 1,
        label=page.get_label() or None,
        width=page.rect.width,
        height=page.rect.height,
        raw_text=raw,
        rows=rows,
        image_coverage=coverage,
    )


def _image_coverage(page: pymupdf.Page) -> float:
    area = page.rect.width * page.rect.height
    if not area:
        return 0.0
    covered = 0.0
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"]) & page.rect
        if not r.is_empty:
            covered += r.width * r.height
    return min(1.0, covered / area)


def _rows(page: pymupdf.Page, scanned: bool) -> list[Row]:
    w, h = page.rect.width, page.rect.height
    rows: list[Row] = []
    for bno, block in enumerate(page.get_text("dict", flags=TEXT_FLAGS)["blocks"]):
        if block.get("type") != 0:
            continue
        lines: list[Row] = []
        for line in block["lines"]:
            if abs(line["dir"][1]) > 0.1:  # vertical margin text, watermarks
                continue
            # Keep whitespace-only spans: some PDFs (LaTeX) put inter-word spaces there.
            spans = line["spans"]
            if not any(s["text"].strip() for s in spans):
                continue
            size = _dominant_size(spans)
            text = _line_text(spans, size, scanned)
            if not text.strip():
                continue
            x0, y0, x1, y1 = line["bbox"]
            lines.append(Row(text, x0 / w, y0 / h, x1 / w, y1 / h, size, bno))
        rows.extend(_merge_same_row(lines))
    return rows


def _dominant_size(spans: list[dict]) -> float:
    sizes: Counter[float] = Counter()
    for s in spans:
        if n := len(s["text"].strip()):
            sizes[round(s["size"], 1)] += n
    return sizes.most_common(1)[0][0]


def _line_text(spans: list[dict], size: float, scanned: bool) -> str:
    parts = []
    for i, s in enumerate(spans):
        text = s["text"]
        is_super = bool(s["flags"] & pymupdf.TEXT_FONT_SUPERSCRIPT)
        # OCR layers have meaningless sizes, so only trust the superscript flag there.
        is_small = not scanned and s["size"] < 0.75 * size
        # Drop footnote reference marks inside body text, but keep a leading one:
        # that's the note number at the start of a footnote.
        if i > 0 and (is_super or is_small) and _NOTE_REF.match(text.strip()):
            continue
        parts.append(text)
    text = "".join(parts).translate(_LIGATURES).translate(_INVISIBLE)
    return _SPACES.sub(" ", text)


def _merge_same_row(lines: list[Row]) -> list[Row]:
    """Join lines of one block that sit side by side on the same baseline."""
    merged: list[Row] = []
    for line in lines:
        prev = merged[-1] if merged else None
        if prev is not None and _same_row(prev, line):
            left, right = (prev, line) if prev.x0 <= line.x0 else (line, prev)
            longer = max(prev, line, key=lambda r: len(r.text))
            merged[-1] = Row(
                text=f"{left.text.rstrip()} {right.text.lstrip()}",
                x0=min(prev.x0, line.x0),
                y0=min(prev.y0, line.y0),
                x1=max(prev.x1, line.x1),
                y1=max(prev.y1, line.y1),
                size=longer.size,
                block=prev.block,
            )
        else:
            merged.append(line)
    return merged


def _same_row(a: Row, b: Row) -> bool:
    overlap = min(a.y1, b.y1) - max(a.y0, b.y0)
    return overlap > 0.5 * min(a.height, b.height)
