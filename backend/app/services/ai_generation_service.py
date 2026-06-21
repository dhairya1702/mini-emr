import asyncio
import logging
from collections import OrderedDict
from typing import Any, TypedDict

import httpx

from app.config import get_settings
from app.db import AppRepository
from app.services.ai_usage_service import record_model_usage

VERTEX_AI_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
VERTEX_AI_TIMEOUT_SECONDS = 60.0
logger = logging.getLogger(__name__)


class GeneratedNoteResult(TypedDict):
    content: str
    used_fallback: bool
    warning: str | None
    error_message: str | None


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
    for label in SECTION_ORDER:
        existing = _strip_pipe_tables("\n".join(line for line in sections[label] if line.strip()))
        content = existing or fallbacks[label]
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


def build_fallback_case_study(
    title: str,
    template_key: str,
    author_instructions: str,
    source_context: str,
) -> str:
    template_line = {
        "conference_presentation": "Conference-style presentation format.",
        "teaching_rounds": "Teaching-rounds discussion format.",
        "hospital_case_discussion": "Hospital case-discussion format.",
    }.get(template_key, "Structured clinical case format.")
    instructions = author_instructions.strip() or "No extra author instructions were provided."
    return (
        f"Title: {title}\n\n"
        "Abstract:\n"
        f"{template_line} This case study was generated from the available longitudinal clinic history.\n\n"
        "Background / Chief Concern:\n"
        "The case centers on the presenting concern and documented clinical context from the patient record.\n\n"
        "Chronological History:\n"
        f"{source_context or 'Chronological history was limited in the record.'}\n\n"
        "Examination / Findings:\n"
        "Relevant examination findings should be reviewed from the consultation notes and visit history.\n\n"
        "Investigations / Relevant Tests:\n"
        "Relevant longitudinal tests and structured measurements should be highlighted here.\n\n"
        "Management / Interventions:\n"
        "Management decisions should summarize documented interventions, advice, and follow-up planning.\n\n"
        "Outcome / Follow-up:\n"
        "Outcome should describe the observed follow-up course in the available records.\n\n"
        "Discussion:\n"
        f"Discuss the clinical significance of the case in light of this framing: {instructions}\n\n"
        "Learning Points:\n"
        "- Highlight the key diagnostic or management lessons.\n"
        "- Summarize why this case is useful for presentation or discussion."
    )


def _vertex_ai_api_endpoint(location: str) -> str:
    normalized = (location or "global").strip() or "global"
    if normalized == "global":
        return "https://aiplatform.googleapis.com"
    return f"https://{normalized}-aiplatform.googleapis.com"


async def _resolve_vertex_credentials(configured_project: str) -> tuple[str, str]:
    def _load_credentials() -> tuple[str, str]:
        import google.auth
        from google.auth.transport.requests import Request

        credentials, detected_project = google.auth.default(scopes=[VERTEX_AI_SCOPE])
        if not credentials.valid or credentials.expired or not credentials.token:
            credentials.refresh(Request())

        token = str(credentials.token or "").strip()
        project_id = str(configured_project or detected_project or "").strip()
        if not token:
            raise RuntimeError("Vertex AI access token could not be resolved.")
        if not project_id:
            raise RuntimeError("GOOGLE_CLOUD_PROJECT must be configured for Vertex AI calls.")
        return token, project_id

    return await asyncio.to_thread(_load_credentials)


def _extract_text_from_vertex_response(response: dict[str, Any]) -> str:
    candidates = response.get("candidates") or []
    text_parts: list[str] = []
    for candidate in candidates:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            text = str(part.get("text") or "").strip()
            if text:
                text_parts.append(text)
    return "\n".join(text_parts).strip()


def _has_max_tokens_finish(response: dict[str, Any]) -> bool:
    candidates = response.get("candidates") or []
    return any(str(candidate.get("finishReason") or "").upper() == "MAX_TOKENS" for candidate in candidates)


