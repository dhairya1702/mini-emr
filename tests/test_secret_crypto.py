from types import SimpleNamespace

import pytest

from app import secret_crypto


def test_stored_secret_round_trip_is_encrypted(monkeypatch):
    monkeypatch.setattr(
        secret_crypto,
        "get_settings",
        lambda: SimpleNamespace(auth_secret="test-auth-secret"),
    )

    encrypted = secret_crypto.encrypt_stored_secret("abcd efgh ijkl mnop")

    assert encrypted
    assert encrypted.startswith(secret_crypto.SECRET_PREFIX)
    assert "abcd efgh" not in encrypted
    assert secret_crypto.decrypt_stored_secret(encrypted) == "abcd efgh ijkl mnop"


def test_stored_secret_rejects_wrong_key(monkeypatch):
    monkeypatch.setattr(
        secret_crypto,
        "get_settings",
        lambda: SimpleNamespace(auth_secret="first-key"),
    )
    encrypted = secret_crypto.encrypt_stored_secret("smtp-password")
    monkeypatch.setattr(
        secret_crypto,
        "get_settings",
        lambda: SimpleNamespace(auth_secret="different-key"),
    )

    with pytest.raises(RuntimeError, match="could not be decrypted"):
        secret_crypto.decrypt_stored_secret(encrypted)


def test_legacy_plaintext_secret_remains_readable():
    assert secret_crypto.decrypt_stored_secret("legacy-password") == "legacy-password"
