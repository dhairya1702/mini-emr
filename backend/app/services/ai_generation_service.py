import asyncio
import json
import logging
import re
from collections import OrderedDict
from typing import Any, TypedDict

import httpx

from app.config import get_settings
from app.db import AppRepository
from app.schema_domains.clinical_assistant import (
    ClinicalAnalysisResponse,
    ClinicalAssistantAnswer,
    ClinicalAssistantModuleSuggestion,
    ClinicalAssistantSpecialty,
    ClinicalAssistantQuestion,
    ClinicalQuestionsResponse,
)
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


def _fallback_optometry_category(reason_text: str) -> str:
    text = reason_text.lower()
    if any(term in text for term in ("red", "redness", "pink", "irritation", "discharge")):
        return "red_eye"
    if any(term in text for term in ("blur", "blurry", "vision", "power", "glasses", "refraction")):
        return "blurred_vision"
    if any(term in text for term in ("contact lens", "lens", "cl")):
        return "contact_lens_issue"
    if any(term in text for term in ("headache", "strain", "screen", "reading")):
        return "headache_eye_strain"
    if any(term in text for term in ("myopia", "progress", "axial")):
        return "myopia_progression"
    if any(term in text for term in ("dry", "burning", "foreign body", "gritty")):
        return "dry_eye"
    return "general_eye_complaint"


def _normalize_clinical_specialty(clinic_specialty: str | None) -> ClinicalAssistantSpecialty:
    value = str(clinic_specialty or "").strip()
    if value in {"optometry", "pediatrics", "general_physician", "dentistry"}:
        return value  # type: ignore[return-value]
    return "general_physician"


def _fallback_pediatrics_category(reason_text: str) -> str:
    text = reason_text.lower()
    if any(term in text for term in ("fever", "temperature", "febrile")):
        return "pediatric_fever"
    if any(term in text for term in ("cough", "cold", "breath", "wheeze", "respiratory")):
        return "pediatric_respiratory"
    if any(term in text for term in ("vomit", "loose", "diarrhea", "stool", "dehydration")):
        return "pediatric_gastroenteritis"
    if any(term in text for term in ("rash", "spots", "skin")):
        return "pediatric_rash"
    if any(term in text for term in ("growth", "weight", "height", "feeding", "nutrition")):
        return "pediatric_growth_or_feeding"
    return "general_pediatric_complaint"


def _fallback_general_category(reason_text: str) -> str:
    text = reason_text.lower()
    if any(term in text for term in ("fever", "temperature", "chills")):
        return "fever"
    if any(term in text for term in ("cough", "cold", "breath", "wheeze", "sore throat")):
        return "respiratory"
    if any(term in text for term in ("pain abdomen", "abdominal", "vomit", "diarrhea", "stomach")):
        return "gastrointestinal"
    if any(term in text for term in ("chest pain", "palpitation", "syncope")):
        return "cardiorespiratory_red_flag"
    if any(term in text for term in ("headache", "dizzy", "weakness", "numb", "seizure")):
        return "neurologic"
    return "general_primary_care_complaint"


def _fallback_dentistry_category(reason_text: str) -> str:
    text = reason_text.lower()
    if any(term in text for term in ("tooth pain", "toothache", "sensitivity", "hot", "cold", "biting pain")):
        return "tooth_pain"
    if any(term in text for term in ("gum", "bleeding", "periodontal", "mobility", "bad breath")):
        return "gum_issue"
    if any(term in text for term in ("trauma", "broken tooth", "fracture", "avulsed", "knocked out", "injury")):
        return "dental_trauma"
    if any(term in text for term in ("swelling", "abscess", "infection", "pus", "fever", "face swollen")):
        return "facial_swelling_or_infection"
    if any(term in text for term in ("extraction", "post-op", "post op", "procedure", "dry socket", "bleeding")):
        return "post_procedure_follow_up"
    if any(term in text for term in ("braces", "aligner", "wire", "retainer", "appliance", "orthodont")):
        return "orthodontic_or_appliance_issue"
    return "general_dental_complaint"


def _assistant_note_additions(answers: list[ClinicalAssistantAnswer]) -> str:
    answer_lines = [f"{answer.label}: {answer.answer}" for answer in answers if answer.answer.strip()]
    return "AI assistant Q&A:\n" + "\n".join(f"- {line}" for line in answer_lines) if answer_lines else ""


