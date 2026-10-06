"""Page citations in model-written text: [p. 12], [pp. 12–14], [p. 12, 40].

Parsed as frontend/src/panels/citations.ts does: a bracket holding anything but pages of the
book, like "[to grasp what thinking is]" inside a quotation, isn't a citation.
"""

import re
from collections.abc import Callable

CITATION = re.compile(r"\[(pp?)\.\s*([^\]]+)\]")
_REF = re.compile(r"^(\d+)(?:\s*[–—-]\s*(\d+))?$")

Ref = tuple[int, int | None]  # a page, and the last page of a span


def refs(inner: str, page_count: int | None) -> list[Ref] | None:
    """The pages inside a citation's brackets, or None if it isn't one."""

    def in_book(n: int) -> bool:
        return n >= 1 and (page_count is None or n <= page_count)

    found = []
    for item in re.split(r"[,;]", inner):
        m = _REF.match(item.strip())
        if not m:
            return None
        page, end = int(m.group(1)), int(m.group(2)) if m.group(2) else None
        if not in_book(page) or (end is not None and (end < page or not in_book(end))):
            return None
        found.append((page, end if end != page else None))
    return found


def cited(text: str, page_count: int | None) -> list[Ref]:
    """Every page cited in `text`, once each, in order of first mention."""
    found: dict[Ref, None] = {}
    for match in CITATION.finditer(text):
        for ref in refs(match.group(2), page_count) or []:
            found.setdefault(ref)
    return list(found)


def relabel(text: str, page_count: int | None, label: Callable[[int], str]) -> str:
    """Citations rewritten with other page names, such as the printed ones."""

    def rewrite(match: re.Match) -> str:
        found = refs(match.group(2), page_count)
        if found is None:
            return match.group(0)
        spans = any(end for _, end in found) or len(found) > 1
        names = [f"{label(p)}–{label(e)}" if e else label(p) for p, e in found]
        return f"[{'pp' if spans else 'p'}. {', '.join(names)}]"

    return CITATION.sub(rewrite, text)
