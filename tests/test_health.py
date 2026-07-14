from __future__ import annotations

import test_app  # noqa: F401
import app.routes.health as health_module

from test_app import client


def test_liveness_does_not_require_dependencies(client):
    test_client, _repo = client
    response = test_client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_reports_dependency_failure(client, monkeypatch):
    test_client, _repo = client

    def fail_readiness() -> None:
        raise RuntimeError("pending migration")

    monkeypatch.setattr(health_module, "_check_readiness", fail_readiness)
    response = test_client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["detail"] == "Service is not ready."


def test_health_compatibility_route_uses_readiness(client, monkeypatch):
    test_client, _repo = client
    monkeypatch.setattr(health_module, "_check_readiness", lambda: None)
    response = test_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