def build_fallback_optometry_questions(reason_text: str, warning: str | None = None) -> ClinicalQuestionsResponse:
    category = _fallback_optometry_category(reason_text)
    base_questions = {
        "red_eye": [
            ("which_eye", "Red eye triage", "Which eye is affected?", "single_choice", ["Right", "Left", "Both", "Not asked"], "Laterality helps localize and prioritize the eye exam."),
            ("duration", "Red eye triage", "How long has the redness been present?", "duration", [], "Duration helps separate acute red-eye causes from chronic irritation."),
            ("pain", "Red flags", "Any eye pain?", "single_choice", ["None", "Mild", "Moderate", "Severe", "Not asked"], "Pain severity helps screen urgent red-eye causes."),
            ("photophobia", "Red flags", "Any photophobia?", "yes_no", ["No", "Yes", "Not asked"], "Photophobia can indicate corneal or intraocular inflammation."),
            ("vision_reduced", "Red flags", "Any reduction in vision?", "yes_no", ["No", "Yes", "Not asked"], "Reduced vision with red eye needs urgent attention."),
            ("contact_lens_use", "Contact lens", "Does the patient wear contact lenses?", "yes_no", ["No", "Yes", "Not asked"], "Contact lens red eye requires corneal assessment."),
            ("trauma_foreign_body", "Red flags", "Any trauma, chemical exposure, or foreign body sensation?", "yes_no", ["No", "Yes", "Not asked"], "Trauma and chemical exposure change urgency."),
            ("discharge", "Symptoms", "What type of discharge is present?", "single_choice", ["None", "Watery", "Mucopurulent", "Sticky lids", "Not asked"], "Discharge pattern helps guide differential considerations."),
        ],
        "blurred_vision": [
            ("which_eye", "Blurred vision", "Is blur in one eye or both?", "single_choice", ["Right", "Left", "Both", "Not asked"], "Laterality changes the concern level."),
            ("distance_near", "Blurred vision", "Is blur for distance, near, or both?", "single_choice", ["Distance", "Near", "Both", "Variable", "Not asked"], "Pattern guides refraction and binocular workup."),
            ("onset", "Red flags", "Was onset sudden or gradual?", "single_choice", ["Sudden", "Gradual", "Not sure", "Not asked"], "Sudden visual change is a red flag."),
            ("pain_redness", "Red flags", "Any pain, redness, flashes, floaters, or curtain?", "multi_choice", ["Pain", "Redness", "Flashes", "Floaters", "Curtain", "None"], "These symptoms can indicate urgent pathology."),
            ("current_correction", "Refraction", "Current glasses or contact lens use?", "short_text", [], "Existing correction is needed before refraction decisions."),
        ],
        "contact_lens_issue": [
            ("pain_redness", "Red flags", "Any pain, redness, photophobia, or reduced vision?", "multi_choice", ["Pain", "Redness", "Photophobia", "Reduced vision", "None"], "Contact lens complications can be urgent."),
            ("overnight_wear", "Contact lens", "Any overnight wear?", "yes_no", ["No", "Yes", "Not asked"], "Overnight wear increases keratitis risk."),
            ("wear_schedule", "Contact lens", "What is the wear schedule and replacement frequency?", "short_text", [], "Wear pattern helps assess lens-related problems."),
            ("hygiene", "Contact lens", "Any hygiene or solution concerns?", "short_text", [], "Care routine can explain irritation or infection risk."),
        ],
        "headache_eye_strain": [
            ("near_work", "Asthenopia", "Is it worse with near work or screens?", "yes_no", ["No", "Yes", "Not asked"], "Near-work symptoms guide binocular/accommodation checks."),
            ("diplopia", "Red flags", "Any double vision?", "yes_no", ["No", "Yes", "Not asked"], "Diplopia changes the workup."),
            ("end_day", "Asthenopia", "Worse toward end of day?", "yes_no", ["No", "Yes", "Not asked"], "Timing helps identify strain/fatigue patterns."),
            ("current_rx", "Refraction", "Current prescription and last refraction date?", "short_text", [], "Old correction may explain symptoms."),
        ],
        "myopia_progression": [
            ("previous_rx", "Myopia history", "Previous prescription and date?", "short_text", [], "Progression requires comparison."),
            ("family_history", "Risk factors", "Family history of myopia?", "yes_no", ["No", "Yes", "Not asked"], "Family history is a myopia risk factor."),
            ("near_outdoor", "Risk factors", "Near work and outdoor time?", "short_text", [], "Lifestyle risk factors guide counseling."),
            ("axial_length", "Module request", "Record axial length if available.", "module_request", ["myopia_management"], "Axial length supports progression monitoring."),
        ],
        "dry_eye": [
            ("symptom_pattern", "Dry eye", "Burning, grittiness, watering, or fluctuating vision?", "multi_choice", ["Burning", "Grittiness", "Watering", "Fluctuating vision", "None"], "Symptom pattern supports ocular surface assessment."),
            ("screen_environment", "Dry eye", "Screen use, AC exposure, or low blinking context?", "short_text", [], "Environment often contributes to dry eye symptoms."),
            ("contact_lens_use", "Contact lens", "Does the patient wear contact lenses?", "yes_no", ["No", "Yes", "Not asked"], "Contact lenses can worsen dryness."),
            ("red_flags", "Red flags", "Any pain, photophobia, or reduced vision?", "multi_choice", ["Pain", "Photophobia", "Reduced vision", "None"], "These move beyond routine dry eye."),
        ],
        "general_eye_complaint": [
            ("main_issue", "Triage", "What is the main issue?", "single_choice", ["Blurred vision", "Red eye", "Pain", "Headache/strain", "Contact lens", "Follow-up"], "Classifies the optometry workflow."),
            ("which_eye", "Triage", "One eye or both?", "single_choice", ["Right", "Left", "Both", "Not asked"], "Laterality is needed early."),
            ("onset", "Triage", "Sudden or gradual onset?", "single_choice", ["Sudden", "Gradual", "Not sure", "Not asked"], "Sudden symptoms can be urgent."),
            ("red_flags", "Red flags", "Any pain, photophobia, vision loss, trauma, flashes, floaters, or chemical exposure?", "multi_choice", ["Pain", "Photophobia", "Vision loss", "Trauma", "Flashes/floaters", "Chemical exposure", "None"], "Screens urgent eye conditions."),
        ],
    }
    question_rows = base_questions.get(category, base_questions["general_eye_complaint"])
    questions = [
        ClinicalAssistantQuestion(
            id=row[0],
            group=row[1],
            label=row[2],
            type=row[3],  # type: ignore[arg-type]
            priority="high" if row[1] == "Red flags" else "medium",
            options=row[4],
            rationale=row[5],
        )
        for row in question_rows
    ]
    modules = [ClinicalAssistantModuleSuggestion(module="eye_exam", reason="Record visual acuity and relevant ocular findings.")]
    if category in {"red_eye", "contact_lens_issue", "dry_eye"}:
        modules.append(ClinicalAssistantModuleSuggestion(module="contact_lens", reason="Capture lens use, wear schedule, hygiene, and comfort issues if relevant."))
    if category == "headache_eye_strain":
        modules.append(ClinicalAssistantModuleSuggestion(module="binocular_vision", reason="Screen convergence, accommodation, and binocular symptoms."))
    if category == "myopia_progression":
        modules.append(ClinicalAssistantModuleSuggestion(module="myopia_management", reason="Capture refraction history and axial length where available."))
    return ClinicalQuestionsResponse(
        assistant_specialty="optometry",
        complaint_category=category,
        detected_factors=[category],
        questions=questions,
        module_suggestions=modules,
        used_fallback=bool(warning),
        warning=warning,
    )


def build_fallback_optometry_analysis(
    reason_text: str,
    answers: list[ClinicalAssistantAnswer],
    warning: str | None = None,
) -> ClinicalAnalysisResponse:
    category = _fallback_optometry_category(reason_text)
    note_additions = _assistant_note_additions(answers)
    possibilities = {
        "red_eye": [
            {"label": "Conjunctivitis / ocular surface irritation", "likelihood": "consider", "why": "Red eye symptoms can fit surface irritation or conjunctivitis depending on discharge, pain, and vision.", "what_to_check": "Visual acuity, discharge type, corneal staining, contact lens history."},
            {"label": "Keratitis or corneal involvement", "likelihood": "rule_out", "why": "Pain, photophobia, reduced vision, or contact lens use would increase concern.", "what_to_check": "Corneal clarity/staining and contact lens risk factors."},
        ],
        "blurred_vision": [
            {"label": "Refractive change", "likelihood": "consider", "why": "Blurred vision often requires refraction comparison.", "what_to_check": "Unaided/aided VA, pinhole, refraction, onset pattern."},
            {"label": "Ocular pathology requiring referral", "likelihood": "rule_out", "why": "Sudden blur, flashes, floaters, curtain, pain, or redness are red flags.", "what_to_check": "Red flag symptoms and ocular findings."},
        ],
        "contact_lens_issue": [
            {"label": "Contact lens-related irritation", "likelihood": "consider", "why": "Lens wear pattern, dryness, and hygiene can explain symptoms.", "what_to_check": "Wear schedule, overnight wear, lens age, solution, corneal staining."},
            {"label": "Contact lens-associated keratitis", "likelihood": "rule_out", "why": "Painful red eye, photophobia, or reduced vision in a lens wearer is urgent.", "what_to_check": "VA, cornea, photophobia, pain severity."},
        ],
        "headache_eye_strain": [
            {"label": "Asthenopia / binocular vision issue", "likelihood": "consider", "why": "Near work, screens, diplopia, and end-of-day symptoms guide this.", "what_to_check": "Cover test, NPC, accommodation, current prescription."},
        ],
        "myopia_progression": [
            {"label": "Myopia progression", "likelihood": "consider", "why": "Requires comparison with previous refraction or axial length.", "what_to_check": "Previous Rx, axial length, family history, near work, outdoor time."},
        ],
        "dry_eye": [
            {"label": "Dry eye / ocular surface disease", "likelihood": "consider", "why": "Burning, grittiness, watering, and fluctuating vision can fit dry eye.", "what_to_check": "Tear film, staining, screen/AC exposure, contact lens use."},
        ],
        "general_eye_complaint": [
            {"label": "Optometry triage incomplete", "likelihood": "contextual", "why": "The main complaint needs classification before reasoning support is useful.", "what_to_check": "Blur/redness/pain/contact lens/trauma/vision loss category."},
        ],
    }
    module_suggestions = ["eye_exam"]
    if category in {"red_eye", "contact_lens_issue", "dry_eye"}:
        module_suggestions.append("contact_lens")
    if category == "headache_eye_strain":
        module_suggestions.append("binocular_vision")
    if category == "myopia_progression":
        module_suggestions.append("myopia_management")
    return ClinicalAnalysisResponse(
        assistant_specialty="optometry",
        possibilities=possibilities.get(category, possibilities["general_eye_complaint"]),
        red_flags=[
            {"label": "Sudden vision loss", "severity": "urgent", "present": False},
            {"label": "Severe pain or photophobia", "severity": "urgent", "present": False},
            {"label": "Contact lens red eye", "severity": "urgent", "present": False},
            {"label": "Trauma, chemical injury, flashes/floaters/curtain", "severity": "urgent", "present": False},
        ],
        suggested_tests=["Visual acuity", "Relevant anterior segment/corneal assessment", "Refraction or specialty module as indicated"],
        documentation_gaps=["Vision change status", "Pain/photophobia status", "Contact lens history", "Laterality and duration"],
        module_suggestions=module_suggestions,  # type: ignore[arg-type]
        note_additions=note_additions,
        used_fallback=bool(warning),
        warning=warning,
    )


