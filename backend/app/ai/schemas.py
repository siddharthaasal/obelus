"""The shapes of the model's answers, sent to Gemini as response schemas.

What goes in each field is described in the prompt files (app/ai/prompts/), where it can be
tuned. Renaming or adding a field here means updating the prompt and the frontend's types.
"""

from pydantic import BaseModel

from app.models import LookupKind


class PageNote(BaseModel):
    page: int
    note: str


class KeyTerm(BaseModel):
    term: str
    meaning: str


class DefineResult(BaseModel):
    term: str
    in_context: str
    general: str | None
    across_book: str | None
    key_pages: list[PageNote]


class WhoResult(BaseModel):
    name: str
    relation_label: str
    bio: str
    relation: str
    here: str
    key_pages: list[PageNote]


class ExplainResult(BaseModel):
    restatement: str
    key_terms: list[KeyTerm]
    in_argument: str
    related_pages: list[PageNote]


RESULTS: dict[LookupKind, type[BaseModel]] = {
    LookupKind.define: DefineResult,
    LookupKind.who: WhoResult,
    LookupKind.explain: ExplainResult,
}
