from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.schema_domains.clinical_assistant import ClinicalAssistantAnswer
from app.services import ai_generation_service


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _Repo:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def create_ai_usage_event(self, **payload):
        self.events.append(payload)
        return payload


def test_gemini_35_uses_medium_thinking_without_legacy_sampling():
    config = ai_generation_service._vertex_generation_config(
        model="gemini-3.5-flash",
        max_output_tokens=2048,
        temperature=0.35,
        thinking_budget=0,
    )

    assert config == {
        "maxOutputTokens": 2048,
        "thinkingConfig": {"thinkingLevel": "medium"},
    }


def test_note_normalization_preserves_exact_structured_medication_regimen():
    normalized = ai_generation_service._normalize_note_content(
        """Presenting Complaint:\nFever.\n\nDiagnosis:\nViral illness.\n\nClinical Notes:\nHydration advised.\n\nTreatment:\nParacetamol was prescribed.\n\nFollow-up Advice:\nReview if worse.""",
        symptoms="Fever",
        diagnosis="Viral illness",
        medications=(
            "Prescribed medicines:\n"
            "Medicine | Quantity | Schedule | Duration | Notes\n"
            "--- | --- | --- | --- | ---\n"
            "Paracetamol 500 mg | 10 tablets | Morning and night | 5 days | After food"
        ),
        notes="Hydration advised.",
    )

    assert "Paracetamol 500 mg" in normalized
    assert "10 tablets" in normalized
    assert "Morning and night" in normalized
    assert "5 days" in normalized
    assert "After food" in normalized


def test_note_normalization_preserves_structured_eye_exam_table_with_generated_prose():
    normalized = ai_generation_service._normalize_note_content(
        """Presenting Complaint:\nBlurred vision.\n\nDiagnosis:\nRefractive error.\n\nClinical Notes:\nThe patient reports intermittent blur while reading.\n\nTreatment:\nSpectacle correction discussed.\n\nFollow-up Advice:\nReview if symptoms worsen.""",
        symptoms="Blurred vision",
        diagnosis="Refractive error",
        medications="Spectacle correction discussed.",
        notes="The patient reports intermittent blur while reading.",
        measurements_context=(
            "Eye Exam:\n"
            "Eye | Sphere | Cylinder | Axis | Vision\n"
            "--- | --- | --- | --- | ---\n"
            "Right | -1.25 | -0.50 | 90 | 6/6\n"
            "Left | -1.00 | -0.25 | 85 | 6/6"
        ),
    )

    assert "Clinical Notes:\nEye Exam:" in normalized
    assert "Eye | Sphere | Cylinder | Axis | Vision" in normalized
    assert "Right | -1.25 | -0.50 | 90 | 6/6" in normalized
    assert "The patient reports intermittent blur while reading." in normalized
    assert normalized.index("Eye Exam:") < normalized.index("The patient reports intermittent blur while reading.")


async def _fake_generate_vertex_content(**_kwargs):
    return {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": "Generated response"}],
                }
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 123,
            "candidatesTokenCount": 45,
            "cachedContentTokenCount": 7,
        },
    }


