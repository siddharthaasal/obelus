"""Build small synthetic PDFs that exercise each cleanup rule."""

from pathlib import Path

import pymupdf

WIDTH, HEIGHT = 432, 648  # 6 x 9 in
LEFT, INDENT = 54, 68
BODY, SMALL, HEADER = 11, 8, 9
LEADING = 15

# Each page: paragraphs of pre-broken lines. Lines inside a paragraph don't end
# in terminal punctuation, so only real paragraph ends look like ones.
PAGES: list[list[list[str]]] = [
    [
        ["Chapter One"],
        [
            "The history of philo-",
            "sophy is a history of attempts to grasp",
            "what thinking is, and each attempt begins",
            "with a kind of negation of the last one.",
        ],
        [
            "Kant calls the unity of self-",
            "consciousness the transcendental unity of",
            "apperception, and the Anglo-",
            "Saxon reception of that idea was slow.",
        ],
    ],
    [
        [
            "A second page continues the argument and",
            "introduces a claim that needs a source, the \ufb01rst",
            "which the note at the bottom supplies.",
        ],
        [
            "Hegel answers that negations are not",
            "merely empty but determinate—",
            "they carry what they negate forward.",
        ],
    ],
    [
        [
            "The third page mentions the thing in itself,",
            "which is well-known to every reader and",
            "which the well-",
            "known commentators all discuss at length.",
        ],
    ],
]
# Filler pages so each running head (odd and even) repeats often enough to detect.
PAGES += [
    [[f"Filler page {n} keeps the running heads", "repeating across the chapter."]]
    for n in range(4, 8)
]
FOOTNOTES = {1: ["1. See the Critique of Pure Reason, B131, for the", "claim about apperception."]}


def make_book_pdf(path: Path, title: str | None = "A Test Book", author: str | None = None) -> Path:
    doc = pymupdf.open()
    # Embed the font so em dashes and ligatures survive (the builtin encoding drops them).
    font = pymupdf.Font("tiro").buffer
    for i, paragraphs in enumerate(PAGES):
        page = doc.new_page(width=WIDTH, height=HEIGHT)
        page.insert_font(fontname="body", fontbuffer=font)
        number = i + 1
        if i > 0:  # chapter openers have no running head
            head = f"{number}    A Test Book" if number % 2 == 0 else f"Chapter One    {number}"
            page.insert_text((LEFT, 40), head, fontsize=HEADER, fontname="body")
        y = 90.0
        for p, lines in enumerate(paragraphs):
            heading = i == 0 and p == 0
            for j, line in enumerate(lines):
                x = INDENT if j == 0 and not heading else LEFT
                size = 18 if heading else BODY
                page.insert_text((x, y), line, fontsize=size, fontname="body")
                y += 28 if heading else LEADING
        for j, line in enumerate(FOOTNOTES.get(i, [])):
            page.insert_text((LEFT, 560 + j * 10), line, fontsize=SMALL, fontname="body")
        page.insert_text((WIDTH / 2, 625), str(number), fontsize=HEADER, fontname="body")
    doc.set_metadata({"title": title or "", "author": author or ""})
    doc.save(path)
    doc.close()
    return path
