import pytest
from sqlmodel import Session

from app.ai.gemini import GeminiError
from app.ai.lookups import clean_term, query_key
from app.ai.schemas import DefineResult, ExplainResult, WhoResult
from app.config import get_settings
from app.db import engine
from app.models import LookupKind
from app.search.fts import _spread, term_pages
from tests.factory import make_book_pdf
from tests.test_ingest import upload


@pytest.fixture
def book(client, run_jobs, tmp_path) -> dict:
    book = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]
    run_jobs()
    return book


def look(client, book_id, kind, text, page=1, **extra):
    return client.post(
        f"/api/books/{book_id}/lookups", json={"kind": kind, "page": page, "text": text, **extra}
    )


def test_define_anchors_asks_and_saves(client, gemini, book):
    res = look(
        client, book["id"], "define", "negation", before="begins with a kind of ", after=" of the"
    )
    assert res.status_code == 201, res.text
    lookup = res.json()
    assert lookup["kind"] == "define"
    assert lookup["query_text"] == "negation"
    page = client.get(f"/api/books/{book['id']}/pages/1").json()["clean_text"]
    assert page[lookup["char_start"] : lookup["char_end"]] == "negation"
    # A short paragraph brings its neighbours: here the chapter heading and the next one.
    assert lookup["context_text"].startswith("Chapter One\n\nThe history of philosophy")
    # The small test book is sent whole with the request, not cached.
    assert lookup["context_mode"] == "inline"
    assert lookup["model"] == get_settings().model_fast
    assert lookup["usage"] == {"input": 1200, "cached": 0, "output": 80, "thinking": 40}

    # Tidied: a blank optional field is null; pages sorted, de-duplicated, and in range.
    answer = lookup["response"]
    assert answer["general"] is None
    assert answer["key_pages"] == [
        {"page": 1, "note": "Introduced"},
        {"page": 2, "note": "Hegel's determinate negation"},
    ]

    [call] = gemini.called("generate")
    assert call["schema"] is DefineResult
    assert call["cache_name"] is None
    assert "reading companion for one book, “A Test Book”" in call["system"]
    book_text, prompt = call["contents"]
    assert book_text.startswith("<book>\n[p. 1]\nChapter One")
    assert "[p. 2]" in book_text and "Notes:\n1. See the Critique" in book_text
    assert 'selected the term "negation" on [p. 1]' in prompt
    # Full-text search: exact matching finds page 1; stemming adds "negations" on page 2.
    assert "finds the term on these pages: 1, 2." in prompt
    assert call["thinking"] == "low"


def test_repeat_lookup_comes_from_the_table(client, gemini, book):
    first = look(client, book["id"], "define", "negation").json()
    again = look(client, book["id"], "define", "“Negation,”")
    assert again.status_code == 200
    assert again.json() == first
    assert len(gemini.called("generate")) == 1

    # Regenerating asks again and replaces the answer in place.
    fresh = look(client, book["id"], "define", "negation", refresh=True)
    assert fresh.status_code == 201
    assert fresh.json()["id"] == first["id"]
    assert fresh.json()["created_at"] > first["created_at"]
    assert len(gemini.called("generate")) == 2
    assert len(client.get(f"/api/books/{book['id']}/lookups").json()) == 1


def test_who_and_explain(client, gemini, book):
    who = look(client, book["id"], "who", "Kant", after=" calls the unity")
    assert who.status_code == 201, who.text
    assert who.json()["query_text"] == "Kant"
    assert who.json()["response"]["name"] == "Immanuel Kant"
    prompt = gemini.called("generate")[-1]["contents"][-1]
    assert gemini.called("generate")[-1]["schema"] is WhoResult
    assert 'selected the name "Kant"' in prompt
    assert "finds the name only on page 1." in prompt

    # As PDF.js's text layer has it: a line-end hyphen and newlines.
    passage = "The history of philo-\nsophy is a history of attempts to grasp\nwhat thinking is"
    explain = look(client, book["id"], "explain", passage)
    assert explain.status_code == 201, explain.text
    query = explain.json()["query_text"]
    assert query == "The history of philosophy is a history of attempts to grasp what thinking is"
    call = gemini.called("generate")[-1]
    assert call["schema"] is ExplainResult
    assert f"<selection>\n{query}\n</selection>" in call["contents"][-1]
    assert "full-text search" not in call["contents"][-1]


