from fastapi import APIRouter, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db import SessionDep

router = APIRouter(tags=["health"])


@router.get("/health")
def health(session: SessionDep, response: Response) -> dict:
    try:
        pgvector = session.exec(
            text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
        ).scalar_one_or_none()
    except SQLAlchemyError:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "db": "error", "pgvector": None}

    return {"status": "ok", "db": "ok", "pgvector": pgvector}
