"""Book chat: conversations about the open book, answered by the deep model.

A question goes to Gemini with the book (cached, inline, or excerpts, as for lookups: see
app/ai/context.py), the chat instructions (prompts/chat.md), as much of the conversation as
fits, and the page the reader is on. The answer streams back as it's written;
app/ai/replies.py runs each one in its own thread.
"""

import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import delete
from sqlmodel import Session, SQLModel, select

from app.ai import context
from app.ai.gemini import CacheMissing, Gemini, Turn, Usage
from app.ai.prompts import render
from app.config import get_settings
from app.models import Book, Conversation, Message, MessageStatus, Role
from app.models.base import utcnow
from app.search.fts import question_pages

MAX_MESSAGE_CHARS = 10_000
# Earlier messages sent with a question, the most recent first: about 12k tokens.
MAX_HISTORY_CHARS = 48_000
TITLE_CHARS = 80
# In excerpt mode: pages matching the question's words, and pages the last answer cited.
QUESTION_PAGES = 12
CITED_PAGES = 10

# As in frontend/src/panels/citations.ts: [p. 12], [pp. 12–14], [p. 12, 40].
_CITATION = re.compile(r"\[pp?\.\s*([^\]]+)\]")
_REF = re.compile(r"^(\d+)(?:\s*[–—-]\s*(\d+))?$")


class MessageOut(SQLModel):
    """A message as the API sends it, in responses and in the chat's event stream."""

    id: int
    conversation_id: int
    role: Role
    content: str
    page_number: int | None
    section: str | None
    citations: list[dict]
    status: MessageStatus
    model: str | None
    context_mode: str | None
    usage: dict
    created_at: datetime


@dataclass
class Answer:
    """What's known about an answer besides its text, filled in as it's written."""

    model: str
    context_mode: context.Mode | None = None
    usage: Usage = field(default_factory=Usage)
    complete: bool = True


def add_question(
    session: Session, conversation: Conversation, content: str, page: int, section: str | None
) -> Message:
    message = Message(
        conversation_id=conversation.id,
        role=Role.user,
        content=content,
        page_number=page,
        section=section,
    )
    if not conversation.title:
        conversation.title = title_for(content)
    conversation.updated_at = utcnow()
    session.add(message)
    session.commit()
    session.refresh(message)
    return message


def messages_of(session: Session, conversation_id: int) -> list[Message]:
    return list(
        session.exec(
            select(Message).where(Message.conversation_id == conversation_id).order_by(Message.id)
        ).all()
    )


def last_question(session: Session, conversation_id: int) -> Message | None:
    return session.exec(
        select(Message)
        .where(Message.conversation_id == conversation_id, Message.role == Role.user)
        .order_by(Message.id.desc())
    ).first()


def stream_answer(
    session: Session, gemini: Gemini, book: Book, question: Message, answer: Answer
) -> Iterator[str]:
    """The answer to `question`, in pieces as the model writes it. `answer` is filled in along
    the way. Closing the iterator stops the model."""
    history = [m for m in messages_of(session, question.conversation_id) if m.id < question.id]
    thinking = get_settings().chat_thinking
    for attempt in range(2):
        ctx = context.prepare(session, gemini, book, answer.model)
        answer.context_mode = ctx.mode
        stream = gemini.stream(
            answer.model,
            turns=build_turns(session, ctx, history, question),
            system=ctx.system,
            cache_name=ctx.cache.cache_name if ctx.cache else None,
            thinking=None if thinking == "default" else thinking,
        )
        # End the read transaction: the answer can take a minute to write.
        session.commit()
        wrote = False
        try:
            for piece in stream:
                wrote = True
                answer.usage = stream.usage
                yield piece
        except CacheMissing:
            # Expired or deleted early on Gemini's side, which shows at the first chunk:
            # rebuild it once and ask again.
            if attempt or wrote or ctx.cache is None:
                raise
            context.forget(session, ctx.cache)
            continue
        finally:
            stream.close()
        answer.usage = stream.usage
        answer.complete = stream.complete
        return


