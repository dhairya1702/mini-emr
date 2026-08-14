from __future__ import annotations

import io

import pytest

from test_app import auth_headers_for_token, auth_module, client, config_module, register_test_clinic


@pytest.fixture(autouse=True)
def _restore_settings_cache():
    config_module.get_settings.cache_clear()


def _superadmin_headers(test_client, session: dict) -> dict[str, str]:
    login = test_client.post(
        "/superdashboard/auth/login",
        json={
            "identifier": session["user"]["identifier"],
            "password": "password123!",
        },
    )
    assert login.status_code == 200, login.json()
    token = login.json()["token"]
    return auth_headers_for_token(token)


def _configure_superadmin(monkeypatch: pytest.MonkeyPatch, identifier: str):
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "app_origin": "http://testserver",
                "super_admin_identifiers": identifier,
                "session_ttl_hours": 12,
                "superdashboard_session_ttl_hours": 4,
            },
        )(),
    )


def test_superdashboard_and_clinic_sessions_can_use_different_accounts(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    ops = register_test_clinic(test_client, identifier="separate-ops@clinic.com", clinic_name="Ops Account")
    clinic = register_test_clinic(test_client, identifier="clinic-user@clinic.com", clinic_name="Clinic Account")
    _configure_superadmin(monkeypatch, ops["user"]["identifier"])

    clinic_login = test_client.post(
        "/auth/login",
        json={"identifier": clinic["user"]["identifier"], "password": "password123!"},
    )
    ops_login = test_client.post(
        "/superdashboard/auth/login",
        json={"identifier": ops["user"]["identifier"], "password": "password123!"},
    )

    assert clinic_login.status_code == 200
    assert ops_login.status_code == 200
    assert test_client.cookies.get("clinic_session")
    assert test_client.cookies.get("superdashboard_session")
    assert test_client.get("/auth/me").json()["identifier"] == clinic["user"]["identifier"]
    ops_session = test_client.get("/superdashboard/auth/session")
    assert ops_session.status_code == 200
    assert ops_session.json()["identifier"] == ops["user"]["identifier"]
    assert ops_session.headers.get("x-session-token") is None

    logout = test_client.post(
        "/superdashboard/auth/logout",
        headers={"Origin": "http://testserver"},
    )
    assert logout.status_code == 204
    assert test_client.get("/auth/me").json()["identifier"] == clinic["user"]["identifier"]
    assert test_client.get("/superdashboard/auth/session").status_code == 401


def test_clinic_logout_does_not_revoke_same_users_superdashboard_session(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="dual-realm@clinic.com", clinic_name="Dual Realm")
    _configure_superadmin(monkeypatch, session["user"]["identifier"])
    assert test_client.post(
        "/auth/login",
        json={"identifier": session["user"]["identifier"], "password": "password123!"},
    ).status_code == 200
    ops_login = test_client.post(
        "/superdashboard/auth/login",
        json={"identifier": session["user"]["identifier"], "password": "password123!"},
    )
    assert ops_login.status_code == 200
    payload = auth_module.decode_access_token(ops_login.json()["token"])
    assert payload["realm"] == "superdashboard"
    assert int(payload["exp"]) - int(payload["iat"]) == 4 * 60 * 60

    logout = test_client.post("/auth/logout", headers={"Origin": "http://testserver"})

    assert logout.status_code == 204
    assert test_client.get("/auth/me").status_code == 401
    assert test_client.get("/superdashboard/auth/session").status_code == 200


def test_superdashboard_rejects_clinic_tokens_and_unapproved_logins(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    approved = register_test_clinic(test_client, identifier="approved-ops@clinic.com", clinic_name="Approved Ops")
    unapproved = register_test_clinic(test_client, identifier="unapproved@clinic.com", clinic_name="Unapproved")
    _configure_superadmin(monkeypatch, approved["user"]["identifier"])

    clinic_token_response = test_client.get(
        "/superdashboard/orgs",
        headers=auth_headers_for_token(approved["token"]),
    )
    unapproved_login = test_client.post(
        "/superdashboard/auth/login",
        json={"identifier": unapproved["user"]["identifier"], "password": "password123!"},
    )
    wrong_password = test_client.post(
        "/superdashboard/auth/login",
        json={"identifier": approved["user"]["identifier"], "password": "wrong-password"},
    )

    assert clinic_token_response.status_code == 401
    assert unapproved_login.status_code == 401
    assert wrong_password.status_code == 401
    assert unapproved_login.json() == wrong_password.json() == {"detail": "Invalid email/phone or password."}


def test_password_change_revokes_the_users_superdashboard_session(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="password-ops@clinic.com", clinic_name="Password Ops")
    _configure_superadmin(monkeypatch, session["user"]["identifier"])
    assert test_client.post(
        "/auth/login",
        json={"identifier": session["user"]["identifier"], "password": "password123!"},
    ).status_code == 200
    assert test_client.post(
        "/superdashboard/auth/login",
        json={"identifier": session["user"]["identifier"], "password": "password123!"},
    ).status_code == 200

    changed = test_client.post(
        "/auth/me/password",
        headers={"Origin": "http://testserver"},
        json={"current_password": "password123!", "new_password": "new-password123!"},
    )

    assert changed.status_code == 204
    assert test_client.get("/auth/me").status_code == 200
    assert test_client.get("/superdashboard/auth/session").status_code == 401


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
    assert refreshed is None

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
    test_client, repo = client
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
    settings = test_client.get("/settings/clinic", headers=auth_headers_for_token(session["token"]))
    assert settings.json()["workspace_mode"] == "team"
    orgs = test_client.get("/superdashboard/orgs", headers=headers)
    assert orgs.json()[0]["workspace_mode"] == "team"
    assert not any(event["action"] == "workspace_mode_changed" for event in repo.audit_events.values())


def test_superdashboard_can_change_organization_user_limit(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
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
    assert not any(event["action"] == "user_limit_changed" for event in repo.audit_events.values())

    staff = test_client.post(
        "/users/staff",
        headers=auth_headers_for_token(session["token"]),
        json={
            "identifier": "ops-limit-staff@clinic.com",
            "email": "ops-limit-staff@clinic.com",
            "phone": "5550109001",
            "password": "password123!",
        },
    )
    assert staff.status_code == 201

    below_current = test_client.patch(
        f"/superdashboard/orgs/{org_id}/users-allowed",
        headers=headers,
        json={"users_allowed": 1},
    )
    assert below_current.status_code == 400
    assert below_current.json()["detail"] == "User limit cannot be lower than the 2 existing users."


def test_superdashboard_org_detail_includes_settings(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="ops-detail@clinic.com", clinic_name="Detail Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "ops-detail@clinic.com",
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)

    response = test_client.get(f"/superdashboard/orgs/{session['user']['org_id']}", headers=headers)

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["summary"]["clinic_name"] == "Detail Clinic"
    assert body["settings"]["clinic_name"] == "Detail Clinic"
    assert body["users"][0]["identifier"] == "ops-detail@clinic.com"


def test_superdashboard_can_update_organization_settings(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="ops-settings@clinic.com", clinic_name="Settings Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "ops-settings@clinic.com",
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)

    updated = test_client.patch(
        f"/superdashboard/orgs/{session['user']['org_id']}/settings",
        headers=headers,
        json={
            "clinic_name": "Renamed Clinic",
            "clinic_phone": "+91 90000 11111",
            "clinic_specialty": "pediatrics",
            "timezone": "Asia/Kolkata",
            "appointment_start_time": "10:00",
            "appointment_end_time": "19:00",
            "appointments_per_hour": 3,
            "doctor_name": "Dr Ops",
        },
    )

    assert updated.status_code == 200, updated.json()
    assert updated.json()["clinic_name"] == "Renamed Clinic"
    assert updated.json()["clinic_specialty"] == "pediatrics"
    assert updated.json()["timezone"] == "Asia/Kolkata"
    detail = test_client.get(f"/superdashboard/orgs/{session['user']['org_id']}", headers=headers)
    assert detail.json()["settings"]["doctor_name"] == "Dr Ops"
    orgs = test_client.get("/superdashboard/orgs", headers=headers)
    assert orgs.json()[0]["clinic_specialty"] == "pediatrics"


def test_superdashboard_can_update_user_role(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="ops-role@clinic.com", clinic_name="Role Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "ops-role@clinic.com",
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)
    staff = test_client.post(
        "/users/staff",
        headers=auth_headers_for_token(session["token"]),
        json={
            "identifier": "role-staff@clinic.com",
            "email": "role-staff@clinic.com",
            "phone": "5550109002",
            "password": "password123!",
        },
    )
    assert staff.status_code == 201, staff.json()
    staff_id = staff.json()["id"]

    updated = test_client.patch(
        f"/superdashboard/users/{staff_id}/role",
        headers=headers,
        json={"role": "admin"},
    )

    assert updated.status_code == 200, updated.json()
    assert updated.json()["role"] == "admin"
    detail = test_client.get(f"/superdashboard/orgs/{session['user']['org_id']}", headers=headers)
    assert any(user["identifier"] == "role-staff@clinic.com" and user["role"] == "admin" for user in detail.json()["users"])
    assert not any(event["action"] == "user_role_changed" for event in repo.audit_events.values())


def test_superdashboard_prevents_demoting_last_admin_but_can_delete_admins(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="ops-last-admin@clinic.com", clinic_name="Last Admin Clinic")
    managed_session = register_test_clinic(
        test_client,
        identifier="managed-admin@clinic.com",
        clinic_name="Managed Admin Clinic",
    )
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "ops-last-admin@clinic.com",
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)
    user_id = session["user"]["id"]
    managed_user_id = managed_session["user"]["id"]

    demote = test_client.patch(
        f"/superdashboard/users/{user_id}/role",
        headers=headers,
        json={"role": "staff"},
    )
    delete_managed_admin = test_client.delete(f"/superdashboard/users/{managed_user_id}", headers=headers)
    delete_self = test_client.delete(f"/superdashboard/users/{user_id}", headers=headers)

    assert demote.status_code == 400
    assert demote.json()["detail"] == "Every clinic must retain at least one admin."
    assert delete_managed_admin.status_code == 200, delete_managed_admin.text
    assert delete_self.status_code == 400
    assert delete_self.json()["detail"] == "You cannot remove your own account."


def test_superdashboard_delete_org_removes_org_and_reports_missing(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="ops-delete@clinic.com", clinic_name="Delete Ops Clinic")
    managed_session = register_test_clinic(
        test_client,
        identifier="managed-delete@clinic.com",
        clinic_name="Managed Delete Clinic",
    )
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": "ops-delete@clinic.com",
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)
    managed_org_id = managed_session["user"]["org_id"]

    deleted = test_client.delete(f"/superdashboard/orgs/{managed_org_id}", headers=headers)
    orgs = test_client.get("/superdashboard/orgs", headers=headers)
    deleted_again = test_client.delete(f"/superdashboard/orgs/{managed_org_id}", headers=headers)

    assert deleted.status_code == 200, deleted.text
    assert all(row["org_id"] != managed_org_id for row in orgs.json())
    assert deleted_again.status_code == 404
    assert deleted_again.json()["detail"] == "Organization not found."


def test_customer_user_limit_blocks_extra_staff(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="limit-owner@clinic.com", clinic_name="Limit Clinic")
    headers = auth_headers_for_token(session["token"])

    first_staff = test_client.post(
        "/users/staff",
        headers=headers,
        json={
            "identifier": "limit-staff-1@clinic.com",
            "email": "limit-staff-1@clinic.com",
            "phone": "5550109003",
            "password": "password123!",
        },
    )
    second_staff = test_client.post(
        "/users/staff",
        headers=headers,
        json={
            "identifier": "limit-staff-2@clinic.com",
            "email": "limit-staff-2@clinic.com",
            "phone": "5550109004",
            "password": "password123!",
        },
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
        headers=auth_headers_for_token(session["token"]),
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
        headers=auth_headers_for_token(session["token"]),
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

    assert response.status_code == 401
