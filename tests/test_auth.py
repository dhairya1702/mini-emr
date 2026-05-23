from __future__ import annotations

from io import BytesIO
from uuid import uuid4

import pytest
from PIL import Image, ImageDraw

from test_app import auth_headers_for_token, auth_module, client, main_module, register_test_clinic
from app.services.signature_service import normalize_signature_image


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


def test_register_creates_clinic_settings_with_empty_specialty(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="specialty-register@clinic.com", clinic_name="Specialty Register Clinic")

    response = test_client.get("/settings/clinic", headers=auth_headers_for_token(session["token"]))

    assert response.status_code == 200
    assert response.json()["clinic_specialty"] is None


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
    register_test_clinic(test_client, identifier="cookie@clinic.com", clinic_name="Cookie Clinic")

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
    register_test_clinic(test_client, identifier="ratelimit-login@clinic.com", clinic_name="Rate Limit Clinic")
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
    session = register_test_clinic(test_client, identifier="self-signature@clinic.com", clinic_name="Self Signature Clinic")
    headers = auth_headers_for_token(session["token"])

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
