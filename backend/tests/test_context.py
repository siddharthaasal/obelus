from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlmodel import Session, select

from app.ai import context
from app.config import get_settings
from app.db import engine
from app.models import GeminiCache
from app.models.base import utcnow
from tests.factory import make_book_pdf
from tests.test_ingest import upload
from tests.test_lookups import look


@pytest.fixture
def book(client, run_jobs, tmp_path) -> dict:
    book = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]
    run_jobs()
    return book


@pytest.fixture
def cacheable(monkeypatch):
    """Treat the small test book as big enough for a Gemini cache."""
    monkeypatch.setattr(context, "MIN_CACHE_TOKENS", 0)


def prepare(client, book_id):
    res = client.post(f"/api/books/{book_id}/context")
    assert res.status_code == 200, res.text
    return res.json()


def cache_row(book_id) -> GeminiCache:
    with Session(engine) as s:
        return s.exec(select(GeminiCache).where(GeminiCache.book_id == book_id)).one()


def set_expiry(book_id, delta: timedelta):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE gemini_caches SET expires_at = :t WHERE book_id = :b"),
            {"t": utcnow() + delta, "b": book_id},
        )


def test_opening_a_book_caches_it_once(client, gemini, book, cacheable):
    ctx = prepare(client, book["id"])
    assert ctx["mode"] == "cached"
    assert ctx["token_count"] > 0
    [created] = gemini.called("create_cache")
    assert created["text"].startswith("<book>\n[p. 1]")
    assert "reading companion for one book" in created["system"]

    assert prepare(client, book["id"])["expires_at"] == ctx["expires_at"]
    res = look(client, book["id"], "define", "negation")
    assert res.json()["context_mode"] == "cached"
    assert res.json()["usage"]["cached"] == 1000
    assert len(gemini.called("create_cache")) == 1

    # With the book in the cache, a request sends only the question.
    [call] = gemini.called("generate")
    assert call["cache_name"] == cache_row(book["id"]).cache_name
    assert len(call["contents"]) == 1
    assert call["contents"][0].startswith('The reader selected the term "negation"')


def test_cache_is_extended_while_in_use_and_replaced_once_expired(client, gemini, book, cacheable):
    prepare(client, book["id"])
    first = cache_row(book["id"])

    set_expiry(book["id"], timedelta(minutes=10))  # under half the 60-minute TTL left
    prepare(client, book["id"])
    assert gemini.called("extend_cache") == [{"name": first.cache_name}]
    assert cache_row(book["id"]).expires_at > utcnow() + timedelta(minutes=50)

    set_expiry(book["id"], timedelta(seconds=-5))
    prepare(client, book["id"])
    second = cache_row(book["id"])
    assert second.cache_name != first.cache_name
    assert {"name": first.cache_name} in gemini.called("delete_cache")
    assert list(gemini.caches) == [second.cache_name]


def test_reprocessing_a_book_rebuilds_its_cache(client, gemini, book, cacheable, run_jobs):
    prepare(client, book["id"])
    old = cache_row(book["id"]).cache_name
    client.post(f"/api/books/{book['id']}/reprocess")
    run_jobs()
    prepare(client, book["id"])
    assert cache_row(book["id"]).cache_name != old
    assert list(gemini.caches) == [cache_row(book["id"]).cache_name]


def test_a_cache_gone_early_is_rebuilt_and_the_lookup_retried(client, gemini, book, cacheable):
    prepare(client, book["id"])
    gemini.caches.clear()  # expired or deleted on Gemini's side
    res = look(client, book["id"], "who", "Kant")
    assert res.status_code == 201, res.text
    assert len(gemini.called("create_cache")) == 2
    assert len(gemini.called("generate")) == 2


def test_rejected_cache_falls_back_to_sending_the_book(client, gemini, book, cacheable):
    gemini.reject_caches = True
    assert prepare(client, book["id"])["mode"] == "inline"
    res = look(client, book["id"], "define", "negation")
    assert res.json()["context_mode"] == "inline"
    assert gemini.called("generate")[0]["contents"][0].startswith("<book>")
    assert len(gemini.called("create_cache")) == 1  # not retried on every request


def test_small_books_skip_the_cache(client, gemini, book):
    assert prepare(client, book["id"])["mode"] == "inline"
    assert gemini.called("create_cache") == []


def test_books_too_long_for_the_model_send_excerpts(client, gemini, book, monkeypatch):
    monkeypatch.setattr(context, "HEADROOM_TOKENS", 0)
    gemini.input_limit = 10  # every book is too long
    res = look(client, book["id"], "define", "apperception", page=5)
    assert res.json()["context_mode"] == "excerpt"
    excerpts = gemini.called("generate")[0]["contents"][0]
    assert excerpts.startswith("The whole book is too long to include")
    # Pages 3 to 7 surround the selection; 1 and 2 are where the term appears.
    for n in range(1, 8):
        assert f"[p. {n}]" in excerpts
    assert gemini.called("create_cache") == []


def test_caching_can_be_turned_off(client, gemini, book, cacheable, monkeypatch):
    # The free tier doesn't offer explicit caching on every model.
    monkeypatch.setattr(get_settings(), "context_caching", False)
    assert prepare(client, book["id"])["mode"] == "inline"
    assert look(client, book["id"], "define", "negation").json()["context_mode"] == "inline"
    assert gemini.called("create_cache") == []


def test_max_book_tokens_caps_what_one_request_sends(client, gemini, book, monkeypatch):
    # Free keys limit tokens per minute, so a long book can be held to excerpts.
    monkeypatch.setattr(get_settings(), "max_book_tokens", 100)
    res = look(client, book["id"], "define", "negation")
    assert res.json()["context_mode"] == "excerpt"
    assert gemini.called("generate")[0]["contents"][0].startswith("The whole book is too long")


def test_removing_a_book_deletes_its_cache(client, gemini, book, cacheable):
    prepare(client, book["id"])
    name = cache_row(book["id"]).cache_name
    assert client.delete(f"/api/books/{book['id']}").status_code == 204
    assert {"name": name} in gemini.called("delete_cache")
    assert gemini.caches == {}


def test_context_needs_a_ready_book_and_a_key(client, book, monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    assert client.post(f"/api/books/{book['id']}/context").status_code == 503
    queued = upload(client, make_book_pdf(tmp_path / "q.pdf", title="Q")).json()["book"]
    assert client.post(f"/api/books/{queued['id']}/context").status_code == 409