def _question_from_row(row: tuple[str, str, str, str, list[str], str], *, high_priority_groups: set[str]) -> ClinicalAssistantQuestion:
    return ClinicalAssistantQuestion(
        id=row[0],
        group=row[1],
        label=row[2],
        type=row[3],  # type: ignore[arg-type]
        priority="high" if row[1] in high_priority_groups else "medium",
        options=row[4],
        rationale=row[5],
    )


def build_fallback_pediatrics_questions(reason_text: str, warning: str | None = None) -> ClinicalQuestionsResponse:
    category = _fallback_pediatrics_category(reason_text)
    rows_by_category = {
        "pediatric_fever": [
            ("duration", "Fever history", "How long has the fever been present?", "duration", [], "Duration helps separate short viral illness from persistent fever."),
            ("temperature", "Fever history", "What was the highest recorded temperature?", "short_text", [], "Peak temperature and measurement method guide urgency."),
            ("activity", "Red flags", "Is the child unusually drowsy, irritable, or difficult to wake?", "yes_no", ["No", "Yes", "Not asked"], "Altered behavior can indicate serious illness."),
            ("hydration", "Red flags", "Any poor feeding, reduced urine, dry mouth, or signs of dehydration?", "multi_choice", ["Poor feeding", "Reduced urine", "Dry mouth", "Sunken eyes", "None"], "Hydration status affects urgency."),
            ("breathing", "Red flags", "Any fast breathing, chest indrawing, grunting, or blue lips?", "multi_choice", ["Fast breathing", "Chest indrawing", "Grunting", "Blue lips", "None"], "Respiratory distress needs urgent assessment."),
            ("rash_neck", "Red flags", "Any non-blanching rash, neck stiffness, seizure, or persistent vomiting?", "multi_choice", ["Non-blanching rash", "Neck stiffness", "Seizure", "Persistent vomiting", "None"], "These are important pediatric danger signs."),
        ],
        "pediatric_respiratory": [
            ("duration", "Respiratory history", "How long has cough or breathing difficulty been present?", "duration", [], "Duration helps identify acute progression."),
            ("work_of_breathing", "Red flags", "Any fast breathing, chest indrawing, grunting, or inability to speak/feed?", "multi_choice", ["Fast breathing", "Chest indrawing", "Grunting", "Cannot feed/speak", "None"], "Work of breathing determines urgency."),
            ("fever", "Associated symptoms", "Is fever present?", "yes_no", ["No", "Yes", "Not asked"], "Fever changes infectious concern."),
            ("wheeze_history", "Respiratory history", "Any wheeze, asthma history, or nebulizer/inhaler use?", "short_text", [], "Prior wheeze/asthma changes assessment."),
            ("hydration", "Red flags", "Is feeding and urine output normal?", "single_choice", ["Normal", "Reduced", "Very poor", "Not asked"], "Poor intake can signal severity."),
        ],
        "pediatric_gastroenteritis": [
            ("vomit_stool", "GI history", "How many vomiting or loose stool episodes in the last 24 hours?", "short_text", [], "Frequency helps estimate dehydration risk."),
            ("hydration", "Red flags", "Any reduced urine, lethargy, dry mouth, or inability to keep fluids down?", "multi_choice", ["Reduced urine", "Lethargy", "Dry mouth", "Cannot keep fluids", "None"], "These screen dehydration severity."),
            ("blood_bile", "Red flags", "Any blood in stool, green vomit, severe abdominal pain, or distension?", "multi_choice", ["Blood in stool", "Green vomit", "Severe pain", "Distension", "None"], "These can indicate surgical or severe disease."),
            ("fever", "Associated symptoms", "Is fever present?", "yes_no", ["No", "Yes", "Not asked"], "Fever changes differential context."),
        ],
        "pediatric_rash": [
            ("rash_duration", "Rash history", "When did the rash start and where did it begin?", "short_text", [], "Timing and distribution guide triage."),
            ("non_blanching", "Red flags", "Is the rash non-blanching or associated with fever/toxic appearance?", "multi_choice", ["Non-blanching", "Fever", "Toxic appearance", "None"], "Non-blanching rash with fever is urgent."),
            ("itch_pain", "Rash history", "Is it itchy, painful, blistering, or spreading rapidly?", "multi_choice", ["Itchy", "Painful", "Blistering", "Rapid spread", "None"], "Rash quality changes urgency and workup."),
            ("exposure", "Context", "Any new medicine, food, infection exposure, or allergy history?", "short_text", [], "Exposure history is important."),
        ],
        "pediatric_growth_or_feeding": [
            ("feeding", "Growth and feeding", "What are the current feeding pattern and appetite concerns?", "short_text", [], "Feeding context is needed for pediatric assessment."),
            ("weight_change", "Growth and feeding", "Any recent weight loss, poor gain, vomiting, diarrhea, or chronic illness?", "multi_choice", ["Weight loss", "Poor gain", "Vomiting", "Diarrhea", "Chronic illness", "None"], "These guide growth concern."),
            ("development", "Context", "Any developmental, sleep, behavior, or school concerns?", "short_text", [], "Broader pediatric context may be relevant."),
            ("growth_module", "Module request", "Record growth measurements if available.", "module_request", ["pediatric_growth_measurement"], "Growth tracking supports longitudinal review."),
        ],
        "general_pediatric_complaint": [
            ("age_context", "Triage", "What is the child's age and main concern today?", "short_text", [], "Age changes pediatric risk assessment."),
            ("duration", "Triage", "How long has the concern been present?", "duration", [], "Duration helps triage acuity."),
            ("red_flags", "Red flags", "Any breathing difficulty, dehydration, lethargy, seizure, non-blanching rash, or severe pain?", "multi_choice", ["Breathing difficulty", "Dehydration", "Lethargy", "Seizure", "Non-blanching rash", "Severe pain", "None"], "Screens common pediatric danger signs."),
            ("feeding_urine", "Triage", "Are feeding and urine output normal?", "single_choice", ["Normal", "Reduced", "Very poor", "Not asked"], "Hydration and intake matter in children."),
        ],
    }
    rows = rows_by_category.get(category, rows_by_category["general_pediatric_complaint"])
    modules = [ClinicalAssistantModuleSuggestion(module="vitals", reason="Record pediatric vitals if clinically indicated.")]
    if category in {"pediatric_growth_or_feeding", "general_pediatric_complaint"}:
        modules.append(ClinicalAssistantModuleSuggestion(module="pediatric_growth_measurement", reason="Capture height, weight, and growth context if relevant."))
    modules.append(ClinicalAssistantModuleSuggestion(module="pediatric_follow_up_plan", reason="Set review timing if symptoms need follow-up."))
    return ClinicalQuestionsResponse(
        assistant_specialty="pediatrics",
        complaint_category=category,
        detected_factors=[category],
        questions=[_question_from_row(row, high_priority_groups={"Red flags"}) for row in rows],
        module_suggestions=modules,
        used_fallback=bool(warning),
        warning=warning,
    )


