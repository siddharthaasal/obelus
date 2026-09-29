import json
import threading
from datetime import timedelta

import pytest
from sqlalchemy import func
from sqlmodel import Session, select

from app.ai import chat, context
from app.ai.gemini import GeminiError
from app.config import get_settings
from app.db import engine
from app.models import Message, Role
from app.models.base import utcnow
from tests.factory import make_book_pdf
from tests.fakes import CHAT_PIECES
from tests.test_ingest import upload

ANSWER = "".join(CHAT_PIECES)


@pytest.fixture
def book(client, run_jobs, tmp_path) -> dict:
    book = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]
    run_jobs()
    return book


def events(res) -> list[tuple[str, dict]]:
    """A server-sent event stream as (event, data) pairs, without keepalive comments."""
    out = []
    for block in res.text.split("\n\n"):
        lines = [line for line in block.splitlines() if not line.startswith(":")]
        if not lines:
            continue
        fields = dict(line.split(": ", 1) for line in lines)
        out.append((fields["event"], json.loads(fields["data"])))
    return out


def ask(client, book_id, content, page=1, conversation=None, **extra):
    url = f"/api/books/{book_id}/conversations"
    if conversation is not None:
        url += f"/{conversation}/messages"
    return client.post(url, json={"content": content, "page": page, **extra})


def written(evs) -> str:
    return "".join(data["text"] for name, data in evs if name == "delta")


def in_background(fn):
    """Run a request on another thread, for tests that act while an answer is written."""
    out: dict = {}
    thread = threading.Thread(target=lambda: out.update(res=fn()))
    thread.start()
    return thread, out


def test_first_question_starts_a_chat(client, gemini, book):
    res = ask(client, book["id"], "  What drives thought?  ", page=2, section=" Chapter  One ")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    evs = events(res)

    name, saved = evs[0]
    assert name == "user"
    conversation = saved["conversation"]
    assert conversation["title"] == "What drives thought?"
    assert conversation["answering"] is True
    question = saved["message"]
    assert (question["role"], question["content"]) == ("user", "What drives thought?")
    assert (question["page_number"], question["section"]) == (2, "Chapter One")

    assert [n for n, _ in evs[1:-1]] == ["delta"] * len(CHAT_PIECES)
    assert written(evs) == ANSWER
    name, done = evs[-1]
    assert name == "done"
    answer = done["message"]
    assert answer["role"] == "assistant"
    assert answer["content"] == ANSWER
    assert answer["status"] == "complete"
    assert answer["model"] == get_settings().model_deep
    assert answer["context_mode"] == "inline"
    assert answer["usage"] == {"input": 1200, "cached": 0, "output": 60, "thinking": 40}
    assert answer["citations"] == [
        {"book_id": book["id"], "page": 1},
        {"book_id": book["id"], "page": 2, "end": 3},
    ]

    [call] = gemini.called("stream")
    assert call["model"] == get_settings().model_deep
    assert call["cache_name"] is None
    assert call["thinking"] is None  # CHAT_THINKING=default leaves it to the model
    assert "reading companion for one book, “A Test Book”" in call["system"]
    [turn] = call["turns"]  # the book, the chat instructions, and the question: one user turn
    assert turn.role == "user"
    book_text, instructions, asked = turn.parts
    assert book_text.startswith("<book>\n[p. 1]")
    assert instructions.startswith("The reader now wants to talk the book through")
    assert asked == (
        "<reading>The reader is on [p. 2], in “Chapter One”.</reading>\n\nWhat drives thought?"
    )

    # What streamed is what was saved.
    got = client.get(f"/api/books/{book['id']}/conversations/{conversation['id']}").json()
    assert got["messages"] == [question, answer]
    assert got["answering"] is False
    assert got["message_count"] == 2


