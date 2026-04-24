from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAIN_PATH = ROOT / "backend" / "app" / "main.py"
DB_PATH = ROOT / "backend" / "app" / "db.py"


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


def test_mutation_routes_delegate_to_workflow_modules() -> None:
    auth_text = (ROOT / "backend" / "app" / "routes" / "auth.py").read_text()
    users_text = (ROOT / "backend" / "app" / "routes" / "users.py").read_text()
    catalog_text = (ROOT / "backend" / "app" / "routes" / "catalog.py").read_text()

    assert "from app.services.user_workflow import login_user_workflow, register_user_workflow" in auth_text
    assert "from app.services.user_workflow import create_staff_user_workflow" in users_text
    assert "from app.services.catalog_workflow import (" in catalog_text
    assert "from app.services.audit_service import write_audit_event" not in catalog_text
    assert "await repo.create_catalog_item(" not in catalog_text
    assert "await repo.update_catalog_stock(" not in catalog_text
    assert "await repo.delete_catalog_item(" not in catalog_text


def test_db_uses_sync_supabase_client_module_directly() -> None:
    text = DB_PATH.read_text()
    assert "from supabase._sync.client import SyncClient as Client" in text
    assert "from supabase._sync.client import create_client" in text
    assert "warnings.filterwarnings(" in text
    assert "from supabase import Client, create_client" not in text