def build_fallback_general_questions(reason_text: str, warning: str | None = None) -> ClinicalQuestionsResponse:
    category = _fallback_general_category(reason_text)
    rows_by_category = {
        "fever": [
            ("duration", "Fever history", "How long has fever been present?", "duration", [], "Duration helps triage acute vs persistent fever."),
            ("highest_temp", "Fever history", "What was the highest measured temperature?", "short_text", [], "Peak temperature and measurement method provide context."),
            ("localizing_symptoms", "Symptoms", "Any cough, urinary symptoms, abdominal pain, rash, headache, or travel exposure?", "multi_choice", ["Cough", "Urinary symptoms", "Abdominal pain", "Rash", "Headache", "Travel exposure", "None"], "Localizing symptoms guide assessment."),
            ("red_flags", "Red flags", "Any breathlessness, confusion, severe dehydration, neck stiffness, chest pain, or persistent vomiting?", "multi_choice", ["Breathlessness", "Confusion", "Severe dehydration", "Neck stiffness", "Chest pain", "Persistent vomiting", "None"], "Screens urgent concerns."),
            ("risk", "Context", "Any pregnancy, diabetes, immunosuppression, elderly age, or major comorbidity?", "multi_choice", ["Pregnancy", "Diabetes", "Immunosuppression", "Elderly", "Major comorbidity", "None"], "Risk factors change threshold for escalation."),
        ],
        "respiratory": [
            ("duration", "Respiratory history", "How long has cough/cold/breathing symptom been present?", "duration", [], "Duration helps determine acuity."),
            ("breathlessness", "Red flags", "Any shortness of breath, chest pain, low SpO2, cyanosis, or hemoptysis?", "multi_choice", ["Shortness of breath", "Chest pain", "Low SpO2", "Cyanosis", "Hemoptysis", "None"], "Screens severe respiratory disease."),
            ("fever_sputum", "Symptoms", "Any fever, sputum, wheeze, sore throat, or exposure history?", "multi_choice", ["Fever", "Sputum", "Wheeze", "Sore throat", "Exposure", "None"], "Associated symptoms guide differential."),
            ("risk", "Context", "Any asthma/COPD, smoking, cardiac disease, pregnancy, or immunosuppression?", "multi_choice", ["Asthma/COPD", "Smoking", "Cardiac disease", "Pregnancy", "Immunosuppression", "None"], "Risk factors affect management threshold."),
        ],
        "gastrointestinal": [
            ("duration", "GI history", "How long have GI symptoms been present?", "duration", [], "Duration helps assess acuity."),
            ("vomit_stool", "GI history", "Vomiting, diarrhea, constipation, or blood in stool?", "multi_choice", ["Vomiting", "Diarrhea", "Constipation", "Blood in stool", "None"], "GI pattern narrows considerations."),
            ("pain", "Red flags", "Any severe/worsening abdominal pain, guarding, distension, black stool, or persistent vomiting?", "multi_choice", ["Severe pain", "Guarding", "Distension", "Black stool", "Persistent vomiting", "None"], "Screens urgent abdominal conditions."),
            ("hydration", "Red flags", "Any dizziness, reduced urine, dry mouth, or inability to keep fluids?", "multi_choice", ["Dizziness", "Reduced urine", "Dry mouth", "Cannot keep fluids", "None"], "Hydration status changes urgency."),
        ],
        "cardiorespiratory_red_flag": [
            ("chest_pain", "Red flags", "Describe chest pain onset, character, radiation, sweating, nausea, and exertional relation.", "short_text", [], "Chest pain needs structured risk assessment."),
            ("breath_syncope", "Red flags", "Any shortness of breath, syncope, palpitations, or neurologic symptoms?", "multi_choice", ["Shortness of breath", "Syncope", "Palpitations", "Neurologic symptoms", "None"], "Associated symptoms can indicate urgent disease."),
            ("risk", "Context", "Any diabetes, hypertension, smoking, cardiac history, pregnancy, or age risk?", "multi_choice", ["Diabetes", "Hypertension", "Smoking", "Cardiac history", "Pregnancy", "Age risk", "None"], "Risk factors guide escalation."),
            ("vitals_module", "Module request", "Record vitals if available.", "module_request", ["vitals"], "Vitals are important in cardiorespiratory complaints."),
        ],
        "neurologic": [
            ("onset", "Red flags", "Was onset sudden, severe, or associated with weakness/numbness/speech/vision change?", "multi_choice", ["Sudden", "Severe", "Weakness/numbness", "Speech change", "Vision change", "None"], "Screens neurologic emergency."),
            ("headache_features", "History", "Any fever, neck stiffness, vomiting, trauma, seizure, or altered sensorium?", "multi_choice", ["Fever", "Neck stiffness", "Vomiting", "Trauma", "Seizure", "Altered sensorium", "None"], "Identifies urgent headache/neurologic features."),
            ("med_history", "Context", "Any hypertension, diabetes, anticoagulant use, migraine history, or pregnancy?", "multi_choice", ["Hypertension", "Diabetes", "Anticoagulant", "Migraine history", "Pregnancy", "None"], "Risk context changes assessment."),
        ],
        "general_primary_care_complaint": [
            ("main_issue", "Triage", "What is the main concern and duration?", "short_text", [], "Clarifies the presenting problem."),
            ("red_flags", "Red flags", "Any chest pain, breathlessness, confusion, severe pain, fainting, neurologic deficit, pregnancy concern, or allergic reaction?", "multi_choice", ["Chest pain", "Breathlessness", "Confusion", "Severe pain", "Fainting", "Neurologic deficit", "Pregnancy concern", "Allergic reaction", "None"], "Screens common urgent concerns."),
            ("vitals", "Context", "Are vitals available or needed?", "module_request", ["vitals"], "Vitals support triage."),
            ("meds_allergies", "Context", "Current medicines, allergies, and major past history?", "short_text", [], "Medication and allergy history are essential."),
        ],
    }
    rows = rows_by_category.get(category, rows_by_category["general_primary_care_complaint"])
    return ClinicalQuestionsResponse(
        assistant_specialty="general_physician",
        complaint_category=category,
        detected_factors=[category],
        questions=[_question_from_row(row, high_priority_groups={"Red flags"}) for row in rows],
        module_suggestions=[
            ClinicalAssistantModuleSuggestion(module="vitals", reason="Record vitals if clinically indicated."),
            ClinicalAssistantModuleSuggestion(module="medicines", reason="Check medicines, doses, and allergies if treatment is documented."),
        ],
        used_fallback=bool(warning),
        warning=warning,
    )