def test_selection_in_a_footnote(client, gemini, book):
    res = look(client, book["id"], "who", "Critique of Pure Reason", page=2)
    assert res.status_code == 201
    assert res.json()["char_start"] is None  # offsets only index the body text
    assert res.json()["context_text"].startswith("1. See the Critique of Pure Reason")


def test_unanchored_selection_still_gets_an_answer(client, gemini, book):
    res = look(client, book["id"], "define", "Spinoza's substance")
    assert res.status_code == 201
    assert res.json()["query_text"] == "Spinoza's substance"
    assert res.json()["char_start"] is None
    prompt = gemini.called("generate")[-1]["contents"][-1]
    assert "doesn't find the term in the book's text" in prompt


def test_list_and_delete(client, gemini, book):
    a = look(client, book["id"], "define", "negation").json()
    b = look(client, book["id"], "who", "Hegel", page=2).json()
    listed = client.get(f"/api/books/{book['id']}/lookups").json()
    assert [x["id"] for x in listed] == [b["id"], a["id"]]  # newest first

    assert client.delete(f"/api/books/{book['id']}/lookups/{a['id']}").status_code == 204
    assert client.delete(f"/api/books/{book['id']}/lookups/{a['id']}").status_code == 404
    assert client.delete(f"/api/books/999/lookups/{b['id']}").status_code == 404
    assert [x["id"] for x in client.get(f"/api/books/{book['id']}/lookups").json()] == [b["id"]]


def test_rejected_lookups(client, gemini, book, tmp_path):
    long_term = look(client, book["id"], "define", "word " * 30)
    assert long_term.status_code == 422
    assert "Use Explain" in long_term.json()["detail"]
    long_passage = look(client, book["id"], "explain", "Several pages of text. " * 800)
    assert long_passage.status_code == 422
    assert "too long for a passage" in long_passage.json()["detail"]
    assert look(client, book["id"], "who", " — ").status_code == 422
    assert look(client, book["id"], "define", "negation", page=99).status_code == 404
    assert look(client, 999, "define", "negation").status_code == 404
    assert look(client, book["id"], "summarize", "negation").status_code == 422

    queued = upload(client, make_book_pdf(tmp_path / "q.pdf", title="Queued")).json()["book"]
    res = look(client, queued["id"], "define", "negation")
    assert res.status_code == 409
    assert "still being processed" in res.json()["detail"]
    assert gemini.called("generate") == []


def test_without_an_api_key(client, gemini, book, monkeypatch):
    saved = look(client, book["id"], "define", "negation").json()
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")

    res = look(client, book["id"], "who", "Kant")
    assert res.status_code == 503
    assert "GEMINI_API_KEY" in res.json()["detail"]
    # Answers already saved are still there.
    assert look(client, book["id"], "define", "negation").json() == saved
    assert client.get("/api/ai").json()["configured"] is False


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (GeminiError("Gemini's rate limit or quota is used up.", 429), 429),
        (GeminiError("Gemini is having trouble (503).", 503), 502),
    ],
)
def test_gemini_errors_reach_the_reader(client, gemini, book, error, status):
    gemini.fail_next = error
    res = look(client, book["id"], "define", "negation")
    assert res.status_code == status
    assert res.json()["detail"] == error.message
    assert client.get(f"/api/books/{book['id']}/lookups").json() == []


def test_clean_term_and_key():
    assert clean_term("  “Hegel’s,” ") == "Hegel"
    assert clean_term("being-in-the-\nworld.") == "being-in-the- world"
    assert clean_term("(Aufhebung)") == "Aufhebung"
    assert query_key(LookupKind.define, "Negation") == query_key(LookupKind.define, " negation ")
    assert query_key(LookupKind.define, "negation") != query_key(LookupKind.who, "negation")


def test_term_pages(book):
    with Session(engine) as s:
        assert term_pages(s, book["id"], "Kant").pages == [1]
        assert term_pages(s, book["id"], "negation").pages == [1, 2]
        assert term_pages(s, book["id"], "thing in itself").pages == [3]
        assert term_pages(s, book["id"], "apperception").total == 2  # page 2 via its footnote
        assert term_pages(s, book["id"], "Spinoza").total == 0
    assert _spread(list(range(1, 101)), 5) == [1, 26, 51, 75, 100]
