import os
import time

from sqlalchemy import text
from sqlmodel import Session, select

from app.config import get_settings
from app.db import engine
from app.ingest import pipeline
from app.ingest.jobs import recover_interrupted
from app.models import Book, Job
from tests.factory import make_book_pdf


def upload(client, path, name=None):
    with path.open("rb") as f:
        return client.post("/api/books", files={"file": (name or path.name, f, "application/pdf")})


def page(client, book_id, n):
    res = client.get(f"/api/books/{book_id}/pages/{n}")
    assert res.status_code == 200, res.text
    return res.json()


def settle(path):
    """Backdate a dropped file so the library scan treats it as fully copied."""
    past = time.time() - 60
    os.utime(path, (past, past))


def test_upload_ingests_and_cleans(client, run_jobs, tmp_path):
    res = upload(client, make_book_pdf(tmp_path / "Test Book.pdf"))
    assert res.status_code == 201, res.text
    book = res.json()["book"]
    assert book["status"] == "queued"
    assert book["title"] == "A Test Book"
    assert book["file_name"] == "Test Book.pdf"

    assert run_jobs() == 1
    book = client.get(f"/api/books/{book['id']}").json()
    assert book["status"] == "ready", book["error"]
    assert book["page_count"] == 7
    assert book["needs_ocr_pages"] == 0

    p1 = page(client, book["id"], 1)
    assert p1["clean_text"].startswith("Chapter One\n\nThe history of philosophy is a history")
    assert "self-consciousness" in p1["clean_text"]
    assert "Anglo-Saxon" in p1["clean_text"]
    assert {r["reason"] for r in p1["removed_lines"]} == {"page_number"}

    p2 = page(client, book["id"], 2)
    assert "A Test Book" not in p2["clean_text"]
    assert {r["reason"] for r in p2["removed_lines"]} == {"header", "page_number"}
    assert "determinate—they carry" in p2["clean_text"]
    assert "needs a source, the first which" in p2["clean_text"]  # ligature expanded
    assert p2["footnotes"] == (
        "1. See the Critique of Pure Reason, B131, for the claim about apperception."
    )
    assert "Critique" not in p2["clean_text"]
    assert "philo-" in p1["raw_text"]  # raw text is kept as extracted

    p3 = page(client, book["id"], 3)
    assert "well-known commentators" in p3["clean_text"]


def test_full_text_search_indexes_pages(client, run_jobs, tmp_path):
    book_id = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]["id"]
    run_jobs()

    def hits(config, column, query):
        sql = text(
            f"SELECT page_number FROM pages WHERE book_id = :b "
            f"AND {column} @@ plainto_tsquery('{config}', :q) ORDER BY page_number"
        )
        with engine.connect() as conn:
            return list(conn.execute(sql, {"b": book_id, "q": query}).scalars())

    assert hits("english", "tsv", "negation") == [1, 2]  # stems "negations" too
    assert hits("simple", "tsv_simple", "negation") == [1]  # exact word only
    assert hits("english", "tsv", "apperception") == [1, 2]  # page 2 via its footnote


def test_duplicate_upload_returns_existing_book(client, run_jobs, tmp_path):
    pdf = make_book_pdf(tmp_path / "b.pdf")
    first = upload(client, pdf).json()["book"]
    res = upload(client, pdf, name="renamed copy.pdf")
    assert res.status_code == 200
    assert res.json() == {"book": first, "duplicate": True}
    assert len(client.get("/api/books").json()) == 1


def test_rejects_non_pdf_uploads(client, tmp_path):
    notes = tmp_path / "notes.txt"
    notes.write_text("hello")
    assert upload(client, notes).status_code == 415

    fake = tmp_path / "fake.pdf"
    fake.write_bytes(b"not really a pdf")
    res = upload(client, fake)
    assert res.status_code == 422
    assert client.get("/api/books").json() == []
    assert list(get_settings().library_dir.iterdir()) == []


def test_upload_name_collision_gets_a_new_filename(client, tmp_path):
    a = make_book_pdf(tmp_path / "a.pdf", title="One")
    b = make_book_pdf(tmp_path / "b.pdf", title="Two")
    assert upload(client, a, name="Same.pdf").json()["book"]["file_name"] == "Same.pdf"
    assert upload(client, b, name="Same.pdf").json()["book"]["file_name"] == "Same (2).pdf"


