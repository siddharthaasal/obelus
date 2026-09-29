from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_db_and_pgvector():
    # Entering the client runs the lifespan, which applies migrations.
    with TestClient(app) as client:
        res = client.get("/api/health")

    assert res.status_code == 200
    body = res.json()
    assert body["db"] == "ok"
    assert body["pgvector"], "vector extension should be installed by migrations"


def test_unknown_api_route_is_404_not_spa():
    with TestClient(app) as client:
        res = client.get("/api/does-not-exist")

    assert res.status_code == 404
    assert res.headers["content-type"].startswith("application/json")
