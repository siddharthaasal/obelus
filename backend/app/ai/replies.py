"""Chat answers being written, each in its own thread.

A reply runs apart from the request that asked for it; the HTTP response only follows its
events. So an answer is finished and saved even if the reader closes the book midway, a
reader who comes back (or opens a second tab) picks the stream up where it is, and Stop ends
it at once, keeping what was written. One answer at a time per conversation.

Events, sent as server-sent events:
- delta {"text"}: the next piece of the answer.
- done {"message"}: the saved answer, or null if it was stopped before any text.
- error {"detail", "status"}: nothing was saved; the question can be answered again.
"""

import json
import logging
import threading
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass

import anyio
from fastapi.encoders import jsonable_encoder
from sqlmodel import Session

from app.ai import chat
from app.ai.gemini import GeminiError, require_gemini
from app.config import get_settings
from app.db import engine
from app.models import Book, Message, MessageStatus

log = logging.getLogger("uvicorn.error")

# A comment goes down a quiet stream this often (while a cache is made, or the model
# thinks), so proxies don't take it for a dead connection.
KEEPALIVE_SECONDS = 15.0
FAILED = "Something went wrong while writing the answer. Try again."

_running: dict[int, "Reply"] = {}  # by conversation id
_guard = threading.Lock()


class Busy(Exception):
    """The conversation already has an answer being written."""


@dataclass(frozen=True)
class Event:
    name: str
    data: dict

    def sse(self) -> str:
        return f"event: {self.name}\ndata: {json.dumps(jsonable_encoder(self.data))}\n\n"


def claim(book_id: int, conversation_id: int) -> "Reply":
    """Reserve the conversation for a new answer, before its question is saved. Then
    `start` it, or `release` it if the question couldn't be saved."""
    with _guard:
        if conversation_id in _running:
            raise Busy
        reply = _running[conversation_id] = Reply(book_id, conversation_id)
    return reply


def running(conversation_id: int) -> "Reply | None":
    with _guard:
        return _running.get(conversation_id)


class Reply:
    def __init__(self, book_id: int, conversation_id: int):
        self.book_id = book_id
        self.conversation_id = conversation_id
        self.question_id: int | None = None
        self._answer = chat.Answer(model=get_settings().model_deep)
        self._stop = threading.Event()
        # Guards the text and events, and wakes followers when they change.
        self._changed = threading.Condition()
        self._text: list[str] = []
        self._events: list[Event] = []
        self._closing = False
        self._finished = False
        # Held while the answer is saved: finishing and stopping can race.
        self._concluding = threading.Lock()

    def start(self, question_id: int) -> None:
        self.question_id = question_id
        threading.Thread(
            target=self._run, name=f"reply-{self.conversation_id}", daemon=True
        ).start()

    def release(self) -> None:
        """Give up a claim that was never started."""
        self._unregister()

    def stop(self) -> None:
        """Stop writing. What's been written so far is saved."""
        self._stop.set()
        self._conclude(MessageStatus.stopped)

    def discard(self) -> None:
        """Stop writing and save nothing: the conversation is being deleted."""
        self._stop.set()
        self._conclude(None, Event("done", {"message": None}))

    async def sse(self, first: Iterable[Event] = ()) -> AsyncIterator[str]:
        """The events as server-sent events: `first`, then everything so far, then each new
        one until the answer ends."""
        for event in first:
            yield event.sse()
        seen = 0
        while True:
            events, finished = await anyio.to_thread.run_sync(
                self._events_after, seen, KEEPALIVE_SECONDS, abandon_on_cancel=True
            )
            if not events and not finished:
                yield ": keepalive\n\n"
            for event in events:
                yield event.sse()
            seen += len(events)
            if finished:
                return

    def _run(self) -> None:
        try:
            with Session(engine) as session:
                book = session.get_one(Book, self.book_id)
                question = session.get_one(Message, self.question_id)
                pieces = chat.stream_answer(session, require_gemini(), book, question, self._answer)
                try:
                    for piece in pieces:
                        if self._stop.is_set() or not self._write(piece):
                            break
                finally:
                    pieces.close()
            if self._answer.complete:
                self._conclude(MessageStatus.complete)
            else:
                self._conclude(MessageStatus.truncated)
        except GeminiError as e:
            self._conclude(None, Event("error", {"detail": e.message, "status": e.http_status}))
        except Exception:
            log.exception("chat: couldn't answer message %s", self.question_id)
            self._conclude(None, Event("error", {"detail": FAILED, "status": 500}))

    def _write(self, piece: str) -> bool:
        with self._changed:
            if self._closing:
                return False
            self._text.append(piece)
            self._events.append(Event("delta", {"text": piece}))
            self._changed.notify_all()
            return True

    def _conclude(self, status: MessageStatus | None, event: Event | None = None) -> None:
        """End the answer: save it with `status`, or, with no status, save nothing and send
        `event`. The first call wins."""
        with self._concluding:
            with self._changed:
                if self._closing:
                    return
                self._closing = True
                text = "".join(self._text).strip()
            if status is not None:
                message = None
                if text and self.question_id is not None:
                    try:
                        with Session(engine) as session:
                            message = chat.save_answer(
                                session,
                                self.conversation_id,
                                self.question_id,
                                text,
                                status,
                                self._answer,
                            )
                    except Exception:
                        log.exception("chat: couldn't save the answer to %s", self.question_id)
                        event = Event("error", {"detail": FAILED, "status": 500})
                shown = message and chat.MessageOut.model_validate(message)
                event = event or Event("done", {"message": shown})
            # Free the conversation before anyone hears it's done, so a follow-up question
            # sent straight away isn't turned down as busy.
            self._unregister()
            with self._changed:
                self._events.append(event)
                self._finished = True
                self._changed.notify_all()

    def _events_after(self, seen: int, timeout: float) -> tuple[list[Event], bool]:
        with self._changed:
            if seen >= len(self._events) and not self._finished:
                self._changed.wait(timeout)
            return self._events[seen:], self._finished

    def _unregister(self) -> None:
        with _guard:
            if _running.get(self.conversation_id) is self:
                del _running[self.conversation_id]