def test_follow_ups_carry_the_conversation(client, gemini, book):
    first = events(ask(client, book["id"], "What drives thought?"))
    cid = first[0][1]["conversation"]["id"]
    gemini.chat_pieces = ["It returns ", "on [p. 2]."]
    res = ask(client, book["id"], "And after that?", page=3, conversation=cid)
    evs = events(res)
    assert evs[0][0] == "user" and evs[0][1]["conversation"]["title"] == "What drives thought?"
    assert written(evs) == "It returns on [p. 2]."

    turns = gemini.called("stream")[-1]["turns"]
    assert [t.role for t in turns] == ["user", "model", "user"]
    assert turns[0].parts[-1].endswith("What drives thought?")
    assert turns[1].parts == (ANSWER,)
    assert turns[2].parts == ("<reading>The reader is on [p. 3].</reading>\n\nAnd after that?",)

    listed = client.get(f"/api/books/{book['id']}/conversations").json()
    assert [(c["id"], c["message_count"]) for c in listed] == [(cid, 4)]


def test_chats_list_most_recent_first(client, gemini, book):
    a = events(ask(client, book["id"], "First chat"))[0][1]["conversation"]["id"]
    b = events(ask(client, book["id"], "Second chat"))[0][1]["conversation"]["id"]
    assert [c["id"] for c in client.get(f"/api/books/{book['id']}/conversations").json()] == [b, a]
    events(ask(client, book["id"], "Back to the first", conversation=a))
    assert [c["id"] for c in client.get(f"/api/books/{book['id']}/conversations").json()] == [a, b]


def test_chat_uses_the_book_cache(client, gemini, book, monkeypatch):
    monkeypatch.setattr(context, "MIN_CACHE_TOKENS", 0)
    res = client.post(f"/api/books/{book['id']}/context", params={"purpose": "chat"})
    assert res.status_code == 200, res.text
    assert res.json()["model"] == get_settings().model_deep
    [created] = gemini.called("create_cache")
    assert created["model"] == get_settings().model_deep

    evs = events(ask(client, book["id"], "What drives thought?"))
    assert evs[-1][1]["message"]["context_mode"] == "cached"
    [call] = gemini.called("stream")
    assert call["cache_name"] in gemini.caches
    # With the book cached, only the instructions and the question are sent.
    [turn] = call["turns"]
    assert len(turn.parts) == 2 and turn.parts[0].startswith("The reader now wants")

    # A cache gone early is rebuilt, and the question asked again.
    gemini.caches.clear()
    evs = events(ask(client, book["id"], "Again?", conversation=evs[0][1]["conversation"]["id"]))
    assert evs[-1][0] == "done", evs
    assert len(gemini.called("create_cache")) == 2
    assert len(gemini.called("stream")) == 3


def test_long_books_send_excerpts(client, gemini, book, monkeypatch):
    monkeypatch.setattr(context, "HEADROOM_TOKENS", 0)
    gemini.input_limit = 10  # every book is too long
    evs = events(ask(client, book["id"], "What does Hegel say about negations?", page=5))
    assert evs[-1][1]["message"]["context_mode"] == "excerpt"
    excerpts = gemini.called("stream")[0]["turns"][0].parts[0]
    assert excerpts.startswith("The whole book is too long to include, so here are excerpts")
    # Pages 3 to 7 surround the reader; 1 and 2 match the question's words.
    for n in range(1, 8):
        assert f"[p. {n}]" in excerpts


def test_an_error_saves_the_question_for_another_try(client, gemini, book):
    gemini.fail_next = GeminiError("Gemini's rate limit or quota is used up.", 429)
    evs = events(ask(client, book["id"], "What drives thought?"))
    assert [n for n, _ in evs] == ["user", "error"]
    assert evs[1][1] == {"detail": "Gemini's rate limit or quota is used up.", "status": 429}
    cid = evs[0][1]["conversation"]["id"]
    url = f"/api/books/{book['id']}/conversations/{cid}"
    assert [m["role"] for m in client.get(url).json()["messages"]] == ["user"]

    # Answer it after all.
    evs = events(client.post(f"{url}/reply"))
    assert [n for n, _ in evs][-1] == "done"
    assert written(evs) == ANSWER
    assert [m["role"] for m in client.get(url).json()["messages"]] == ["user", "assistant"]