async def _generate_vertex_content(
    *,
    project_id: str,
    location: str,
    model: str,
    system_instruction: str,
    prompt: str,
    max_output_tokens: int,
    temperature: float,
    thinking_budget: int | None = None,
) -> dict[str, Any]:
    token, resolved_project = await _resolve_vertex_credentials(project_id)
    base_url = _vertex_ai_api_endpoint(location)
    url = (
        f"{base_url}/v1/projects/{resolved_project}/locations/{location}/publishers/google/models/"
        f"{model}:generateContent"
    )
    payload = {
        "systemInstruction": {
            "parts": [{"text": system_instruction}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
        },
    }
    if thinking_budget is not None:
        payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": thinking_budget}
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=VERTEX_AI_TIMEOUT_SECONDS) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()


async def generate_soap_note(
    repo: AppRepository,
    org_id: str,
    symptoms: str,
    diagnosis: str,
    medications: str,
    notes: str,
    patient_context: str = "",
    clinic_context: str = "",
    measurements_context: str = "",
) -> GeneratedNoteResult:
    settings = get_settings()
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
When details are missing, use neutral clinical wording and do not invent facts such as vitals, labs, durations, exam findings, negative findings, or test results.
Only include physical examination findings, normal findings, and negative findings if they are explicitly provided in the input.
Do not use SOAP headings.
Keep the output plain text only.
If the Structured measurements input includes pipe-delimited tables, preserve them in the Clinical Notes section before the prose notes.
If the Medications input includes a pipe-delimited regimen table, preserve it in the Treatment section before any prose explanation.
In the Treatment section, include all provided medication and care instructions unless they are clearly unsafe or contradictory.

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

    if not str(settings.gemini_model or "").strip():
        return {
            "content": build_fallback_note(
                symptoms,
                diagnosis,
                medications,
                notes,
                patient_context,
                measurements_context,
            ),
            "used_fallback": True,
            "warning": "AI unavailable, used fallback template.",
            "error_message": "GEMINI_MODEL is not configured.",
        }

    try:
        response = await _generate_vertex_content(
            project_id=settings.google_cloud_project,
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            max_output_tokens=2048,
            temperature=0.35,
            thinking_budget=0,
            system_instruction=(
                "You write polished outpatient consultation notes for small clinics. "
                "Return only the final note text. "
                "Return only the five requested section headings and their content. "
                "Do not include patient demographics, phone numbers, ages, or any header block in the note body. "
                "Do not invent examination findings, normal findings, negative findings, tests, vitals, or durations."
            ),
            prompt=prompt,
        )
    except Exception as exc:
        logger.exception("Vertex AI consultation note generation failed")
        return {
            "content": build_fallback_note(
                symptoms,
                diagnosis,
                medications,
                notes,
                patient_context,
                measurements_context,
            ),
            "used_fallback": True,
            "warning": "AI unavailable, used fallback template.",
            "error_message": str(exc),
        }

    generated_text = _extract_text_from_vertex_response(response)
    finish_reasons = [
        str(candidate.get("finishReason") or "")
        for candidate in response.get("candidates") or []
        if isinstance(candidate, dict)
    ]
    logger.info(
        "Vertex AI consultation note response: finish_reasons=%s generated_chars=%s usage=%s",
        finish_reasons,
        len(generated_text),
        response.get("usageMetadata") or {},
    )
    if _has_max_tokens_finish(response) or not generated_text:
        warning = "AI returned incomplete content, used fallback template." if generated_text else "AI returned no content, used fallback template."
        error_message = "Vertex AI returned MAX_TOKENS." if generated_text else "Vertex AI returned an empty response."
        logger.warning(
            "Vertex AI consultation note response was unusable; returning fallback. finish_reasons=%s generated_chars=%s",
            finish_reasons,
            len(generated_text),
        )
        return {
            "content": build_fallback_note(
                symptoms,
                diagnosis,
                medications,
                notes,
                patient_context,
                measurements_context,
            ),
            "used_fallback": True,
            "warning": warning,
            "error_message": error_message,
        }

    await record_model_usage(
        repo,
        org_id=org_id,
        provider="gemini",
        model=settings.gemini_model,
        feature="consultation_note",
        response=response,
        metadata={"has_patient_context": bool(patient_context), "has_measurements_context": bool(measurements_context)},
    )

    return {
        "content": _normalize_note_content(
            generated_text,
            symptoms,
            diagnosis,
            medications,
            notes,
            patient_context,
            measurements_context,
        ),
        "used_fallback": False,
        "warning": None,
        "error_message": None,
    }


