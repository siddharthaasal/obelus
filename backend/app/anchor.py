"""Find a reader selection in a page's extracted text.

PDF.js's text layer and PyMuPDF's extraction never agree character for character: line-end
hyphens, ligatures, footnote marks, spacing, and running heads all differ. So both sides are
reduced to casefolded letters and digits, matched there (exactly, then fuzzily with rapidfuzz),
and the match is mapped back to offsets in the original text.

A few words of text before and after the selection, read from the text layer, pick the right
occurrence when the selected word appears more than once on the page.
"""

import unicodedata
from collections.abc import Callable
from dataclasses import dataclass

from rapidfuzz import fuzz

# Selections shorter than this (in letters and digits) must match exactly: fuzzy matching a
# short word finds similar words, not the selected one.
MIN_FUZZY = 12
FUZZY_SCORE = 85  # rapidfuzz partial_ratio, 0-100
CONTEXT = 60  # letters of surrounding text used to choose between repeated matches

# Context handed to the model: the paragraph around the selection, within these bounds.
CONTEXT_MAX_CHARS = 1500
SHORT_PARAGRAPH = 300  # shorter paragraphs (headings, one-liners) take in their neighbours


@dataclass(frozen=True)
class Anchor:
    start: int
    end: int
    score: float  # 100 for an exact match


def anchor(text: str, selected: str, before: str = "", after: str = "") -> Anchor | None:
    """Offsets of `selected` in `text`, widened to whole words, or None if it isn't there."""
    hay, index = _letters(text)
    needle = _letters(selected)[0]
    if not needle or not hay:
        return None
    pre = _letters(before)[0][-CONTEXT:]
    post = _letters(after)[0][:CONTEXT]

    def whole_words(s: int, e: int) -> int:
        """2 when hay[s:e] starts and ends on word boundaries in `text`, 1 for one of them."""
        a, b = index[s], index[e - 1] + 1
        return (a == 0 or not text[a - 1].isalnum()) + (b == len(text) or not text[b].isalnum())

    found = _exact(hay, needle, pre, post, whole_words) or _fuzzy(hay, needle)
    if found is None:
        return None
    s, e, score = found
    start, end = _whole_words(text, index[s], index[e - 1] + 1)
    return Anchor(start, end, score)


def paragraph_context(text: str, start: int, end: int) -> str:
    """The paragraph(s) holding text[start:end], trimmed to a window around it if long."""
    lo = _paragraph_start(text, start)
    hi = _paragraph_end(text, end)
    if hi - lo < SHORT_PARAGRAPH:
        lo = _paragraph_start(text, max(lo - 2, 0))
        hi = _paragraph_end(text, min(hi + 2, len(text)))
    limit = max(CONTEXT_MAX_CHARS, end - start + 600)
    if hi - lo <= limit:
        return text[lo:hi].strip()
    pad = (limit - (end - start)) // 2
    w_lo, w_hi = max(lo, start - pad), min(hi, end + pad)
    # Cut at spaces so the window doesn't start or end mid-word.
    if w_lo > lo and (cut := text.find(" ", w_lo, start)) != -1:
        w_lo = cut + 1
    if w_hi < hi and (cut := text.rfind(" ", end, w_hi)) != -1:
        w_hi = cut
    snippet = text[w_lo:w_hi].strip()
    return f"{'…' if w_lo > lo else ''}{snippet}{'…' if w_hi < hi else ''}"


def _letters(s: str) -> tuple[str, list[int]]:
    """Casefolded letters and digits of `s`, and each one's index in `s`."""
    out: list[str] = []
    index: list[int] = []
    for i, ch in enumerate(s):
        # NFKC splits ligatures (ﬁ -> fi); casefold maps ß -> ss. Both keep index i.
        for c in unicodedata.normalize("NFKC", ch).casefold():
            if c.isalnum():
                out.append(c)
                index.append(i)
    return "".join(out), index


def _exact(
    hay: str, needle: str, pre: str, post: str, whole_words: Callable[[int, int], int]
) -> tuple[int, int, float] | None:
    starts = []
    i = hay.find(needle)
    while i != -1:
        starts.append(i)
        i = hay.find(needle, i + 1)
    if not starts:
        return None
    n = len(needle)

    def fits(s: int) -> tuple[float, int]:
        # Agreement with the surrounding text first; then prefer a whole word ("negation")
        # to the same letters inside a longer one ("negations").
        before = fuzz.ratio(hay[max(0, s - len(pre)) : s], pre) if pre else 0
        after = fuzz.ratio(hay[s + n : s + n + len(post)], post) if post else 0
        return before + after, whole_words(s, s + n)

    best = max(starts, key=fits)  # max keeps the first of equals
    return best, best + n, 100.0


def _fuzzy(hay: str, needle: str) -> tuple[int, int, float] | None:
    if len(needle) < MIN_FUZZY or len(needle) > len(hay):
        return None
    m = fuzz.partial_ratio_alignment(needle, hay, score_cutoff=FUZZY_SCORE)
    if m is None or m.dest_end <= m.dest_start:
        return None
    start, end = _refine(hay, needle, m.dest_start, m.dest_end)
    return start, end, m.score


def _refine(hay: str, needle: str, start: int, end: int) -> tuple[int, int]:
    """Move each end of a fuzzy match to where the needle's own start and end line up.

    The alignment window is as long as the needle, so letters the needle has and the page
    lacks (a footnote mark) push it into the neighbouring word, which whole-word widening
    would then take in.
    """
    k = min(len(needle), 24)
    slop = min(12, len(needle) // 8 + 2)
    head, tail = needle[:k], needle[-k:]

    def best(lo: int, hi: int, origin: int, score) -> int:
        # Closest match, then the longest run of letters lining up exactly at the boundary
        # (a window two letters early and one two letters late score the same ratio), then
        # the one nearest where the alignment put it.
        return max(range(lo, hi + 1), key=lambda x: (*score(x), -abs(x - origin)))

    def head_fit(x: int) -> tuple[float, int]:
        window = hay[x : x + k]
        return fuzz.ratio(head, window), _common_prefix(head, window)

    def tail_fit(x: int) -> tuple[float, int]:
        window = hay[max(start, x - k) : x]
        return fuzz.ratio(tail, window), _common_prefix(tail[::-1], window[::-1])

    start = best(max(0, start - slop), start + slop, start, head_fit)
    end = best(max(start + 1, end - slop), min(len(hay), end + slop), end, tail_fit)
    return start, end


def _common_prefix(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a, b, strict=False):
        if x != y:
            break
        n += 1
    return n


def _whole_words(text: str, start: int, end: int) -> tuple[int, int]:
    while start > 0 and text[start - 1].isalnum():
        start -= 1
    while end < len(text) and text[end].isalnum():
        end += 1
    return start, end


def _paragraph_start(text: str, i: int) -> int:
    j = text.rfind("\n\n", 0, i)
    return 0 if j == -1 else j + 2


def _paragraph_end(text: str, i: int) -> int:
    j = text.find("\n\n", i)
    return len(text) if j == -1 else j
