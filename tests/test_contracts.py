from __future__ import annotations

import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType

import pytest


def _install_reportlab_stubs() -> None:
    reportlab_module = ModuleType("reportlab")
    reportlab_lib_module = ModuleType("reportlab.lib")
    reportlab_colors_module = ModuleType("reportlab.lib.colors")
    reportlab_colors_module.HexColor = lambda value: value
    reportlab_pagesizes_module = ModuleType("reportlab.lib.pagesizes")
    reportlab_pagesizes_module.A4 = (595, 842)
    reportlab_units_module = ModuleType("reportlab.lib.units")
    reportlab_units_module.inch = 72
    reportlab_utils_module = ModuleType("reportlab.lib.utils")
    reportlab_utils_module.ImageReader = lambda source: source
    reportlab_pdfbase_module = ModuleType("reportlab.pdfbase")
    reportlab_pdfmetrics_module = ModuleType("reportlab.pdfbase.pdfmetrics")
    reportlab_pdfmetrics_module.stringWidth = lambda text, *_args: float(len(text) * 6)

    class _DummyCanvas:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def setTitle(self, *_args, **_kwargs) -> None:
            pass

        def setFillColor(self, *_args, **_kwargs) -> None:
            pass

        def setFont(self, *_args, **_kwargs) -> None:
            pass

        def drawString(self, *_args, **_kwargs) -> None:
            pass

        def drawRightString(self, *_args, **_kwargs) -> None:
            pass

        def line(self, *_args, **_kwargs) -> None:
            pass

        def roundRect(self, *_args, **_kwargs) -> None:
            pass

        def setStrokeColor(self, *_args, **_kwargs) -> None:
            pass

        def drawImage(self, *_args, **_kwargs) -> None:
            pass

        def showPage(self) -> None:
            pass

        def save(self) -> None:
            pass

    reportlab_pdfgen_module = ModuleType("reportlab.pdfgen")
    reportlab_canvas_module = ModuleType("reportlab.pdfgen.canvas")
    reportlab_canvas_module.Canvas = _DummyCanvas
    reportlab_pdfgen_module.canvas = reportlab_canvas_module

    sys.modules.setdefault("reportlab", reportlab_module)
    sys.modules.setdefault("reportlab.lib", reportlab_lib_module)
    sys.modules.setdefault("reportlab.lib.colors", reportlab_colors_module)
    sys.modules.setdefault("reportlab.lib.pagesizes", reportlab_pagesizes_module)
    sys.modules.setdefault("reportlab.lib.units", reportlab_units_module)
    sys.modules.setdefault("reportlab.lib.utils", reportlab_utils_module)
    sys.modules.setdefault("reportlab.pdfbase", reportlab_pdfbase_module)
    sys.modules.setdefault("reportlab.pdfbase.pdfmetrics", reportlab_pdfmetrics_module)
    sys.modules.setdefault("reportlab.pdfgen", reportlab_pdfgen_module)
    sys.modules.setdefault("reportlab.pdfgen.canvas", reportlab_canvas_module)


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
_install_reportlab_stubs()

from app.clinic_context import build_clinic_context, build_measurements_context, build_patient_context
from app.exports import build_history_visit_rows, filter_rows_by_created_at, get_export_range_start
from app.main import app
from app.schemas import EyeExamEntry, GenerateNoteRequest, TestScoreEntry as ScoreEntry


TYPES_PATH = ROOT / "web" / "lib" / "types.ts"


def _parse_ts_interfaces() -> dict[str, list[str]]:
    text = TYPES_PATH.read_text()
    interfaces: dict[str, list[str]] = {}
    for match in re.finditer(r"export interface (\w+) \{(.*?)\n\}", text, re.S):
        name, body = match.groups()
        fields: list[str] = []
        for raw_line in body.splitlines():
            line = raw_line.strip().rstrip(";")
            if not line or line.startswith("//") or ":" not in line:
                continue
            fields.append(line.split(":", 1)[0].strip().rstrip("?"))
        interfaces[name] = fields
    return interfaces


def _parse_ts_unions() -> dict[str, list[str]]:
    text = TYPES_PATH.read_text()
    unions: dict[str, list[str]] = {}
    for match in re.finditer(r"export type (\w+) = (.*?);", text, re.S):
        name, body = match.groups()
        values = re.findall(r'"([^"]+)"', body)
        if values:
            unions[name] = values
    return unions


def _schema_properties(name: str) -> list[str]:
    return list(app.openapi()["components"]["schemas"][name]["properties"])


def _schema_property_set(name: str) -> set[str]:
    return set(_schema_properties(name))


def _literal_values(type_name: str) -> list[str]:
    namespace = {}
    exec((ROOT / "backend" / "app" / "schemas.py").read_text(), namespace)
    literal_type = namespace[type_name]
    return list(literal_type.__args__)


@pytest.mark.parametrize(
    ("frontend_name", "backend_name"),
    [
        ("Patient", "PatientOut"),
        ("PatientMatch", "PatientMatchOut"),
        ("PatientVisit", "PatientVisitOut"),
        ("Appointment", "AppointmentOut"),
        ("PatientTimelineEvent", "PatientTimelineEvent"),
        ("ConsultationNote", "NoteOut"),
        ("AuditEvent", "AuditEventOut"),
        ("GenerateNoteResponse", "GenerateNoteResponse"),
        ("GenerateLetterResponse", "GenerateLetterResponse"),
        ("FollowUp", "FollowUpOut"),
        ("CatalogItem", "CatalogItemOut"),
        ("Invoice", "InvoiceOut"),
        ("ClinicSettings", "ClinicSettingsOut"),
        ("AuthUser", "UserOut"),
        ("AuthResponse", "AuthResponse"),
    ],
)
def test_frontend_response_contracts_match_backend_openapi(frontend_name: str, backend_name: str) -> None:
    interfaces = _parse_ts_interfaces()
    assert set(interfaces[frontend_name]) == _schema_property_set(backend_name)