@pytest.mark.anyio
async def test_generate_soap_note_records_org_ai_usage(monkeypatch):
    repo = _Repo()
    seen_kwargs = {}

    async def _fake_generate_note_content(**kwargs):
        seen_kwargs.update(kwargs)
        return {
            "candidates": [{
                "content": {"parts": [{"text": """{
                  \"note_sections\": {
                    \"presenting_complaint\": \"Fever\",
                    \"diagnosis\": \"Viral infection\",
                    \"clinical_notes\": \"Rest well\",
                    \"treatment\": \"Paracetamol advised\",
                    \"follow_up_advice\": \"Review if worse\"
                  },
                  \"services_performed\": [],
                  \"medications_prescribed\": []
                }"""}]}
            }],
            "usageMetadata": {
                "promptTokenCount": 123,
                "candidatesTokenCount": 45,
                "cachedContentTokenCount": 7,
            },
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_generate_note_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_soap_note(
        repo,
        "org-1",
        symptoms="Fever",
        diagnosis="Viral infection",
        medications="Paracetamol",
        notes="Rest well",
        patient_context="Name: Test Patient",
        clinic_context="Clinic Name: Demo Clinic",
        measurements_context="Temperature: 101 F",
    )

    assert "Presenting Complaint:" in result["content"]
    assert "Fever" in result["content"]
    assert "Diagnosis:" in result["content"]
    assert result["used_fallback"] is False
    assert seen_kwargs["max_output_tokens"] == 4096
    assert seen_kwargs["thinking_budget"] == 0
    assert len(repo.events) == 1
    event = repo.events[0]
    assert event["org_id"] == "org-1"
    assert event["provider"] == "gemini"
    assert event["model"] == "gemini-test"
    assert event["feature"] == "consultation_note"
    assert event["input_tokens"] == 123
    assert event["output_tokens"] == 45
    assert event["cache_read_input_tokens"] == 7


@pytest.mark.anyio
async def test_generate_soap_note_discards_truncated_vertex_output(monkeypatch):
    repo = _Repo()

    async def _fake_truncated_note_content(**_kwargs):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "Presenting Complaint:\nFever"}],
                    },
                    "finishReason": "MAX_TOKENS",
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 123,
                "candidatesTokenCount": 8,
            },
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_truncated_note_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_soap_note(
        repo,
        "org-1",
        symptoms="Fever",
        diagnosis="Viral infection",
        medications="Paracetamol",
        notes="Rest well",
    )

    assert result["used_fallback"] is True
    assert result["warning"] == "AI returned incomplete content, used fallback template."
    assert "Presenting Complaint:" in result["content"]
    assert "Fever" in result["content"]
    assert len(repo.events) == 2
    assert all(event["feature"] == "consultation_note" for event in repo.events)
    assert all(event["output_tokens"] == 8 for event in repo.events)


@pytest.mark.anyio
async def test_generate_clinic_letter_records_org_ai_usage(monkeypatch):
    repo = _Repo()
    seen_kwargs = {}

    async def _fake_generate_letter_content(**kwargs):
        seen_kwargs.update(kwargs)
        return await _fake_generate_vertex_content(**kwargs)

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_generate_letter_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    content = await ai_generation_service.generate_clinic_letter(
        repo,
        "org-2",
        to="Patient",
        subject="Follow-up",
        content="Please continue treatment.",
        clinic_context="Clinic Name: Demo Clinic",
    )

    assert content == "Generated response"
    assert seen_kwargs["max_output_tokens"] == 2048
    assert seen_kwargs["thinking_budget"] == 0
    assert len(repo.events) == 1
    event = repo.events[0]
    assert event["org_id"] == "org-2"
    assert event["feature"] == "clinic_letter"
    assert event["model"] == "gemini-test"


@pytest.mark.anyio
async def test_generate_clinic_letter_discards_truncated_vertex_output(monkeypatch):
    repo = _Repo()

    async def _fake_truncated_letter_content(**_kwargs):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "To: RIT\nSubject: Medical Certificate for Leave\n\nThis"}],
                    },
                    "finishReason": "MAX_TOKENS",
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 123,
                "candidatesTokenCount": 8,
            },
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_truncated_letter_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    content = await ai_generation_service.generate_clinic_letter(
        repo,
        "org-2",
        to="RIT",
        subject="Medical Certificate for Leave",
        content="This patient requires leave.",
        clinic_context="Doctor Name: Dr. Demo",
    )

    assert content == (
        "To: RIT\n"
        "Subject: Medical Certificate for Leave\n\n"
        "Dear Sir/Madam,\n\n"
        "This patient requires leave.\n\n"
        "Please feel free to contact the clinic if any further clarification is required.\n\n"
        "Sincerely,\n"
        "Dr. Demo"
    )
    assert len(repo.events) == 1
    assert repo.events[0]["feature"] == "clinic_letter"
    assert repo.events[0]["output_tokens"] == 8


@pytest.mark.anyio
async def test_fallback_generation_does_not_record_ai_usage(monkeypatch):
    repo = _Repo()
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="",
            google_cloud_location="global",
            gemini_model="",
        ),
    )

    result = await ai_generation_service.generate_soap_note(
        repo,
        "org-3",
        symptoms="",
        diagnosis="",
        medications="",
        notes="",
    )

    assert "Presenting Complaint:" in result["content"]
    assert result["used_fallback"] is True
    assert repo.events == []


