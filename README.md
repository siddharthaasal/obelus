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
