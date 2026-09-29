"""Prompts live in this folder as plain Markdown, so they can be tuned without touching code.

Placeholders are written {{name}}, and every one must be filled: a typo raises instead of
sending "{{titel}}" to the model. <!-- HTML comments --> are notes for whoever edits the file
and are stripped before sending. Files are read on each use, so edits apply without a restart.
"""

import re
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent

_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")
_COMMENT = re.compile(r"<!--.*?-->", re.S)


def render(name: str, /, **values: object) -> str:
    template = _COMMENT.sub("", (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8"))
    missing = set(_PLACEHOLDER.findall(template)) - values.keys()
    if missing:
        raise KeyError(f"prompts/{name}.md needs {', '.join(sorted(missing))}")
    return _PLACEHOLDER.sub(lambda m: str(values[m.group(1)]), template).strip()
