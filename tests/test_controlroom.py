from __future__ import annotations

import pytest
from pydantic import TypeAdapter
from uuid import uuid4

from test_app import auth_headers_for_token, auth_module, client, register_test_clinic
from app.schema_domains.controlroom import ControlRoomIncidentOut
from app.repositories.postgres.controlroom import _serialize_platform_error_sample


def _settings(identifier: str):
    return type(
        "Settings",
        (),
        {
            "auth_secret": "test-secret",
            "super_admin_identifiers": "",
            "control_room_identifiers": identifier,
            "whatsapp_enabled": True,
        },
    )()


def _headers(test_client, session: dict) -> dict[str, str]:
    login = test_client.post(
        "/auth/login",
        json={"identifier": session["user"]["identifier"], "password": "password123!"},
    )
    assert login.status_code == 200, login.json()
    return auth_headers_for_token(login.json()["token"])


def test_controlroom_requires_control_room_identifier(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="owner@clinic.com", clinic_name="Owner Clinic")
    monkeypatch.setattr(auth_module, "get_settings", lambda: _settings("other@clinic.com"))

    response = test_client.get("/controlroom/status", headers=_headers(test_client, session))

    assert response.status_code == 403
    assert response.json()["detail"] == "Control room access required."


def test_controlroom_status_database_and_runbooks(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="ops@clinic.com", clinic_name="Ops Clinic")
    monkeypatch.setattr(auth_module, "get_settings", lambda: _settings("ops@clinic.com"))
    headers = _headers(test_client, session)
    repo.api_request_metrics.append(
        {"org_id": session["user"]["org_id"], "status_code": 500, "created_at": next(iter(repo.users.values()))["created_at"]}
    )

    status = test_client.get("/controlroom/status", headers=headers)
    database = test_client.get("/controlroom/database", headers=headers)
    runbooks = test_client.get("/controlroom/runbooks", headers=headers)

    assert status.status_code == 200, status.json()
    assert any(check["key"] == "migrations" for check in status.json()["checks"])
    assert database.status_code == 200, database.json()
    assert database.json()["reachable"] is True
    assert any(check["key"] == "invoice_items_invoice_org" for check in database.json()["integrity_checks"])
    assert runbooks.status_code == 200, runbooks.json()
    assert any(row["key"] == "apply_migration" for row in runbooks.json()["runbooks"])


def test_controlroom_groups_incidents(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="incidents@clinic.com", clinic_name="Incident Clinic")
    monkeypatch.setattr(auth_module, "get_settings", lambda: _settings("incidents@clinic.com"))
    headers = _headers(test_client, session)
    for _ in range(2):
        test_client.get("/missing-controlroom-route", headers=headers)
    awaitable = repo.create_platform_error(
        org_id=session["user"]["org_id"],
        user_id=session["user"]["id"],
        identifier=session["user"]["identifier"],
        path="/invoices",
        method="POST",
        status_code=500,
        error_type="RuntimeError",
        message="Invoice send failed",
    )
    import asyncio

    asyncio.run(awaitable)

    response = test_client.get("/controlroom/incidents", headers=headers)

    assert response.status_code == 200, response.json()
    incidents = response.json()["incidents"]
    assert any(row["path"] == "/invoices" and row["count"] == 1 for row in incidents)


def test_controlroom_sql_uses_physical_email_columns():
    source = (
        __import__("pathlib").Path(__file__).resolve().parents[1]
        / "backend"
        / "app"
        / "repositories"
        / "postgres"
        / "controlroom.py"
    ).read_text(encoding="utf-8")

    assert "sender_email_app_password" in source
    assert "email_configured" not in source


def test_controlroom_incident_response_accepts_uuid_samples():
    adapter = TypeAdapter(ControlRoomIncidentOut)
    org_id = uuid4()
    user_id = uuid4()
    incident = adapter.validate_python(
        {
            "fingerprint": "abc123",
            "severity": "high",
            "method": "GET",
            "path": "/controlroom/incidents",
            "status_code": 500,
            "error_type": "RuntimeError",
            "message": "Failed",
            "count": 1,
            "affected_org_count": 1,
            "affected_user_count": 1,
            "first_seen_at": "2026-07-23T00:00:00Z",
            "last_seen_at": "2026-07-23T00:00:00Z",
            "latest_sample": {
                "id": uuid4(),
                "org_id": org_id,
                "user_id": user_id,
                "identifier": "ops@clinic.com",
                "path": "/controlroom/incidents",
                "method": "GET",
                "status_code": 500,
                "error_type": "RuntimeError",
                "message": "Failed",
                "details": "",
                "context": {},
                "created_at": "2026-07-23T00:00:00Z",
            },
        }
    )

    assert incident.latest_sample.org_id == org_id


def test_controlroom_repository_serializes_incident_sample_ids():
    sample = _serialize_platform_error_sample(
        {
            "id": uuid4(),
            "org_id": uuid4(),
            "user_id": uuid4(),
            "path": "/controlroom/incidents",
        }
    )

    assert isinstance(sample["id"], str)
    assert isinstance(sample["org_id"], str)
    assert isinstance(sample["user_id"], str)
