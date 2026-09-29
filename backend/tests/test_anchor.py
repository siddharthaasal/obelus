from app.anchor import anchor, paragraph_context

PAGE = (
    "Hegel answers that negations are not merely empty but determinate—they carry what they "
    "negate forward. The first negation is abstract.\n\n"
    "A second paragraph returns to negation, now as the negation of the negation, which Hegel "
    "calls the concrete universal."
)


def found(text, selected, **kw):
    a = anchor(text, selected, **kw)
    return None if a is None else text[a.start : a.end]


class TestAnchor:
    def test_exact(self):
        a = anchor(PAGE, "determinate")
        assert PAGE[a.start : a.end] == "determinate"
        assert a.score == 100

    def test_pdfjs_line_break_hyphen_and_spacing(self):
        # PDF.js keeps the line-end hyphen and newline; the clean text rejoined the word.
        text = "The history of philosophy is a history of attempts to grasp what thinking is."
        assert found(text, "history of philo-\nsophy is") == "history of philosophy is"

    def test_ligatures_and_punctuation(self):
        text = "the ﬁrst which the note supplies"
        assert found(text, "first") == "ﬁrst"
        assert found(PAGE, "“negations,”") == "negations"

    def test_widens_to_whole_words(self):
        assert found(PAGE, "etermin") == "determinate"

    def test_context_picks_the_selected_occurrence(self):
        # "negation" appears four times; before/after text from the text layer says which.
        a = anchor(PAGE, "negation", before="now as the ", after=" of the negation, which")
        assert PAGE[a.start - 11 : a.end + 3] == "now as the negation of"
        first = anchor(PAGE, "negation")
        assert PAGE[first.start - 10 : first.start] == "The first "

    def test_fuzzy_survives_footnote_marks_and_dropped_text(self):
        # The text layer has a footnote mark (12) the clean text dropped.
        a = anchor(PAGE, "The first negation12 is abstract. A second paragraph returns")
        assert a is not None and a.score < 100
        assert PAGE[a.start : a.end].startswith("The first negation is abstract")

    def test_short_words_need_an_exact_match(self):
        assert anchor(PAGE, "negatoin") is None

    def test_not_on_the_page(self):
        assert anchor(PAGE, "an entirely different sentence about Spinoza") is None
        assert anchor(PAGE, "  —  ") is None
        assert anchor("", "Hegel") is None


class TestParagraphContext:
    def test_short_paragraphs_take_their_neighbours(self):
        a = anchor(PAGE, "concrete universal")
        ctx = paragraph_context(PAGE, a.start, a.end)
        assert ctx.startswith("Hegel answers")
        assert ctx.endswith("concrete universal.")

    def test_long_paragraph_is_windowed(self):
        long = " ".join(f"word{i}" for i in range(600)) + " target " + "filler " * 600
        a = anchor(long, "target")
        ctx = paragraph_context(long, a.start, a.end)
        assert "target" in ctx
        assert ctx.startswith("…") and ctx.endswith("…")
        assert len(ctx) <= 1500 + 2
        assert not ctx[1].isspace() and ctx[1:5] == "word"
