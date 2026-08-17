import {
  createEmptyBinocularVision,
  createEmptyContactLens,
  createEmptyLowVision,
  createEmptyMyopiaManagement,
  formatLocalDateTimeInput,
} from "@/lib/optometry/consultation";
import { createEmptyEyeExam } from "@/lib/structured-modules";
import type { NoteAsset, OptometryChiefComplaintEntry } from "@/lib/types";

export type PrescriptionDraft = {
  itemId: string;
  name: string;
  unit: string;
  quantity: string;
  duration: string;
  notes: string;
  morning: boolean;
  afternoon: boolean;
  night: boolean;
};

export function createConsultationId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyConsultationForm(
  options: { now?: Date; createId?: () => string } = {},
) {
  const now = options.now ?? new Date();
  const createId = options.createId ?? createConsultationId;

  return {
    symptoms: "",
    chiefComplaints: [] as OptometryChiefComplaintEntry[],
    lastAppliedChiefComplaintText: "",
    diagnosis: "",
    medications: "",
    treatment: "",
    notes: "",
    bloodPressureSystolic: "",
    bloodPressureDiastolic: "",
    pulse: "",
    spo2: "",
    bloodSugar: "",
    testScores: [{ id: createId(), label: "", value: "" }],
    eyeExam: createEmptyEyeExam(),
    contactLens: createEmptyContactLens(),
    binocularVision: createEmptyBinocularVision(),
    lowVision: createEmptyLowVision(),
    myopiaManagement: createEmptyMyopiaManagement(),
    growthMeasurement: {
      measured_at: formatLocalDateTimeInput(now),
      height_cm: "",
      weight_kg: "",
      head_circumference_cm: "",
      visit_notes: "",
      savedRecord: null as null | { bmi: number; track_id: string },
    },
    wellChildVisit: {
      visit_band: "school_age",
      nutrition_summary: "",
      sleep_summary: "",
      elimination_summary: "",
      school_behavior_summary: "",
      parent_concerns: "",
      assessment_summary: "",
    },
    parentHandoutRequest: {
      template_key: "well_visit_summary",
      instructions: "",
      generated_title: "",
      generated_content: "",
    },
    pediatricFollowUpPlan: {
      preset_key: "routine_review",
      suggested_interval: "",
      notes: "",
    },
    followUpDate: "",
    followUpNotes: "",
    generatedNote: "",
    prescriptions: [] as PrescriptionDraft[],
    assets: [] as NoteAsset[],
  };
}

export type ConsultationForm = ReturnType<typeof createEmptyConsultationForm>;