def build_fallback_dentistry_questions(reason_text: str, warning: str | None = None) -> ClinicalQuestionsResponse:
    category = _fallback_dentistry_category(reason_text)
    rows_by_category = {
        "tooth_pain": [
            ("tooth_location", "Pain history", "Which tooth or area is painful?", "short_text", [], "Location helps target the dental exam and records."),
            ("duration", "Pain history", "How long has the pain been present?", "duration", [], "Duration helps separate acute flare from chronic sensitivity."),
            ("pain_triggers", "Pain history", "Is pain triggered by hot, cold, sweet, or biting?", "multi_choice", ["Hot", "Cold", "Sweet", "Biting", "Spontaneous", "None"], "Triggers help characterize pulpal or periodontal concern."),
            ("night_pain", "Red flags", "Any spontaneous severe pain, night pain, swelling, fever, or bad taste/discharge?", "multi_choice", ["Severe spontaneous pain", "Night pain", "Swelling", "Fever", "Bad taste/discharge", "None"], "These can indicate infection or urgent dental disease."),
            ("medical_risk", "Context", "Any diabetes, immunosuppression, pregnancy, blood thinner use, or drug allergy?", "multi_choice", ["Diabetes", "Immunosuppression", "Pregnancy", "Blood thinners", "Drug allergy", "None"], "Medical context changes risk and treatment planning."),
        ],
        "gum_issue": [
            ("gum_symptoms", "Gum history", "What gum symptoms are present?", "multi_choice", ["Bleeding", "Swelling", "Pain", "Bad breath", "Mobility", "Recession"], "Gum symptom pattern guides periodontal assessment."),
            ("duration", "Gum history", "How long has this been present?", "duration", [], "Duration helps identify acute vs chronic gum issues."),
            ("oral_hygiene", "Context", "Any recent cleaning, oral hygiene change, tobacco use, or periodontal history?", "short_text", [], "Risk context is important for gum disease."),
            ("red_flags", "Red flags", "Any facial swelling, fever, pus, trismus, or spreading pain?", "multi_choice", ["Facial swelling", "Fever", "Pus", "Trismus", "Spreading pain", "None"], "Screens odontogenic infection red flags."),
        ],
        "dental_trauma": [
            ("injury_time", "Trauma history", "When did the injury happen?", "duration", [], "Timing is critical for dental trauma decisions."),
            ("injury_type", "Trauma history", "What happened to the tooth or mouth?", "multi_choice", ["Broken tooth", "Loose tooth", "Knocked out tooth", "Soft tissue cut", "Jaw injury", "Bleeding"], "Injury type determines urgency."),
            ("permanent_tooth", "Red flags", "If a tooth was knocked out, was it a permanent tooth and how was it stored?", "short_text", [], "Avulsed permanent teeth are urgent."),
            ("jaw_neuro", "Red flags", "Any uncontrolled bleeding, bite change, jaw pain, numbness, or trouble opening mouth?", "multi_choice", ["Uncontrolled bleeding", "Bite change", "Jaw pain", "Numbness", "Trouble opening", "None"], "Screens facial/jaw trauma concerns."),
        ],
        "facial_swelling_or_infection": [
            ("swelling_site", "Infection history", "Where is the swelling and how fast is it spreading?", "short_text", [], "Location and spread determine urgency."),
            ("systemic", "Red flags", "Any fever, malaise, difficulty swallowing, breathing difficulty, or trismus?", "multi_choice", ["Fever", "Malaise", "Difficulty swallowing", "Breathing difficulty", "Trismus", "None"], "These are dental infection danger signs."),
            ("source_tooth", "Dental history", "Any painful tooth, gum swelling, recent dental treatment, or pus/bad taste?", "multi_choice", ["Painful tooth", "Gum swelling", "Recent treatment", "Pus/bad taste", "None"], "Helps identify odontogenic source."),
            ("medical_risk", "Context", "Any diabetes, immunosuppression, pregnancy, or drug allergy?", "multi_choice", ["Diabetes", "Immunosuppression", "Pregnancy", "Drug allergy", "None"], "Risk factors change urgency."),
        ],
        "post_procedure_follow_up": [
            ("procedure", "Procedure follow-up", "What dental procedure was done and when?", "short_text", [], "Procedure and timing frame expected recovery."),
            ("pain_bleeding", "Red flags", "Any increasing pain, uncontrolled bleeding, swelling, fever, or bad taste?", "multi_choice", ["Increasing pain", "Uncontrolled bleeding", "Swelling", "Fever", "Bad taste", "None"], "Screens post-procedure complications."),
            ("dry_socket", "Follow-up", "If extraction: severe pain after 2-4 days, bad odor/taste, or empty socket concern?", "multi_choice", ["Severe delayed pain", "Bad odor/taste", "Empty socket concern", "None"], "Screens dry socket concern."),
            ("meds", "Context", "What medicines were prescribed and are they being taken?", "short_text", [], "Medication adherence and allergies matter."),
        ],
        "orthodontic_or_appliance_issue": [
            ("appliance", "Orthodontic history", "What appliance is involved?", "single_choice", ["Braces", "Aligner", "Retainer", "Expander", "Other", "Not asked"], "Appliance type guides next steps."),
            ("issue", "Orthodontic history", "What is the issue?", "multi_choice", ["Wire poking", "Bracket loose", "Aligner not fitting", "Pain", "Ulcer", "Retainer issue", "Bite concern"], "Problem type guides urgency and documentation."),
            ("duration", "Orthodontic history", "When did it start?", "duration", [], "Duration helps determine acuity."),
            ("trauma_swelling", "Red flags", "Any trauma, swelling, fever, uncontrolled pain, or inability to eat?", "multi_choice", ["Trauma", "Swelling", "Fever", "Uncontrolled pain", "Cannot eat", "None"], "Screens urgent appliance-related issues."),
        ],
        "general_dental_complaint": [
            ("main_issue", "Dental triage", "What is the main dental concern today?", "single_choice", ["Tooth pain", "Gum issue", "Swelling", "Trauma", "Post-procedure", "Braces/aligners", "Other"], "Classifies dental workflow."),
            ("duration", "Dental triage", "How long has this been present?", "duration", [], "Duration helps triage urgency."),
            ("red_flags", "Red flags", "Any facial swelling, fever, difficulty swallowing/breathing, trismus, trauma, or uncontrolled bleeding?", "multi_choice", ["Facial swelling", "Fever", "Difficulty swallowing/breathing", "Trismus", "Trauma", "Uncontrolled bleeding", "None"], "Screens urgent dental red flags."),
            ("medical_risk", "Context", "Any diabetes, immunosuppression, pregnancy, blood thinner use, or drug allergy?", "multi_choice", ["Diabetes", "Immunosuppression", "Pregnancy", "Blood thinners", "Drug allergy", "None"], "Medical context affects dental care."),
        ],
    }
    rows = rows_by_category.get(category, rows_by_category["general_dental_complaint"])
    modules = [
        ClinicalAssistantModuleSuggestion(module="attachments", reason="Add dental photos, radiographs, or procedure images if available."),
        ClinicalAssistantModuleSuggestion(module="medicines", reason="Review analgesics, antibiotics, allergies, and current medicines."),
    ]
    if category in {"facial_swelling_or_infection", "dental_trauma", "post_procedure_follow_up"}:
        modules.append(ClinicalAssistantModuleSuggestion(module="vitals", reason="Record vitals if systemic symptoms, trauma, or infection concern is present."))
    return ClinicalQuestionsResponse(
        assistant_specialty="dentistry",
        complaint_category=category,
        detected_factors=[category],
        questions=[_question_from_row(row, high_priority_groups={"Red flags"}) for row in rows],
        module_suggestions=modules,
        used_fallback=bool(warning),
        warning=warning,
    )


def build_fallback_pediatrics_analysis(
    reason_text: str,
    answers: list[ClinicalAssistantAnswer],
    warning: str | None = None,
) -> ClinicalAnalysisResponse:
    category = _fallback_pediatrics_category(reason_text)
    return ClinicalAnalysisResponse(
        assistant_specialty="pediatrics",
        possibilities=[
            {
                "label": "Common pediatric infectious or inflammatory illness",
                "likelihood": "consider",
                "why": "The presenting concern may fit a routine pediatric illness depending on fever pattern, hydration, respiratory effort, and activity.",
                "what_to_check": "Age, vitals, hydration, feeding/urine output, activity level, and focused system findings.",
            },
            {
                "label": "Pediatric red-flag condition",
                "likelihood": "rule_out",
                "why": "Breathing difficulty, dehydration, lethargy, seizures, non-blanching rash, severe pain, or poor feeding change urgency.",
                "what_to_check": "Danger signs, work of breathing, perfusion, hydration, neurologic status, and rash features.",
            },
        ],
        red_flags=[
            {"label": "Respiratory distress", "severity": "urgent", "present": None},
            {"label": "Dehydration or poor feeding/reduced urine", "severity": "urgent", "present": None},
            {"label": "Lethargy, seizure, or altered responsiveness", "severity": "urgent", "present": None},
            {"label": "Non-blanching rash, neck stiffness, or severe pain", "severity": "urgent", "present": None},
        ],
        suggested_tests=["Age-appropriate vitals", "Hydration and perfusion assessment", "Focused system exam"],
        documentation_gaps=["Age and weight", "Hydration/urine output", "Activity level", "Respiratory effort", "Fever duration/peak"],
        module_suggestions=["vitals", "pediatric_follow_up_plan"],
        note_additions=_assistant_note_additions(answers),
        used_fallback=bool(warning),
        warning=warning,
    )