@pytest.mark.anyio
async def test_patient_summary_uses_vertex_json_paragraph_contract(monkeypatch):
    repo = _Repo()
    seen_kwargs = {}

    async def _fake_summary_content(**kwargs):
        seen_kwargs.update(kwargs)
        return {
            "candidates": [{"content": {"parts": [{"text": '{"summary":"The latest visit addressed persistent fever, with hydration and paracetamol documented. The preceding visit recorded the same complaint, supporting a short recurrent pattern and planned clinical review."}' }]}}],
            "usageMetadata": {"promptTokenCount": 80, "candidatesTokenCount": 32},
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_summary_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_patient_summary(
        repo,
        "org-1",
        source_context={"recent_visits": [{"reason": "fever", "consultation_note": "Hydration and paracetamol."}]},
    )

    assert result["used_fallback"] is False
    assert "\n" not in result["content"]
    assert not result["content"].startswith("-")
    assert seen_kwargs["response_mime_type"] == "application/json"
    assert seen_kwargs["max_output_tokens"] == 256
    assert seen_kwargs["temperature"] == 0.2
    assert repo.events[0]["metadata"]["rolling_visit_limit"] == 2


def test_normalized_note_strips_pipe_tables_from_generated_content():
    content = ai_generation_service._normalize_note_content(
        """
Presenting Complaint:
Dry cough since yesterday.

Diagnosis:
Viral URI.

Clinical Notes:
Field | Value
--- | ---
Template Key | well_visit_summary

Field | Value
--- | ---
Preset Key | routine_review

Patient appears well.

Treatment:
Paracetamol.

Follow-up Advice:
Review if worsening.
""",
        symptoms="Dry cough",
        diagnosis="Viral URI",
        medications="Paracetamol",
        notes="Patient appears well.",
    )

    assert "Field | Value" not in content
    assert "Template Key" not in content
    assert "Preset Key" not in content
    assert "well_visit_summary" not in content
    assert "routine_review" not in content
    assert "Patient appears well." in content


@pytest.mark.anyio
async def test_generate_optometry_clinical_questions_records_usage(monkeypatch):
    repo = _Repo()
    seen_kwargs = {}

    async def _fake_clinical_questions_content(**kwargs):
        seen_kwargs.update(kwargs)
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": """
                                {
                                  "complaint_category": "red_eye",
                                  "detected_factors": ["redness", "pain screening"],
                                  "questions": [
                                    {
                                      "id": "contact_lens_use",
                                      "group": "History",
                                      "label": "Does the patient use contact lenses?",
                                      "type": "yes_no",
                                      "priority": "high",
                                      "options": ["No", "Yes", "Not asked"],
                                      "rationale": "Contact lens red eye changes urgency."
                                    }
                                  ],
                                  "module_suggestions": [
                                    {"module": "eye_exam", "reason": "Check VA and anterior segment findings."}
                                  ],
                                  "safety_notice": "For clinician review only. Not a diagnosis."
                                }
                                """
                            }
                        ],
                    }
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 50,
                "candidatesTokenCount": 20,
            },
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_clinical_questions_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_optometry_clinical_questions(
        repo,
        "org-4",
        patient_context="Name: Test Patient\nReason: red eye",
        clinic_context="Specialty: optometry",
        consultation_context="Symptoms: red eye",
        measurement_context="",
    )

    assert result.complaint_category == "red_eye"
    assert result.questions[0].id == "contact_lens_use"
    assert seen_kwargs["response_mime_type"] == "application/json"
    assert seen_kwargs["thinking_budget"] == 0
    assert repo.events[0]["feature"] == "clinical_questions_optometry"


@pytest.mark.anyio
async def test_generate_optometry_clinical_analysis_falls_back_on_truncated_output(monkeypatch):
    repo = _Repo()

    async def _fake_truncated_analysis_content(**_kwargs):
        return {
            "candidates": [
                {
                    "content": {"parts": [{"text": "{\"possibilities\": ["}]},
                    "finishReason": "MAX_TOKENS",
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 80,
                "candidatesTokenCount": 5,
            },
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_truncated_analysis_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_optometry_clinical_analysis(
        repo,
        "org-5",
        patient_context="Name: Test Patient\nReason: blurred vision",
        clinic_context="Specialty: optometry",
        consultation_context="Symptoms: blurred vision",
        measurement_context="",
        answers=[ClinicalAssistantAnswer(question_id="duration", label="Duration", answer="2 days")],
    )

    assert result.used_fallback is True
    assert "fallback optometry analysis" in (result.warning or "")
    assert result.possibilities
    assert len(repo.events) == 1
    assert repo.events[0]["feature"] == "clinical_analysis_optometry"
    assert repo.events[0]["output_tokens"] == 5


@pytest.mark.anyio
async def test_generate_pediatrics_clinical_questions_records_usage(monkeypatch):
    repo = _Repo()

    async def _fake_pediatric_questions_content(**_kwargs):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": """
                                {
                                  "assistant_specialty": "pediatrics",
                                  "complaint_category": "pediatric_fever",
                                  "detected_factors": ["fever"],
                                  "questions": [
                                    {
                                      "id": "hydration",
                                      "group": "Red flags",
                                      "label": "Any reduced urine or poor feeding?",
                                      "type": "multi_choice",
                                      "priority": "high",
                                      "options": ["Reduced urine", "Poor feeding", "None"],
                                      "rationale": "Hydration changes urgency."
                                    }
                                  ],
                                  "module_suggestions": [
                                    {"module": "pediatric_follow_up_plan", "reason": "Set review timing."}
                                  ],
                                  "safety_notice": "For clinician review only. Not a diagnosis."
                                }
                                """
                            }
                        ]
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 40, "candidatesTokenCount": 18},
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_pediatric_questions_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_clinical_questions(
        repo,
        "org-6",
        clinic_specialty="pediatrics",
        patient_context="Name: Child\nReason: fever",
        clinic_context="Specialty: pediatrics",
        consultation_context="Symptoms: fever since 2 days",
        measurement_context="",
    )

    assert result.assistant_specialty == "pediatrics"
    assert result.questions[0].id == "hydration"
    assert result.module_suggestions[0].module == "pediatric_follow_up_plan"
    assert repo.events[0]["feature"] == "clinical_questions_pediatrics"


@pytest.mark.anyio
async def test_general_clinical_analysis_accepts_null_red_flag_present(monkeypatch):
    repo = _Repo()

    async def _fake_general_analysis_content(**_kwargs):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": """
                                {
                                  "assistant_specialty": "general_physician",
                                  "possibilities": [
                                    {
                                      "label": "Primary-care respiratory complaint",
                                      "likelihood": "contextual",
                                      "why": "Cough requires duration, vitals, and red-flag review.",
                                      "what_to_check": "Vitals and breathlessness."
                                    }
                                  ],
                                  "red_flags": [
                                    {"label": "Shortness of breath", "severity": "urgent", "present": null}
                                  ],
                                  "suggested_tests": ["Vitals"],
                                  "documentation_gaps": ["Duration"],
                                  "module_suggestions": ["vitals", "unknown_module"],
                                  "note_additions": "AI assistant Q&A:\\n- Duration: 2 days",
                                  "safety_notice": "For clinician review only. Not a diagnosis."
                                }
                                """
                            }
                        ]
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 60, "candidatesTokenCount": 30},
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_general_analysis_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_clinical_analysis(
        repo,
        "org-7",
        clinic_specialty="general_physician",
        patient_context="Name: Test Patient\nReason: cough",
        clinic_context="Specialty: general physician",
        consultation_context="Symptoms: cough",
        measurement_context="",
        answers=[ClinicalAssistantAnswer(question_id="duration", label="Duration", answer="2 days")],
    )

    assert result.assistant_specialty == "general_physician"
    assert result.red_flags[0].present is None
    assert result.module_suggestions == ["vitals"]
    assert repo.events[0]["feature"] == "clinical_analysis_general_physician"


@pytest.mark.anyio
async def test_unknown_specialty_uses_general_fallback_without_ai_usage(monkeypatch):
    repo = _Repo()
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="",
            google_cloud_location="global",
            gemini_model="",
        ),
    )

    result = await ai_generation_service.generate_clinical_questions(
        repo,
        "org-8",
        clinic_specialty="unknown",
        patient_context="Name: Test Patient\nReason: cough and fever",
        clinic_context="Specialty: unknown",
        consultation_context="Symptoms: cough and fever",
        measurement_context="",
    )

    assert result.assistant_specialty == "general_physician"
    assert result.questions
    assert repo.events == []


@pytest.mark.anyio
async def test_generate_dentistry_clinical_questions_records_usage(monkeypatch):
    repo = _Repo()

    async def _fake_dentistry_questions_content(**_kwargs):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": """
                                {
                                  "assistant_specialty": "dentistry",
                                  "complaint_category": "tooth_pain",
                                  "detected_factors": ["tooth pain"],
                                  "questions": [
                                    {
                                      "id": "pain_triggers",
                                      "group": "Pain history",
                                      "label": "Is pain triggered by hot, cold, sweet, or biting?",
                                      "type": "multi_choice",
                                      "priority": "medium",
                                      "options": ["Hot", "Cold", "Sweet", "Biting", "None"],
                                      "rationale": "Triggers help characterize dental pain."
                                    }
                                  ],
                                  "module_suggestions": [
                                    {"module": "attachments", "reason": "Attach dental photo or radiograph."}
                                  ],
                                  "safety_notice": "For clinician review only. Not a diagnosis."
                                }
                                """
                            }
                        ]
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 44, "candidatesTokenCount": 22},
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_dentistry_questions_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_clinical_questions(
        repo,
        "org-9",
        clinic_specialty="dentistry",
        patient_context="Name: Dental Patient\nReason: tooth pain",
        clinic_context="Specialty: dentistry",
        consultation_context="Symptoms: tooth pain with cold sensitivity",
        measurement_context="",
    )

    assert result.assistant_specialty == "dentistry"
    assert result.complaint_category == "tooth_pain"
    assert result.module_suggestions[0].module == "attachments"
    assert repo.events[0]["feature"] == "clinical_questions_dentistry"


@pytest.mark.anyio
async def test_dentistry_clinical_analysis_filters_modules_and_accepts_unknown_red_flags(monkeypatch):
    repo = _Repo()

    async def _fake_dentistry_analysis_content(**_kwargs):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": """
                                {
                                  "assistant_specialty": "dentistry",
                                  "possibilities": [
                                    {
                                      "label": "Dental infection concern",
                                      "likelihood": "rule_out",
                                      "why": "Swelling and fever need urgent screening.",
                                      "what_to_check": "Facial swelling, trismus, swallowing, and vitals."
                                    }
                                  ],
                                  "red_flags": [
                                    {"label": "Facial swelling", "severity": "urgent", "present": null}
                                  ],
                                  "suggested_tests": ["Oral exam", "Dental photo/radiograph"],
                                  "documentation_gaps": ["Tooth/site"],
                                  "module_suggestions": ["attachments", "vitals", "eye_exam"],
                                  "note_additions": "AI assistant Q&A:\\n- Site: lower molar",
                                  "safety_notice": "For clinician review only. Not a diagnosis."
                                }
                                """
                            }
                        ]
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 66, "candidatesTokenCount": 32},
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_dentistry_analysis_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_clinical_analysis(
        repo,
        "org-10",
        clinic_specialty="dentistry",
        patient_context="Name: Dental Patient\nReason: swelling",
        clinic_context="Specialty: dentistry",
        consultation_context="Symptoms: facial swelling",
        measurement_context="",
        answers=[ClinicalAssistantAnswer(question_id="site", label="Site", answer="lower molar")],
    )

    assert result.assistant_specialty == "dentistry"
    assert result.red_flags[0].present is None
    assert result.module_suggestions == ["attachments", "vitals"]
    assert repo.events[0]["feature"] == "clinical_analysis_dentistry"


@pytest.mark.anyio
async def test_dentistry_fallback_questions_without_ai_usage(monkeypatch):
    repo = _Repo()
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="",
            google_cloud_location="global",
            gemini_model="",
        ),
    )

    result = await ai_generation_service.generate_clinical_questions(
        repo,
        "org-11",
        clinic_specialty="dentistry",
        patient_context="Name: Dental Patient\nReason: braces wire poking",
        clinic_context="Specialty: dentistry",
        consultation_context="Symptoms: braces wire poking cheek",
        measurement_context="",
    )

    assert result.assistant_specialty == "dentistry"
    assert result.complaint_category == "orthodontic_or_appliance_issue"
    assert result.questions
    assert repo.events == []
