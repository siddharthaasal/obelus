# Personal AI Reader: build plan

## 1. Goals and scope

A local-first reading app for dense books (philosophy first, any PDF later). Each person runs their own copy with their own library and Gemini key. The core loop is: read a PDF comfortably, select text, and get instant help that knows the whole book.

**In scope:** PDF library, reader, selection actions (define in context, who is this, explain passage), chat about the current book with page citations, highlights and notes, and search across all books.

**Out of scope for now:** multi-user accounts, hosting, EPUB, mobile apps, sharing between users. Sharing happens through the repo, not the app.

## 2. Architecture

One FastAPI process serves the API and the built frontend. Postgres (with pgvector) runs in Docker. PDFs live on disk. Gemini is the only external dependency.

```
Browser (React + PDF.js)
   │  HTTP + SSE
FastAPI (uv) ── ingestion worker (same process, background loop)
   │                    │
Postgres + pgvector   DATA_DIR/library/*.pdf
   │
Gemini API (generation, context caching, embeddings, OCR fallback)
```

The worker runs inside the FastAPI process as an asyncio loop that polls a jobs table. There's no Celery or Redis, which keeps it at one command to run.

## 3. Repo layout

```
reader/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app, serves /api and static frontend
│   │   ├── config.py          # pydantic-settings, reads .env
│   │   ├── db.py              # SQLModel engine/session
│   │   ├── models/            # SQLModel tables
│   │   ├── api/               # routers: books, reader, ai, highlights, search
│   │   ├── ingest/            # extract, clean, ocr, chunk, embed, worker
│   │   ├── ai/                # gemini client, cache mgmt, prompts, actions
│   │   └── search/            # fts, vector, hybrid
│   ├── migrations/            # Alembic
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── reader/            # PDF.js viewer, text layer, selection popover
│   │   ├── panels/            # chat, lookups, highlights
│   │   └── library/
│   └── vite.config.ts
├── docker-compose.yml         # postgres only
├── Makefile                   # up, run, migrate, backup, restore, dev
├── .env.example
└── README.md
```

## 4. Configuration (`.env`)

```
GEMINI_API_KEY=
DATABASE_URL=postgresql+psycopg://reader:reader@localhost:5433/reader
POSTGRES_PORT=5433              # avoids clashing with local Supabase on 5432
DATA_DIR=~/ReaderData           # library/, backups/
APP_HOST=127.0.0.1
APP_PORT=8420
MODEL_FAST=                     # lookups (a Flash-class model)
MODEL_DEEP=                     # chat (a Pro-class model)
EMBED_MODEL=
EMBED_DIM=768
CACHE_TTL_MINUTES=60
```

App code and user data never share a directory, so `git pull` can't touch anyone's library.

## 5. Data model

- **books:** id, title, author, file_path, file_hash (for dedupe), page_count, status (`queued`, `extracting`, `embedding`, `ready`, `failed`), error, last_read_page, created_at.
- **pages:** id, book_id, page_number, raw_text, clean_text, footnotes, is_ocr, and `tsv tsvector` generated from clean_text with a GIN index. This is the source of truth for text.
- **chunks:** id, book_id, page_start, page_end, text, `embedding vector(EMBED_DIM)` with an HNSW index. Used only for cross-book retrieval.
- **highlights:** id, book_id, page_number, selected_text, char_start/char_end into `pages.clean_text`, `rects jsonb`(PDF.js coordinates for drawing), color, note, created_at.
- **lookups:** id, book_id, page_number, kind (`define`, `who`, `explain`), query_text, context_text, response, model, created_at. Doubles as a cache: the same term in the same book returns instantly.
- **conversations / messages:** a conversation belongs to a book (or to the whole library); messages have role, content, and `citations jsonb` (`[{book_id, page}]`).
- **jobs:** id, kind, book_id, status, attempts, payload, timestamps.
- **gemini_caches:** book_id, cache_name, model, expires_at, so an open book reuses its cache.

