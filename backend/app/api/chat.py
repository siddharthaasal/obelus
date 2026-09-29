from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import field_validator
from sqlalchemy import func
from sqlmodel import Field, Session, SQLModel, select

from app.ai import chat, replies
from app.ai.chat import MessageOut
from app.ai.gemini import NOT_CONFIGURED, gemini_client
from app.ai.replies import Busy, Event, Reply
from app.api.deps import get_book_or_404, require_ready
from app.db import SessionDep
from app.models import Book, Conversation, Message

router = APIRouter(prefix="/books/{book_id}/conversations", tags=["chat"])

BUSY = "An answer is still being written. Wait for it, or stop it."
# What streaming endpoints answer with: server-sent events, described in app/ai/replies.py,
# after a `user` event when a question was just saved.
EVENT_STREAM = {200: {"content": {"text/event-stream": {}}, "description": "Server-sent events"}}


class MessageIn(SQLModel):
    content: str = Field(max_length=chat.MAX_MESSAGE_CHARS)
    # The page the reader is on, and its section in the table of contents, if any.
    page: int = Field(ge=1)
    section: str | None = Field(default=None, max_length=500)

    @field_validator("content")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Write a message first")
        return v.strip()

    @field_validator("section")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        v = " ".join((v or "").split())
        return v or None


class ConversationOut(SQLModel):
    id: int
    book_id: int
    title: str
    message_count: int
    # An answer is being written now; follow it with GET .../reply.
    answering: bool
    created_at: datetime
    updated_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


@router.get("")
def list_conversations(book_id: int, session: SessionDep) -> list[ConversationOut]:
    """A book's chats, the most recently active first."""
    get_book_or_404(session, book_id)
    rows = session.exec(
        select(Conversation, func.count(Message.id))
        .join(Message, isouter=True)
        .where(Conversation.book_id == book_id)
        .group_by(Conversation.id)
        .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
    ).all()
    return [_out(c, n) for c, n in rows]


@router.post("", responses=EVENT_STREAM)
def start_conversation(book_id: int, body: MessageIn, session: SessionDep) -> StreamingResponse:
    """Start a chat with its first question. The answer streams back as server-sent events,
    after a `user` event with the new conversation and the saved question."""
    book = _chat_ready(session, book_id)
    conversation = Conversation(book_id=book.id)
    session.add(conversation)
    session.flush()
    return _ask(session, conversation, body)


@router.get("/{conversation_id}")
def get_conversation(book_id: int, conversation_id: int, session: SessionDep) -> ConversationDetail:
    conversation = _conversation_or_404(session, book_id, conversation_id)
    messages = chat.messages_of(session, conversation.id)
    return ConversationDetail(
        **_out(conversation, len(messages)).model_dump(),
        messages=[MessageOut.model_validate(m) for m in messages],
    )


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(book_id: int, conversation_id: int, session: SessionDep) -> None:
    conversation = _conversation_or_404(session, book_id, conversation_id)
    if reply := replies.running(conversation.id):
        reply.discard()
    session.delete(conversation)
    session.commit()


@router.post("/{conversation_id}/messages", responses=EVENT_STREAM)
def send_message(
    book_id: int, conversation_id: int, body: MessageIn, session: SessionDep
) -> StreamingResponse:
    """Ask a question in a chat. The answer streams back as server-sent events, after a
    `user` event with the saved question."""
    _chat_ready(session, book_id)
    conversation = _conversation_or_404(session, book_id, conversation_id)
    return _ask(session, conversation, body)


@router.post("/{conversation_id}/reply", responses=EVENT_STREAM)
def answer_again(book_id: int, conversation_id: int, session: SessionDep) -> StreamingResponse:
    """Answer the chat's last question again: after an error or a stop, or for a different
    answer. The new answer replaces the old one once it's written."""
    _chat_ready(session, book_id)
    conversation = _conversation_or_404(session, book_id, conversation_id)
    reply = _claim(conversation)
    question = chat.last_question(session, conversation.id)
    if question is None:
        reply.release()
        raise HTTPException(status.HTTP_409_CONFLICT, "This chat has no question to answer")
    reply.start(question.id)
    return _stream(reply)


@router.get("/{conversation_id}/reply", responses=EVENT_STREAM)
def follow_reply(book_id: int, conversation_id: int, session: SessionDep) -> StreamingResponse:
    """Follow the answer being written, from its start: for a reader who left and came back.
    404 when no answer is being written."""
    conversation = _conversation_or_404(session, book_id, conversation_id)
    reply = replies.running(conversation.id)
    if reply is None or reply.question_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No answer is being written")
    return _stream(reply)


@router.post("/{conversation_id}/stop", status_code=status.HTTP_204_NO_CONTENT)
def stop_reply(book_id: int, conversation_id: int, session: SessionDep) -> None:
    """Stop the answer being written. What it says so far is kept."""
    conversation = _conversation_or_404(session, book_id, conversation_id)
    if reply := replies.running(conversation.id):
        reply.stop()


def _ask(session: Session, conversation: Conversation, body: MessageIn) -> StreamingResponse:
    reply = _claim(conversation)
    try:
        question = chat.add_question(session, conversation, body.content, body.page, body.section)
    except BaseException:
        reply.release()
        raise
    reply.start(question.id)
    saved = Event(
        "user",
        {
            "conversation": _out(conversation, _count(session, conversation.id)),
            "message": MessageOut.model_validate(question),
        },
    )
    return _stream(reply, saved)


def _stream(reply: Reply, *first: Event) -> StreamingResponse:
    return StreamingResponse(
        reply.sse(first),
        media_type="text/event-stream",
        # Keep proxies from buffering or caching the stream.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _chat_ready(session: Session, book_id: int) -> Book:
    """Chat needs the book's text and a key; check both before anything is saved."""
    book = get_book_or_404(session, book_id)
    require_ready(book)
    if gemini_client() is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, NOT_CONFIGURED)
    return book


def _claim(conversation: Conversation) -> Reply:
    try:
        return replies.claim(conversation.book_id, conversation.id)
    except Busy as e:
        raise HTTPException(status.HTTP_409_CONFLICT, BUSY) from e


def _conversation_or_404(session: Session, book_id: int, conversation_id: int) -> Conversation:
    conversation = session.get(Conversation, conversation_id)
    if conversation is None or conversation.book_id != book_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat not found")
    return conversation


def _count(session: Session, conversation_id: int) -> int:
    return session.exec(
        select(func.count(Message.id)).where(Message.conversation_id == conversation_id)
    ).one()


def _out(conversation: Conversation, message_count: int) -> ConversationOut:
    return ConversationOut.model_validate(
        conversation,
        update={
            "message_count": message_count,
            "answering": replies.running(conversation.id) is not None,
        },
    )
