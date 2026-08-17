import type { ConsultationForm, PrescriptionDraft } from "@/features/consultation/model/consultation-form";
import { flattenEyeExamForNote } from "@/lib/structured-modules";
import type { GenerateNotePayload, StructuredModule } from "@/lib/types";

export function buildMedicationTreatmentPayload(medications: string, treatment: string) {
  const medicationText = medications.trim();
  const treatmentText = treatment.trim();
  if (medicationText && treatmentText) {
    return `Medications:\n${medicationText}\n\nTreatment:\n${treatmentText}`;
  }
  if (medicationText) {
    return `Medications:\n${medicationText}`;
  }
  if (treatmentText) {
    return `Treatment:\n${treatmentText}`;
  }
  return "";
}

export function prescriptionScheduleLabel(prescription: PrescriptionDraft) {
  const parts = [
    prescription.morning ? "Morning" : "",
    prescription.afternoon ? "Afternoon" : "",
    prescription.night ? "Night" : "",
  ].filter(Boolean);
  return parts.join(", ") || "As directed";
}

export function buildStructuredModulePayloads({
  form,
  currentModules,
  isPediatricsClinic,
}: {
  form: ConsultationForm;
  currentModules: StructuredModule[];
  isPediatricsClinic: boolean;
}): StructuredModule[] {
  const structuredModules = [...currentModules];
  if (isPediatricsClinic && form.growthMeasurement.height_cm && form.growthMeasurement.weight_kg) {
    structuredModules.push({
      module_type: "pediatric_growth_measurement",
      payload: {
        measured_at: new Date(form.growthMeasurement.measured_at).toISOString(),
        height_cm: Number(form.growthMeasurement.height_cm),
        weight_kg: Number(form.growthMeasurement.weight_kg),
        head_circumference_cm: form.growthMeasurement.head_circumference_cm
          ? Number(form.growthMeasurement.head_circumference_cm)
          : null,
        visit_notes: form.growthMeasurement.visit_notes.trim(),
      },
    });
  }
  if (isPediatricsClinic && (
    form.wellChildVisit.nutrition_summary.trim()
    || form.wellChildVisit.sleep_summary.trim()
    || form.wellChildVisit.elimination_summary.trim()
    || form.wellChildVisit.school_behavior_summary.trim()
    || form.wellChildVisit.parent_concerns.trim()
    || form.wellChildVisit.assessment_summary.trim()
  )) {
    structuredModules.push({
      module_type: "well_child_visit",
      payload: form.wellChildVisit,
    });
  }
  if (isPediatricsClinic && form.parentHandoutRequest.template_key.trim()) {
    structuredModules.push({
      module_type: "parent_handout_request",
      payload: {
        template_key: form.parentHandoutRequest.template_key,
        instructions: form.parentHandoutRequest.instructions,
      },
    });
  }
  if (isPediatricsClinic && (
    form.pediatricFollowUpPlan.preset_key.trim()
    || form.pediatricFollowUpPlan.suggested_interval.trim()
    || form.pediatricFollowUpPlan.notes.trim()
  )) {
    structuredModules.push({
      module_type: "pediatric_follow_up_plan",
      payload: form.pediatricFollowUpPlan,
    });
  }
  return structuredModules;
}

export function buildConsultationNotePayload({
  patientId,
  visitId,
  form,
  currentModules,
  isPediatricsClinic,
  currentNoteId,
  noteStatus,
  includeNoteId = false,
}: {
  patientId: string;
  visitId?: string | null;
  form: ConsultationForm;
  currentModules: StructuredModule[];
  isPediatricsClinic: boolean;
  currentNoteId: string;
  noteStatus: "draft" | "final" | "sent" | "";
  includeNoteId?: boolean;
}): GenerateNotePayload {
  const refreshingDraft = Boolean(includeNoteId && currentNoteId && noteStatus === "draft");
  return {
    note_id: refreshingDraft ? currentNoteId : undefined,
    patient_id: patientId,
    visit_id: visitId ?? null,
    symptoms: form.symptoms,
    diagnosis: form.diagnosis,
    medications: buildMedicationTreatmentPayload(form.medications, form.treatment),
    notes: form.notes,
    blood_pressure_systolic: form.bloodPressureSystolic ? Number(form.bloodPressureSystolic) : null,
    blood_pressure_diastolic: form.bloodPressureDiastolic ? Number(form.bloodPressureDiastolic) : null,
    pulse: form.pulse ? Number(form.pulse) : null,
    spo2: form.spo2 ? Number(form.spo2) : null,
    blood_sugar: form.bloodSugar ? Number(form.bloodSugar) : null,
    test_scores: form.testScores
      .filter((entry) => entry.label.trim() && entry.value.trim())
      .map((entry) => ({ label: entry.label.trim(), value: entry.value.trim() })),
    eye_exam: flattenEyeExamForNote(form.eyeExam),
    contact_lens: null,
    binocular_vision: null,
    low_vision: null,
    myopia_measurement: null,
    structured_modules: buildStructuredModulePayloads({ form, currentModules, isPediatricsClinic }),
    assets: form.assets,
    prescriptions: form.prescriptions.map((entry) => ({
      catalog_item_id: entry.itemId,
      name: entry.name,
      strength: "",
      dose: "",
      route: "",
      schedule: prescriptionScheduleLabel(entry),
      duration: entry.duration.trim(),
      quantity: entry.quantity.trim(),
      instructions: entry.notes.trim(),
    })),
  };
}
