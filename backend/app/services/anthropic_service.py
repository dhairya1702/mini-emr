import asyncio

from anthropic import Anthropic

from app.config import get_settings


def build_fallback_note(
    symptoms: str,
    diagnosis: str,
    medications: str,
    notes: str,
    patient_context: str = "",
) -> str:
    header = f"{patient_context}\n\n" if patient_context else ""
    return (
        f"{header}"
        f"Presenting Complaint:\n{symptoms or 'Symptoms not fully documented.'}\n\n"
        f"Diagnosis:\n{diagnosis or 'Clinical impression is still under evaluation.'}\n\n"
        f"Clinical Notes:\n{notes or 'No additional findings were documented during this consultation.'}\n\n"
        f"Treatment:\n{medications or 'Medication plan was not documented.'}\n\n"
        "Follow-up Advice:\nReturn for reassessment if symptoms worsen or fail to improve."
    )


async def generate_soap_note(
    symptoms: str,
    diagnosis: str,
    medications: str,
    notes: str,
    patient_context: str = "",
) -> str:
    settings = get_settings()

    if not settings.anthropic_api_key:
        return build_fallback_note(symptoms, diagnosis, medications, notes, patient_context)

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

Symptoms:
{symptoms or 'Not provided'}

Diagnosis:
{diagnosis or 'Not provided'}

Medications:
{medications or 'Not provided'}

Additional notes:
{notes or 'Not provided'}
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

    blocks = [block.text for block in response.content if getattr(block, "type", "") == "text"]
    return "\n".join(blocks).strip() or build_fallback_note(
        symptoms,
        diagnosis,
        medications,
        notes,
        patient_context,
    )
