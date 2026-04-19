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
