from fastapi import APIRouter
from sqlmodel import SQLModel

from app.config import get_settings
from app.db import SessionDep
from app.ingest.library import scan_library
from app.ingest.worker import worker

router = APIRouter(prefix="/library", tags=["library"])


class LibraryInfo(SQLModel):
    library_dir: str


class ScanOut(SQLModel):
    added: int
    duplicates: int


@router.get("")
def library_info() -> LibraryInfo:
    return LibraryInfo(library_dir=str(get_settings().library_dir))


@router.post("/scan")
def scan(session: SessionDep) -> ScanOut:
    """Pick up PDFs dropped into the library folder now, instead of at the next scan."""
    result = scan_library(session)
    if result.added:
        worker.notify()
    return ScanOut(added=result.added, duplicates=result.duplicates)
