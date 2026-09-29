# Obelus

A local-first reading companion for dense books. Open a PDF, select a passage, and get help that
knows the whole book: definitions in the author's usage, who a name refers to, plain-language
explanations, and chat with page citations.

Each person runs their own copy with their own library and Gemini key. See [plan.md](plan.md) for
the design and build phases.

## Requirements

- [Docker](https://docs.docker.com/get-docker/) (runs Postgres with pgvector)
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (Python; installs Python 3.13 for you)
- [Node.js](https://nodejs.org/) 20.19+ or 22.12+ (frontend build)
- `make`

## Setup

```sh
git clone <repo-url> obelus && cd obelus
make setup     # creates .env, installs backend and frontend deps
```

Open `.env` and set `GEMINI_API_KEY`. The other defaults work as they are.

```sh
make run       # starts Postgres, builds the frontend, serves on http://127.0.0.1:8420
```

The first start creates your data directory (`~/ObelusData` by default) and applies database
migrations. `http://127.0.0.1:8420/api/health` should report `db ok` and a pgvector version.

## Adding books

- **Upload:** click **Add PDFs** in the library, or drag PDFs onto the page.
- **Drop into the folder:** copy PDFs into `DATA_DIR/library/` (subfolders are fine). New files
  are picked up within about 10 seconds, or immediately with **Rescan folder**.

Either way, a file that's already in the library (same content, any name) is skipped. Each book is
extracted in the background: running headers and page numbers are stripped, footnotes are moved
aside, words hyphenated across lines are rejoined, and lines are reflowed into paragraphs.

Removing a book moves its PDF to `DATA_DIR/trash/` rather than deleting it.

**Inspect text** on a book opens the debug view: the page image, the raw extracted text, and the
cleaned text side by side, plus every line cleanup removed and why. Use it to check a new book,
especially a scan. Pages with no usable text (image-only scans) are flagged as needing OCR, which
comes in a later phase.

## Reading

Click a book's title, or **Read**, to open it. A book reopens on the page where you left off, and
the library shows how far you've got. **Contents** lists the PDF's table of contents, if it has
one, and marks the section you're in. The side panel holds your [lookups](#lookups) and
[chats](#chat); highlights come later.

| Key | Action |
| --- | --- |
| `J` / `K` | Next / previous page |
| `G` | Go to a page (focuses the page number) |
| `+` / `-` / `0` | Zoom in / out / reset (also with ⌘ or Ctrl) |
| `[` / `]` | Show or hide the contents / the side panel |
| `D` / `W` / `E` | Define / Who / Explain the selected text |
| `C` | Chat: open it and start typing (`Esc` hands the keys back to the book) |
| `Esc` | Clear the selection |

Books can be read while they're still being extracted; only a failed book can't be opened.
**Inspect this page's text** in the toolbar opens the debug view at the page you're on.

## Lookups

Select a word, a name, or a passage on the page and a small toolbar appears over it:

- **Define** (`D`): what the term means in this book, how its use shifts across the book, and
  the pages worth reading about it.
- **Who** (`W`): who the person is, their relation to the author, and how the author uses them
  here.
- **Explain** (`E`): the passage in plain language, its key terms, and where it sits in the
  argument. Longer selections offer only this.

Answers open in the side panel's **Lookups** tab. Their page citations are links: click one to
jump to the page, which briefly lights up so you can find it. Answers are saved, so looking up
the same term in the same book again is instant; **Ask again** replaces a saved answer.

Lookups need `GEMINI_API_KEY` in `.env`. When you open a book, its whole text goes into a
Gemini context cache, so each lookup pays in full only for the question; the cache lasts
`CACHE_TTL_MINUTES` and is extended while you read. Small books are sent whole with each
request instead, and a book too long for the model gets the pages around the selection. The
prompts are plain files in `backend/app/ai/prompts/` (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Chat

The side panel's **Chat** tab (`C`) is for talking the book through: what a chapter argues, how
two passages connect, whether you've read something right. Each question goes to `MODEL_DEEP`
with the book, the conversation so far, and the page you're on (and its section, if the PDF has
a table of contents), so "here" and "this chapter" mean what you'd expect. The answer streams
in as it's written, with its page citations as links. Each question keeps a link to the page
you asked it from.

- **Stop** ends an answer early and keeps what it wrote. **Ask again** (on the last answer)
  replaces it with a new one.
- An answer is finished and saved even if you close the book while it's being written; reopen
  the chat and it picks up where it is.
- A book reopens on its most recent chat. **All chats** lists the others; the pen starts a new
  one. Deleting a chat can't be undone.
- For a book too long to send whole, the model gets the pages around yours, the pages that best
  match your question's words, and the pages its last answer cited. Answers say when they're
  working from excerpts.

With `MODEL_DEEP` different from `MODEL_FAST` and caching on, the chat keeps its own Gemini
cache of the book, made the first time you open the Chat tab. `CHAT_THINKING` trades answer
quality for how soon the first words arrive.

`.env.example` is set up for a free API key: a Flash-Lite model (the most generous free
quota), caching off (the free tier doesn't include it for Flash-Lite), and a cap on how much of
a book one request sends. With a paid key, its comments say what to change.

## Everyday commands

| Command | What it does |
| --- | --- |
| `make run` | Serve the app on `APP_PORT`, rebuilding the frontend if it changed |
| `make dev` | Vite dev server with hot reload plus `uvicorn --reload`; open the Vite URL (http://127.0.0.1:5173) |
| `make up` / `make down` | Start or stop Postgres. Your data stays in the Docker volume |
| `make migrate` | Apply migrations without starting the app |
| `make backup` | `pg_dump` to `DATA_DIR/backups/`, timestamped |
| `make restore FILE=...` | Replace the database with a dump (asks first) |
| `make psql` | Open a SQL shell |
| `make test` / `make lint` | Backend tests; ruff, oxlint, and tsc |

Run `make` on its own to list every target.

## Where things live

- **App code:** this repo. `git pull` never touches your data.
- **Your data:** `DATA_DIR` (PDFs in `library/`, dumps in `backups/`, removed books in `trash/`)
  and the `obelus_pgdata` Docker volume. Back up both.
- **Config:** `.env` in the repo root, which git ignores. `.env.example` documents every setting.

## Using it from other devices

The app has no authentication, so keep `APP_HOST=127.0.0.1`. To reach it from your phone or
laptop, use [`tailscale serve`](https://tailscale.com/kb/1312/serve) to expose the port to your
tailnet only:

```sh
tailscale serve --bg 8420
```

Never bind it to `0.0.0.0` or a public interface.

## Layout

```
backend/     FastAPI app (app/), Alembic migrations (migrations/), tests
frontend/    React + Vite; built into frontend/dist and served by FastAPI
Makefile     every command above
docker-compose.yml   Postgres + pgvector, bound to 127.0.0.1
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for migrations and code style.
