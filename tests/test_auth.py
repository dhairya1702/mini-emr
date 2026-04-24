from __future__ import annotations

from uuid import uuid4

import pytest

from test_app import auth_headers, auth_module, client, main_module, register


def test_auth_me_reissues_session_headers(client):
    test_client, _repo = client
    session = register(test_client, identifier="session@clinic.com", clinic_name="Session Clinic")
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) == session["token"]

    response = test_client.get("/auth/me", headers=auth_headers(session["token"]))
    assert response.status_code == 200
    refreshed_token = response.headers.get("x-session-token")
    refreshed_expiry = response.headers.get("x-session-expires-at")
    assert refreshed_token
    assert refreshed_expiry

    payload = auth_module.decode_access_token(refreshed_token)
    assert payload["sub"] == response.json()["id"]
    assert int(refreshed_expiry) == payload["exp"]
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) == refreshed_token


def test_auth_cookie_session_and_logout(client):
    test_client, _repo = client
    register(test_client, identifier="cookie@clinic.com", clinic_name="Cookie Clinic")

    cookie_response = test_client.get("/auth/me")
    assert cookie_response.status_code == 200
    assert cookie_response.json()["identifier"] == "cookie@clinic.com"

    logout_response = test_client.post("/auth/logout")
    assert logout_response.status_code == 204
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) is None

    after_logout = test_client.get("/auth/me")
    assert after_logout.status_code == 401


def test_access_token_requires_explicit_auth_secret(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {"auth_secret": "", "supabase_service_role_key": "service-role-key"},
        )(),
    )

    with pytest.raises(RuntimeError, match="AUTH_SECRET must be configured."):
        auth_module.create_access_token(
            {
                "id": str(uuid4()),
                "org_id": str(uuid4()),
                "identifier": "owner@clinic.com",
                "role": "admin",
            }
        )


def test_login_rate_limit_returns_429(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    register(test_client, identifier="ratelimit-login@clinic.com", clinic_name="Rate Limit Clinic")
    monkeypatch.setitem(main_module.RATE_LIMIT_WINDOWS, "auth_login", (1, 60.0))
    main_module.RATE_LIMIT_BUCKETS.clear()

    first = test_client.post(
        "/auth/login",
        json={"identifier": "ratelimit-login@clinic.com", "password": "password123"},
    )
    assert first.status_code == 200

    second = test_client.post(
        "/auth/login",
        json={"identifier": "ratelimit-login@clinic.com", "password": "password123"},
    )
    assert second.status_code == 429


def test_auth_me_can_update_account_details(client):
    test_client, _repo = client
    session = register(test_client, identifier="account@clinic.com", clinic_name="Account Clinic")
    headers = auth_headers(session["token"])

    response = test_client.patch(
        "/auth/me",
        headers=headers,
        json={
            "name": "Dr Akanksha Goyal",
            "doctor_dob": "1990-05-12",
            "doctor_address": "12 Marine Drive",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Dr Akanksha Goyal"
    assert body["doctor_dob"] == "1990-05-12"
    assert body["doctor_address"] == "12 Marine Drive"


def test_auth_me_can_change_password(client):
    test_client, _repo = client
    session = register(test_client, identifier="password-change@clinic.com", clinic_name="Password Clinic")
    headers = auth_headers(session["token"])

    response = test_client.post(
        "/auth/me/password",
        headers=headers,
        json={
            "current_password": "password123",
            "new_password": "newpassword456",
        },
    )

    assert response.status_code == 204

    login = test_client.post(
        "/auth/login",
        json={"identifier": "password-change@clinic.com", "password": "newpassword456"},
    )
    assert login.status_code == 200


def test_auth_me_can_manage_own_signature(client):
    test_client, _repo = client
    session = register(test_client, identifier="self-signature@clinic.com", clinic_name="Self Signature Clinic")
    headers = auth_headers(session["token"])

    uploaded = test_client.post(
        "/auth/me/signature",
        headers=headers,
        files={"file": ("signature.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["doctor_signature_name"] == "signature.png"

    downloaded = test_client.get("/auth/me/signature/file", headers=headers)
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "image/png"

    removed = test_client.delete("/auth/me/signature", headers=headers)
    assert removed.status_code == 200
    assert removed.json()["doctor_signature_name"] is None