def build_turns(
    session: Session, ctx: context.BookContext, history: list[Message], question: Message
) -> list[Turn]:
    """The conversation as the model gets it: the book (unless cached) and the chat
    instructions, then the recent messages, then the question."""
    earlier = _recent(history)
    focus: list[int] = []
    if ctx.mode == "excerpt":
        matches = question_pages(session, ctx.book_id, question.content, QUESTION_PAGES)
        focus = [question.page_number or 1, *matches, *_last_cited(earlier)]
    lead = [*ctx.contents(session, focus, excerpts="chat_excerpts"), render("chat")]
    turns = [Turn("user", tuple(lead))]
    for m in [*earlier, question]:
        if m.role == Role.user:
            turns.append(Turn("user", (_as_question(m),)))
        else:
            turns.append(Turn("model", (m.content,)))
    return _merge(turns)


def save_answer(
    session: Session,
    conversation_id: int,
    question_id: int,
    text: str,
    status: MessageStatus,
    answer: Answer,
) -> Message | None:
    """Save an answer to the conversation's last question, replacing any earlier answer to it.
    Returns None if the conversation was deleted while the answer was written."""
    conversation = session.get(Conversation, conversation_id)
    if conversation is None:
        return None
    book = session.get_one(Book, conversation.book_id)
    session.exec(
        delete(Message).where(Message.conversation_id == conversation_id, Message.id > question_id)
    )
    message = Message(
        conversation_id=conversation_id,
        role=Role.assistant,
        content=text,
        citations=citations_in(text, book.id, book.page_count),
        status=status,
        model=answer.model,
        context_mode=answer.context_mode,
        usage=answer.usage.as_dict(),
    )
    conversation.updated_at = utcnow()
    session.add(message)
    session.commit()
    session.refresh(message)
    return message


def citations_in(text: str, book_id: int, page_count: int | None) -> list[dict]:
    """The pages an answer cites, in order of first mention. Like the frontend, a bracket
    holding anything but pages of this book isn't a citation."""
    found: dict[tuple[int, int | None], None] = {}
    for match in _CITATION.finditer(text):
        refs = _refs(match.group(1), page_count)
        for ref in refs or []:
            found.setdefault(ref)
    return [
        {"book_id": book_id, "page": page, **({"end": end} if end else {})} for page, end in found
    ]


def title_for(text: str) -> str:
    """A conversation's title: its first question on one line, cut at a word if it's long."""
    line = " ".join(text.split())
    if len(line) <= TITLE_CHARS:
        return line
    cut = line[: TITLE_CHARS - 1]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:.-–—") + "…"


def _refs(inner: str, page_count: int | None) -> list[tuple[int, int | None]] | None:
    def in_book(n: int) -> bool:
        return n >= 1 and (page_count is None or n <= page_count)

    refs = []
    for item in re.split(r"[,;]", inner):
        m = _REF.match(item.strip())
        if not m:
            return None
        page, end = int(m.group(1)), int(m.group(2)) if m.group(2) else None
        if not in_book(page) or (end is not None and (end < page or not in_book(end))):
            return None
        refs.append((page, end if end != page else None))
    return refs


def _recent(history: list[Message]) -> list[Message]:
    """The latest messages that fit the history budget, starting with a question."""
    kept: list[Message] = []
    used = 0
    for m in reversed(history):
        used += len(m.content)
        if used > MAX_HISTORY_CHARS:
            break
        kept.append(m)
    kept.reverse()
    while kept and kept[0].role != Role.user:
        kept.pop(0)
    return kept


def _last_cited(messages: list[Message]) -> list[int]:
    for m in reversed(messages):
        if m.role == Role.assistant:
            return [c["page"] for c in m.citations][:CITED_PAGES]
    return []


def _as_question(m: Message) -> str:
    section = f", in “{m.section}”" if m.section else ""
    return render("question", page=m.page_number, section=section, message=m.content)


def _merge(turns: list[Turn]) -> list[Turn]:
    """Join consecutive turns from the same side (a question left unanswered, and the next),
    so the conversation alternates."""
    merged: list[Turn] = []
    for t in turns:
        if merged and merged[-1].role == t.role:
            merged[-1] = Turn(t.role, merged[-1].parts + t.parts)
        else:
            merged.append(t)
    return merged
