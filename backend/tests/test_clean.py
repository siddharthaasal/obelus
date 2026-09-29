from collections import Counter

from app.ingest.clean import clean_book, join_hyphenated, split_footnotes
from app.ingest.extract import ExtractedPage, Row


def row(text, y, size=11.0, x0=0.1, x1=0.9, block=0, h=0.02):
    return Row(text=text, x0=x0, y0=y, x1=x1, y1=y + h, size=size, block=block)


def page(rows, number=1, coverage=0.0):
    return ExtractedPage(
        number=number,
        label=None,
        width=432,
        height=648,
        raw_text="\n".join(r.text for r in rows),
        rows=rows,
        image_coverage=coverage,
    )


def body(n, start=0.2):
    return [row(f"body line {i} of the page text continues", start + i * 0.025) for i in range(n)]


class TestHyphenation:
    def test_joins_syllable_breaks(self):
        assert join_hyphenated("the philo-", "sophy of", Counter()) == "the philosophy of"

    def test_keeps_compounds_of_two_words(self):
        assert join_hyphenated("self-", "consciousness", Counter()) == "self-consciousness"

    def test_keeps_capitalized_second_part(self):
        assert join_hyphenated("Anglo-", "Saxon", Counter()) == "Anglo-Saxon"

    def test_book_usage_beats_dictionary(self):
        vocab = Counter({"well-known": 3})
        assert join_hyphenated("well-", "known", vocab) == "well-known"
        vocab = Counter({"aufhebung": 2})
        assert join_hyphenated("Aufhe-", "bung", vocab) == "Aufhebung"


class TestRunningLines:
    def test_removes_repeated_header_and_page_number(self):
        pages = [
            page([row(f"The Critique of Reason   {n}", 0.05), *body(3), row(str(n), 0.93)], n)
            for n in range(1, 6)
        ]
        cleaned = clean_book(pages)
        for c in cleaned:
            assert "Critique" not in c.clean_text
            assert {r["reason"] for r in c.removed} == {"header", "page_number"}

    def test_fuzzy_matches_ocr_noise(self):
        heads = ["AN ENQUIRY CONCERNING", "AN  ENQ UIRY CONCERNING", "AN ENQUIRV CONCERNINC"]
        pages = [page([row(h, 0.05), *body(3)], i + 1) for i, h in enumerate(heads)]
        assert all(c.removed for c in clean_book(pages))

    def test_keeps_one_off_top_line_and_large_headings(self):
        pages = [page([row("Chapter One", 0.05, size=18), *body(3)], n) for n in range(1, 5)]
        pages.append(page([row("An opening line only here", 0.05), *body(3)], 5))
        cleaned = clean_book(pages)
        assert all(not c.removed for c in cleaned)
        assert cleaned[0].clean_text.startswith("Chapter One")


class TestFootnotes:
    def test_small_rows_below_a_gap_are_footnotes(self):
        rows = [*body(5), row("1. See Kant, B131.", 0.85, size=8.5, h=0.015)]
        kept, notes = split_footnotes(rows, 11.0)
        assert [r.text for r in notes] == ["1. See Kant, B131."]
        assert len(kept) == 5

    def test_small_text_mid_page_is_not_a_footnote(self):
        rows = [*body(3), row("[an editorial aside]", 0.3, size=9), *body(3, start=0.33)]
        assert split_footnotes(rows, 11.0)[1] == []

    def test_scanned_pages_skip_size_rules(self):
        rows = [*body(5), row("1. looks like a note", 0.85, size=6)]
        cleaned = clean_book([page(rows, coverage=1.0)])
        assert cleaned[0].footnotes == ""
        assert "looks like a note" in cleaned[0].clean_text


class TestReflow:
    def test_joins_lines_and_splits_paragraphs(self):
        rows = [
            row("First paragraph starts here and", 0.2, x0=0.15),
            row("ends on this line.", 0.225, x1=0.5),
            row("Second paragraph is indented and", 0.25, x0=0.15),
            row("goes on—", 0.275),
            row("without a gap.", 0.3, x1=0.4),
        ]
        cleaned = clean_book([page(rows)])[0]
        assert cleaned.clean_text == (
            "First paragraph starts here and ends on this line.\n\n"
            "Second paragraph is indented and goes on—without a gap."
        )

    def test_soft_hyphens(self):
        rows = [row("en­thusi­", 0.2), row("asm for post-­metaphysics", 0.225)]
        assert clean_book([page(rows)])[0].clean_text == "enthusiasm for post-metaphysics"


def test_needs_ocr_for_image_only_pages():
    assert clean_book([page([], coverage=1.0)])[0].needs_ocr
    assert not clean_book([page([])])[0].needs_ocr  # a genuinely blank page
