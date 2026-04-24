import asyncio

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
    header = f"{patient_context}\n\n" if patient_context else ""
    clinical_notes = notes or "No additional findings were documented during this consultation."
    if measurements_context:
        clinical_notes = f"{measurements_context}\n{clinical_notes}".strip()
    return (
        f"{header}"
        f"Presenting Complaint:\n{symptoms or 'Symptoms not fully documented.'}\n\n"
        f"Diagnosis:\n{diagnosis or 'Clinical impression is still under evaluation.'}\n\n"
        f"Clinical Notes:\n{clinical_notes}\n\n"
        f"Treatment:\n{medications or 'Medication plan was not documented.'}\n\n"
        "Follow-up Advice:\nReturn for reassessment if symptoms worsen or fail to improve."
    )


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
The note should begin with patient details in this exact order, each on its own line:
Name
Phone
Age
Height
Weight
Temperature
Reason for Visit
Generated On

After that, leave one blank line and write these exact section headings:
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
                    "Always place patient details first in the requested order, then the requested section headings."
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
    return "\n".join(blocks).strip() or build_fallback_note(
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
