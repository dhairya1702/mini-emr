from __future__ import annotations

import pytest

from test_app import auth_headers, auth_module, client, config_module, register


@pytest.fixture(autouse=True)
def _restore_settings_cache():
    config_module.get_settings.cache_clear()
    yield
    config_module.get_settings.cache_clear()


def test_superuser_orgs_requires_allowlisted_identifier(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register(test_client, identifier="owner@clinic.com", clinic_name="Owner Clinic")
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

    response = test_client.get("/superuser/orgs", headers=auth_headers(session["token"]))

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["clinic_name"] == "Owner Clinic"


def test_superuser_orgs_denies_non_allowlisted_identifier(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register(test_client, identifier="staff@clinic.com", clinic_name="Staff Clinic")
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

    response = test_client.get("/superuser/orgs", headers=auth_headers(session["token"]))

    assert response.status_code == 403