def test_an_error_partway_saves_no_answer(client, gemini, book):
    gemini.fail_mid_stream = GeminiError("Couldn't reach Gemini: ReadError")
    evs = events(ask(client, book["id"], "What drives thought?"))
    assert [n for n, _ in evs] == ["user", "delta", "error"]
    assert gemini.streams[0].closed
    cid = evs[0][1]["conversation"]["id"]
    got = client.get(f"/api/books/{book['id']}/conversations/{cid}").json()
    assert [m["role"] for m in got["messages"]] == ["user"]


def test_asking_again_replaces_the_last_answer(client, gemini, book):
    evs = events(ask(client, book["id"], "What drives thought?"))
    cid, old = evs[0][1]["conversation"]["id"], evs[-1][1]["message"]
    gemini.chat_pieces = ["A different answer [p. 3]."]
    evs = events(client.post(f"/api/books/{book['id']}/conversations/{cid}/reply"))
    new = evs[-1][1]["message"]
    assert new["id"] != old["id"]
    assert new["citations"] == [{"book_id": book["id"], "page": 3}]
    messages = client.get(f"/api/books/{book['id']}/conversations/{cid}").json()["messages"]
    assert [m["content"] for m in messages] == [
        "What drives thought?",
        "A different answer [p. 3].",
    ]
    # The old answer isn't part of the conversation the model sees.
    assert [t.role for t in gemini.called("stream")[-1]["turns"]] == ["user"]


def test_stop_keeps_what_was_written(client, gemini, book):
    gemini.hold = threading.Event()
    thread, out = in_background(lambda: ask(client, book["id"], "What drives thought?"))
    try:
        while not gemini.streams:
            pass
        assert gemini.streams[0].waiting.wait(5)
        [conversation] = client.get(f"/api/books/{book['id']}/conversations").json()
        url = f"/api/books/{book['id']}/conversations/{conversation['id']}"
        assert conversation["answering"] is True
        # One answer at a time.
        assert ask(client, book["id"], "Hello?", conversation=conversation["id"]).status_code == 409
        assert client.post(f"{url}/stop").status_code == 204
    finally:
        gemini.hold.set()
        thread.join(10)

    evs = events(out["res"])
    assert [n for n, _ in evs] == ["user", "delta", "done"]
    stopped = evs[-1][1]["message"]
    assert (stopped["content"], stopped["status"]) == ("Negation drives", "stopped")
    got = client.get(url).json()
    assert got["answering"] is False
    assert got["messages"][-1] == stopped
    assert gemini.streams[0].closed


def test_a_reader_who_comes_back_follows_the_answer(client, gemini, book):
    gemini.hold = threading.Event()
    thread, out = in_background(lambda: ask(client, book["id"], "What drives thought?"))
    try:
        while not gemini.streams:
            pass
        assert gemini.streams[0].waiting.wait(5)
        [conversation] = client.get(f"/api/books/{book['id']}/conversations").json()
        url = f"/api/books/{book['id']}/conversations/{conversation['id']}"
        follower, followed = in_background(lambda: client.get(f"{url}/reply"))
    finally:
        gemini.hold.set()
        thread.join(10)
    follower.join(10)

    # The follower gets the whole answer, including what was written before it arrived.
    evs = events(followed["res"])
    assert written(evs) == ANSWER
    assert evs[-1][1]["message"]["content"] == ANSWER
    assert events(out["res"])[-1] == evs[-1]
    assert client.get(f"{url}/reply").status_code == 404  # nothing being written now


def test_a_model_that_stops_early_marks_the_answer(client, gemini, book):
    gemini.chat_finish = "MAX_TOKENS"
    evs = events(ask(client, book["id"], "Tell me everything."))
    assert evs[-1][1]["message"]["status"] == "truncated"


