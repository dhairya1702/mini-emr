from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAIN_PATH = ROOT / "backend" / "app" / "main.py"


def test_main_stays_app_assembly_only() -> None:
    text = MAIN_PATH.read_text()
    assert "@app." not in text
    assert "app.include_router(" in text


def test_route_modules_exist_for_backend_domains() -> None:
    routes_dir = ROOT / "backend" / "app" / "routes"
    expected = {
        "health.py",
        "auth.py",
        "users.py",
        "patients.py",
        "appointments.py",
        "notes.py",
        "billing.py",
        "catalog.py",
        "followups.py",
        "audit.py",
        "exports.py",
        "settings.py",
    }
    assert expected.issubset({path.name for path in routes_dir.iterdir() if path.is_file()})