Use `tsvector` with the `english` configuration, plus a `simple` configuration column if exact-word matching matters. Stemming merges "negation" and "negate", which is sometimes helpful and sometimes not for philosophical terms.

## 6. Ingestion pipeline

Triggered by uploading or dropping a file into `DATA_DIR/library/`.

1. **Register:** hash the file, skip duplicates, read PDF metadata for title and author (editable later).
2. **Extract:** PyMuPDF per page, keeping text blocks with positions and font sizes.
3. **Detect scans:** pages with little or no extractable text get marked for OCR.
4. **OCR fallback:** render the page to an image and send it to the fast Gemini model with a strict "transcribe exactly" prompt, or use Tesseract locally if you'd rather not send pages out.
5. **Clean:**
    - Running headers and footers: find lines repeated across many pages in the same position and remove them.
    - Page numbers: strip bare numbers at the top or bottom.
    - Hyphenation: join `word-\nbreak` when the joined form is a real word.
    - Footnotes: small font at the bottom of the page goes to `pages.footnotes`, kept out of the main text flow but still searchable.
6. **Store pages:** write `clean_text`; the tsvector column updates automatically.
7. **Chunk:** about 800 tokens with about 100 token overlap, never splitting mid-paragraph where avoidable, and recording page ranges.
8. **Embed:** batch calls to the embedding model, store vectors.
9. **Ready:** mark the book `ready`. The frontend polls status, or uses SSE for a progress bar.

Build a small debug view early that shows raw and clean text side by side for any page. You'll use it constantly while tuning cleanup rules, and PDFs vary more than you expect.

## 7. Reader

- PDF.js viewer with its text layer on, so selection matches what's visible. Continuous scroll, zoom, page jump, and a table of contents from the PDF outline if one exists.
- Save `last_read_page` as you read, so a book reopens where you left off.
- Highlights drawn from stored `rects` as an overlay layer.
- Layout: book in the center, a collapsible right panel with tabs for Lookups, Chat, and Highlights.
- Keyboard shortcuts: `d` define, `w` who, `e` explain, `h` highlight, `/` search.

**Anchoring selections:** PDF.js text and PyMuPDF text won't match character for character. Send the selected text and page number to the backend, then fuzzy-match it against `pages.clean_text` (with `rapidfuzz`) to get stable offsets. Store both the offsets and the PDF.js rects, one for logic and one for drawing.

## 8. AI features

**Whole-book context caching.** When a ready book is opened, create (or reuse) a Gemini explicit cache containing the book's clean text with `[p. N]` markers before each page, plus a system prompt. Store the cache name and expiry; refresh when it's about to expire during a session. Every action and chat message for that book goes through the cache, so you only pay full price for the book once per session.

Check the current Gemini docs for the context window, minimum cache size, and cache pricing on the models you pick, since these change. Very long books that exceed the limit fall back to retrieval over that book's chunks.

**System prompt (cached):** you're a reading companion for this specific book; cite pages as `[p. N]` for any claim about the text; distinguish clearly between what the author says and outside interpretation; say when the text doesn't support an answer.

**Selection actions (fast model, structured output via Pydantic AI):**

- **Define in context.** Input: the term, its surrounding paragraph, the page. Output: meaning in this author's usage; general or dictionary meaning if different; how usage shifts through the book; key pages. Before calling the model, run full-text search for the term across the book and include the hit pages, which grounds the "where else" answer in real occurrences.
- **Who is this.** Input: the name plus context. Output: a short bio, their relevance to this author (influence, opponent, source), how the author uses them here, and other pages where they appear (again from full-text search).
- **Explain passage.** Input: the selected paragraph(s). Output: a plain-language restatement, key terms, where it fits in the argument (what it answers, what it sets up), and related pages.

Each result is saved to `lookups` and shown as a card in the panel, with page citations you can click.

