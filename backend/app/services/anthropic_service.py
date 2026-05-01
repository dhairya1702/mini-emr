import asyncio
from collections import OrderedDict

from anthropic import Anthropic

from app.config import get_settings
from app.db import SupabaseRepository
from app.services.ai_usage_service import record_anthropic_usage


def build_fallback_note(
    symptoms: str,
    diagnosis: str,
    medications: str,
    notes: str,
    patient_context: str = "",
    measurements_context: str = "",
) -> str:
    clinical_notes = notes or "No additional findings were documented during this consultation."
    if measurements_context:
        clinical_notes = f"{measurements_context}\n{clinical_notes}".strip()
    return (
        f"Presenting Complaint:\n{symptoms or 'Symptoms not fully documented.'}\n\n"
        f"Diagnosis:\n{diagnosis or 'Clinical impression is still under evaluation.'}\n\n"
        f"Clinical Notes:\n{clinical_notes}\n\n"
        f"Treatment:\n{medications or 'Medication plan was not documented.'}\n\n"
        "Follow-up Advice:\nReturn for reassessment if symptoms worsen or fail to improve."
    )


SECTION_ORDER = [
    "Presenting Complaint",
    "Diagnosis",
    "Clinical Notes",
    "Treatment",
    "Follow-up Advice",
]


def _normalize_multiline_text(value: str) -> str:
    return "\n".join(line.rstrip() for line in value.strip().splitlines()).strip()


def _normalize_section_candidate(raw_line: str) -> str:
    stripped = raw_line.strip().strip("*").strip()
    while stripped.startswith(("-", "*", "•")):
        stripped = stripped[1:].strip()
    return stripped


def _match_section_label(raw_line: str) -> tuple[str, str] | None:
    stripped = _normalize_section_candidate(raw_line)
    if ":" not in stripped:
        return None
    label, remainder = stripped.split(":", 1)
    normalized_label = label.strip()
    if normalized_label not in SECTION_ORDER:
        return None
    return normalized_label, remainder.strip()


def _extract_pipe_table_blocks(value: str) -> list[str]:
    blocks: list[str] = []
    current: list[str] = []
    for raw_line in value.splitlines():
        line = raw_line.rstrip()
        if "|" in line:
            current.append(line)
            continue
        if current:
            blocks.append("\n".join(current).strip())
            current = []
    if current:
        blocks.append("\n".join(current).strip())
    return [block for block in blocks if block]


def _strip_pipe_tables(value: str) -> str:
    cleaned_lines: list[str] = []
    skipping_table = False
    for raw_line in value.splitlines():
        stripped = raw_line.strip()
        if "|" in stripped:
            skipping_table = True
            continue
        if skipping_table and (not stripped or set(stripped) <= {"-", ":", " "}):
            continue
        skipping_table = False
        if stripped in {
            "Vitals Table:",
            "Test Scores:",
            "Eye Exam:",
            "Prescribed medicines:",
            "Contact Lens Assessment:",
            "Contact Lens Order Summary:",
            "Contact Lens Eye Details:",
            "Binocular Vision Overview:",
            "Binocular Vision Convergence:",
            "Binocular Vision Sensory & Plan:",
            "Low Vision Assessment:",
            "Low Vision Functional & Device Trial:",
            "Low Vision Plan & Support:",
            "Myopia Management:",
        }:
            continue
        cleaned_lines.append(raw_line.rstrip())
    return _normalize_multiline_text("\n".join(cleaned_lines))


def _normalize_note_content(
    note_text: str,
    symptoms: str,
    diagnosis: str,
    medications: str,
    notes: str,
    patient_context: str = "",
    measurements_context: str = "",
) -> str:
    sections: OrderedDict[str, list[str]] = OrderedDict((label, []) for label in SECTION_ORDER)
    current_section: str | None = None

    for raw_line in note_text.splitlines():
        stripped = raw_line.strip()
        matched = _match_section_label(raw_line)
        if matched:
            matched_section, remainder = matched
            current_section = matched_section
            if remainder:
                sections[matched_section].append(remainder)
        elif current_section:
            sections[current_section].append(raw_line.rstrip())

        if matched:
            continue

    clinical_notes = notes.strip() or "No additional findings were documented during this consultation."
    if measurements_context.strip():
        clinical_notes = f"{measurements_context.strip()}\n{clinical_notes}".strip()

    fallbacks = {
        "Presenting Complaint": symptoms.strip() or "Symptoms not fully documented.",
        "Diagnosis": diagnosis.strip() or "Clinical impression is still under evaluation.",
        "Clinical Notes": clinical_notes,
        "Treatment": medications.strip() or "Medication plan was not documented.",
        "Follow-up Advice": "Return for reassessment if symptoms worsen or fail to improve.",
    }

    normalized_sections = []
    measurement_tables = _extract_pipe_table_blocks(measurements_context)
    medication_tables = _extract_pipe_table_blocks(medications)
    for label in SECTION_ORDER:
        existing = _strip_pipe_tables("\n".join(line for line in sections[label] if line.strip()))
        content = existing or fallbacks[label]
        if label == "Clinical Notes" and measurement_tables:
            missing = [table for table in measurement_tables if table not in content]
            if missing:
                content = "\n\n".join([*missing, content]).strip()
        if label == "Treatment" and medication_tables:
            missing = [table for table in medication_tables if table not in content]
            if missing:
                content = "\n\n".join([*missing, content]).strip()
        normalized_sections.append(f"{label}:\n{content}")

    return "\n\n".join(normalized_sections).strip()


