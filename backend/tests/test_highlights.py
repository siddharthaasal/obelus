from urllib.parse import unquote

import pytest
from sqlalchemy import text

from app import citations
from app.db import engine
from tests.factory import make_book_pdf
from tests.test_ingest import upload
from tests.test_lookups import look

RECT = {"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.03}


@pytest.fixture
def book(client, run_jobs, tmp_path) -> dict:
    book = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]
    run_jobs()
    return book


def mark(client, book_id, selected, page=1, rects=(RECT,), **extra):
    body = {"page": page, "text": selected, "rects": list(rects), **extra}
    return client.post(f"/api/books/{book_id}/highlights", json=body)


def listed(client, book_id) -> list[dict]:
    return client.get(f"/api/books/{book_id}/highlights").json()


def test_a_highlight_is_anchored_in_the_clean_text(client, book):
    res = mark(client, book["id"], "negation", before="with a kind of ", after=" of the last")
    assert res.status_code == 201, res.text
    h = res.json()
    assert (h["selected_text"], h["color"], h["note"]) == ("negation", "yellow", "")
    assert h["rects"] == [RECT]
    page = client.get(f"/api/books/{book['id']}/pages/1").json()["clean_text"]
    assert page[h["char_start"] : h["char_end"]] == "negation"

    # Punctuation selected at the edges is kept.
    h = mark(client, book["id"], "they carry what they negate forward.", page=2).json()
    assert h["selected_text"] == "they carry what they negate forward."

    # As the text layer has it, a word broken across lines comes back whole.
    passage = "The history of philo-\nsophy is a history"
    h = mark(client, book["id"], passage).json()
    assert h["selected_text"] == "The history of philosophy is a history"
    assert h["char_start"] is not None


def test_highlights_outside_the_body_text(client, book):
    footnote = mark(client, book["id"], "Critique of Pure Reason", page=2).json()
    assert footnote["selected_text"] == "Critique of Pure Reason"
    assert footnote["char_start"] is None

    # Not found (a figure caption, an OCR miss): kept as selected, on one line.
    stray = mark(client, book["id"], "Spinoza's  substance,\nextended", page=3).json()
    assert stray["selected_text"] == "Spinoza's substance, extended"
    assert stray["char_start"] is None


def test_rects_are_kept_on_the_page(client, book):
    overhang = [
        {"x": -0.01, "y": 0.5, "w": 0.3, "h": 0.02},
        {"x": 0.9, "y": 0.99, "w": 0.2, "h": 0.03},
    ]
    h = mark(client, book["id"], "negation", rects=overhang).json()
    assert h["rects"] == [
        {"x": 0.0, "y": 0.5, "w": 0.29, "h": 0.02},
        {"x": 0.9, "y": 0.99, "w": 0.1, "h": 0.01},
    ]
    offpage = mark(client, book["id"], "negation", rects=[{"x": 1.0, "y": 0.5, "w": 0.1, "h": 0.1}])
    assert offpage.status_code == 422


def test_listed_in_reading_order(client, book):
    later = mark(client, book["id"], "Hegel answers", page=2).json()
    second = mark(
        client, book["id"], "apperception", page=1, before="transcendental unity of "
    ).json()
    first = mark(client, book["id"], "The history of philo-\nsophy").json()
    unanchored = mark(client, book["id"], "Nowhere on the page", page=1).json()
    assert [h["id"] for h in listed(client, book["id"])] == [
        first["id"],
        second["id"],
        unanchored["id"],
        later["id"],
    ]


def test_notes_and_colours(client, book):
    h = mark(client, book["id"], "negation", note="  Compare Spinoza.  ", color="green").json()
    assert (h["note"], h["color"]) == ("Compare Spinoza.", "green")
    url = f"/api/books/{book['id']}/highlights/{h['id']}"

    res = client.patch(url, json={"note": "Compare Spinoza and Hegel.\n\nSee ch. 2."})
    assert res.status_code == 200
    assert res.json()["note"] == "Compare Spinoza and Hegel.\n\nSee ch. 2."
    assert res.json()["color"] == "green"  # untouched
    assert client.patch(url, json={"color": "pink"}).json()["color"] == "pink"
    assert client.patch(url, json={"note": "  "}).json()["note"] == ""
    assert client.patch(url, json={"color": "orange"}).status_code == 422

    assert client.delete(url).status_code == 204
    assert client.delete(url).status_code == 404
    assert listed(client, book["id"]) == []


def test_rejected_highlights(client, book, tmp_path, run_jobs):
    assert mark(client, book["id"], "negation", page=99).status_code == 422
    assert mark(client, book["id"], "negation", rects=[]).status_code == 422
    assert mark(client, book["id"], " — ").status_code == 422
    assert mark(client, 999, "negation").status_code == 404

    other = upload(client, make_book_pdf(tmp_path / "o.pdf", title="Other")).json()["book"]
    run_jobs()
    h = mark(client, book["id"], "negation").json()
    assert (
        client.patch(f"/api/books/{other['id']}/highlights/{h['id']}", json={}).status_code == 404
    )
    assert client.delete(f"/api/books/{other['id']}/highlights/{h['id']}").status_code == 404

    # Removing the book removes its highlights.
    assert client.delete(f"/api/books/{book['id']}").status_code == 204
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM highlights")).scalar() == 0


def test_export_notes(client, gemini, book):
    mark(client, book["id"], "Hegel answers that negations are not", page=2, note="The key move.")
    mark(client, book["id"], "apperception", before="transcendental unity of ")
    look(client, book["id"], "define", "negation", before="with a kind of ", after=" of the last")
    # Printed page numbers where the PDF has them.
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE pages SET label = CASE page_number WHEN 1 THEN 'i' WHEN 2 THEN 'ii' END")
        )

    res = client.get(f"/api/books/{book['id']}/notes.md")
    assert res.status_code == 200
    assert res.headers["content-type"] == "text/markdown; charset=utf-8"
    disposition = res.headers["content-disposition"]
    assert unquote(disposition.split("filename*=UTF-8''")[1]) == "A Test Book - notes.md"

    md = res.text
    assert md.startswith("# A Test Book\n\nNotes from Obelus, ")
    assert ": 2 highlights and 1 lookup.\n" in md
    one, two = md.index("## p. i (PDF page 1)"), md.index("## p. ii (PDF page 2)")
    # On page 1, the lookup ("negation", early on the page) comes before the highlight.
    define, apperception = md.index("**Define: negation.**"), md.index("> apperception")
    assert one < define < apperception < two
    # Citations name printed pages.
    assert "negation drives thought forward [p. i]." in md
    assert "*Across the book:* Hegel makes it determinate [p. ii]." in md
    assert "*Key pages:*\n- p. i: Introduced\n- p. ii: Hegel's determinate negation" in md
    assert md.endswith("> Hegel answers that negations are not\n\nThe key move.\n")


def test_an_empty_export(client, book):
    md = client.get(f"/api/books/{book['id']}/notes.md").text
    assert md.endswith(": 0 highlights and 0 lookups.\n")
    assert client.get("/api/books/999/notes.md").status_code == 404


def test_relabel_citations():
    labels = {1: "i", 2: "ii", 3: "iii"}.get
    s = "See [p. 1], [pp. 2–3], [p. 1, 3], and [p. 9], quoting “[the] word”."
    assert citations.relabel(s, 3, lambda n: labels(n) or str(n)) == (
        "See [p. i], [pp. ii–iii], [pp. i, iii], and [p. 9], quoting “[the] word”."
    )