def build_fallback_general_analysis(
    reason_text: str,
    answers: list[ClinicalAssistantAnswer],
    warning: str | None = None,
) -> ClinicalAnalysisResponse:
    category = _fallback_general_category(reason_text)
    return ClinicalAnalysisResponse(
        assistant_specialty="general_physician",
        possibilities=[
            {
                "label": "Primary-care complaint requiring focused assessment",
                "likelihood": "contextual",
                "why": "The current information supports triage and documentation guidance rather than a final diagnosis.",
                "what_to_check": "Vitals, duration, associated symptoms, medication/allergy history, comorbidities, and focused exam.",
            },
            {
                "label": "Urgent red-flag condition",
                "likelihood": "rule_out",
                "why": "Chest pain, shortness of breath, altered mental status, severe dehydration, neurologic deficit, syncope, severe allergic reaction, or pregnancy-related concern requires escalation.",
                "what_to_check": "Document presence or absence of relevant red flags and vital signs.",
            },
        ],
        red_flags=[
            {"label": "Chest pain or shortness of breath", "severity": "urgent", "present": None},
            {"label": "Altered mental status, syncope, seizure, or focal neurologic deficit", "severity": "urgent", "present": None},
            {"label": "Severe dehydration, severe abdominal pain, or persistent vomiting", "severity": "urgent", "present": None},
            {"label": "Pregnancy-related concern or severe allergic reaction", "severity": "urgent", "present": None},
        ],
        suggested_tests=["Vitals", "Focused examination", "Medication and allergy review"],
        documentation_gaps=["Duration/onset", "Vitals", "Red-flag review", "Past history/comorbidities", "Current medications/allergies"],
        module_suggestions=["vitals", "medicines"],
        note_additions=_assistant_note_additions(answers),
        used_fallback=bool(warning),
        warning=warning,
    )


def build_fallback_dentistry_analysis(
    reason_text: str,
    answers: list[ClinicalAssistantAnswer],
    warning: str | None = None,
) -> ClinicalAnalysisResponse:
    category = _fallback_dentistry_category(reason_text)
    return ClinicalAnalysisResponse(
        assistant_specialty="dentistry",
        possibilities=[
            {
                "label": "Dental complaint requiring focused oral assessment",
                "likelihood": "contextual",
                "why": "The current information supports dental triage and documentation guidance rather than a final diagnosis.",
                "what_to_check": "Tooth/site, duration, pain triggers, swelling, oral exam findings, photos/radiographs if available, medical risks, and allergies.",
            },
            {
                "label": "Odontogenic infection or urgent dental complication",
                "likelihood": "rule_out",
                "why": "Facial swelling, fever, trismus, difficulty swallowing/breathing, spreading infection, trauma, or uncontrolled bleeding changes urgency.",
                "what_to_check": "Swelling spread, airway/swallowing, mouth opening, vitals, trauma timing, bleeding, and medical risk factors.",
            },
        ],
        red_flags=[
            {"label": "Facial swelling, fever, or systemic toxicity", "severity": "urgent", "present": None},
            {"label": "Difficulty breathing/swallowing or trismus", "severity": "urgent", "present": None},
            {"label": "Rapidly spreading infection or immunocompromised/diabetes risk", "severity": "urgent", "present": None},
            {"label": "Avulsed permanent tooth, jaw trauma, or uncontrolled bleeding", "severity": "urgent", "present": None},
        ],
        suggested_tests=["Focused oral exam", "Dental photo/radiograph attachment if available", "Vitals if systemic symptoms or infection concern", "Medication and allergy review"],
        documentation_gaps=["Tooth/site", "Duration", "Pain triggers", "Swelling/systemic symptoms", "Medical risk/allergy history", "Dental photo or radiograph status"],
        module_suggestions=["attachments", "medicines", "vitals"],
        note_additions=_assistant_note_additions(answers),
        used_fallback=bool(warning),
        warning=warning,
    )


def build_fallback_clinical_questions(
    clinic_specialty: str | None,
    reason_text: str,
    warning: str | None = None,
) -> ClinicalQuestionsResponse:
    specialty = _normalize_clinical_specialty(clinic_specialty)
    if specialty == "optometry":
        return build_fallback_optometry_questions(reason_text, warning)
    if specialty == "pediatrics":
        return build_fallback_pediatrics_questions(reason_text, warning)
    if specialty == "dentistry":
        return build_fallback_dentistry_questions(reason_text, warning)
    return build_fallback_general_questions(reason_text, warning)


def build_fallback_clinical_analysis(
    clinic_specialty: str | None,
    reason_text: str,
    answers: list[ClinicalAssistantAnswer],
    warning: str | None = None,
) -> ClinicalAnalysisResponse:
    specialty = _normalize_clinical_specialty(clinic_specialty)
    if specialty == "optometry":
        return build_fallback_optometry_analysis(reason_text, answers, warning)
    if specialty == "pediatrics":
        return build_fallback_pediatrics_analysis(reason_text, answers, warning)
    if specialty == "dentistry":
        return build_fallback_dentistry_analysis(reason_text, answers, warning)
    return build_fallback_general_analysis(reason_text, answers, warning)


_QUESTION_SPECIALTY_INSTRUCTIONS: dict[ClinicalAssistantSpecialty, dict[str, str]] = {
    "optometry": {
        "label": "optometry",
        "categories": "red_eye | blurred_vision | contact_lens_issue | headache_eye_strain | myopia_progression | dry_eye | general_eye_complaint",
        "modules": "eye_exam, contact_lens, binocular_vision, low_vision, myopia_management, attachments, medicines, vitals",
        "focus": "Ask red-flag and optometry history questions. Focus on laterality, onset, vision change, pain, photophobia, contact lens risk, trauma, flashes/floaters/curtain, and relevant exam modules.",
    },
    "pediatrics": {
        "label": "pediatrics",
        "categories": "pediatric_fever | pediatric_respiratory | pediatric_gastroenteritis | pediatric_rash | pediatric_growth_or_feeding | general_pediatric_complaint",
        "modules": "pediatric_growth_measurement, well_child_visit, parent_handout_request, pediatric_follow_up_plan, attachments, medicines, vitals",
        "focus": "Ask age-aware pediatric history and red-flag questions. Focus on feeding, urine output, hydration, activity, respiratory effort, fever pattern, rash danger signs, seizures, lethargy, severe pain, safeguarding concern, and growth context where relevant.",
    },
    "general_physician": {
        "label": "general primary care",
        "categories": "fever | respiratory | gastrointestinal | cardiorespiratory_red_flag | neurologic | general_primary_care_complaint",
        "modules": "attachments, medicines, vitals",
        "focus": "Ask conservative primary-care triage questions. Focus on onset, duration, vitals, medication/allergy history, comorbidities, pregnancy risk, and red flags such as chest pain, shortness of breath, altered mental status, severe dehydration, focal neurologic deficit, syncope, severe abdominal pain, high fever with toxicity, and severe allergic reaction.",
    },
    "dentistry": {
        "label": "dentistry",
        "categories": "tooth_pain | gum_issue | dental_trauma | facial_swelling_or_infection | post_procedure_follow_up | orthodontic_or_appliance_issue | general_dental_complaint",
        "modules": "attachments, medicines, vitals",
        "focus": "Ask dental triage questions. Focus on tooth/site, pain triggers, swelling or infection, gum symptoms, dental trauma timing, post-procedure concerns, braces/aligners/appliance issues, dental photos or radiographs, medicines, allergies, and urgent dental red flags.",
    },
}