@pytest.mark.parametrize(
    ("frontend_name", "backend_name"),
    [
        ("RegisterPayload", "UserCreate"),
        ("StaffUserCreatePayload", "StaffUserCreate"),
        ("CatalogItemCreatePayload", "CatalogItemCreate"),
        ("CatalogStockUpdatePayload", "CatalogStockUpdate"),
        ("InvoiceItemInput", "InvoiceItemInput"),
        ("InvoiceCreatePayload", "InvoiceCreate"),
        ("SendInvoicePayload", "SendInvoiceRequest"),
        ("AppointmentCreatePayload", "AppointmentCreate"),
        ("AppointmentUpdatePayload", "AppointmentUpdate"),
        ("AppointmentCheckInPayload", "AppointmentCheckInRequest"),
        ("FollowUpCreatePayload", "FollowUpCreate"),
        ("FollowUpUpdatePayload", "FollowUpUpdate"),
        ("PatientInput", "PatientCreate"),
        ("FinalizeNotePayload", "FinalizeNoteRequest"),
        ("GenerateNotePayload", "GenerateNoteRequest"),
        ("GenerateLetterPayload", "GenerateLetterRequest"),
        ("GeneratePdfPayload", "GeneratePdfRequest"),
        ("GenerateLetterPdfPayload", "GenerateLetterPdfRequest"),
        ("SendLetterPayload", "SendLetterRequest"),
        ("SendNotePayload", "SendNoteRequest"),
        ("ClinicSettingsUpdatePayload", "ClinicSettingsUpdate"),
    ],
)
def test_frontend_request_contracts_match_backend_openapi(frontend_name: str, backend_name: str) -> None:
    interfaces = _parse_ts_interfaces()
    assert set(interfaces[frontend_name]) == _schema_property_set(backend_name)


@pytest.mark.parametrize(
    ("frontend_name", "backend_name"),
    [
        ("PatientStatus", "PatientStatus"),
        ("AppointmentStatus", "AppointmentStatus"),
        ("FollowUpStatus", "FollowUpStatus"),
        ("PaymentStatus", "PaymentStatus"),
        ("CatalogItemType", "CatalogItemType"),
        ("UserRole", "UserRole"),
    ],
)
def test_frontend_enum_unions_match_backend_openapi(frontend_name: str, backend_name: str) -> None:
    unions = _parse_ts_unions()
    openapi_enum = _literal_values(backend_name)
    assert unions[frontend_name] == openapi_enum


def test_build_patient_context_omits_missing_measurements() -> None:
    context = build_patient_context(
        {
            "name": "Jane Doe",
            "phone": "+15551234567",
            "age": None,
            "height": None,
            "weight": 64,
            "temperature": None,
            "reason": "Headache",
        },
        generated_at="Apr 19, 2026 09:30 AM",
    )
    assert "Name: Jane Doe" in context
    assert "Weight: 64 kg" in context
    assert "Age:" not in context
    assert "Generated On: Apr 19, 2026 09:30 AM" in context


def test_build_clinic_and_measurement_contexts_include_structured_fields() -> None:
    clinic_context = build_clinic_context(
        {
            "clinic_name": "ClinicOS",
            "clinic_phone": "+15550001111",
            "doctor_name": "Dr. Patel",
            "custom_footer": "Open weekdays",
        }
    )
    assert "Clinic Name: ClinicOS" in clinic_context
    assert "Doctor Name: Dr. Patel" in clinic_context
    assert "Open weekdays" in clinic_context

    measurements_context = build_measurements_context(
        GenerateNoteRequest(
            symptoms="",
            diagnosis="",
            medications="",
            notes="",
            blood_pressure_systolic=120,
            blood_pressure_diastolic=80,
            pulse=72,
            spo2=99,
            blood_sugar=110,
            test_scores=[ScoreEntry(label="Vision", value="20/20")],
            eye_exam=[EyeExamEntry(eye="right", sphere="-1.25", cylinder="", axis="90", vision="6/6")],
        )
    )
    assert "Blood Pressure: 120/80 mmHg" in measurements_context
    assert "Vision: 20/20" in measurements_context
    assert "Right Eye: Sphere -1.25, Axis 90, Vision 6/6" in measurements_context


def test_export_helpers_preserve_latest_visit_and_filter_date_ranges() -> None:
    created_at = datetime(2026, 4, 1, 9, 0, tzinfo=UTC)
    last_visit_at = datetime(2026, 4, 10, 10, 0, tzinfo=UTC)
    patient_id = "00000000-0000-0000-0000-000000000001"
    rows = build_history_visit_rows(
        visits=[],
        patients=[
            {
                "id": patient_id,
                "name": "Jane Doe",
                "phone": "+15551234567",
                "reason": "Checkup",
                "age": 34,
                "weight": 60,
                "height": 165,
                "temperature": 98.6,
                "status": "waiting",
                "billed": False,
                "created_at": created_at,
                "last_visit_at": last_visit_at,
            }
        ],
    )
    assert len(rows) == 1
    assert rows[0].created_at == last_visit_at

    filtered = filter_rows_by_created_at(
        [{"created_at": "2026-04-10T10:00:00+00:00"}, {"created_at": "2026-03-01T10:00:00+00:00"}],
        datetime(2026, 4, 1, 0, 0, tzinfo=UTC),
    )
    assert filtered == [{"created_at": "2026-04-10T10:00:00+00:00"}]
    assert get_export_range_start("all") is None
    with pytest.raises(ValueError):
        get_export_range_start("bad-range")
