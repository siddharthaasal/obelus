import logging
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.api import books, health, library
from app.config import BACKEND_DIR, FRONTEND_DIST, get_settings
from app.ingest.worker import worker

log = logging.getLogger("uvicorn.error")


def run_migrations() -> None:
    cfg = Config(BACKEND_DIR / "alembic.ini")
    # Leave uvicorn's logging alone; env.py skips fileConfig when this is False.
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    for d in (settings.library_dir, settings.backups_dir, settings.tmp_dir):
        d.mkdir(parents=True, exist_ok=True)
    run_migrations()
    log.info("data dir: %s", settings.data_dir)
    if settings.worker_enabled:
        worker.start()
    yield
    await worker.stop()


app = FastAPI(title="Obelus", lifespan=lifespan)

api = APIRouter(prefix="/api")
api.include_router(health.router)
api.include_router(books.router)
api.include_router(library.router)
app.include_router(api)


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
def api_not_found(path: str):
    # Keep unknown /api routes from falling through to the SPA below.
    raise HTTPException(status_code=404, detail=f"No API route /api/{path}")


if (FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        file = (FRONTEND_DIST / path).resolve()
        if path and file.is_file() and file.is_relative_to(FRONTEND_DIST):
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")

else:

    @app.get("/", include_in_schema=False)
    def no_frontend():
        return HTMLResponse(
            "<p>Frontend not built. Run <code>make run</code> (builds it) "
            "or <code>make dev</code> and open the Vite URL.</p>"
        )