def build_fallback_letter(
    to: str,
    subject: str,
    content: str,
    clinic_context: str = "",
) -> str:
    clinic_bits = [line.strip() for line in clinic_context.splitlines() if line.strip()]
    doctor_name = ""
    for line in clinic_bits:
      if line.startswith("Doctor Name:"):
          doctor_name = line.split(":", 1)[1].strip()
          break

    signature_name = doctor_name or "Clinic Team"
    body = content.strip()
    return (
        f"To: {to.strip()}\n"
        f"Subject: {subject.strip()}\n\n"
        f"Dear Sir/Madam,\n\n"
        f"{body}\n\n"
        "Please feel free to contact the clinic if any further clarification is required.\n\n"
        "Sincerely,\n"
        f"{signature_name}"
    )


async def generate_soap_note(
    repo: SupabaseRepository,
    org_id: str,
    symptoms: str,
    diagnosis: str,
    medications: str,
    notes: str,
    patient_context: str = "",
    clinic_context: str = "",
    measurements_context: str = "",
) -> str:
    settings = get_settings()

    if not settings.anthropic_api_key:
        return build_fallback_note(symptoms, diagnosis, medications, notes, patient_context, measurements_context)

    client = Anthropic(api_key=settings.anthropic_api_key)
    prompt = f"""
Write a detailed, clinic-ready consultation note in a clean structured format.
Use these exact section headings in this order:
Presenting Complaint:
Diagnosis:
Clinical Notes:
Treatment:
Follow-up Advice:

Write each section in clear clinical prose using full sentences and short paragraphs.
Make it specific and natural, for example phrasing like "The patient presents with fever for the last 3 days..."
When details are missing, use neutral clinical wording and do not invent risky facts such as vitals, labs, or durations.
Do not use SOAP headings.
Keep the output plain text only.
If the Structured measurements input includes pipe-delimited tables, preserve them in the Clinical Notes section before the prose notes.
If the Medications input includes a pipe-delimited regimen table, preserve it in the Treatment section before any prose explanation.

Patient context:
{patient_context or 'Not provided'}

Clinic context:
{clinic_context or 'Not provided'}

Symptoms:
{symptoms or 'Not provided'}

Diagnosis:
{diagnosis or 'Not provided'}

Medications:
{medications or 'Not provided'}

Additional notes:
{notes or 'Not provided'}

Structured measurements:
{measurements_context or 'Not provided'}
""".strip()

    try:
        response = await asyncio.to_thread(
            lambda: client.messages.create(
                model=settings.anthropic_model,
                max_tokens=600,
                temperature=0.35,
                system=(
                    "You write polished outpatient consultation notes for small clinics. "
                    "Return only the final note text. "
                    "Return only the five requested section headings and their content. "
                    "Do not include patient demographics, phone numbers, ages, or any header block in the note body."
                ),
                messages=[{"role": "user", "content": prompt}],
            )
        )
    except Exception:
        return build_fallback_note(symptoms, diagnosis, medications, notes, patient_context)

    await record_anthropic_usage(
        repo,
        org_id=org_id,
        model=settings.anthropic_model,
        feature="consultation_note",
        response=response,
        metadata={"has_patient_context": bool(patient_context), "has_measurements_context": bool(measurements_context)},
    )

    blocks = [block.text for block in response.content if getattr(block, "type", "") == "text"]
    generated_text = "\n".join(blocks).strip() or build_fallback_note(
        symptoms,
        diagnosis,
        medications,
        notes,
        patient_context,
        measurements_context,
    )
    return _normalize_note_content(
        generated_text,
        symptoms,
        diagnosis,
        medications,
        notes,
        patient_context,
        measurements_context,
    )


async def generate_clinic_letter(
    repo: SupabaseRepository,
    org_id: str,
    to: str,
    subject: str,
    content: str,
    clinic_context: str = "",
) -> str:
    settings = get_settings()

    if not settings.anthropic_api_key:
        return build_fallback_letter(to, subject, content, clinic_context)

    client = Anthropic(api_key=settings.anthropic_api_key)
    prompt = f"""
Write a polished clinic letter in plain text.
Use this exact top structure:
To: ...
Subject: ...

Then write a professional letter body with a greeting, concise clinical/administrative wording, and a courteous closing.
Do not invent medical facts beyond what the user provided.
Keep it ready to place on clinic letterhead.
Return plain text only.

Clinic context:
{clinic_context or 'Not provided'}

To:
{to}

Subject:
{subject}

Content instructions:
{content}
""".strip()

    try:
        response = await asyncio.to_thread(
            lambda: client.messages.create(
                model=settings.anthropic_model,
                max_tokens=500,
                temperature=0.35,
                system=(
                    "You write clear professional clinic letters. "
                    "Return only the final letter text."
                ),
                messages=[{"role": "user", "content": prompt}],
            )
        )
    except Exception:
        return build_fallback_letter(to, subject, content, clinic_context)

    await record_anthropic_usage(
        repo,
        org_id=org_id,
        model=settings.anthropic_model,
        feature="clinic_letter",
        response=response,
        metadata={"has_clinic_context": bool(clinic_context), "recipient": to.strip()},
    )

    blocks = [block.text for block in response.content if getattr(block, "type", "") == "text"]
    return "\n".join(blocks).strip() or build_fallback_letter(to, subject, content, clinic_context)