async def generate_clinic_letter(
    repo: AppRepository,
    org_id: str,
    to: str,
    subject: str,
    content: str,
    clinic_context: str = "",
) -> str:
    settings = get_settings()
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

    if not str(settings.gemini_model or "").strip():
        logger.info("Clinic letter generation using fallback because GEMINI_MODEL is not configured.")
        return build_fallback_letter(to, subject, content, clinic_context)

    try:
        response = await _generate_vertex_content(
            project_id=settings.google_cloud_project,
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            max_output_tokens=2048,
            temperature=0.35,
            thinking_budget=0,
            system_instruction=(
                "You write clear professional clinic letters. "
                "Return only the final letter text."
            ),
            prompt=prompt,
        )
    except Exception:
        logger.exception("Vertex AI clinic letter generation failed; returning fallback letter.")
        return build_fallback_letter(to, subject, content, clinic_context)

    generated_text = _extract_text_from_vertex_response(response)
    finish_reasons = [
        str(candidate.get("finishReason") or "")
        for candidate in response.get("candidates") or []
        if isinstance(candidate, dict)
    ]
    logger.info(
        "Vertex AI clinic letter response: finish_reasons=%s generated_chars=%s usage=%s",
        finish_reasons,
        len(generated_text),
        response.get("usageMetadata") or {},
    )
    if _has_max_tokens_finish(response) or not generated_text:
        logger.warning(
            "Vertex AI clinic letter response was unusable; returning fallback. finish_reasons=%s generated_chars=%s",
            finish_reasons,
            len(generated_text),
        )
        return build_fallback_letter(to, subject, content, clinic_context)

    await record_model_usage(
        repo,
        org_id=org_id,
        provider="gemini",
        model=settings.gemini_model,
        feature="clinic_letter",
        response=response,
        metadata={"has_clinic_context": bool(clinic_context), "recipient": to.strip()},
    )

    return generated_text


async def generate_case_study_document(
    repo: AppRepository,
    org_id: str,
    *,
    title: str,
    template_key: str,
    author_instructions: str,
    clinic_context: str,
    source_context: str,
    anonymized: bool,
) -> str:
    settings = get_settings()
    prompt = f"""
Write a polished, presentation-ready medical case study in plain text.
Use these exact headings in this order:
Title:
Abstract:
Background / Chief Concern:
Chronological History:
Examination / Findings:
Investigations / Relevant Tests:
Management / Interventions:
Outcome / Follow-up:
Discussion:
Learning Points:

Requirements:
- Keep the output structured and concise enough to present at a conference or hospital discussion.
- Use full clinical prose, not bullet overload, except Learning Points where short bullets are acceptable.
- Do not invent missing facts.
- Use only the source history provided.
- Respect the requested framing and educational emphasis.
- If anonymized is true, do not introduce real patient identifiers.
- Return plain text only.

Clinic context:
{clinic_context or 'Not provided'}

Template key:
{template_key}

Author instructions:
{author_instructions or 'None provided'}

Anonymized:
{'Yes' if anonymized else 'No'}

Source case history:
{source_context or 'No source context provided'}
""".strip()

    if not str(settings.gemini_model or "").strip():
        return build_fallback_case_study(title, template_key, author_instructions, source_context)

    try:
        response = await _generate_vertex_content(
            project_id=settings.google_cloud_project,
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            max_output_tokens=1200,
            temperature=0.35,
            system_instruction=(
                "You write polished clinical case studies for doctors presenting in conferences and hospitals. "
                "Return only the final case study text with the requested section headings."
            ),
            prompt=prompt,
        )
    except Exception:
        return build_fallback_case_study(title, template_key, author_instructions, source_context)

    await record_model_usage(
        repo,
        org_id=org_id,
        provider="gemini",
        model=settings.gemini_model,
        feature="case_study",
        response=response,
        metadata={"template_key": template_key, "anonymized": anonymized},
    )

    return _extract_text_from_vertex_response(response) or build_fallback_case_study(
        title,
        template_key,
        author_instructions,
        source_context,
    )
