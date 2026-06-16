from __future__ import annotations

import io

import pytest

from test_app import auth_headers_for_token, auth_module, client, config_module, register_test_clinic


@pytest.fixture(autouse=True)
def _restore_settings_cache():
    config_module.get_settings.cache_clear()
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
            },
        )(),
    )

    response = test_client.get("/superuser/orgs", headers=auth_headers_for_token(session["token"]))

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["clinic_name"] == "Owner Clinic"
    assert rows[0]["media_storage_bytes"] == 0


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
    headers = auth_headers_for_token(session["token"])
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
        files={"file": ("clip.mp4", io.BytesIO(b'video-bytes'), "video/mp4")},
        headers=headers,
    )
    assert upload.status_code == 201

    response = test_client.get("/superuser/orgs", headers=headers)

    assert response.status_code == 200
    assert response.json()[0]["media_storage_bytes"] == len(b"video-bytes")


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
