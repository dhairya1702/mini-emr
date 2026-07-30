from __future__ import annotations

import asyncio

import pytest

from test_app import auth_headers_for_token, auth_module, client, register_test_clinic
from app.services import email_service


def _enable_superadmin(monkeypatch: pytest.MonkeyPatch, identifier: str) -> None:
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {"auth_secret": "test-secret", "super_admin_identifiers": identifier},
        )(),
    )


def test_superdashboard_email_settings_hide_password_and_require_valid_credentials(
    client,
    monkeypatch: pytest.MonkeyPatch,
):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="email-ops@clinic.com",
        clinic_name="Email Ops",
    )
    _enable_superadmin(monkeypatch, session["user"]["identifier"])
    login = test_client.post(
        "/superdashboard/auth/login",
        json={"identifier": session["user"]["identifier"], "password": "password123!"},
    )
    headers = auth_headers_for_token(login.json()["token"])
    tested: list[tuple[str, str]] = []

    async def fake_test_email_credentials(*, sender_email: str, app_password: str) -> None:
        tested.append((sender_email, app_password))

    monkeypatch.setattr(
        "app.routes.superuser.test_email_credentials",
        fake_test_email_credentials,
    )

    saved = test_client.put(
        "/superdashboard/settings/email",
        headers=headers,
        json={
            "sender_name": "ClinicOS",
            "sender_email": "clinicos.sender@gmail.com",
            "sender_email_app_password": "abcd efgh ijkl mnop",
            "is_enabled": True,
        },
    )

    assert saved.status_code == 200, saved.json()
    assert saved.json()["is_enabled"] is True
    assert saved.json()["is_configured"] is True
    assert "sender_email_app_password" not in saved.json()
    assert repo.platform_email_settings["sender_email_app_password"] == "abcd efgh ijkl mnop"
    assert tested == [("clinicos.sender@gmail.com", "abcd efgh ijkl mnop")]

    fetched = test_client.get("/superdashboard/settings/email", headers=headers)
    assert fetched.status_code == 200
    assert "sender_email_app_password" not in fetched.json()


def test_global_sender_adds_automated_footer_and_no_reply_to(monkeypatch: pytest.MonkeyPatch):
    captured = {}

    class Repo:
        async def get_platform_email_settings(self):
            return {
                "sender_name": "ClinicOS",
                "sender_email": "clinicos.sender@gmail.com",
                "sender_email_app_password": "app-password",
                "is_enabled": True,
            }

    def fake_send(message, *, sender_email: str, app_password: str):
        captured.update(
            message=message,
            sender_email=sender_email,
            app_password=app_password,
        )

    monkeypatch.setattr(email_service, "_send_email_sync", fake_send)
    asyncio.run(
        email_service.send_clinic_email_message(
            repo=Repo(),
            clinic_settings={"clinic_name": "Bluebird", "email_sender_mode": "clinicos"},
            recipient="patient@example.com",
            subject="Invoice",
            text_content="Your invoice is attached.",
        )
    )

    message = captured["message"]
    assert message["From"] == "Bluebird via ClinicOS <clinicos.sender@gmail.com>"
    assert message["Reply-To"] is None
    assert "mailbox is not monitored" in message.get_content()
    assert captured["sender_email"] == "clinicos.sender@gmail.com"


def test_global_sender_can_suppress_automated_footer(monkeypatch: pytest.MonkeyPatch):
    captured = {}

    class Repo:
        async def get_platform_email_settings(self):
            return {
                "sender_name": "ClinicOS",
                "sender_email": "clinicos.sender@gmail.com",
                "sender_email_app_password": "app-password",
                "is_enabled": True,
            }

    def fake_send(message, *, sender_email: str, app_password: str):
        captured["message"] = message

    monkeypatch.setattr(email_service, "_send_email_sync", fake_send)
    asyncio.run(
        email_service.send_clinic_email_message(
            repo=Repo(),
            clinic_settings={"clinic_name": "Bluebird", "email_sender_mode": "clinicos"},
            recipient="patient@example.com",
            subject="Follow-up",
            text_content="Thank you,\nBluebird",
            html_content="<p>Thank you,<br><strong>Bluebird</strong></p>",
            include_automated_footer=False,
        )
    )

    rendered_parts = "\n".join(
        part.get_content()
        for part in captured["message"].walk()
        if part.get_content_maintype() == "text"
    )
    assert "mailbox is not monitored" not in rendered_parts


def test_clinic_sender_does_not_fall_back_or_add_platform_footer(monkeypatch: pytest.MonkeyPatch):
    captured = {}

    class Repo:
        async def get_platform_email_settings(self):
            return {
                "sender_name": "ClinicOS",
                "sender_email": "global@gmail.com",
                "sender_email_app_password": "global-password",
                "is_enabled": True,
            }

    def fake_send(message, *, sender_email: str, app_password: str):
        captured.update(message=message, sender_email=sender_email, app_password=app_password)

    monkeypatch.setattr(email_service, "_send_email_sync", fake_send)
    asyncio.run(
        email_service.send_clinic_email_message(
            repo=Repo(),
            clinic_settings={
                "email_sender_mode": "clinic",
                "sender_name": "Bluebird",
                "sender_email": "clinic@gmail.com",
                "sender_email_app_password": "clinic-password",
            },
            recipient="patient@example.com",
            subject="Letter",
            text_content="Attached.",
        )
    )

    assert captured["sender_email"] == "clinic@gmail.com"
    assert captured["app_password"] == "clinic-password"
    assert "mailbox is not monitored" not in captured["message"].get_content()