_ANALYSIS_RED_FLAGS: dict[ClinicalAssistantSpecialty, str] = {
    "optometry": "- sudden vision loss\n- severe pain\n- photophobia\n- contact lens red eye\n- trauma or foreign body\n- flashes, floaters, curtain\n- corneal opacity\n- chemical injury",
    "pediatrics": "- respiratory distress\n- dehydration or poor feeding/reduced urine\n- lethargy, seizure, or altered responsiveness\n- persistent high fever/toxic appearance\n- non-blanching rash\n- severe abdominal pain\n- neck stiffness\n- safeguarding concern",
    "general_physician": "- chest pain\n- shortness of breath\n- altered mental status\n- severe dehydration\n- focal neurologic deficit\n- severe abdominal pain\n- high fever with toxicity\n- pregnancy-related concern\n- syncope\n- severe allergic reaction",
    "dentistry": "- facial swelling\n- fever or systemic toxicity\n- difficulty breathing or swallowing\n- trismus\n- rapidly spreading infection\n- uncontrolled bleeding\n- avulsed permanent tooth or dental trauma\n- immunocompromised or diabetes risk",
}


def _sanitize_clinical_payload(parsed: dict[str, Any], *, specialty: ClinicalAssistantSpecialty, analysis: bool) -> dict[str, Any]:
    sanitized = dict(parsed)
    sanitized["assistant_specialty"] = specialty
    allowed_modules = set(_QUESTION_SPECIALTY_INSTRUCTIONS[specialty]["modules"].replace(" ", "").split(","))
    if analysis:
        raw_modules = sanitized.get("module_suggestions") or []
        sanitized["module_suggestions"] = [
            module for module in raw_modules if str(module) in allowed_modules
        ][:8]
    else:
        raw_suggestions = sanitized.get("module_suggestions") or []
        suggestions: list[dict[str, str]] = []
        for suggestion in raw_suggestions:
            if isinstance(suggestion, dict):
                module = str(suggestion.get("module") or "")
                if module in allowed_modules:
                    suggestions.append({"module": module, "reason": str(suggestion.get("reason") or "")})
        sanitized["module_suggestions"] = suggestions[:6]
    return sanitized


async def generate_clinical_questions(
    repo: AppRepository,
    org_id: str,
    *,
    clinic_specialty: str | None,
    patient_context: str,
    clinic_context: str,
    consultation_context: str,
    measurement_context: str,
) -> ClinicalQuestionsResponse:
    specialty = _normalize_clinical_specialty(clinic_specialty)
    settings = get_settings()
    reason_text = "\n".join([patient_context, consultation_context])
    if not str(settings.gemini_model or "").strip():
        return build_fallback_clinical_questions(specialty, reason_text, f"AI unavailable, used fallback {specialty} questions.")

    profile = _QUESTION_SPECIALTY_INSTRUCTIONS[specialty]
    prompt = f"""
Return JSON only for a {profile["label"]} clinical assistant.
Generate focused, case-specific questions from the queue reason and current consultation draft.
Do not diagnose. Do not recommend treatment. {profile["focus"]}
Use only these question types: yes_no, single_choice, multi_choice, short_text, number, duration, module_request.
Use only these modules: {profile["modules"]}.
Return at most 8 questions.

JSON shape:
{{
  "assistant_specialty": "{specialty}",
  "complaint_category": "{profile["categories"]}",
  "detected_factors": ["short factor"],
  "questions": [
    {{
      "id": "stable_snake_case",
      "group": "Red flags",
      "label": "Question text?",
      "type": "single_choice",
      "priority": "high",
      "options": ["No", "Yes", "Not asked"],
      "rationale": "Why this matters"
    }}
  ],
  "module_suggestions": [
    {{"module": "vitals", "reason": "Why this module helps"}}
  ],
  "safety_notice": "For clinician review only. Not a diagnosis."
}}

Clinic context:
{clinic_context or 'Not provided'}

Patient context:
{patient_context or 'Not provided'}

Current consultation draft:
{consultation_context or 'Not provided'}

Structured/module context:
{measurement_context or 'Not provided'}
""".strip()
    try:
        response = await _generate_vertex_content(
            project_id=settings.google_cloud_project,
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            max_output_tokens=2048,
            temperature=0.15,
            thinking_budget=0,
            response_mime_type="application/json",
            system_instruction=(
                f"You are a {profile['label']} clinical question assistant. "
                "Return valid JSON only. Do not diagnose or recommend treatment."
            ),
            prompt=prompt,
        )
        generated_text = _extract_text_from_vertex_response(response)
        if _has_max_tokens_finish(response) or not generated_text:
            return build_fallback_clinical_questions(specialty, reason_text, f"AI returned incomplete content, used fallback {specialty} questions.")
        parsed = _sanitize_clinical_payload(_extract_json_object(generated_text), specialty=specialty, analysis=False)
        result = ClinicalQuestionsResponse.model_validate(parsed)
    except Exception:
        logger.exception("Vertex AI %s clinical questions failed; returning fallback.", specialty)
        return build_fallback_clinical_questions(specialty, reason_text, f"AI unavailable, used fallback {specialty} questions.")

    await record_model_usage(
        repo,
        org_id=org_id,
        provider="gemini",
        model=settings.gemini_model,
        feature=f"clinical_questions_{specialty}",
        response=response,
        metadata={"assistant_specialty": specialty, "has_measurements_context": bool(measurement_context)},
    )
    return result


async def generate_clinical_analysis(
    repo: AppRepository,
    org_id: str,
    *,
    clinic_specialty: str | None,
    patient_context: str,
    clinic_context: str,
    consultation_context: str,
    measurement_context: str,
    answers: list[ClinicalAssistantAnswer],
) -> ClinicalAnalysisResponse:
    specialty = _normalize_clinical_specialty(clinic_specialty)
    settings = get_settings()
    reason_text = "\n".join([patient_context, consultation_context])
    if not str(settings.gemini_model or "").strip():
        return build_fallback_clinical_analysis(specialty, reason_text, answers, f"AI unavailable, used fallback {specialty} analysis.")

    profile = _QUESTION_SPECIALTY_INSTRUCTIONS[specialty]
    answer_context = "\n".join(f"- {answer.label}: {answer.answer}" for answer in answers if answer.answer.strip())
    prompt = f"""
Return JSON only for a {profile["label"]} clinical reasoning support assistant.
Use the current consultation draft and answered questions to provide clinician-review support.
Do not state a final diagnosis. Do not recommend treatment. Do not invent examination findings.
Use wording such as consider, fits with, rule out, and what to check.
Use only these modules: {profile["modules"]}.

JSON shape:
{{
  "assistant_specialty": "{specialty}",
  "possibilities": [
    {{
      "label": "Possible consideration",
      "likelihood": "likely | consider | rule_out | contextual",
      "why": "Why this fits or may fit",
      "what_to_check": "Specific history/exam/module data to check"
    }}
  ],
  "red_flags": [
    {{"label": "Short label", "severity": "urgent", "present": null}}
  ],
  "suggested_tests": ["Vitals"],
  "documentation_gaps": ["Duration not recorded"],
  "module_suggestions": ["vitals"],
  "note_additions": "Brief note-ready Q&A summary, not a diagnosis.",
  "safety_notice": "For clinician review only. Not a diagnosis."
}}

Required red-flag screening concepts:
{_ANALYSIS_RED_FLAGS[specialty]}

Clinic context:
{clinic_context or 'Not provided'}

Patient context:
{patient_context or 'Not provided'}

Current consultation draft:
{consultation_context or 'Not provided'}

Structured/module context:
{measurement_context or 'Not provided'}

Answered assistant questions:
{answer_context or 'No answers provided'}
""".strip()
    try:
        response = await _generate_vertex_content(
            project_id=settings.google_cloud_project,
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            max_output_tokens=2048,
            temperature=0.15,
            thinking_budget=0,
            response_mime_type="application/json",
            system_instruction=(
                f"You are a {profile['label']} clinical reasoning support assistant. "
                "Return valid JSON only. Do not provide final diagnosis or treatment."
            ),
            prompt=prompt,
        )
        generated_text = _extract_text_from_vertex_response(response)
        if _has_max_tokens_finish(response) or not generated_text:
            return build_fallback_clinical_analysis(specialty, reason_text, answers, f"AI returned incomplete content, used fallback {specialty} analysis.")
        parsed = _sanitize_clinical_payload(_extract_json_object(generated_text), specialty=specialty, analysis=True)
        result = ClinicalAnalysisResponse.model_validate(parsed)
    except Exception:
        logger.exception("Vertex AI %s clinical analysis failed; returning fallback.", specialty)
        return build_fallback_clinical_analysis(specialty, reason_text, answers, f"AI unavailable, used fallback {specialty} analysis.")

    await record_model_usage(
        repo,
        org_id=org_id,
        provider="gemini",
        model=settings.gemini_model,
        feature=f"clinical_analysis_{specialty}",
        response=response,
        metadata={"assistant_specialty": specialty, "answer_count": len(answers), "has_measurements_context": bool(measurement_context)},
    )
    return result