def test_rejected_messages(client, gemini, book, monkeypatch, tmp_path):
    base = f"/api/books/{book['id']}/conversations"
    assert ask(client, book["id"], "   ").status_code == 422
    assert ask(client, book["id"], "x" * (chat.MAX_MESSAGE_CHARS + 1)).status_code == 422
    assert ask(client, book["id"], "Hi", page=0).status_code == 422
    assert ask(client, 999, "Hi").status_code == 404
    assert ask(client, book["id"], "Hi", conversation=999).status_code == 404
    assert client.post(f"{base}/999/reply").status_code == 404
    assert client.get(f"{base}/999/reply").status_code == 404
    assert client.post(f"{base}/999/stop").status_code == 404

    queued = upload(client, make_book_pdf(tmp_path / "q.pdf", title="Queued")).json()["book"]
    res = ask(client, queued["id"], "Hi")
    assert res.status_code == 409 and "still being processed" in res.json()["detail"]

    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    res = ask(client, book["id"], "Hi")
    assert res.status_code == 503 and "GEMINI_API_KEY" in res.json()["detail"]
    assert client.get(base).json() == []  # nothing was saved
    assert gemini.called("stream") == []


def test_chats_belong_to_their_book(client, gemini, book, tmp_path, run_jobs):
    other = upload(client, make_book_pdf(tmp_path / "o.pdf", title="Other")).json()["book"]
    run_jobs()
    cid = events(ask(client, book["id"], "Hi"))[0][1]["conversation"]["id"]
    assert client.get(f"/api/books/{other['id']}/conversations/{cid}").status_code == 404
    assert client.get(f"/api/books/{other['id']}/conversations").json() == []
    assert ask(client, other["id"], "Hi", conversation=cid).status_code == 404


def test_deleting_chats(client, gemini, book):
    cid = events(ask(client, book["id"], "Hi"))[0][1]["conversation"]["id"]
    url = f"/api/books/{book['id']}/conversations/{cid}"
    assert client.delete(url).status_code == 204
    assert client.get(url).status_code == 404
    assert client.delete(url).status_code == 404

    events(ask(client, book["id"], "Hi again"))
    assert client.delete(f"/api/books/{book['id']}").status_code == 204
    with Session(engine) as s:
        assert s.exec(select(func.count(Message.id))).one() == 0


def test_titles_and_citations():
    assert chat.title_for("  What   is\nnegation? ") == "What is negation?"
    long = "Why does the author think that " + "the history of philosophy " * 5
    title = chat.title_for(long)
    assert title == "Why does the author think that the history of philosophy the history of…"
    assert len(title) <= chat.TITLE_CHARS

    text = "See [p. 4], [pp. 4–6], [p. 9, 2], [p. 400], [p. 7-5], [Kant, p. 3], and [p. 4]."
    assert chat.citations_in(text, 1, page_count=10) == [
        {"book_id": 1, "page": 4},
        {"book_id": 1, "page": 4, "end": 6},
        {"book_id": 1, "page": 9},
        {"book_id": 1, "page": 2},
    ]


def test_history_keeps_the_latest_messages_that_fit(monkeypatch):
    monkeypatch.setattr(chat, "MAX_HISTORY_CHARS", 25)
    now = utcnow()

    def msg(i, role, text):
        return Message(
            id=i, conversation_id=1, role=role, content=text, created_at=now + timedelta(i)
        )

    history = [
        msg(1, Role.user, "an old question"),
        msg(2, Role.assistant, "an old answer"),
        msg(3, Role.user, "a newer one"),
        msg(4, Role.assistant, "its answer"),
    ]
    assert [m.id for m in chat._recent(history)] == [3, 4]
    monkeypatch.setattr(chat, "MAX_HISTORY_CHARS", 15)
    # Never starting on an answer: the model would see a reply to nothing.
    assert chat._recent(history) == []