def test_library_scan_picks_up_dropped_files(client, run_jobs, library_dir):
    nested = library_dir / "Kant"
    nested.mkdir()
    settle(make_book_pdf(nested / "critique.pdf", title=None))
    (library_dir / ".hidden").mkdir()
    settle(make_book_pdf(library_dir / ".hidden" / "skip.pdf"))
    broken = library_dir / "broken.pdf"
    broken.write_bytes(b"%PDF-1.4 truncated")
    settle(broken)
    fresh = make_book_pdf(library_dir / "still-copying.pdf")  # too recent to pick up

    assert client.post("/api/library/scan").json() == {"added": 2, "duplicates": 0}
    run_jobs()
    books = {b["file_name"]: b for b in client.get("/api/books").json()}
    assert set(books) == {"critique.pdf", "broken.pdf"}
    assert books["critique.pdf"]["title"] == "critique"
    assert books["critique.pdf"]["status"] == "ready"
    assert books["broken.pdf"]["status"] == "failed"
    assert "readable PDF" in books["broken.pdf"]["error"]

    # A copy of a known book is skipped, and not re-hashed on the next scan.
    settle(fresh)
    dup = library_dir / "copy.pdf"
    dup.write_bytes((nested / "critique.pdf").read_bytes())
    settle(dup)
    assert client.post("/api/library/scan").json() == {"added": 1, "duplicates": 1}
    assert client.post("/api/library/scan").json() == {"added": 0, "duplicates": 0}


def test_reprocess_replaces_pages(client, run_jobs, tmp_path):
    book_id = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]["id"]
    run_jobs()
    res = client.post(f"/api/books/{book_id}/reprocess")
    assert res.status_code == 202
    assert res.json()["status"] == "queued"
    client.post(f"/api/books/{book_id}/reprocess")  # a second click doesn't queue twice
    assert run_jobs() == 1
    assert client.get(f"/api/books/{book_id}").json()["status"] == "ready"
    with Session(engine) as s:
        count = s.exec(text("SELECT count(*) FROM pages WHERE book_id = :b"), params={"b": book_id})
        assert count.scalar() == 7


def test_delete_moves_file_to_trash(client, run_jobs, tmp_path, library_dir):
    book_id = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]["id"]
    run_jobs()
    assert client.delete(f"/api/books/{book_id}").status_code == 204
    assert client.get(f"/api/books/{book_id}").status_code == 404
    assert list(library_dir.iterdir()) == []
    assert [p.name for p in (get_settings().data_dir / "trash").iterdir()] == ["b.pdf"]
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM pages")).scalar() == 0


def test_edit_title_and_author(client, tmp_path):
    book_id = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]["id"]
    res = client.patch(f"/api/books/{book_id}", json={"title": " Critique ", "author": "Kant"})
    assert (res.json()["title"], res.json()["author"]) == ("Critique", "Kant")
    assert client.patch(f"/api/books/{book_id}", json={"author": ""}).json()["author"] is None
    assert client.patch(f"/api/books/{book_id}", json={"title": "  "}).status_code == 422


def test_page_image_and_file(client, run_jobs, tmp_path):
    book_id = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]["id"]
    res = client.get(f"/api/books/{book_id}/pages/2/image?dpi=50")
    assert res.status_code == 200
    assert res.content.startswith(b"\x89PNG")
    assert client.get(f"/api/books/{book_id}/pages/99/image").status_code == 404
    assert client.get(f"/api/books/{book_id}/pages/1").status_code == 404  # not ingested yet
    res = client.get(f"/api/books/{book_id}/file")
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF")


def test_transient_failure_retries(client, run_jobs, tmp_path, monkeypatch):
    book_id = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]["id"]
    real = pipeline.extract_pages

    def flaky(path):
        monkeypatch.setattr(pipeline, "extract_pages", real)
        raise RuntimeError("disk hiccup")

    monkeypatch.setattr(pipeline, "extract_pages", flaky)
    assert run_jobs() == 1
    book = client.get(f"/api/books/{book_id}").json()
    assert book["status"] == "queued"
    assert "disk hiccup" in book["error"]
    assert run_jobs() == 0  # backing off

    with engine.begin() as conn:
        conn.execute(text("UPDATE jobs SET run_after = now()"))
    assert run_jobs() == 1
    book = client.get(f"/api/books/{book_id}").json()
    assert (book["status"], book["error"]) == ("ready", None)


def test_missing_file_fails_without_retrying(client, run_jobs, tmp_path, library_dir):
    book_id = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]["id"]
    (library_dir / "b.pdf").unlink()
    assert run_jobs() == 1
    book = client.get(f"/api/books/{book_id}").json()
    assert book["status"] == "failed"
    assert "File not found" in book["error"]


def test_interrupted_jobs_are_requeued(client, run_jobs, tmp_path):
    book_id = upload(client, make_book_pdf(tmp_path / "b.pdf")).json()["book"]["id"]
    with engine.begin() as conn:
        conn.execute(text("UPDATE jobs SET status = 'running'"))
        conn.execute(text("UPDATE books SET status = 'extracting'"))
    with Session(engine) as s:
        assert recover_interrupted(s) == 1
        assert s.exec(select(Job.status)).one() == "queued"
        assert s.get(Book, book_id).status == "queued"
    assert run_jobs() == 1
