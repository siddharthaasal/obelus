-include .env

APP_HOST ?= 127.0.0.1
APP_PORT ?= 8420
DATA_DIR ?= ~/ObelusData
# Make doesn't expand ~, so do it here for recipes that quote paths.
BACKUP_DIR := $(patsubst ~/%,$(HOME)/%,$(DATA_DIR))/backups

COMPOSE := docker compose
PG := -U obelus -d obelus

FRONTEND_DEPS := frontend/node_modules/.package-lock.json
FRONTEND_SRC := $(shell find frontend/src frontend/public -type f 2>/dev/null) \
	$(wildcard frontend/index.html frontend/vite.config.ts frontend/tsconfig*.json)

.DEFAULT_GOAL := help
.PHONY: help setup up down migrate revision build run dev backup restore psql lint fmt test

help: ## List targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

setup: ## First-time setup: create .env, install backend and frontend deps
	@test -f .env || (cp .env.example .env && echo "Created .env. Add your GEMINI_API_KEY.")
	cd backend && uv sync
	@$(MAKE) --no-print-directory $(FRONTEND_DEPS)

up: ## Start Postgres (docker compose) and wait until it's healthy
	$(COMPOSE) up -d --wait db

down: ## Stop Postgres (data is kept in the pgdata volume)
	$(COMPOSE) down

migrate: up ## Apply migrations (also runs automatically when the app starts)
	cd backend && uv run alembic upgrade head

revision: up ## New migration from model changes: make revision m="add books"
	@test -n "$(m)" || (echo 'usage: make revision m="describe the change"' && exit 1)
	cd backend && uv run alembic revision --autogenerate -m "$(m)"

$(FRONTEND_DEPS): frontend/package.json $(wildcard frontend/package-lock.json)
	cd frontend && npm install
	@touch $@

frontend/dist/index.html: $(FRONTEND_DEPS) $(FRONTEND_SRC)
	cd frontend && npm run build

build: frontend/dist/index.html ## Build the frontend (skipped when up to date)

run: up build ## Build frontend if needed and serve everything on APP_PORT
	cd backend && uv run uvicorn app.main:app --host $(APP_HOST) --port $(APP_PORT)

dev: up $(FRONTEND_DEPS) ## Vite dev server + uvicorn --reload (open the Vite URL)
	@(cd backend && exec uv run uvicorn app.main:app --reload --reload-dir app --reload-dir migrations \
		--host $(APP_HOST) --port $(APP_PORT)) & api=$$!; \
	trap "kill $$api 2>/dev/null" EXIT INT TERM; \
	cd frontend && npm run dev

backup: up ## Dump the database to DATA_DIR/backups/ (timestamped)
	@mkdir -p "$(BACKUP_DIR)"
	@f="$(BACKUP_DIR)/obelus-$$(date +%Y%m%d-%H%M%S).dump"; \
	$(COMPOSE) exec -T db pg_dump $(PG) --format=custom > "$$f.partial" \
		&& mv "$$f.partial" "$$f" && echo "Wrote $$f" \
		|| (rm -f "$$f.partial"; exit 1)

restore: up ## Replace the database with a dump: make restore FILE=path/to.dump
	@test -f "$(FILE)" || (echo "usage: make restore FILE=path/to.dump" && exit 1)
	@printf "This replaces the current database with $(FILE). Stop the app first. Continue? [y/N] "; \
	read ans; [ "$$ans" = y ] || [ "$$ans" = Y ] || (echo "Aborted."; exit 1)
	$(COMPOSE) exec -T db pg_restore $(PG) --clean --if-exists --no-owner < "$(FILE)"

psql: up ## Open a psql shell on the database
	$(COMPOSE) exec db psql $(PG)

lint: $(FRONTEND_DEPS) ## Lint backend (ruff) and frontend (oxlint, tsc)
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run lint && npx tsc -b

fmt: ## Format and autofix backend code
	cd backend && uv run ruff check --fix . && uv run ruff format .

test: up ## Run backend tests
	cd backend && uv run pytest
