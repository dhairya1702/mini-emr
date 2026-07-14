from __future__ import annotations

import io

import pytest

from test_app import auth_headers_for_token, auth_module, client, config_module, register_test_clinic


@pytest.fixture(autouse=True)
def _restore_settings_cache():
    config_module.get_settings.cache_clear()


def _superadmin_headers(test_client, session: dict) -> dict[str, str]:
    login = test_client.post(
        "/auth/login",
        json={
            "identifier": session["user"]["identifier"],
            "password": "password123!",
        },
    )
    assert login.status_code == 200, login.json()
    token = login.json()["token"]
    return auth_headers_for_token(token)


def test_superuser_orgs_requires_allowlisted_identifier(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="owner@clinic.com", clinic_name="Owner Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "owner@clinic.com",
            },
        )(),
    )

    response = test_client.get("/superuser/orgs", headers=_superadmin_headers(test_client, session))
    refreshed = response.headers.get("x-session-token")
    assert refreshed

    assert response.status_code == 200, response.json()
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["clinic_name"] == "Owner Clinic"
    assert rows[0]["media_storage_bytes"] == 0


def test_superdashboard_can_create_and_list_customer_onboarding(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="ops@clinic.com", clinic_name="Ops Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "ops@clinic.com",
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)

    created = test_client.post(
        "/superdashboard/onboarding/customers",
        headers=headers,
        json={
            "customer_name": "Bluebird Clinic",
            "phone": "+91 98765 43210",
            "users_allowed": 3,
            "workspace_mode": "team",
        },
    )

    assert created.status_code == 201, created.json()
    body = created.json()
    assert body["customer_id"].startswith("CID-")
    assert body["customer_name"] == "Bluebird Clinic"
    assert body["phone"] == "+919876543210"
    assert body["users_allowed"] == 3
    assert body["workspace_mode"] == "team"

    listed = test_client.get("/superdashboard/onboarding", headers=headers)
    assert listed.status_code == 200
    assert any(row["customer_id"] == body["customer_id"] for row in listed.json()["customers"])


def test_superdashboard_can_switch_organization_workspace_mode(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="ops-mode@clinic.com", clinic_name="Mode Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "ops-mode@clinic.com",
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)

    updated = test_client.patch(
        f"/superdashboard/orgs/{session['user']['org_id']}/workspace-mode",
        headers=headers,
        json={"workspace_mode": "team"},
    )

    assert updated.status_code == 200, updated.json()
    assert updated.json()["workspace_mode"] == "team"
    settings = test_client.get("/settings/clinic", headers=headers)
    assert settings.json()["workspace_mode"] == "team"
    orgs = test_client.get("/superdashboard/orgs", headers=headers)
    assert orgs.json()[0]["workspace_mode"] == "team"


def test_superdashboard_can_change_organization_user_limit(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="ops-limit@clinic.com", clinic_name="Limit Ops Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "ops-limit@clinic.com",
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)
    org_id = session["user"]["org_id"]

    updated = test_client.patch(
        f"/superdashboard/orgs/{org_id}/users-allowed",
        headers=headers,
        json={"users_allowed": 5},
    )

    assert updated.status_code == 200, updated.json()
    assert updated.json()["users_allowed"] == 5
    settings = test_client.get("/settings/clinic", headers=auth_headers_for_token(session["token"]))
    assert settings.json()["users_allowed"] == 5
    orgs = test_client.get("/superdashboard/orgs", headers=headers)
    assert orgs.json()[0]["users_allowed"] == 5

    staff = test_client.post(
        "/users/staff",
        headers=auth_headers_for_token(session["token"]),
        json={"identifier": "ops-limit-staff@clinic.com", "password": "password123!"},
    )
    assert staff.status_code == 201

    below_current = test_client.patch(
        f"/superdashboard/orgs/{org_id}/users-allowed",
        headers=headers,
        json={"users_allowed": 1},
    )
    assert below_current.status_code == 400
    assert below_current.json()["detail"] == "User limit cannot be lower than the 2 existing users."


def test_customer_user_limit_blocks_extra_staff(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="limit-owner@clinic.com", clinic_name="Limit Clinic")
    headers = auth_headers_for_token(session["token"])

    first_staff = test_client.post(
        "/users/staff",
        headers=headers,
        json={"identifier": "limit-staff-1@clinic.com", "password": "password123!"},
    )
    second_staff = test_client.post(
        "/users/staff",
        headers=headers,
        json={"identifier": "limit-staff-2@clinic.com", "password": "password123!"},
    )

    assert first_staff.status_code == 201
    assert second_staff.status_code == 400
    assert second_staff.json()["detail"] == "User limit reached for this customer."


def test_superuser_orgs_include_media_storage_usage(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="owner-storage@clinic.com", clinic_name="Owner Storage Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "owner-storage@clinic.com",
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)
    patient = test_client.post(
        "/patients",
        json={
            "name": "Storage Patient",
            "phone": "5550107890",
            "reason": "Media review",
            "age": 32,
            "weight": 68,
            "height": 170,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()
    upload = test_client.post(
        f"/patients/{patient['id']}/attachments",
        files={
            "file": (
                "clip.mp4",
                io.BytesIO(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 20),
                "video/mp4",
            )
        },
        headers=headers,
    )
    assert upload.status_code == 201

    response = test_client.get("/superuser/orgs", headers=headers)

    assert response.status_code == 200, response.json()
    assert response.json()[0]["media_storage_bytes"] == len(
        b"\x00\x00\x00\x18ftypisom" + b"\x00" * 20
    )


def test_superuser_orgs_denies_non_allowlisted_identifier(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="staff@clinic.com", clinic_name="Staff Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "owner@clinic.com",
            },
        )(),
    )

    response = test_client.get("/superuser/orgs", headers=auth_headers_for_token(session["token"]))

    assert response.status_code == 403
