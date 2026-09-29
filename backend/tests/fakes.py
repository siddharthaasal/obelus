"""A stand-in for app.ai.gemini.Gemini that records calls and returns canned answers."""

import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.ai.gemini import CacheInfo, CacheMissing, GeminiError, Generated, Usage
from app.ai.schemas import (
    DefineResult,
    ExplainResult,
    KeyTerm,
    PageNote,
    WhoResult,
)
from app.models.base import utcnow

# Messy on purpose (a blank optional field, pages out of order, repeated, and past the end)
# to exercise the cleanup applied before saving.
ANSWERS = {
    DefineResult: DefineResult(
        term="negation",
        in_context="For the author, negation drives thought forward [p. 1].",
        general="  ",
        across_book="Hegel makes it determinate [p. 2].",
        key_pages=[
            PageNote(page=2, note=" Hegel's determinate negation "),
            PageNote(page=1, note="Introduced"),
            PageNote(page=2, note="Repeated"),
            PageNote(page=99, note="Past the end"),
        ],
    ),
    WhoResult: WhoResult(
        name="Immanuel Kant",
        relation_label="source",
        bio="German philosopher (1724–1804).",
        relation="The book starts from his account of apperception [p. 1].",
        here="Cited for the unity of self-consciousness.",
        key_pages=[],
    ),
    ExplainResult: ExplainResult(
        restatement="Each philosophy begins by rejecting the last.",
        key_terms=[KeyTerm(term="negation", meaning="Rejecting a view while building on it.")],
        in_argument="It opens the chapter [p. 1] and sets up Hegel [p. 2].",
        related_pages=[PageNote(page=2, note="Hegel's reply")],
    ),
}


# A chat answer, as the pieces it streams in.
CHAT_PIECES = [
    "Negation drives ",
    "thought forward [p. 1]. ",
    "Hegel makes it determinate [pp. 2–3].",
]


@dataclass
class FakeStream:
    pieces: list[str]
    fail: Exception | None = None  # raised at the first read, as the real request would be
    fail_after_first: Exception | None = None
    finish_reason: str = "STOP"
    # Set just before waiting on `hold`: the first piece has been handed over.
    waiting: threading.Event = field(default_factory=threading.Event)
    hold: threading.Event | None = None
    usage: Usage = field(default_factory=Usage)
    closed: bool = False

    @property
    def complete(self) -> bool:
        return self.finish_reason == "STOP"

    def __iter__(self):
        if self.fail:
            raise self.fail
        for i, piece in enumerate(self.pieces):
            if i == 1 and self.hold:
                self.waiting.set()
                assert self.hold.wait(10), "the test never released the stream"
            if i == 1 and self.fail_after_first:
                raise self.fail_after_first
            self.usage = Usage(input=1200, cached=0, output=20 * (i + 1), thinking=40)
            yield piece

    def close(self) -> None:
        self.closed = True


@dataclass
class FakeCache:
    model: str
    system: str
    text: str
    expires_at: datetime


@dataclass
class FakeGemini:
    input_limit: int = 1_048_576
    # Raise this from the next generate() call.
    fail_next: Exception | None = None
    # Refuse to create caches, as Gemini does for content below its minimum size.
    reject_caches: bool = False
    # Chat: what the next streams write, and how they end.
    chat_pieces: list[str] = field(default_factory=lambda: list(CHAT_PIECES))
    chat_finish: str = "STOP"
    fail_mid_stream: Exception | None = None  # raised after the first piece
    hold: threading.Event | None = None  # after the first piece, wait until it's set
    streams: list[FakeStream] = field(default_factory=list)
    caches: dict[str, FakeCache] = field(default_factory=dict)
    calls: list[tuple[str, dict]] = field(default_factory=list)
    _n: int = 0

    def called(self, name: str) -> list[dict]:
        return [kw for n, kw in self.calls if n == name]

    def input_token_limit(self, model: str) -> int:
        return self.input_limit

    def create_cache(
        self, model: str, *, system: str, text: str, ttl_seconds: int, display_name: str
    ) -> CacheInfo:
        self.calls.append(("create_cache", {"model": model, "system": system, "text": text}))
        if self.reject_caches:
            raise GeminiError("Cached content is too small", 400)
        self._n += 1
        name = f"cachedContents/fake-{self._n}"
        expires = utcnow() + timedelta(seconds=ttl_seconds)
        self.caches[name] = FakeCache(model, system, text, expires)
        return CacheInfo(name=name, expires_at=expires, token_count=len(text) // 4)

    def extend_cache(self, name: str, ttl_seconds: int) -> datetime:
        self.calls.append(("extend_cache", {"name": name}))
        if name not in self.caches:
            raise CacheMissing("gone", 404)
        self.caches[name].expires_at = utcnow() + timedelta(seconds=ttl_seconds)
        return self.caches[name].expires_at

    def delete_cache(self, name: str) -> None:
        self.calls.append(("delete_cache", {"name": name}))
        self.caches.pop(name, None)

    def generate(self, model, schema, *, contents, system=None, cache_name=None, thinking=None):
        self.calls.append(
            (
                "generate",
                {
                    "model": model,
                    "schema": schema,
                    "contents": contents,
                    "system": system,
                    "cache_name": cache_name,
                    "thinking": thinking,
                },
            )
        )
        if self.fail_next:
            error, self.fail_next = self.fail_next, None
            raise error
        if cache_name and cache_name not in self.caches:
            raise CacheMissing("gone", 403)
        usage = Usage(input=1200, cached=1000 if cache_name else 0, output=80, thinking=40)
        return Generated(result=ANSWERS[schema], usage=usage)

    def stream(self, model, *, turns, system=None, cache_name=None, thinking=None) -> FakeStream:
        self.calls.append(
            (
                "stream",
                {
                    "model": model,
                    "turns": turns,
                    "system": system,
                    "cache_name": cache_name,
                    "thinking": thinking,
                },
            )
        )
        fail = None
        if self.fail_next:
            fail, self.fail_next = self.fail_next, None
        elif cache_name and cache_name not in self.caches:
            fail = CacheMissing("gone", 403)
        stream = FakeStream(
            pieces=list(self.chat_pieces),
            fail=fail,
            fail_after_first=self.fail_mid_stream,
            finish_reason=self.chat_finish,
            hold=self.hold,
        )
        self.streams.append(stream)
        return stream
