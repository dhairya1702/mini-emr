from __future__ import annotations

import asyncio
from io import BytesIO
from uuid import uuid4

import pytest
from starlette.requests import Request
from PIL import Image, ImageDraw

from test_app import (
    auth_headers_for_token,
    auth_module,
    client,
    main_module,
    register_test_clinic,
    signature_png_bytes,
)
from app import config as config_module
from app.services import password_reset_service
from app.services.signature_service import normalize_signature_image
from app.services.user_workflow import build_user_out


def test_build_user_out_defaults_missing_superdashboard_session_version():
    user = build_user_out({
        "id": uuid4(),
        "org_id": uuid4(),
        "identifier": "missing-super-session@example.com",
        "name": "Missing Session",
        "role": "admin",
        "doctor_dob": None,
        "doctor_address": "",
        "doctor_signature_name": None,
        "doctor_signature_url": None,
        "doctor_signature_content_type": None,
        "created_at": "2026-08-14T12:28:24+00:00",
        "session_version": None,
        "superdashboard_session_version": None,
    })

    assert user.session_version == 1
    assert user.superdashboard_session_version == 1


def test_auth_me_reissues_session_headers(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="session@clinic.com", clinic_name="Session Clinic")
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) == session["token"]

    response = test_client.get("/auth/me", headers=auth_headers_for_token(session["token"]))
    assert response.status_code == 200
    refreshed_token = response.headers.get("x-session-token")
    refreshed_expiry = response.headers.get("x-session-expires-at")
    assert refreshed_token
    assert refreshed_expiry

    payload = auth_module.decode_access_token(refreshed_token)
    assert payload["sub"] == response.json()["id"]
    assert int(refreshed_expiry) == payload["exp"]
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) == refreshed_token


def test_api_responses_include_or_preserve_request_id(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="request-id@clinic.com", clinic_name="Request ID Clinic")
    generated = test_client.get("/auth/me", headers=auth_headers_for_token(session["token"]))
    assert generated.headers.get("x-request-id")

    supplied = test_client.get(
        "/auth/me",
        headers={**auth_headers_for_token(session["token"]), "X-Request-ID": "trace-123"},
    )
    assert supplied.headers["x-request-id"] == "trace-123"


def test_register_creates_clinic_settings_with_empty_specialty(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="specialty-register@clinic.com", clinic_name="Specialty Register Clinic")

    response = test_client.get("/settings/clinic", headers=auth_headers_for_token(session["token"]))

    assert response.status_code == 200
    assert response.json()["clinic_specialty"] is None


def test_registration_config_exposes_open_team_signup(client):
    test_client, _repo = client

    response = test_client.get("/auth/registration-config")

    assert response.status_code == 200
    assert response.json() == {
        "customer_id_required": False,
        "default_workspace_mode": "team",
        "default_users_allowed": 2,
    }


def test_open_registration_creates_team_clinic_without_customer_id(client):
    test_client, repo = client

    response = test_client.post(
        "/auth/register",
        json={
            "identifier": "open-register@clinic.com",
            "email": "open-register@clinic.com",
            "phone": "5550104444",
            "password": "password123!",
            "admin_name": "Clinic Admin",
            "clinic_name": "Open Clinic",
            "clinic_address": "123 Main Street",
            "clinic_phone": "5550104444",
            "doctor_name": "Dr Open",
        },
    )

    assert response.status_code == 201
    org_id = response.json()["user"]["org_id"]
    assert repo.clinic_settings[org_id]["workspace_mode"] == "team"
    assert repo.clinic_settings[org_id]["users_allowed"] == 2
    assert not any(row.get("claimed_org_id") == org_id for row in repo.customer_onboarding.values())


