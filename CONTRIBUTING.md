# Contributing

## Running

`make setup` once, then `make dev` while working: the Vite dev server with hot reload on
http://127.0.0.1:5173, and the API with auto-reload behind it. `make run` serves the production
build the way you'll actually use it.

## Schema changes

Both of us have real data, so every schema change is an Alembic migration, never a manual edit in
`psql`.

1. Add or change a SQLModel table in `backend/app/models/`, and import new modules in
   `backend/app/models/__init__.py` so Alembic can see them.
2. `make revision m="add books table"` autogenerates a file in `backend/migrations/versions/`.
3. Read the generated file. Autogenerate misses some things (extensions, generated columns, some
   index types, renames). Fix it by hand with `op.execute(...)` where needed.
4. `make migrate`, or just restart the app, since it migrates on startup.
5. Commit the migration together with the model change.

If you both add a migration on separate branches, Alembic will report multiple heads after the
merge. Run `cd backend && uv run alembic merge heads -m "merge"` and commit the result.

Take a `make backup` before pulling someone else's migrations if your library matters to you.

## Tests

`make test` runs against a separate `obelus_test` database (created automatically) and a
temporary data directory, so it never touches your library. The background worker is off in
tests; call the `run_jobs` fixture to process queued jobs.

## Tuning text cleanup

The rules live in `backend/app/ingest/clean.py`, and PDFs vary a lot. When a book comes out wrong:

1. Find the bad page with **Inspect text** in the library.
2. Reproduce it as a small case in `backend/tests/test_clean.py`. Build rows by hand: position,
   font size, and text are all a rule sees.
3. Fix the rule, run `make test`, then **Reprocess book** in the debug view to re-run extraction.

Font-size rules (footnotes, headings) are skipped on scanned pages, because OCR text layers have
meaningless sizes.

## Tuning prompts

Prompts are Markdown files in `backend/app/ai/prompts/`, read on every request, so edits apply
without a restart. Code fills the `{{name}}` placeholders (a missing one raises), and
`<!-- comments -->` are notes for whoever edits the file; they never reach the model. Each
file's header says what it's for and which placeholders it gets.

- `system.md` is cached with each book's text, so changing it rebuilds a book's cache at its
  next lookup: one full-price read of the book.
- An answer's fields are fixed by `backend/app/ai/schemas.py`, and the prompt says what goes in
  each. Adding or renaming a field means changing the schema, the prompt, and the types in
  `frontend/src/api.ts` together.
- Tests use a fake Gemini (`backend/tests/fakes.py`) and never call the API.
  `tests/test_gemini.py` checks what the real client puts on the wire, over a mocked
  transport; rerun it after upgrading `google-genai`.

## Code style

- **Python:** `make fmt` formats and autofixes. `make lint` must pass. Ruff config is in
  `backend/pyproject.toml`.
- **TypeScript:** oxlint and `tsc` via `make lint`.
- **UI:** follow [DESIGN.md](DESIGN.md). Build pages from the components in `frontend/src/ui`
  and style them with its tokens, not hex values. `/design` in the running app shows everything
  available.
- **Prompts:** plain files in `backend/app/ai/prompts/`, so either of us can tune them without
  touching code.
- **Dependencies:** `cd backend && uv add <pkg>`, and `cd frontend && npm install <pkg>`. Commit
  the lockfiles.