async def generate_optometry_clinical_questions(
    repo: AppRepository,
    org_id: str,
    *,
    patient_context: str,
    clinic_context: str,
    consultation_context: str,
    measurement_context: str,
) -> ClinicalQuestionsResponse:
    settings = get_settings()
    reason_text = "\n".join([patient_context, consultation_context])
    if not str(settings.gemini_model or "").strip():
        return build_fallback_optometry_questions(reason_text, "AI unavailable, used fallback optometry questions.")

    prompt = f"""
Return JSON only for an optometry clinical assistant.
Generate focused, case-specific questions from the queue reason and current consultation draft.
Do not diagnose. Do not recommend treatment. Ask red-flag and optometry history questions.
Use only these question types: yes_no, single_choice, multi_choice, short_text, number, duration, module_request.
Use only these modules: eye_exam, contact_lens, binocular_vision, low_vision, myopia_management, attachments, medicines, vitals.
Return at most 8 questions.

JSON shape:
{{
  "complaint_category": "red_eye | blurred_vision | contact_lens_issue | headache_eye_strain | myopia_progression | dry_eye | general_eye_complaint",
  "detected_factors": ["short factor"],
  "questions": [
    {{
      "id": "stable_snake_case",
      "group": "Red flags",
      "label": "Question text?",
      "type": "single_choice",
      "priority": "high",
      "options": ["No", "Yes", "Not asked"],
      "rationale": "Why this matters"
    }}
  ],
  "module_suggestions": [
    {{"module": "eye_exam", "reason": "Why this module helps"}}
  ],
  "safety_notice": "For clinician review only. Not a diagnosis."
}}

Clinic context:
{clinic_context or 'Not provided'}

Patient context:
{patient_context or 'Not provided'}

Current consultation draft:
{consultation_context or 'Not provided'}

Structured optometry/module context:
{measurement_context or 'Not provided'}
""".strip()
    try:
        response = await _generate_vertex_content(
            project_id=settings.google_cloud_project,
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            max_output_tokens=2048,
            temperature=0.15,
            thinking_budget=0,
            response_mime_type="application/json",
            system_instruction=(
                "You are an optometry clinical question assistant. "
                "Return valid JSON only. Do not diagnose or recommend treatment."
            ),
            prompt=prompt,
        )
        generated_text = _extract_text_from_vertex_response(response)
        if _has_max_tokens_finish(response) or not generated_text:
            return build_fallback_optometry_questions(reason_text, "AI returned incomplete content, used fallback optometry questions.")
        parsed = _extract_json_object(generated_text)
        result = ClinicalQuestionsResponse.model_validate(parsed)
        result.assistant_specialty = "optometry"
    except Exception:
        logger.exception("Vertex AI optometry clinical questions failed; returning fallback.")
        return build_fallback_optometry_questions(reason_text, "AI unavailable, used fallback optometry questions.")

    await record_model_usage(
        repo,
        org_id=org_id,
        provider="gemini",
        model=settings.gemini_model,
        feature="clinical_questions_optometry",
        response=response,
        metadata={"has_measurements_context": bool(measurement_context)},
    )
    return result


async def generate_optometry_clinical_analysis(
    repo: AppRepository,
    org_id: str,
    *,
    patient_context: str,
    clinic_context: str,
    consultation_context: str,
    measurement_context: str,
    answers: list[ClinicalAssistantAnswer],
) -> ClinicalAnalysisResponse:
    settings = get_settings()
    reason_text = "\n".join([patient_context, consultation_context])
    if not str(settings.gemini_model or "").strip():
        return build_fallback_optometry_analysis(reason_text, answers, "AI unavailable, used fallback optometry analysis.")

    answer_context = "\n".join(f"- {answer.label}: {answer.answer}" for answer in answers if answer.answer.strip())
    prompt = f"""
Return JSON only for an optometry clinical reasoning support assistant.
Use the current consultation draft and answered questions to provide clinician-review support.
Do not state a final diagnosis. Do not recommend treatment. Do not invent examination findings.
Use wording such as consider, fits with, rule out, and what to check.

JSON shape:
{{
  "possibilities": [
    {{
      "label": "Possible consideration",
      "likelihood": "likely | consider | rule_out | contextual",
      "why": "Why this fits or may fit",
      "what_to_check": "Specific optometry history/exam/module data to check"
    }}
  ],
  "red_flags": [
    {{"label": "Sudden vision loss", "severity": "urgent", "present": false}}
  ],
  "suggested_tests": ["Visual acuity"],
  "documentation_gaps": ["Contact lens use not recorded"],
  "module_suggestions": ["eye_exam"],
  "note_additions": "Brief note-ready Q&A summary, not a diagnosis.",
  "safety_notice": "For clinician review only. Not a diagnosis."
}}

Required red-flag screening concepts:
- sudden vision loss
- severe pain
- photophobia
- contact lens red eye
- trauma or foreign body
- flashes, floaters, curtain
- corneal opacity
- chemical injury

Clinic context:
{clinic_context or 'Not provided'}

Patient context:
{patient_context or 'Not provided'}

Current consultation draft:
{consultation_context or 'Not provided'}

Structured optometry/module context:
{measurement_context or 'Not provided'}

Answered assistant questions:
{answer_context or 'No answers provided'}
""".strip()
    try:
        response = await _generate_vertex_content(
            project_id=settings.google_cloud_project,
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            max_output_tokens=2048,
            temperature=0.15,
            thinking_budget=0,
            response_mime_type="application/json",
            system_instruction=(
                "You are an optometry clinical reasoning support assistant. "
                "Return valid JSON only. Do not provide final diagnosis or treatment."
            ),
            prompt=prompt,
        )
        generated_text = _extract_text_from_vertex_response(response)
        if _has_max_tokens_finish(response) or not generated_text:
            return build_fallback_optometry_analysis(reason_text, answers, "AI returned incomplete content, used fallback optometry analysis.")
        parsed = _extract_json_object(generated_text)
        result = ClinicalAnalysisResponse.model_validate(parsed)
        result.assistant_specialty = "optometry"
    except Exception:
        logger.exception("Vertex AI optometry clinical analysis failed; returning fallback.")
        return build_fallback_optometry_analysis(reason_text, answers, "AI unavailable, used fallback optometry analysis.")

    await record_model_usage(
        repo,
        org_id=org_id,
        provider="gemini",
        model=settings.gemini_model,
        feature="clinical_analysis_optometry",
        response=response,
        metadata={"answer_count": len(answers), "has_measurements_context": bool(measurement_context)},
    )
    return result


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
    response_mime_type: str | None = None,
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
    if response_mime_type:
        payload["generationConfig"]["responseMimeType"] = response_mime_type
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=VERTEX_AI_TIMEOUT_SECONDS) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise
        parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("Vertex AI JSON response must be an object.")
    return parsed


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