**Book chat (deep model):**

- Uses the book cache, the conversation history, and the current page number (so "this chapter" and "here" make sense).
- Streams over SSE.
- The frontend parses `[p. N]` into links that jump the reader to that page and briefly flash it.

**Library chat and cross-book questions:**

- Hybrid retrieval: full-text rank and vector similarity, combined with reciprocal rank fusion in a single SQL query, top about 20 chunks.
- In a book's chat, cross-book retrieval is optional (a toggle). The current book comes from the cache; other books from retrieval, cited as `[Book Title, p. N]`.

## 9. Search

A `/` search bar with two modes:

- **Exact:** Postgres full-text search with `ts_headline` snippets. "Every place 'negation' appears", instantly, within one book or all books.
- **Semantic:** hybrid search for ideas rather than words.

Results link straight to the page.

## 10. Notes and export

- Highlights with optional notes, and lookups, grouped by book and page.
- `Export notes` generates Markdown per book: highlights, notes, and saved lookups in page order. That makes your notes portable to Obsidian or anywhere else.

## 11. Running it

```
make up        # docker compose up -d (postgres)
make migrate   # alembic upgrade head (also runs automatically on start)
make run       # build frontend if needed, start FastAPI on APP_PORT
make dev       # vite dev server + uvicorn --reload
make backup    # pg_dump to DATA_DIR/backups/, timestamped
make restore FILE=...
```

**Other devices:** keep `APP_HOST=127.0.0.1` and use `tailscale serve` to expose the port to your tailnet only. There's no auth in the app, so it should never listen on a public interface.

## 12. Build phases

**Phase 0: skeleton (half a day).** Compose file with pgvector, FastAPI with a health route, SQLModel and Alembic, Vite app served by FastAPI, Makefile, `.env.example`, README setup steps. Done when your friend can clone and run it.

**Phase 1: library and ingestion (1–2 days).** Upload, jobs table and worker, extraction, cleanup, page storage, full-text index, the raw/clean debug view. Skip OCR and embeddings at first. Done when a real book from your list is ingested with clean text.

**Phase 2: reader (1 day).** PDF.js viewer, navigation, table of contents, saved position, side panel shell.

**Phase 3: selection actions (1–2 days).** Popover, selection anchoring, context caching, define, who, explain, lookups cache. **This is the MVP.** Stop here and read with it for a week before building more.

**Phase 4: book chat (1 day).** Streaming chat, conversation history, clickable citations.

**Phase 5: highlights and notes (1 day).** Create, draw, list, and edit highlights; notes; Markdown export.

**Phase 6: search and cross-book (1–2 days).** Chunking, embeddings, hybrid search, exact and semantic search UI, library chat, cross-book toggle.

**Phase 7: hardening.** OCR fallback, better footnote detection, backups, error states, Tailscale notes in the README.

## 13. Risks and mitigations

- **Messy PDFs:** the biggest real risk. Test with the worst PDF on your list in Phase 1, not later. The debug view and per-book cleanup overrides (for example, "header lines to remove") are there for this.
- **Selection mismatch between PDF.js and extracted text:** fuzzy matching handles most cases. If matching fails, still show the AI answer using the raw selected text, and just skip the stored offsets.
- **Cost:** caching keeps repeated questions cheap. Use the fast model for lookups and the deep model only for chat. Show per-book token usage in a small stats view so each of you can see your own spend.
- **Hallucinated interpretations:** the system prompt requires page citations. Make citations prominent in the UI so checking the text is one click away.
- **Scope creep:** read with the MVP after Phase 3 before building anything else.

## 14. Working with your friend

- Short `CONTRIBUTING.md`: how to run, how to add a migration, code style.
- Every schema change is an Alembic migration, never a manual edit, since both of you will have real data.
- Keep prompts in `app/ai/prompts/` as plain files so either of you can tune them without touching code.
