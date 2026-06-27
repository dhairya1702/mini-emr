from __future__ import annotations

import io
import base64
import hashlib
import hmac
import struct
import time

import pytest

from test_app import auth_headers_for_token, auth_module, client, config_module, register_test_clinic


@pytest.fixture(autouse=True)
def _restore_settings_cache():
    config_module.get_settings.cache_clear()


def _totp_code(secret: str) -> str:
    key = base64.b32decode(secret)
    digest = hmac.new(key, struct.pack(">Q", int(time.time()) // 30), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (int.from_bytes(digest[offset:offset + 4], "big") & 0x7FFFFFFF) % 1_000_000
    return f"{value:06d}"


def _superadmin_headers(test_client, session: dict) -> dict[str, str]:
    login = test_client.post(
        "/auth/login",
        json={
            "identifier": session["user"]["identifier"],
            "password": "password123!",
            "totp_code": _totp_code("JBSWY3DPEHPK3PXP"),
        },
    )
    assert login.status_code == 200, login.json()
    token = login.json()["token"]
    assert int(auth_module.decode_access_token(token)["mfa_verified_until"]) > int(time.time())
    return auth_headers_for_token(token)
    yield
    config_module.get_settings.cache_clear()


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
                "super_admin_totp_secrets": '{"owner@clinic.com":"JBSWY3DPEHPK3PXP"}',
            },
        )(),
    )

    without_mfa = test_client.get("/superuser/orgs", headers=auth_headers_for_token(session["token"]))
    assert without_mfa.status_code == 403
    login_without_mfa = test_client.post(
        "/auth/login",
        json={
            "identifier": session["user"]["identifier"],
            "password": "password123!",
        },
    )
    assert login_without_mfa.status_code == 401

    response = test_client.get("/superuser/orgs", headers=_superadmin_headers(test_client, session))
    refreshed = response.headers.get("x-session-token")
    assert refreshed
    assert int(auth_module.decode_access_token(refreshed).get("mfa_verified_until") or 0) > int(time.time())

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
                "super_admin_totp_secrets": '{"ops@clinic.com":"JBSWY3DPEHPK3PXP"}',
            },
        )(),
    )
    headers = _superadmin_headers(test_client, session)

    created = test_client.post(
        "/superdashboard/onboarding/customers",
        headers=headers,
        json={"customer_name": "Bluebird Clinic", "phone": "+91 98765 43210", "users_allowed": 3},
    )

    assert created.status_code == 201, created.json()
    body = created.json()
    assert body["customer_id"].startswith("CID-")
    assert body["customer_name"] == "Bluebird Clinic"
    assert body["phone"] == "+919876543210"
    assert body["users_allowed"] == 3

    listed = test_client.get("/superdashboard/onboarding", headers=headers)
    assert listed.status_code == 200
    assert any(row["customer_id"] == body["customer_id"] for row in listed.json()["customers"])


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
                "super_admin_totp_secrets": '{"owner-storage@clinic.com":"JBSWY3DPEHPK3PXP"}',
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
                "super_admin_totp_secrets": '{"owner@clinic.com":"JBSWY3DPEHPK3PXP"}',
            },
        )(),
    )

    response = test_client.get("/superuser/orgs", headers=auth_headers_for_token(session["token"]))

    assert response.status_code == 403