def test_closed_registration_requires_customer_id(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    monkeypatch.setattr(
        config_module,
        "get_settings",
        lambda: type("Settings", (), {"open_clinic_registration": False})(),
    )

    config_response = test_client.get("/auth/registration-config")
    response = test_client.post(
        "/auth/register",
        json={
            "identifier": "closed-register@clinic.com",
            "email": "closed-register@clinic.com",
            "phone": "5550105555",
            "password": "password123!",
            "admin_name": "Clinic Admin",
            "clinic_name": "Closed Clinic",
            "clinic_address": "123 Main Street",
            "clinic_phone": "5550105555",
            "doctor_name": "Dr Closed",
        },
    )

    assert config_response.status_code == 200
    assert config_response.json()["customer_id_required"] is True
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid customer ID or phone number."


def test_register_requires_valid_onboarded_customer_id(client):
    test_client, _repo = client

    response = test_client.post(
        "/auth/register",
        json={
            "identifier": "blocked-register@clinic.com",
            "email": "blocked-register@clinic.com",
            "phone": "5550109999",
            "password": "password123!",
            "customer_id": "CID-MISSING-0000",
            "admin_name": "Clinic Admin",
            "clinic_name": "Blocked Clinic",
            "clinic_address": "123 Main Street",
            "clinic_phone": "5550109999",
            "doctor_name": "Dr Test",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid customer ID or phone number."


def test_register_requires_onboarded_phone_match(client):
    test_client, repo = client
    customer_id = f"CID-PHN-{uuid4().hex[:4].upper()}"
    asyncio.run(
        repo.create_customer_onboarding(
            customer_id=customer_id,
            customer_name="Phone Match Clinic",
            phone="5550101111",
            users_allowed=2,
            created_by=None,
        )
    )

    response = test_client.post(
        "/auth/register",
        json={
            "identifier": "phone-mismatch@clinic.com",
            "email": "phone-mismatch@clinic.com",
            "phone": "5550102222",
            "password": "password123!",
            "customer_id": customer_id,
            "admin_name": "Clinic Admin",
            "clinic_name": "Phone Match Clinic",
            "clinic_address": "123 Main Street",
            "clinic_phone": "5550102222",
            "doctor_name": "Dr Test",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid customer ID or phone number."


def test_valid_registration_claims_onboarded_customer_id(client):
    test_client, repo = client
    customer_id = f"CID-CLM-{uuid4().hex[:4].upper()}"
    asyncio.run(
        repo.create_customer_onboarding(
            customer_id=customer_id,
            customer_name="Claim Clinic",
            phone="5550103333",
            users_allowed=5,
            workspace_mode="team",
            created_by=None,
        )
    )

    response = test_client.post(
        "/auth/register",
        json={
            "identifier": "claimed-register@clinic.com",
            "email": "claimed-register@clinic.com",
            "phone": "5550103333",
            "password": "password123!",
            "customer_id": customer_id,
            "admin_name": "Clinic Admin",
            "clinic_name": "Claim Clinic",
            "clinic_address": "123 Main Street",
            "clinic_phone": "5550103333",
            "doctor_name": "Dr Test",
        },
    )

    assert response.status_code == 201
    row = asyncio.run(repo.get_customer_onboarding_by_customer_id(customer_id))
    assert row["status"] == "claimed"
    assert row["claimed_org_id"] == response.json()["user"]["org_id"]
    settings = test_client.get(
        "/settings/clinic",
        headers=auth_headers_for_token(response.json()["token"]),
    )
    assert settings.status_code == 200
    assert settings.json()["workspace_mode"] == "team"
    assert settings.json()["users_allowed"] == 5


def test_authenticated_non_auth_routes_reissue_session_headers(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="session-refresh@clinic.com", clinic_name="Session Refresh Clinic")

    response = test_client.get("/patients", headers=auth_headers_for_token(session["token"]))
    assert response.status_code == 200
    refreshed_token = response.headers.get("x-session-token")
    refreshed_expiry = response.headers.get("x-session-expires-at")
    assert refreshed_token
    assert refreshed_expiry

    payload = auth_module.decode_access_token(refreshed_token)
    assert payload["sub"] == session["user"]["id"]
    assert int(refreshed_expiry) == payload["exp"]
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) == refreshed_token


def test_auth_cookie_session_and_logout(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="cookie@clinic.com", clinic_name="Cookie Clinic")

    cookie_response = test_client.get("/auth/me")
    assert cookie_response.status_code == 200
    assert cookie_response.json()["identifier"] == "cookie@clinic.com"

    logout_response = test_client.post(
        "/auth/logout",
        headers={"Origin": "http://127.0.0.1:3000"},
    )
    assert logout_response.status_code == 204
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) is None

    after_logout = test_client.get("/auth/me")
    assert after_logout.status_code == 401
    old_bearer = test_client.get(
        "/auth/me",
        headers=auth_headers_for_token(session["token"]),
    )
    assert old_bearer.status_code == 401


def test_conflicting_bearer_and_cookie_identities_are_rejected(client):
    test_client, _repo = client
    admin = register_test_clinic(test_client, identifier="conflict-admin@clinic.com", clinic_name="Conflict Clinic")
    created = test_client.post(
        "/users/staff",
        json={
            "identifier": "conflict-staff@clinic.com",
            "email": "conflict-staff@clinic.com",
            "phone": "5550102929",
            "password": "password123!",
        },
        headers=auth_headers_for_token(admin["token"]),
    )
    assert created.status_code == 201
    staff = test_client.post(
        "/auth/login",
        json={"identifier": "conflict-staff@clinic.com", "password": "password123!"},
    ).json()

    response = test_client.get(
        "/auth/me",
        headers={
            "Authorization": f"Bearer {admin['token']}",
            "Cookie": f"{auth_module.SESSION_COOKIE_NAME}={staff['token']}",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Conflicting authentication credentials."


def test_clinic_admin_can_send_and_confirm_user_password_reset(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="reset-admin@clinic.com", clinic_name="Reset Clinic")
    headers = auth_headers_for_token(session["token"])
    token_value = "known-reset-token-value-that-is-long-enough"
    sent_messages: list[dict] = []

    async def fake_send_clinic_email_message(**kwargs):
        sent_messages.append(kwargs)
        return {"message_id": "reset-email"}

    monkeypatch.setattr(password_reset_service.secrets, "token_urlsafe", lambda _length: token_value)
    monkeypatch.setattr(password_reset_service, "send_clinic_email_message", fake_send_clinic_email_message)

    created = test_client.post(
        "/users",
        headers=headers,
        json={
            "identifier": "reset-staff",
            "email": "reset-staff@clinic.com",
            "phone": "5550103330",
            "password": "password123!",
            "role": "staff",
        },
    )
    assert created.status_code == 201, created.json()

    reset = test_client.post(f"/users/{created.json()['id']}/password-reset", headers=headers)
    assert reset.status_code == 200
    assert reset.json() == {"message": "Password reset email sent to reset-staff@clinic.com."}
    assert sent_messages[0]["recipient"] == "reset-staff@clinic.com"
    assert f"/reset-password?token={token_value}" in sent_messages[0]["text_content"]
    stored_token = next(iter(repo.password_reset_tokens.values()))
    assert stored_token["token_hash"] == password_reset_service._hash_reset_token(token_value)
    assert stored_token["requester_realm"] == "clinic"

    old_login = test_client.post(
        "/auth/login",
        json={"identifier": "reset-staff", "password": "password123!"},
    )
    assert old_login.status_code == 200

    confirmed = test_client.post(
        "/auth/password-reset/confirm",
        json={"token": token_value, "new_password": "new-password123!"},
    )
    assert confirmed.status_code == 200
    assert confirmed.json() == {"message": "Password updated. You can sign in with the new password."}
    assert repo.password_reset_tokens[stored_token["id"]]["used_at"] is not None

    reused = test_client.post(
        "/auth/password-reset/confirm",
        json={"token": token_value, "new_password": "another-password123!"},
    )
    assert reused.status_code == 400
    assert reused.json()["detail"] == "Password reset link is invalid or expired."
    assert test_client.post(
        "/auth/login",
        json={"identifier": "reset-staff", "password": "password123!"},
    ).status_code == 401
    assert test_client.post(
        "/auth/login",
        json={"identifier": "reset-staff", "password": "new-password123!"},
    ).status_code == 200


def test_superdashboard_can_send_user_password_reset_without_clinic_audit(
    client,
    monkeypatch: pytest.MonkeyPatch,
):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="reset-ops@clinic.com", clinic_name="Reset Ops Clinic")
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "auth_secret": "test-secret",
                "super_admin_identifiers": session["user"]["identifier"],
                "app_origin": "http://testserver",
                "session_ttl_hours": 12,
                "superdashboard_session_ttl_hours": 4,
            },
        )(),
    )
    token_value = "known-ops-reset-token-value-that-is-long-enough"
    sent_messages: list[dict] = []

    async def fake_send_clinic_email_message(**kwargs):
        sent_messages.append(kwargs)
        return {"message_id": "ops-reset-email"}

    monkeypatch.setattr(password_reset_service.secrets, "token_urlsafe", lambda _length: token_value)
    monkeypatch.setattr(password_reset_service, "send_clinic_email_message", fake_send_clinic_email_message)

    created = test_client.post(
        "/users",
        headers=auth_headers_for_token(session["token"]),
        json={
            "identifier": "ops-reset-staff",
            "email": "ops-reset-staff@clinic.com",
            "phone": "5550103331",
            "password": "password123!",
            "role": "staff",
        },
    )
    assert created.status_code == 201, created.json()
    ops_login = test_client.post(
        "/superdashboard/auth/login",
        json={"identifier": session["user"]["identifier"], "password": "password123!"},
    )
    assert ops_login.status_code == 200, ops_login.json()

    reset = test_client.post(
        f"/superdashboard/users/{created.json()['id']}/password-reset",
        headers=auth_headers_for_token(ops_login.json()["token"]),
    )

    assert reset.status_code == 200
    assert sent_messages[0]["recipient"] == "ops-reset-staff@clinic.com"
    stored_token = next(iter(repo.password_reset_tokens.values()))
    assert stored_token["requester_realm"] == "superdashboard"
    assert not any(event["action"] == "password_reset_requested" for event in repo.audit_events.values())


def test_cookie_authenticated_mutation_requires_allowed_origin(client):
    test_client, _repo = client
    register_test_clinic(test_client, identifier="csrf@clinic.com", clinic_name="CSRF Clinic")

    missing_origin = test_client.post("/auth/logout")
    assert missing_origin.status_code == 403
    assert missing_origin.json()["detail"] == "Invalid request origin."

    allowed = test_client.post(
        "/auth/logout",
        headers={"Origin": "http://127.0.0.1:3000"},
    )
    assert allowed.status_code == 204


def test_get_current_user_skips_repository_when_session_is_missing(monkeypatch: pytest.MonkeyPatch):
    def unexpected_repository_call():
        raise AssertionError("Repository should not be created without a token.")

    monkeypatch.setattr(auth_module, "get_repository", unexpected_repository_call)

    request = Request({"type": "http", "headers": []})

    with pytest.raises(auth_module.HTTPException, match="Authentication required."):
        asyncio.run(auth_module.get_current_user(request=request, authorization=None, session_token=None))


def test_access_token_requires_explicit_auth_secret(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {"auth_secret": ""},
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
    register_test_clinic(test_client, identifier="ratelimit-login@clinic.com", clinic_name="Rate Limit Clinic")
    monkeypatch.setitem(main_module.RATE_LIMIT_WINDOWS, "auth_login", (1, 60.0))
    main_module.RATE_LIMIT_BUCKETS.clear()

    first = test_client.post(
        "/auth/login",
        json={"identifier": "ratelimit-login@clinic.com", "password": "wrong-password"},
    )
    assert first.status_code == 401

    second = test_client.post(
        "/auth/login",
        json={"identifier": "ratelimit-login@clinic.com", "password": "wrong-password"},
    )
    assert second.status_code == 429

    valid = test_client.post(
        "/auth/login",
        json={"identifier": "ratelimit-login@clinic.com", "password": "password123!"},
    )
    assert valid.status_code == 200


def test_auth_me_can_update_account_details(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="account@clinic.com", clinic_name="Account Clinic")
    headers = auth_headers_for_token(session["token"])

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
    session = register_test_clinic(test_client, identifier="password-change@clinic.com", clinic_name="Password Clinic")
    headers = auth_headers_for_token(session["token"])

    response = test_client.post(
        "/auth/me/password",
        headers=headers,
        json={
            "current_password": "password123!",
            "new_password": "newpassword456",
        },
    )

    assert response.status_code == 204
    old_session = test_client.get("/auth/me", headers=headers)
    assert old_session.status_code == 401

    login = test_client.post(
        "/auth/login",
        json={"identifier": "password-change@clinic.com", "password": "newpassword456"},
    )
    assert login.status_code == 200


def test_auth_me_can_manage_own_signature(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="self-signature@clinic.com", clinic_name="Self Signature Clinic")
    headers = auth_headers_for_token(session["token"])

    uploaded = test_client.post(
        "/auth/me/signature",
        headers=headers,
        files={"file": ("signature.png", signature_png_bytes(), "image/png")},
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["doctor_signature_name"] == "signature.png"

    downloaded = test_client.get("/auth/me/signature/file", headers=headers)
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "image/png"

    removed = test_client.delete("/auth/me/signature", headers=headers)
    assert removed.status_code == 200
    assert removed.json()["doctor_signature_name"] is None


def test_signature_cleanup_makes_background_transparent():
    image = Image.new("RGBA", (120, 48), (246, 244, 238, 255))
    draw = ImageDraw.Draw(image)
    draw.line((12, 26, 48, 12), fill=(24, 24, 24, 255), width=4)
    draw.line((48, 12, 80, 30), fill=(24, 24, 24, 255), width=4)
    draw.line((80, 30, 108, 14), fill=(24, 24, 24, 255), width=4)

    raw = BytesIO()
    image.save(raw, format="PNG")

    normalized_bytes, normalized_type = normalize_signature_image(raw.getvalue(), "image/png")

    assert normalized_type == "image/png"
    normalized = Image.open(BytesIO(normalized_bytes)).convert("RGBA")
    assert normalized.getbbox() is not None

    pixels = list(normalized.getdata())
    transparent_pixels = sum(1 for pixel in pixels if pixel[3] == 0)
    visible_pixels = sum(1 for pixel in pixels if pixel[3] > 0)

    assert transparent_pixels > 0
    assert visible_pixels > 0
    assert pixels[0][3] == 0


def test_signature_cleanup_removes_warm_paper_noise():
    image = Image.new("RGBA", (140, 52), (248, 223, 92, 255))
    draw = ImageDraw.Draw(image)

    for x in range(0, 140, 3):
        shade = 232 if (x // 3) % 2 == 0 else 242
        draw.line((x, 0, x, 51), fill=(shade, 210, 84, 255), width=1)

    draw.line((18, 29, 55, 13), fill=(18, 33, 138, 255), width=4)
    draw.line((55, 13, 92, 31), fill=(18, 33, 138, 255), width=4)
    draw.line((92, 31, 122, 17), fill=(18, 33, 138, 255), width=4)

    raw = BytesIO()
    image.save(raw, format="PNG")

    normalized_bytes, _ = normalize_signature_image(raw.getvalue(), "image/png")
    normalized = Image.open(BytesIO(normalized_bytes)).convert("RGBA")

    transparent_pixels = 0
    retained_warm_pixels = 0
    for red, green, blue, alpha in normalized.getdata():
        if alpha == 0:
            transparent_pixels += 1
            continue
        if red > 180 and green > 150 and blue < 140:
            retained_warm_pixels += 1

    assert transparent_pixels > 0
    assert retained_warm_pixels == 0
