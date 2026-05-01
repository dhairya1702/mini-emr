"use client";

import { ChangeEvent, Fragment, FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus2, Eye, Eraser, FileText, Image as ImageIcon, Mail, Paperclip, PenLine, Sparkles, Undo2, X } from "lucide-react";
import NextImage from "next/image";
import type { ReactNode } from "react";

import { BinocularVisionPayload, CatalogItem, ContactLensEyeEntry, ContactLensPayload, EyeExamEntry, LowVisionPayload, MyopiaMeasurementPayload, NoteAsset, Patient, TestScoreEntry } from "@/lib/types";
import { api } from "@/lib/api";

function createId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const MAX_ATTACHMENT_SIZE_BYTES = 6 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 6;
const SUPPORTED_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

type PrescriptionDraft = {
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

const PRESCRIPTION_NOTE_OPTIONS = [
  "Before food",
  "After food",
  "PRN",
];

function normalizePrescriptionNotes(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function togglePrescriptionNoteValue(currentValue: string, option: string) {
  const current = normalizePrescriptionNotes(currentValue);
  if (current.includes(option)) {
    return current.filter((entry) => entry !== option).join(", ");
  }
  return [...current, option].join(", ");
}

interface ConsultationDrawerProps {
  patient: Patient | null;
  isOptometryClinic?: boolean;
  onClose: () => void;
  onDone: (
    patient: Patient,
    followUp?: { scheduled_for: string; notes: string },
  ) => Promise<void>;
  onGenerate: (payload: {
    note_id?: string;
    patient_id: string;
    symptoms: string;
    diagnosis: string;
    medications: string;
    notes: string;
    blood_pressure_systolic?: number | null;
    blood_pressure_diastolic?: number | null;
    pulse?: number | null;
    spo2?: number | null;
    blood_sugar?: number | null;
    test_scores?: TestScoreEntry[];
    eye_exam?: EyeExamEntry[];
    contact_lens?: ContactLensPayload | null;
    binocular_vision?: BinocularVisionPayload | null;
    low_vision?: LowVisionPayload | null;
    myopia_measurement?: MyopiaMeasurementPayload | null;
    assets?: NoteAsset[];
  }) => Promise<{ content: string; noteId?: string | null; status?: "draft" | "final" | "sent" | null }>;
  onGeneratePdf: (payload: { note_id?: string; patient_id: string; content: string; assets?: NoteAsset[] }) => Promise<Blob>;
  onSend: (payload: { note_id: string; patient_id: string; recipient_email: string }) => Promise<string>;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",", 2)[1] || "");
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

type MyopiaMeasurementDraft = MyopiaMeasurementPayload & {
  record_id: string;
};

function formatLocalDateTimeInput(value?: Date) {
  const date = value ?? new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function createEmptyForm() {
  return {
    symptoms: "",
    diagnosis: "",
    medications: "",
    notes: "",
    bloodPressureSystolic: "",
    bloodPressureDiastolic: "",
    pulse: "",
    spo2: "",
    bloodSugar: "",
    testScores: [{ id: createId(), label: "", value: "" }],
    eyeExam: [
      { eye: "right", sphere: "", cylinder: "", axis: "", vision: "" },
      { eye: "left", sphere: "", cylinder: "", axis: "", vision: "" },
    ] as EyeExamEntry[],
    contactLens: {
      wearing_goal: "",
      current_lens_brand: "",
      current_wear_schedule: "",
      replacement_frequency: "",
      comfort_issues: "",
      dryness_symptoms: "",
      handling_issues: "",
      care_solution: "",
      allergy_history: "",
      assessment_notes: "",
      lens_type: "",
      manufacturer: "",
      brand: "",
      wear_modality: "",
      trial_lens_used: "",
      vendor_name: "",
      quantity: "",
      special_instructions: "",
      eyes: [
        {
          eye: "right",
          sphere: "",
          cylinder: "",
          axis: "",
          base_curve: "",
          diameter: "",
          add_power: "",
          visual_acuity: "",
          over_refraction: "",
          fit_notes: "",
        },
        {
          eye: "left",
          sphere: "",
          cylinder: "",
          axis: "",
          base_curve: "",
          diameter: "",
          add_power: "",
          visual_acuity: "",
          over_refraction: "",
          fit_notes: "",
        },
      ] as ContactLensEyeEntry[],
    } as ContactLensPayload,
    binocularVision: createEmptyBinocularVision(),
    lowVision: createEmptyLowVision(),
    myopiaManagement: createEmptyMyopiaManagement(),
    followUpDate: "",
    followUpNotes: "",
    generatedNote: "",
    prescriptions: [] as PrescriptionDraft[],
    assets: [] as NoteAsset[],
  };
}

type ConsultationWorkspaceSnapshot = {
  form: ReturnType<typeof createEmptyForm>;
  openSections: {
    vitals: boolean;
    testScores: boolean;
    eyeExam: boolean;
    contactLens: boolean;
    binocularVision: boolean;
    lowVision: boolean;
    myopiaManagement: boolean;
  };
  selectedMedicineIds: string[];
  medicineSearch: string;
  currentNoteId: string;
  noteStatus: "draft" | "final" | "sent" | "";
  isSent: boolean;
  recipientEmail: string;
  hasGeneratedNote: boolean;
  isFollowUpOpen: boolean;
};

function workspaceKey(patientId: string) {
  return `consultation-workspace:${patientId}`;
}

function readWorkspace(patientId: string): ConsultationWorkspaceSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(workspaceKey(patientId));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as ConsultationWorkspaceSnapshot;
  } catch {
    return null;
  }
}

function writeWorkspace(patientId: string, snapshot: ConsultationWorkspaceSnapshot) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(workspaceKey(patientId), JSON.stringify(snapshot));
}

function clearWorkspace(patientId: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(workspaceKey(patientId));
}

function hasContactLensEyeData(entry?: ContactLensEyeEntry | null) {
  if (!entry) {
    return false;
  }
  return Boolean(
    entry.sphere.trim() ||
    entry.cylinder.trim() ||
    entry.axis.trim() ||
    entry.base_curve.trim() ||
    entry.diameter.trim() ||
    entry.add_power.trim() ||
    entry.visual_acuity.trim() ||
    entry.over_refraction.trim() ||
    entry.fit_notes.trim(),
  );
}

function hasContactLensData(contactLens?: ContactLensPayload | null) {
  if (!contactLens) {
    return false;
  }
  return Boolean(
    contactLens.wearing_goal.trim() ||
    contactLens.current_lens_brand.trim() ||
    contactLens.current_wear_schedule.trim() ||
    contactLens.replacement_frequency.trim() ||
    contactLens.comfort_issues.trim() ||
    contactLens.dryness_symptoms.trim() ||
    contactLens.handling_issues.trim() ||
    contactLens.care_solution.trim() ||
    contactLens.allergy_history.trim() ||
    contactLens.assessment_notes.trim() ||
    contactLens.lens_type.trim() ||
    contactLens.manufacturer.trim() ||
    contactLens.brand.trim() ||
    contactLens.wear_modality.trim() ||
    contactLens.trial_lens_used.trim() ||
    contactLens.vendor_name.trim() ||
    contactLens.quantity.trim() ||
    contactLens.special_instructions.trim() ||
    contactLens.eyes.some(hasContactLensEyeData),
  );
}

function createEmptyBinocularVision(): BinocularVisionPayload {
  return {
    symptom_notes: "",
    asthenopia: false,
    headache: false,
    diplopia: false,
    blur_near: false,
    blur_distance: false,
    reading_difficulty: false,
    poor_concentration: false,
    distance_cover_test: "",
    near_cover_test: "",
    distance_deviation_pd: "",
    near_deviation_pd: "",
    binocular_visual_acuity_distance: "",
    binocular_visual_acuity_near: "",
    motility: "",
    pursuits: "",
    saccades: "",
    npc_break_cm: "",
    npc_recovery_cm: "",
    convergence_notes: "",
    bo_distance: "",
    bo_near: "",
    bi_distance: "",
    bi_near: "",
    vergence_notes: "",
    stereo_test_name: "",
    stereo_result_arcsec: "",
    worth_four_dot_distance: "",
    worth_four_dot_near: "",
    sensory_notes: "",
    amplitude_right: "",
    amplitude_left: "",
    facility_cpm: "",
    facility_lens: "",
    accommodation_notes: "",
    working_diagnosis: "",
    management_plan: "",
    follow_up_interval: "",
  };
}

function hasBinocularVisionData(binocular?: BinocularVisionPayload | null) {
  if (!binocular) {
    return false;
  }
  return Boolean(
    binocular.symptom_notes.trim() ||
    binocular.asthenopia ||
    binocular.headache ||
    binocular.diplopia ||
    binocular.blur_near ||
    binocular.blur_distance ||
    binocular.reading_difficulty ||
    binocular.poor_concentration ||
    binocular.distance_cover_test.trim() ||
    binocular.near_cover_test.trim() ||
    binocular.distance_deviation_pd.trim() ||
    binocular.near_deviation_pd.trim() ||
    binocular.binocular_visual_acuity_distance.trim() ||
    binocular.binocular_visual_acuity_near.trim() ||
    binocular.motility.trim() ||
    binocular.pursuits.trim() ||
    binocular.saccades.trim() ||
    binocular.npc_break_cm.trim() ||
    binocular.npc_recovery_cm.trim() ||
    binocular.convergence_notes.trim() ||
    binocular.bo_distance.trim() ||
    binocular.bo_near.trim() ||
    binocular.bi_distance.trim() ||
    binocular.bi_near.trim() ||
    binocular.vergence_notes.trim() ||
    binocular.stereo_test_name.trim() ||
    binocular.stereo_result_arcsec.trim() ||
    binocular.worth_four_dot_distance.trim() ||
    binocular.worth_four_dot_near.trim() ||
    binocular.sensory_notes.trim() ||
    binocular.amplitude_right.trim() ||
    binocular.amplitude_left.trim() ||
    binocular.facility_cpm.trim() ||
    binocular.facility_lens.trim() ||
    binocular.accommodation_notes.trim() ||
    binocular.working_diagnosis.trim() ||
    binocular.management_plan.trim() ||
    binocular.follow_up_interval.trim()
  );
}

function buildBinocularVisionSummary(binocular: BinocularVisionPayload) {
  const parts = [
    binocular.working_diagnosis.trim(),
    binocular.npc_break_cm.trim() ? `NPC ${binocular.npc_break_cm.trim()} cm` : "",
    binocular.stereo_result_arcsec.trim() ? `Stereo ${binocular.stereo_result_arcsec.trim()} arc sec` : "",
    binocular.near_deviation_pd.trim() ? `Near ${binocular.near_deviation_pd.trim()} pd` : "",
  ].filter(Boolean);
  return parts.slice(0, 3).join(" · ") || "Binocular vision data saved.";
}

function createEmptyLowVision(): LowVisionPayload {
  return {
    primary_complaint: "",
    goals: "",
    reading_difficulty: false,
    distance_difficulty: false,
    mobility_difficulty: false,
    face_recognition_difficulty: false,
    glare_complaints: false,
    lighting_difficulty: false,
    distance_visual_acuity: "",
    near_visual_acuity: "",
    habitual_correction: "",
    best_correction: "",
    contrast_sensitivity: "",
    glare_function: "",
    central_vision: "",
    visual_field: "",
    functional_reading: "",
    sustained_near_task: "",
    tv_phone_mobility_notes: "",
    illumination_response: "",
    posture_working_distance: "",
    magnifier_type: "",
    magnification: "",
    near_add: "",
    electronic_aid: "",
    tint_filter: "",
    task_performance_with_device: "",
    device_recommended: "",
    lighting_advice: "",
    non_optical_aids: "",
    rehab_referral: "",
    support_referral: "",
    training_required: "",
    follow_up_plan: "",
    cause_of_low_vision: "",
    prognosis: "",
    emotional_support_notes: "",
    charles_bonnet_screening: "",
    final_plan: "",
  };
}

function hasLowVisionData(lowVision?: LowVisionPayload | null) {
  if (!lowVision) {
    return false;
  }
  return Boolean(
    lowVision.primary_complaint.trim() ||
    lowVision.goals.trim() ||
    lowVision.reading_difficulty ||
    lowVision.distance_difficulty ||
    lowVision.mobility_difficulty ||
    lowVision.face_recognition_difficulty ||
    lowVision.glare_complaints ||
    lowVision.lighting_difficulty ||
    lowVision.distance_visual_acuity.trim() ||
    lowVision.near_visual_acuity.trim() ||
    lowVision.habitual_correction.trim() ||
    lowVision.best_correction.trim() ||
    lowVision.contrast_sensitivity.trim() ||
    lowVision.glare_function.trim() ||
    lowVision.central_vision.trim() ||
    lowVision.visual_field.trim() ||
    lowVision.functional_reading.trim() ||
    lowVision.sustained_near_task.trim() ||
    lowVision.tv_phone_mobility_notes.trim() ||
    lowVision.illumination_response.trim() ||
    lowVision.posture_working_distance.trim() ||
    lowVision.magnifier_type.trim() ||
    lowVision.magnification.trim() ||
    lowVision.near_add.trim() ||
    lowVision.electronic_aid.trim() ||
    lowVision.tint_filter.trim() ||
    lowVision.task_performance_with_device.trim() ||
    lowVision.device_recommended.trim() ||
    lowVision.lighting_advice.trim() ||
    lowVision.non_optical_aids.trim() ||
    lowVision.rehab_referral.trim() ||
    lowVision.support_referral.trim() ||
    lowVision.training_required.trim() ||
    lowVision.follow_up_plan.trim() ||
    lowVision.cause_of_low_vision.trim() ||
    lowVision.prognosis.trim() ||
    lowVision.emotional_support_notes.trim() ||
    lowVision.charles_bonnet_screening.trim() ||
    lowVision.final_plan.trim()
  );
}

function buildLowVisionSummary(lowVision: LowVisionPayload) {
  const parts = [
    lowVision.primary_complaint.trim(),
    lowVision.distance_visual_acuity.trim() ? `DVA ${lowVision.distance_visual_acuity.trim()}` : "",
    lowVision.near_visual_acuity.trim() ? `NVA ${lowVision.near_visual_acuity.trim()}` : "",
    lowVision.device_recommended.trim(),
  ].filter(Boolean);
  return parts.slice(0, 3).join(" · ") || "Low vision data saved.";
}

function createEmptyMyopiaManagement(): MyopiaMeasurementDraft {
  return {
    record_id: "",
    measured_at: formatLocalDateTimeInput(),
    age_years: 0,
    axial_length_right_mm: 0,
    axial_length_left_mm: 0,
    treatment_type: "",
    treatment_notes: "",
    visit_notes: "",
    refraction_right: "",
    refraction_left: "",
  };
}

function hasMyopiaManagementData(myopia?: MyopiaMeasurementDraft | null) {
  if (!myopia) {
    return false;
  }
  return Boolean(
    myopia.record_id ||
    myopia.age_years > 0 ||
    myopia.axial_length_right_mm > 0 ||
    myopia.axial_length_left_mm > 0 ||
    myopia.treatment_type.trim() ||
    myopia.treatment_notes.trim() ||
    myopia.visit_notes.trim() ||
    myopia.refraction_right.trim() ||
    myopia.refraction_left.trim(),
  );
}

function buildMyopiaManagementSummary(myopia: MyopiaMeasurementDraft) {
  const parts = [
    myopia.axial_length_right_mm > 0 ? `OD ${myopia.axial_length_right_mm.toFixed(2)} mm` : "",
    myopia.axial_length_left_mm > 0 ? `OS ${myopia.axial_length_left_mm.toFixed(2)} mm` : "",
    myopia.treatment_type.trim(),
  ].filter(Boolean);
  return parts.join(" · ") || "Myopia management measurement saved.";
}

function prescriptionScheduleLabel(prescription: PrescriptionDraft) {
  const parts = [
    prescription.morning ? "Morning" : "",
    prescription.afternoon ? "Afternoon" : "",
    prescription.night ? "Night" : "",
  ].filter(Boolean);
  return parts.join(", ") || "As directed";
}

function BinocularVisionModal({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: BinocularVisionPayload;
  onClose: () => void;
  onSave: (next: BinocularVisionPayload) => void;
}) {
  const [draft, setDraft] = useState<BinocularVisionPayload>(value);

  useEffect(() => {
    if (open) {
      setDraft(value);
    }
  }, [open, value]);

  if (!open) {
    return null;
  }

  function update<K extends keyof BinocularVisionPayload>(key: K, nextValue: BinocularVisionPayload[K]) {
    setDraft((current) => ({ ...current, [key]: nextValue }));
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[32px] border border-sky-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Optometry Module</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">Binocular Vision</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Capture symptoms, alignment, convergence, vergence, stereopsis, accommodation, and the management plan.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-sky-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <section className="rounded-[28px] border border-sky-200 bg-sky-50/30 p-4">
            <p className="text-sm font-medium text-slate-900">Symptoms</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["asthenopia", "Asthenopia"],
                ["headache", "Headache"],
                ["diplopia", "Diplopia"],
                ["blur_near", "Blur Near"],
                ["blur_distance", "Blur Distance"],
                ["reading_difficulty", "Reading Difficulty"],
                ["poor_concentration", "Poor Concentration"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm text-slate-700">
                  <input type="checkbox" checked={Boolean(draft[key as keyof BinocularVisionPayload])} onChange={(event) => update(key as keyof BinocularVisionPayload, event.target.checked as never)} className="h-4 w-4 rounded border-sky-300 text-sky-600 focus:ring-sky-500" />
                  {label}
                </label>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Symptom Notes</span>
              <textarea rows={3} value={draft.symptom_notes} onChange={(event) => update("symptom_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
            </label>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Alignment & Motility</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[
                ["distance_cover_test", "Distance Cover Test"],
                ["near_cover_test", "Near Cover Test"],
                ["distance_deviation_pd", "Distance Deviation (pd)"],
                ["near_deviation_pd", "Near Deviation (pd)"],
                ["binocular_visual_acuity_distance", "Binocular VA Distance"],
                ["binocular_visual_acuity_near", "Binocular VA Near"],
                ["motility", "Motility"],
                ["pursuits", "Pursuits"],
                ["saccades", "Saccades"],
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                  <input value={draft[key as keyof BinocularVisionPayload] as string} onChange={(event) => update(key as keyof BinocularVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Convergence & Vergence</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[
                ["npc_break_cm", "NPC Break (cm)"],
                ["npc_recovery_cm", "NPC Recovery (cm)"],
                ["bo_distance", "BO Distance"],
                ["bo_near", "BO Near"],
                ["bi_distance", "BI Distance"],
                ["bi_near", "BI Near"],
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                  <input value={draft[key as keyof BinocularVisionPayload] as string} onChange={(event) => update(key as keyof BinocularVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Convergence Notes</span>
                <textarea rows={3} value={draft.convergence_notes} onChange={(event) => update("convergence_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Vergence Notes</span>
                <textarea rows={3} value={draft.vergence_notes} onChange={(event) => update("vergence_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Sensory & Accommodation</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                ["stereo_test_name", "Stereo Test"],
                ["stereo_result_arcsec", "Stereo Result (arc sec)"],
                ["worth_four_dot_distance", "Worth 4 Dot Distance"],
                ["worth_four_dot_near", "Worth 4 Dot Near"],
                ["amplitude_right", "Amplitude Right"],
                ["amplitude_left", "Amplitude Left"],
                ["facility_cpm", "Facility (cpm)"],
                ["facility_lens", "Facility Lens"],
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                  <input value={draft[key as keyof BinocularVisionPayload] as string} onChange={(event) => update(key as keyof BinocularVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Sensory Notes</span>
                <textarea rows={3} value={draft.sensory_notes} onChange={(event) => update("sensory_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Accommodation Notes</span>
                <textarea rows={3} value={draft.accommodation_notes} onChange={(event) => update("accommodation_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Impression & Plan</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Working Diagnosis</span>
                <input value={draft.working_diagnosis} onChange={(event) => update("working_diagnosis", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Follow-up Interval</span>
                <input value={draft.follow_up_interval} onChange={(event) => update("follow_up_interval", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Management Plan</span>
              <textarea rows={4} value={draft.management_plan} onChange={(event) => update("management_plan", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
            </label>
          </section>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50">
            Cancel
          </button>
          <button type="button" onClick={() => { onSave(draft); onClose(); }} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
            Save Binocular Vision
          </button>
        </div>
      </div>
    </div>
  );
}

function LowVisionModal({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: LowVisionPayload;
  onClose: () => void;
  onSave: (next: LowVisionPayload) => void;
}) {
  const [draft, setDraft] = useState<LowVisionPayload>(value);

  useEffect(() => {
    if (open) {
      setDraft(value);
    }
  }, [open, value]);

  if (!open) {
    return null;
  }

  function update<K extends keyof LowVisionPayload>(key: K, nextValue: LowVisionPayload[K]) {
    setDraft((current) => ({ ...current, [key]: nextValue }));
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[32px] border border-sky-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Optometry Module</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">Low Vision</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Capture needs, core measures, functional vision, aids trial, and support planning for low vision assessment.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-sky-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <section className="rounded-[28px] border border-sky-200 bg-sky-50/30 p-4">
            <p className="text-sm font-medium text-slate-900">Patient Needs</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["reading_difficulty", "Reading Difficulty"],
                ["distance_difficulty", "Distance Difficulty"],
                ["mobility_difficulty", "Mobility Difficulty"],
                ["face_recognition_difficulty", "Face Recognition Difficulty"],
                ["glare_complaints", "Glare Complaints"],
                ["lighting_difficulty", "Lighting Difficulty"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm text-slate-700">
                  <input type="checkbox" checked={Boolean(draft[key as keyof LowVisionPayload])} onChange={(event) => update(key as keyof LowVisionPayload, event.target.checked as never)} className="h-4 w-4 rounded border-sky-300 text-sky-600 focus:ring-sky-500" />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Primary Complaint</span>
                <input value={draft.primary_complaint} onChange={(event) => update("primary_complaint", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Goals</span>
                <input value={draft.goals} onChange={(event) => update("goals", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Core Measures</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                ["distance_visual_acuity", "Distance VA"],
                ["near_visual_acuity", "Near VA"],
                ["habitual_correction", "Habitual Correction"],
                ["best_correction", "Best Correction"],
                ["contrast_sensitivity", "Contrast Sensitivity"],
                ["glare_function", "Glare Function"],
                ["central_vision", "Central Vision"],
                ["visual_field", "Visual Field"],
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                  <input value={draft[key as keyof LowVisionPayload] as string} onChange={(event) => update(key as keyof LowVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Functional Vision</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[
                ["functional_reading", "Functional Reading"],
                ["sustained_near_task", "Sustained Near Task"],
                ["illumination_response", "Illumination Response"],
                ["posture_working_distance", "Posture / Working Distance"],
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                  <input value={draft[key as keyof LowVisionPayload] as string} onChange={(event) => update(key as keyof LowVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
                </label>
              ))}
              <label className="md:col-span-2 block">
                <span className="mb-2 block text-sm font-medium text-slate-700">TV / Phone / Mobility Notes</span>
                <textarea rows={3} value={draft.tv_phone_mobility_notes} onChange={(event) => update("tv_phone_mobility_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Aids Trial</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[
                ["magnifier_type", "Magnifier Type"],
                ["magnification", "Magnification"],
                ["near_add", "Near Add"],
                ["electronic_aid", "Electronic Aid"],
                ["tint_filter", "Tint / Filter"],
                ["device_recommended", "Device Recommended"],
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                  <input value={draft[key as keyof LowVisionPayload] as string} onChange={(event) => update(key as keyof LowVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
                </label>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Task Performance With Device</span>
              <textarea rows={3} value={draft.task_performance_with_device} onChange={(event) => update("task_performance_with_device", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
            </label>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Plan & Support</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[
                ["lighting_advice", "Lighting Advice"],
                ["non_optical_aids", "Non-optical Aids"],
                ["rehab_referral", "Rehab Referral"],
                ["support_referral", "Support Referral"],
                ["training_required", "Training Required"],
                ["follow_up_plan", "Follow-up Plan"],
                ["cause_of_low_vision", "Cause of Low Vision"],
                ["prognosis", "Prognosis"],
                ["charles_bonnet_screening", "Charles Bonnet Screening"],
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                  <input value={draft[key as keyof LowVisionPayload] as string} onChange={(event) => update(key as keyof LowVisionPayload, event.target.value as never)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Emotional Support Notes</span>
                <textarea rows={3} value={draft.emotional_support_notes} onChange={(event) => update("emotional_support_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Final Plan</span>
                <textarea rows={3} value={draft.final_plan} onChange={(event) => update("final_plan", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50">
            Cancel
          </button>
          <button type="button" onClick={() => { onSave(draft); onClose(); }} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
            Save Low Vision
          </button>
        </div>
      </div>
    </div>
  );
}

function StructuredModal({
  open,
  title,
  description,
  onClose,
  onSave,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[32px] border border-sky-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Structured Module</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-sky-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-5">{children}</div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50">
            Cancel
          </button>
          <button type="button" onClick={onSave} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function MyopiaManagementModal({
  open,
  value,
  patientAge,
  onClose,
  onSave,
}: {
  open: boolean;
  value: MyopiaMeasurementDraft;
  patientAge: number | null;
  onClose: () => void;
  onSave: (next: MyopiaMeasurementDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<MyopiaMeasurementDraft>(value);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft({
        ...value,
        age_years: value.age_years > 0 ? value.age_years : Number(patientAge || 0),
        measured_at: value.measured_at || formatLocalDateTimeInput(),
      });
      setStatus("");
      setIsSaving(false);
    }
  }, [open, patientAge, value]);

  if (!open) {
    return null;
  }

  function update<K extends keyof MyopiaMeasurementDraft>(key: K, nextValue: MyopiaMeasurementDraft[K]) {
    setDraft((current) => ({ ...current, [key]: nextValue }));
  }

  async function handleSave() {
    if (draft.age_years <= 0) {
      setStatus("Enter the patient age at measurement.");
      return;
    }
    if (draft.axial_length_right_mm <= 0 || draft.axial_length_left_mm <= 0) {
      setStatus("Enter axial length for both eyes.");
      return;
    }
    if (!draft.measured_at.trim()) {
      setStatus("Enter the measurement date and time.");
      return;
    }
    setIsSaving(true);
    setStatus("");
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save myopia measurement.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[32px] border border-sky-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Optometry Module</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">Myopia Management</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Record axial length, treatment, and refraction for longitudinal myopia progression tracking.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-sky-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <section className="rounded-[28px] border border-sky-200 bg-sky-50/30 p-4">
            <p className="text-sm font-medium text-slate-900">Measurement</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <label className="block lg:col-span-2">
                <span className="mb-2 block text-sm font-medium text-slate-700">Measured At</span>
                <input type="datetime-local" value={draft.measured_at} onChange={(event) => update("measured_at", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Age (years)</span>
                <input type="number" step="0.1" value={draft.age_years || ""} onChange={(event) => update("age_years", Number(event.target.value || 0))} className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Treatment Type</span>
                <input value={draft.treatment_type} onChange={(event) => update("treatment_type", event.target.value)} placeholder="Atropine, ortho-k, DIMS, observation" className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Axial Length OD (mm)</span>
                <input type="number" step="0.01" value={draft.axial_length_right_mm || ""} onChange={(event) => update("axial_length_right_mm", Number(event.target.value || 0))} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Axial Length OS (mm)</span>
                <input type="number" step="0.01" value={draft.axial_length_left_mm || ""} onChange={(event) => update("axial_length_left_mm", Number(event.target.value || 0))} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Refraction</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Refraction Right</span>
                <input value={draft.refraction_right} onChange={(event) => update("refraction_right", event.target.value)} placeholder="-2.25 / -0.50 x 180" className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Refraction Left</span>
                <input value={draft.refraction_left} onChange={(event) => update("refraction_left", event.target.value)} placeholder="-2.00 / -0.75 x 170" className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">Plan & Visit Notes</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Treatment Notes</span>
                <textarea rows={4} value={draft.treatment_notes} onChange={(event) => update("treatment_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Visit Notes</span>
                <textarea rows={4} value={draft.visit_notes} onChange={(event) => update("visit_notes", event.target.value)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              </label>
            </div>
          </section>

          {status ? <p className="text-sm text-rose-600">{status}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50">
            Cancel
          </button>
          <button type="button" disabled={isSaving} onClick={handleSave} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
            {isSaving ? "Saving..." : "Save Myopia Measurement"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConsultationDrawer({
  patient,
  isOptometryClinic = false,
  onClose,
  onDone,
  onGenerate,
  onGeneratePdf,
  onSend,
}: ConsultationDrawerProps) {
  const [form, setForm] = useState(createEmptyForm);
  const [openSections, setOpenSections] = useState({
    vitals: false,
    testScores: false,
    eyeExam: false,
    contactLens: false,
    binocularVision: false,
    lowVision: false,
    myopiaManagement: false,
  });
  const [medicineItems, setMedicineItems] = useState<CatalogItem[]>([]);
  const [medicineSearch, setMedicineSearch] = useState("");
  const [selectedMedicineIds, setSelectedMedicineIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [isVitalsOpen, setIsVitalsOpen] = useState(false);
  const [isTestScoresOpen, setIsTestScoresOpen] = useState(false);
  const [isEyeExamOpen, setIsEyeExamOpen] = useState(false);
  const [isContactLensOpen, setIsContactLensOpen] = useState(false);
  const [isBinocularVisionOpen, setIsBinocularVisionOpen] = useState(false);
  const [isLowVisionOpen, setIsLowVisionOpen] = useState(false);
  const [isMyopiaManagementOpen, setIsMyopiaManagementOpen] = useState(false);
  const [hasGeneratedNote, setHasGeneratedNote] = useState(false);
  const [currentNoteId, setCurrentNoteId] = useState("");
  const [noteStatus, setNoteStatus] = useState<"draft" | "final" | "sent" | "">("");
  const [isSent, setIsSent] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingMode, setDrawingMode] = useState<"draw" | "erase">("draw");
  const [brushSize, setBrushSize] = useState(3);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingHistoryRef = useRef<string[]>([]);

  useEffect(() => {
    if (!patient) {
      return;
    }

    let active = true;
    const cachedWorkspace = readWorkspace(patient.id);
    const baseForm = createEmptyForm();
    const cachedForm = cachedWorkspace?.form;
    setStatusMessage("");
    setIsGenerating(false);
    setIsGeneratingPdf(false);
    setIsCompleting(false);
    setIsSending(false);
    setMedicineSearch(cachedWorkspace?.medicineSearch ?? "");
    setForm(
      cachedForm
        ? {
            ...baseForm,
            ...cachedForm,
            eyeExam: Array.isArray(cachedForm.eyeExam) && cachedForm.eyeExam.length
              ? cachedForm.eyeExam
              : baseForm.eyeExam,
            testScores: Array.isArray(cachedForm.testScores) && cachedForm.testScores.length
              ? cachedForm.testScores
              : baseForm.testScores,
            assets: Array.isArray(cachedForm.assets) ? cachedForm.assets : baseForm.assets,
            prescriptions: Array.isArray(cachedForm.prescriptions) ? cachedForm.prescriptions : baseForm.prescriptions,
            contactLens: {
              ...baseForm.contactLens,
              ...(cachedForm.contactLens || {}),
              eyes: Array.isArray(cachedForm.contactLens?.eyes) && cachedForm.contactLens.eyes.length
                ? cachedForm.contactLens.eyes.map((entry, index) => ({
                    ...baseForm.contactLens.eyes[index]!,
                    ...entry,
                  }))
                : baseForm.contactLens.eyes,
            },
            binocularVision: {
              ...baseForm.binocularVision,
              ...(cachedForm.binocularVision || {}),
            },
            lowVision: {
              ...baseForm.lowVision,
              ...(cachedForm.lowVision || {}),
            },
            myopiaManagement: {
              ...baseForm.myopiaManagement,
              ...(cachedForm.myopiaManagement || {}),
            },
          }
        : baseForm,
    );
    setOpenSections(
      cachedWorkspace?.openSections ?? {
        vitals: false,
        testScores: false,
        eyeExam: false,
        contactLens: false,
        binocularVision: false,
        lowVision: false,
        myopiaManagement: false,
      },
    );
    setSelectedMedicineIds(
      cachedWorkspace?.selectedMedicineIds ?? cachedWorkspace?.form.prescriptions.map((entry) => entry.itemId) ?? [],
    );
    setIsFollowUpOpen(cachedWorkspace?.isFollowUpOpen ?? false);
    setHasGeneratedNote(cachedWorkspace?.hasGeneratedNote ?? false);
    setCurrentNoteId(cachedWorkspace?.currentNoteId ?? "");
    setNoteStatus(cachedWorkspace?.noteStatus ?? "");
    setIsSent(cachedWorkspace?.isSent ?? false);
    setRecipientEmail(cachedWorkspace?.recipientEmail ?? patient.email ?? "");

    void Promise.all([api.listCatalogItems(), api.listPatientNotes(patient.id)])
      .then(([items, notes]) => {
        if (!active) {
          return;
        }

        setMedicineItems(items.filter((item) => item.item_type === "medicine"));

        const latestNote = notes[0] ?? null;

        if (latestNote && !cachedWorkspace?.currentNoteId) {
          setCurrentNoteId(String(latestNote.id));
          setNoteStatus(latestNote.status);
          setHasGeneratedNote(Boolean((latestNote.content || "").trim()));
          if (!cachedWorkspace?.form.generatedNote.trim()) {
            setForm((current) => ({
              ...current,
              generatedNote: latestNote.content || "",
              assets: (latestNote.snapshot_asset_payload || latestNote.asset_payload || []) as NoteAsset[],
            }));
          }
        }
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setMedicineItems([]);
        setStatusMessage(error instanceof Error ? error.message : "Failed to load inventory medicines.");
      });

    return () => {
      active = false;
    };
  }, [patient]);

  useEffect(() => {
    if (!patient) {
      return;
    }

    writeWorkspace(patient.id, {
      form,
      openSections,
      selectedMedicineIds,
      medicineSearch,
      currentNoteId,
      noteStatus,
      isSent,
      recipientEmail,
      hasGeneratedNote,
      isFollowUpOpen,
    });
  }, [
    currentNoteId,
    form,
    hasGeneratedNote,
    isFollowUpOpen,
    isSent,
    medicineSearch,
    noteStatus,
    openSections,
    patient,
    recipientEmail,
    selectedMedicineIds,
  ]);

  const filteredMedicineItems = useMemo(() => {
    const query = medicineSearch.trim().toLowerCase();
    return medicineItems.filter((item) => {
      if (!query) {
        return true;
      }
      return item.name.toLowerCase().includes(query) || item.unit.toLowerCase().includes(query);
    });
  }, [medicineItems, medicineSearch]);
  const attachmentAssets = useMemo(
    () => form.assets.filter((asset) => asset.kind === "attachment"),
    [form.assets],
  );
  const drawingAsset = useMemo(
    () => form.assets.find((asset) => asset.kind === "drawing") ?? null,
    [form.assets],
  );
  const medicationPlan = useMemo(() => {
    const manualPlan = form.medications.trim();
    const structuredPlan = form.prescriptions.length
      ? [
          "Prescribed medicines:",
          "Medicine | Quantity | Schedule | Duration | Notes",
          "--- | --- | --- | --- | ---",
          ...form.prescriptions.map((entry) => {
            const quantity = entry.quantity.trim() || "-";
            const duration = entry.duration.trim() || "-";
            const notes = entry.notes.trim() || "-";
            return `${entry.name} | ${quantity} | ${prescriptionScheduleLabel(entry)} | ${duration} | ${notes}`;
          }),
        ].join("\n")
      : "";

    return [manualPlan, structuredPlan].filter(Boolean).join("\n\n");
  }, [form.medications, form.prescriptions]);

  useEffect(() => {
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!drawingAsset) {
      return;
    }
    const image = new window.Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = `data:${drawingAsset.content_type};base64,${drawingAsset.data_base64}`;
  }, [drawingAsset]);

  if (!patient) {
    return null;
  }

  const currentPatient = patient;

  async function handleGenerate(event?: FormEvent) {
    event?.preventDefault();
    setIsGenerating(true);
    setStatusMessage("");
    try {
      const refreshingDraft = Boolean(currentNoteId && noteStatus === "draft");
      const generated = await onGenerate({
        note_id: refreshingDraft ? currentNoteId : undefined,
        patient_id: currentPatient.id,
        symptoms: form.symptoms,
        diagnosis: form.diagnosis,
        medications: medicationPlan,
        notes: form.notes,
        blood_pressure_systolic: form.bloodPressureSystolic ? Number(form.bloodPressureSystolic) : null,
        blood_pressure_diastolic: form.bloodPressureDiastolic ? Number(form.bloodPressureDiastolic) : null,
        pulse: form.pulse ? Number(form.pulse) : null,
        spo2: form.spo2 ? Number(form.spo2) : null,
        blood_sugar: form.bloodSugar ? Number(form.bloodSugar) : null,
        test_scores: form.testScores
          .filter((entry) => entry.label.trim() && entry.value.trim())
          .map((entry) => ({ label: entry.label.trim(), value: entry.value.trim() })),
        eye_exam: form.eyeExam.filter((entry) =>
          entry.sphere.trim() || entry.cylinder.trim() || entry.axis.trim() || entry.vision.trim(),
        ),
        contact_lens: isOptometryClinic && hasContactLensData(form.contactLens)
          ? {
              ...form.contactLens,
              eyes: form.contactLens.eyes.filter((entry) => hasContactLensEyeData(entry)),
            }
          : null,
        binocular_vision: isOptometryClinic && hasBinocularVisionData(form.binocularVision)
          ? form.binocularVision
          : null,
        low_vision: isOptometryClinic && hasLowVisionData(form.lowVision)
          ? form.lowVision
          : null,
        myopia_measurement: isOptometryClinic && hasMyopiaManagementData(form.myopiaManagement)
          ? {
              measured_at: new Date(form.myopiaManagement.measured_at).toISOString(),
              age_years: form.myopiaManagement.age_years,
              axial_length_right_mm: form.myopiaManagement.axial_length_right_mm,
              axial_length_left_mm: form.myopiaManagement.axial_length_left_mm,
              treatment_type: form.myopiaManagement.treatment_type,
              treatment_notes: form.myopiaManagement.treatment_notes,
              visit_notes: form.myopiaManagement.visit_notes,
              refraction_right: form.myopiaManagement.refraction_right,
              refraction_left: form.myopiaManagement.refraction_left,
            }
          : null,
        assets: form.assets,
      });
      setForm((current) => ({ ...current, generatedNote: generated.content }));
      setHasGeneratedNote(true);
      setCurrentNoteId(generated.noteId || "");
      setNoteStatus(generated.status || "draft");
      setIsSent(false);
      setStatusMessage(refreshingDraft ? "Draft note refreshed." : "Draft SOAP note generated.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to generate SOAP note.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSend() {
    if (!form.generatedNote.trim()) {
      setStatusMessage("Generate a note before sending.");
      return;
    }
    if (!currentNoteId) {
      setStatusMessage("Generate and save the note before sending it.");
      return;
    }
    if (!recipientEmail.trim()) {
      setStatusMessage("Enter a recipient email before sending.");
      return;
    }
    if (isSent) {
      setStatusMessage("This saved note has already been emailed and is locked.");
      return;
    }

    setIsSending(true);
    try {
      const message = await onSend({
        note_id: currentNoteId,
        patient_id: currentPatient.id,
        recipient_email: recipientEmail.trim(),
      });
      setNoteStatus("sent");
      setIsSent(true);
      setStatusMessage(message);
      clearWorkspace(currentPatient.id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send email.");
    } finally {
      setIsSending(false);
    }
  }

  async function handlePdf(action: "preview" | "download") {
    if (!form.generatedNote.trim()) {
      setStatusMessage("Generate a note before creating the PDF.");
      return;
    }

    setIsGeneratingPdf(true);
    try {
      const blob = await onGeneratePdf({
        note_id: currentNoteId && (noteStatus === "final" || noteStatus === "sent") ? currentNoteId : undefined,
        patient_id: currentPatient.id,
        content: form.generatedNote,
        assets: form.assets,
      });
      const url = URL.createObjectURL(blob);

      if (action === "preview") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${currentPatient.name.replace(/\s+/g, "_")}_note.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      setStatusMessage("PDF ready.");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  async function handleDone() {
    if (!hasGeneratedNote || !form.generatedNote.trim() || !currentNoteId || noteStatus === "draft") {
      setStatusMessage("Finalize the consultation note before marking this patient done.");
      return;
    }

    setIsCompleting(true);
    try {
      const followUp =
        form.followUpDate.trim()
          ? {
              scheduled_for: new Date(`${form.followUpDate}T09:00:00`).toISOString(),
              notes: form.followUpNotes.trim(),
            }
          : undefined;
      await onDone(currentPatient, followUp);
      clearWorkspace(currentPatient.id);
      onClose();
    } finally {
      setIsCompleting(false);
    }
  }

  function updateTestScore(id: string, patch: Partial<TestScoreEntry>) {
    setForm((current) => ({
      ...current,
      testScores: current.testScores.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }));
  }

  function addTestScore() {
    setForm((current) => ({
      ...current,
      testScores: [...current.testScores, { id: createId(), label: "", value: "" }],
    }));
  }

  function removeTestScore(id: string) {
    setForm((current) => ({
      ...current,
      testScores: current.testScores.length > 1
        ? current.testScores.filter((entry) => entry.id !== id)
        : [{ id: createId(), label: "", value: "" }],
    }));
  }

  function updateEyeExam(eye: "right" | "left", patch: Partial<EyeExamEntry>) {
    setForm((current) => ({
      ...current,
      eyeExam: current.eyeExam.map((entry) => (entry.eye === eye ? { ...entry, ...patch } : entry)),
    }));
  }

  function updateContactLens(patch: Partial<ContactLensPayload>) {
    setForm((current) => ({
      ...current,
      contactLens: { ...current.contactLens, ...patch },
    }));
  }

  function updateContactLensEye(eye: "right" | "left", patch: Partial<ContactLensEyeEntry>) {
    setForm((current) => ({
      ...current,
      contactLens: {
        ...current.contactLens,
        eyes: current.contactLens.eyes.map((entry) => (entry.eye === eye ? { ...entry, ...patch } : entry)),
      },
    }));
  }

  function saveBinocularVision(next: BinocularVisionPayload) {
    setForm((current) => ({ ...current, binocularVision: next }));
    setStatusMessage(buildBinocularVisionSummary(next));
  }

  function saveLowVision(next: LowVisionPayload) {
    setForm((current) => ({ ...current, lowVision: next }));
    setStatusMessage(buildLowVisionSummary(next));
  }

  async function saveMyopiaManagement(next: MyopiaMeasurementDraft) {
    if (!currentPatient) {
      return;
    }
    const payload: MyopiaMeasurementPayload = {
      measured_at: new Date(next.measured_at).toISOString(),
      age_years: next.age_years,
      axial_length_right_mm: next.axial_length_right_mm,
      axial_length_left_mm: next.axial_length_left_mm,
      treatment_type: next.treatment_type.trim(),
      treatment_notes: next.treatment_notes.trim(),
      visit_notes: next.visit_notes.trim(),
      refraction_right: next.refraction_right.trim(),
      refraction_left: next.refraction_left.trim(),
    };
    const saved = next.record_id
      ? await api.updatePatientMyopiaRecord(currentPatient.id, next.record_id, payload)
      : await api.createPatientMyopiaRecord(currentPatient.id, payload);
    setForm((current) => ({
      ...current,
      myopiaManagement: {
        record_id: saved.id,
        measured_at: formatLocalDateTimeInput(new Date(saved.measured_at)),
        age_years: saved.age_years,
        axial_length_right_mm: saved.axial_length_right_mm,
        axial_length_left_mm: saved.axial_length_left_mm,
        treatment_type: saved.treatment_type,
        treatment_notes: saved.treatment_notes,
        visit_notes: saved.visit_notes,
        refraction_right: saved.refraction_right,
        refraction_left: saved.refraction_left,
      },
    }));
    setStatusMessage(buildMyopiaManagementSummary({
      ...next,
      record_id: saved.id,
    }));
  }

  function toggleMedicine(itemId: string) {
    const selectedItem = medicineItems.find((item) => item.id === itemId);
    if (!selectedItem) {
      return;
    }
    setSelectedMedicineIds((current) =>
      current.includes(itemId) ? current.filter((selected) => selected !== itemId) : [...current, itemId],
    );
    setForm((current) => {
      const exists = current.prescriptions.some((entry) => entry.itemId === itemId);
      return {
        ...current,
        prescriptions: exists
          ? current.prescriptions.filter((entry) => entry.itemId !== itemId)
          : [
              ...current.prescriptions,
              {
                itemId,
                name: selectedItem.name,
                unit: selectedItem.unit,
                quantity: "1",
                duration: "",
                notes: "",
                morning: true,
                afternoon: false,
                night: false,
              },
            ],
      };
    });
  }

  function updatePrescription(itemId: string, patch: Partial<PrescriptionDraft>) {
    setForm((current) => ({
      ...current,
      prescriptions: current.prescriptions.map((entry) => (entry.itemId === itemId ? { ...entry, ...patch } : entry)),
    }));
  }

  function removePrescription(itemId: string) {
    setSelectedMedicineIds((current) => current.filter((selected) => selected !== itemId));
    setForm((current) => ({
      ...current,
      prescriptions: current.prescriptions.filter((entry) => entry.itemId !== itemId),
    }));
  }

  function handleSectionSuggestionClick(section: keyof typeof openSections) {
    if (section === "vitals") {
      setIsVitalsOpen(true);
      return;
    }
    if (section === "testScores") {
      setIsTestScoresOpen(true);
      return;
    }
    if (section === "eyeExam") {
      setIsEyeExamOpen(true);
      return;
    }
    if (section === "contactLens") {
      setIsContactLensOpen(true);
      return;
    }
    if (section === "binocularVision") {
      setIsBinocularVisionOpen(true);
      return;
    }
    if (section === "lowVision") {
      setIsLowVisionOpen(true);
      return;
    }
    if (section === "myopiaManagement") {
      setIsMyopiaManagementOpen(true);
    }
  }

  async function handleAttachmentSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }
    if (attachmentAssets.length + files.length > MAX_ATTACHMENT_COUNT) {
      setStatusMessage(`You can keep up to ${MAX_ATTACHMENT_COUNT} consultation attachments.`);
      event.target.value = "";
      return;
    }
    try {
      for (const file of files) {
        if (!SUPPORTED_ATTACHMENT_TYPES.has(file.type || "")) {
          throw new Error("Only JPG, PNG, and PDF files are supported.");
        }
        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          throw new Error("Each attachment must be 6 MB or smaller.");
        }
      }
      const nextAssets = await Promise.all(
        files.map(async (file) => ({
          id: createId(),
          kind: "attachment" as const,
          name: file.name,
          content_type: file.type || "application/octet-stream",
          data_base64: await fileToBase64(file),
        })),
      );
      setForm((current) => ({
        ...current,
        assets: [...current.assets.filter((asset) => asset.kind !== "attachment"), ...nextAssets],
      }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to attach file.");
    } finally {
      event.target.value = "";
    }
  }

  function removeAsset(assetId: string) {
    setForm((current) => ({ ...current, assets: current.assets.filter((asset) => asset.id !== assetId) }));
  }

  function beginDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    drawingHistoryRef.current = [...drawingHistoryRef.current, canvas.toDataURL("image/png")].slice(-12);
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    context.globalCompositeOperation = drawingMode === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = "#0f172a";
    context.lineWidth = drawingMode === "erase" ? brushSize * 4 : brushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
    setIsDrawing(true);
  }

  function continueDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) {
      return;
    }
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    context.lineTo((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
    context.stroke();
  }

  function finishDrawing() {
    if (!isDrawing) {
      return;
    }
    setIsDrawing(false);
    const canvas = drawingCanvasRef.current;
    if (!canvas) {
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const dataBase64 = dataUrl.split(",", 2)[1] || "";
    setForm((current) => ({
      ...current,
      assets: [
        ...current.assets.filter((asset) => asset.kind !== "drawing"),
        {
          id: current.assets.find((asset) => asset.kind === "drawing")?.id || createId(),
          kind: "drawing",
          name: "consultation-drawing.png",
          content_type: "image/png",
          data_base64: dataBase64,
        },
      ],
    }));
  }

  function clearDrawing() {
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    setForm((current) => ({ ...current, assets: current.assets.filter((asset) => asset.kind !== "drawing") }));
    drawingHistoryRef.current = [];
  }

  function undoDrawing() {
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    const previous = drawingHistoryRef.current.pop();
    if (!canvas || !context || !previous) {
      return;
    }
    const image = new window.Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      const dataBase64 = dataUrl.split(",", 2)[1] || "";
      setForm((current) => ({
        ...current,
        assets: [
          ...current.assets.filter((asset) => asset.kind !== "drawing"),
          {
            id: current.assets.find((asset) => asset.kind === "drawing")?.id || createId(),
            kind: "drawing",
            name: "consultation-drawing.png",
            content_type: "image/png",
            data_base64: dataBase64,
          },
        ],
      }));
    };
    image.src = previous;
  }

  const hasVitals =
    Boolean(form.bloodPressureSystolic.trim()) ||
    Boolean(form.bloodPressureDiastolic.trim()) ||
    Boolean(form.pulse.trim()) ||
    Boolean(form.spo2.trim()) ||
    Boolean(form.bloodSugar.trim());
  const filledTestScores = form.testScores.filter((entry) => entry.label.trim() || entry.value.trim());
  const hasTestScores = filledTestScores.length > 0;
  const filledEyeExam = form.eyeExam.filter(
    (entry) => entry.sphere.trim() || entry.cylinder.trim() || entry.axis.trim() || entry.vision.trim(),
  );
  const hasEyeExam = filledEyeExam.length > 0;
  const hasContactLens = hasContactLensData(form.contactLens);
  const hasBinocularVision = hasBinocularVisionData(form.binocularVision);
  const hasLowVision = hasLowVisionData(form.lowVision);
  const hasMyopiaManagement = hasMyopiaManagementData(form.myopiaManagement);

  const sectionSuggestions = [
    {
      key: "vitals" as const,
      label: "Vitals",
      active: hasVitals,
    },
    {
      key: "testScores" as const,
      label: "Test Scores",
      active: hasTestScores,
    },
    {
      key: "eyeExam" as const,
      label: "Eye Exam",
      active: hasEyeExam,
    },
    ...(isOptometryClinic
      ? [{
          key: "contactLens" as const,
          label: "Contact Lens",
          active: hasContactLens,
        }, {
          key: "binocularVision" as const,
          label: "Binocular Vision",
          active: hasBinocularVision,
        }, {
          key: "lowVision" as const,
          label: "Low Vision",
          active: hasLowVision,
        }, {
          key: "myopiaManagement" as const,
          label: "Myopia Management",
          active: hasMyopiaManagement,
        }]
      : []),
  ];
  const lifecycleLabel =
    noteStatus === "sent"
      ? "Sent and locked"
      : noteStatus === "final"
        ? "Finalized"
        : noteStatus === "draft"
        ? "Draft"
          : null;
  const patientInfoChips = [
    { label: "Age", value: currentPatient.age !== null ? String(currentPatient.age) : "-" },
    { label: "Temp", value: currentPatient.temperature !== null ? `${currentPatient.temperature} F` : "-" },
    { label: "Weight", value: currentPatient.weight !== null ? `${currentPatient.weight} kg` : "-" },
    { label: "Height", value: currentPatient.height !== null ? `${currentPatient.height} cm` : "-" },
  ];
  return (
    <aside className="fixed inset-0 z-30 w-screen overflow-y-auto border-l-2 border-sky-300 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.2)] sm:p-6">
      <div className="flex min-h-full flex-col">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-slate-600">Consultation</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900">{currentPatient.name}</h2>
            <p className="mt-2 text-sm text-slate-700">
              {currentPatient.phone} · {currentPatient.reason}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {patientInfoChips.map((entry) => (
                <span
                  key={entry.label}
                  className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  {entry.label} {entry.value}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-sky-200 p-2 text-slate-700 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="grid gap-5 pr-1 xl:grid-cols-[minmax(0,1.7fr)_360px]" onSubmit={handleGenerate}>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Symptoms</span>
              <textarea
                rows={3}
                value={form.symptoms}
                onChange={(event) =>
                  setForm((current) => ({ ...current, symptoms: event.target.value }))
                }
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Chief complaints, duration, key context"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Diagnosis</span>
              <input
                value={form.diagnosis}
                onChange={(event) =>
                  setForm((current) => ({ ...current, diagnosis: event.target.value }))
                }
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Provisional or confirmed diagnosis"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Medications</span>
              <textarea
                rows={3}
                value={form.medications}
                onChange={(event) =>
                  setForm((current) => ({ ...current, medications: event.target.value }))
                }
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Prescriptions, dosage, duration"
              />
              <p className="mt-2 text-xs text-slate-500">
                Selected inventory medicines are forced into the treatment section of the generated note.
              </p>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Clinical Notes</span>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Exam findings, vitals, advice, follow-up"
              />
            </label>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-[28px] border border-sky-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Attachments</p>
                    <p className="mt-1 text-xs text-slate-500">Upload JPG, PNG, or PDF files. Images are appended to the PDF, PDFs are emailed as attachments.</p>
                  </div>
                  <label className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 transition hover:bg-sky-100">
                    Add files
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      onChange={handleAttachmentSelect}
                      className="hidden"
                    />
                  </label>
                </div>
                <div className="space-y-2">
                  {attachmentAssets.length ? attachmentAssets.map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-sky-100 bg-sky-50/40 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        {asset.content_type.startsWith("image/") ? (
                          <NextImage
                            src={`data:${asset.content_type};base64,${asset.data_base64}`}
                            alt={asset.name}
                            width={48}
                            height={48}
                            className="h-12 w-12 rounded-xl border border-sky-100 object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-sky-100 bg-white text-slate-500">
                            <Paperclip className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{asset.name}</p>
                          <p className="text-xs text-slate-500">{asset.content_type}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAsset(asset.id)}
                        className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )) : (
                    <p className="rounded-[18px] border border-dashed border-sky-200 bg-sky-50/20 px-4 py-5 text-sm text-slate-500">
                      No consultation attachments yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-sky-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Drawing</p>
                    <p className="mt-1 text-xs text-slate-500">Sketch findings, markings, or procedure notes.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDrawingMode("draw")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${drawingMode === "draw" ? "border-sky-300 bg-sky-100 text-sky-800" : "border-sky-200 bg-white text-slate-700 hover:bg-sky-50"}`}
                    >
                      <PenLine className="mr-1 inline h-3.5 w-3.5" />
                      Draw
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawingMode("erase")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${drawingMode === "erase" ? "border-sky-300 bg-sky-100 text-sky-800" : "border-sky-200 bg-white text-slate-700 hover:bg-sky-50"}`}
                    >
                      <Eraser className="mr-1 inline h-3.5 w-3.5" />
                      Erase
                    </button>
                    <button
                      type="button"
                      onClick={undoDrawing}
                      className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                    >
                      <Undo2 className="mr-1 inline h-3.5 w-3.5" />
                      Undo
                    </button>
                    <button
                      type="button"
                      onClick={clearDrawing}
                      className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Brush</span>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={brushSize}
                    onChange={(event) => setBrushSize(Number(event.target.value))}
                    className="w-36 accent-sky-500"
                  />
                  <span className="text-xs text-slate-500">{brushSize}px</span>
                </div>
                <canvas
                  ref={drawingCanvasRef}
                  width={560}
                  height={240}
                  onPointerDown={beginDrawing}
                  onPointerMove={continueDrawing}
                  onPointerUp={finishDrawing}
                  onPointerLeave={finishDrawing}
                  className="h-[220px] w-full rounded-[20px] border border-sky-100 bg-sky-50/30"
                />
                {drawingAsset ? (
                  <div className="mt-3 flex items-center gap-2 rounded-[18px] border border-sky-100 bg-sky-50/40 px-3 py-2 text-xs text-slate-600">
                    <ImageIcon className="h-4 w-4 text-sky-600" />
                    Drawing will be appended as an extra page in the generated consultation PDF.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {sectionSuggestions.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => handleSectionSuggestionClick(section.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    section.active
                      ? "border-sky-300 bg-sky-100 text-sky-800"
                      : "border-sky-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                  }`}
                >
                  {section.active ? `${section.label} Added` : `+ ${section.label}`}
                </button>
              ))}
            </div>

            <div className="rounded-[28px] border border-sky-200 bg-sky-50/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-sky-600" />
                  <span className="text-sm font-medium text-slate-900">Generated Note</span>
                </div>
                <div className="flex items-center gap-2">
                  {lifecycleLabel ? (
                    <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-600">
                      {lifecycleLabel}
                    </span>
                  ) : null}
                  <button
                    type="submit"
                    disabled={isGenerating}
                    className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
                  >
                    <Sparkles className="h-4 w-4" />
                    {isGenerating ? "Generating..." : noteStatus === "draft" ? "Refresh Draft" : "Generate Note"}
                  </button>
                </div>
              </div>
              <textarea
                rows={14}
                value={form.generatedNote}
                readOnly
                className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Saved SOAP note will appear here"
              />
              <p className="mt-2 text-xs text-slate-500">
                Saved notes are read-only. Generate again from the consultation fields if you need a different note.
                {noteStatus === "draft" ? " Sending will lock the current saved version automatically." : ""}
                {isSent ? " This note has been sent and is locked." : ""}
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-[28px] border border-sky-200 bg-sky-50/40 p-4">
              <div className="rounded-[20px] border border-sky-100 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Vitals For Note</p>
                    <p className="mt-1 text-xs text-slate-500">Filled vitals are inserted as a structured table in the generated note.</p>
                  </div>
                  {hasVitals ? (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-sky-700">
                      Included
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">BP Systolic</span>
                    <input
                      value={form.bloodPressureSystolic}
                      inputMode="numeric"
                      onChange={(event) => setForm((current) => ({ ...current, bloodPressureSystolic: event.target.value }))}
                      placeholder="120"
                      className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">BP Diastolic</span>
                    <input
                      value={form.bloodPressureDiastolic}
                      inputMode="numeric"
                      onChange={(event) => setForm((current) => ({ ...current, bloodPressureDiastolic: event.target.value }))}
                      placeholder="80"
                      className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Pulse</span>
                    <input
                      value={form.pulse}
                      inputMode="numeric"
                      onChange={(event) => setForm((current) => ({ ...current, pulse: event.target.value }))}
                      placeholder="72"
                      className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">SpO2</span>
                    <input
                      value={form.spo2}
                      inputMode="numeric"
                      onChange={(event) => setForm((current) => ({ ...current, spo2: event.target.value }))}
                      placeholder="98"
                      className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Blood Sugar</span>
                    <input
                      value={form.bloodSugar}
                      inputMode="decimal"
                      onChange={(event) => setForm((current) => ({ ...current, bloodSugar: event.target.value }))}
                      placeholder="110"
                      className="w-full rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Medicines & Suggestions</p>
                  <p className="mt-1 text-xs text-slate-500">Pick from inventory, then fill quantity and schedule for the treatment table.</p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-700">
                  {form.prescriptions.length} selected
                </span>
              </div>
              <input
                value={medicineSearch}
                onChange={(event) => setMedicineSearch(event.target.value)}
                placeholder="Search medicines by name or unit"
                className="w-full rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-emerald-400"
              />
              {form.prescriptions.length ? (
                <div className="mt-3 space-y-3">
                  {form.prescriptions.map((entry) => (
                    <div key={entry.itemId} className="rounded-[22px] border border-emerald-100 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{entry.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{entry.unit || "unit not set"}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePrescription(entry.itemId)}
                          className="rounded-full border border-emerald-200 p-2 text-slate-600 transition hover:bg-emerald-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Quantity</span>
                          <input
                            value={entry.quantity}
                            inputMode="decimal"
                            onChange={(event) => updatePrescription(entry.itemId, { quantity: event.target.value })}
                            placeholder="10"
                            className="w-full rounded-2xl border border-emerald-100 bg-emerald-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-400"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Duration</span>
                          <input
                            value={entry.duration}
                            onChange={(event) => updatePrescription(entry.itemId, { duration: event.target.value })}
                            placeholder="5 days"
                            className="w-full rounded-2xl border border-emerald-100 bg-emerald-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-400"
                          />
                        </label>
                      </div>
                      <div className="mt-3">
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Notes</p>
                        <div className="flex flex-wrap gap-2">
                          {PRESCRIPTION_NOTE_OPTIONS.map((option) => {
                            const active = normalizePrescriptionNotes(entry.notes).includes(option);
                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() =>
                                  updatePrescription(entry.itemId, {
                                    notes: togglePrescriptionNoteValue(entry.notes, option),
                                  })
                                }
                                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                  active
                                    ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                                    : "border-emerald-200 bg-white text-slate-700 hover:bg-emerald-50"
                                }`}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="mt-3">
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Schedule</p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { key: "morning" as const, label: "Morning" },
                            { key: "afternoon" as const, label: "Afternoon" },
                            { key: "night" as const, label: "Night" },
                          ].map((slot) => (
                            <button
                              key={slot.key}
                              type="button"
                              onClick={() => updatePrescription(entry.itemId, { [slot.key]: !entry[slot.key] })}
                              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                entry[slot.key]
                                  ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                                  : "border-emerald-200 bg-white text-slate-700 hover:bg-emerald-50"
                              }`}
                            >
                              {slot.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                {filteredMedicineItems.length ? (
                  filteredMedicineItems.slice(0, 12).map((item) => {
                    const active = selectedMedicineIds.includes(item.id);
                    const outOfStock = item.track_inventory && item.stock_quantity <= 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleMedicine(item.id)}
                        disabled={outOfStock}
                        className={`flex w-full items-center justify-between gap-3 rounded-[22px] border px-4 py-3 text-left transition ${
                          active
                            ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                            : "border-emerald-100 bg-white text-slate-700 hover:bg-emerald-50"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">{item.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.default_price.toFixed(2)}{item.unit ? ` · ${item.unit}` : ""}
                            {item.track_inventory ? ` · Stock ${item.stock_quantity}` : ""}
                          </p>
                        </div>
                        <span className="rounded-full border border-emerald-200 px-3 py-1 text-xs font-medium">
                          {active ? "Selected" : outOfStock ? "Out of stock" : "Add"}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="rounded-[22px] border border-dashed border-emerald-200 bg-white px-4 py-6 text-sm text-slate-500">
                    No medicines match this search.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-sky-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-900">Structured Add-ons</p>
              <p className="mt-1 text-xs text-slate-500">Turn on the extra clinical tables only when you need them.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {sectionSuggestions.map((section) => (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => handleSectionSuggestionClick(section.key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      section.active
                        ? "border-sky-300 bg-sky-100 text-sky-800"
                        : "border-sky-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                    }`}
                  >
                    {section.active ? `${section.label} Added` : `+ ${section.label}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-sky-200 pt-4">
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-700">{statusMessage || "Ready to generate and send."}</p>
                <div className="flex flex-col gap-3">
                  {isFollowUpOpen ? (
                    <div className="rounded-[24px] border border-sky-200 bg-sky-50/40 p-4">
                      <div className="grid gap-3">
                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-slate-700">Follow-up Date</span>
                          <input
                            type="date"
                            value={form.followUpDate}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, followUpDate: event.target.value }))
                            }
                            className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-slate-700">Follow-up Notes</span>
                          <input
                            value={form.followUpNotes}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, followUpNotes: event.target.value }))
                            }
                            placeholder="Review symptoms, BP check, lab result review"
                            className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-[24px] border border-sky-200 bg-sky-50/40 p-4">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                        Recipient email
                      </span>
                      <input
                        type="email"
                        value={recipientEmail}
                        onChange={(event) => setRecipientEmail(event.target.value)}
                        placeholder="patient@example.com"
                        className="w-full rounded-2xl border border-sky-100 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400"
                      />
                    </label>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      disabled={isSending || !currentNoteId || isSent || !recipientEmail.trim()}
                      onClick={handleSend}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
                    >
                      <Mail className="h-4 w-4" />
                      {isSending ? "Sending..." : isSent ? "Sent and Locked" : "Send Email"}
                    </button>
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          disabled={isGeneratingPdf || !currentNoteId}
                          onClick={() => handlePdf("preview")}
                          className="inline-flex min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
                        >
                          <Eye className="h-4 w-4" />
                          {isGeneratingPdf ? "Preparing..." : "Preview"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsFollowUpOpen((current) => !current)}
                          className="inline-flex min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
                        >
                          <CalendarPlus2 className="h-4 w-4" />
                          {isFollowUpOpen ? "Hide" : "Follow-up"}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={isCompleting || noteStatus === "draft" || !currentNoteId}
                        onClick={handleDone}
                        className="inline-flex min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
                      >
                        {isCompleting ? "Moving..." : "Done"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
      <StructuredModal
        open={isVitalsOpen}
        title="Vitals & Measurements"
        description="Structured vitals are inserted into the generated consultation note."
        onClose={() => setIsVitalsOpen(false)}
        onSave={() => setIsVitalsOpen(false)}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">BP</span>
            <div className="flex gap-2">
              <input value={form.bloodPressureSystolic} inputMode="numeric" onChange={(event) => setForm((current) => ({ ...current, bloodPressureSystolic: event.target.value }))} placeholder="120" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              <input value={form.bloodPressureDiastolic} inputMode="numeric" onChange={(event) => setForm((current) => ({ ...current, bloodPressureDiastolic: event.target.value }))} placeholder="80" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
            </div>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Pulse</span>
            <input value={form.pulse} inputMode="numeric" onChange={(event) => setForm((current) => ({ ...current, pulse: event.target.value }))} placeholder="72 bpm" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">SpO2</span>
            <input value={form.spo2} inputMode="numeric" onChange={(event) => setForm((current) => ({ ...current, spo2: event.target.value }))} placeholder="98" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Blood Sugar</span>
            <input value={form.bloodSugar} inputMode="decimal" onChange={(event) => setForm((current) => ({ ...current, bloodSugar: event.target.value }))} placeholder="110" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
          </label>
        </div>
      </StructuredModal>
      <StructuredModal
        open={isTestScoresOpen}
        title="Test Scores"
        description="Add structured test results like visual acuity, pain score, or other measured findings."
        onClose={() => setIsTestScoresOpen(false)}
        onSave={() => setIsTestScoresOpen(false)}
      >
        <div className="flex justify-end">
          <button type="button" onClick={addTestScore} className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100">
            Add Score
          </button>
        </div>
        <div className="space-y-3">
          {form.testScores.map((entry) => (
            <div key={entry.id} className="grid gap-3 md:grid-cols-[1fr_1fr_44px]">
              <input value={entry.label} onChange={(event) => updateTestScore(entry.id!, { label: event.target.value })} placeholder="Test name" className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              <input value={entry.value} onChange={(event) => updateTestScore(entry.id!, { value: event.target.value })} placeholder="Result" className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              <button type="button" onClick={() => removeTestScore(entry.id!)} className="rounded-full border border-sky-200 bg-white p-2 text-slate-600 transition hover:bg-sky-50">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </StructuredModal>
      <StructuredModal
        open={isEyeExamOpen}
        title="Eye Exam"
        description="Capture refraction and vision entries for the right and left eye."
        onClose={() => setIsEyeExamOpen(false)}
        onSave={() => setIsEyeExamOpen(false)}
      >
        <div className="grid gap-3 md:grid-cols-[110px_repeat(4,minmax(0,1fr))]">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Eye</div>
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Sphere</div>
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Cylinder</div>
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Axis</div>
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Vision</div>
          {form.eyeExam.map((entry) => (
            <Fragment key={entry.eye}>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-sm font-medium capitalize text-slate-700">{entry.eye}</div>
              <input value={entry.sphere} onChange={(event) => updateEyeExam(entry.eye, { sphere: event.target.value })} placeholder="-1.25" className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              <input value={entry.cylinder} onChange={(event) => updateEyeExam(entry.eye, { cylinder: event.target.value })} placeholder="-0.50" className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              <input value={entry.axis} onChange={(event) => updateEyeExam(entry.eye, { axis: event.target.value })} placeholder="90" className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
              <input value={entry.vision} onChange={(event) => updateEyeExam(entry.eye, { vision: event.target.value })} placeholder="6/6" className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
            </Fragment>
          ))}
        </div>
      </StructuredModal>
      <StructuredModal
        open={isContactLensOpen}
        title="Contact Lens"
        description="Assessment, trial fit, and vendor-facing order details for optometry consultations."
        onClose={() => setIsContactLensOpen(false)}
        onSave={() => setIsContactLensOpen(false)}
      >
        <div className="space-y-5">
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Assessment</p>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Wearing Goal</span><input value={form.contactLens.wearing_goal} onChange={(event) => updateContactLens({ wearing_goal: event.target.value })} placeholder="Daily wear, events, sports, cosmetic use" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Current Lens Brand</span><input value={form.contactLens.current_lens_brand} onChange={(event) => updateContactLens({ current_lens_brand: event.target.value })} placeholder="If already a wearer" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Wear Schedule</span><input value={form.contactLens.current_wear_schedule} onChange={(event) => updateContactLens({ current_wear_schedule: event.target.value })} placeholder="8-10 hours/day, occasional wear" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Replacement Frequency</span><input value={form.contactLens.replacement_frequency} onChange={(event) => updateContactLens({ replacement_frequency: event.target.value })} placeholder="Daily, biweekly, monthly" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Comfort Issues</span><textarea rows={3} value={form.contactLens.comfort_issues} onChange={(event) => updateContactLens({ comfort_issues: event.target.value })} className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Dryness Symptoms</span><textarea rows={3} value={form.contactLens.dryness_symptoms} onChange={(event) => updateContactLens({ dryness_symptoms: event.target.value })} className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Handling Issues</span><textarea rows={3} value={form.contactLens.handling_issues} onChange={(event) => updateContactLens({ handling_issues: event.target.value })} className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
              <div className="grid gap-4">
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Care Solution</span><input value={form.contactLens.care_solution} onChange={(event) => updateContactLens({ care_solution: event.target.value })} className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Allergy History</span><input value={form.contactLens.allergy_history} onChange={(event) => updateContactLens({ allergy_history: event.target.value })} className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
              </div>
            </div>
            <label className="mt-4 block"><span className="mb-2 block text-sm font-medium text-slate-700">Assessment Notes</span><textarea rows={3} value={form.contactLens.assessment_notes} onChange={(event) => updateContactLens({ assessment_notes: event.target.value })} placeholder="Suitability, slit lamp findings, patient preferences" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
          </div>
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Order Details</p>
            <div className="grid gap-4 md:grid-cols-2">
              {[
                ["Lens Type", "lens_type", "Soft toric, multifocal, RGP"],
                ["Manufacturer", "manufacturer", "Acuvue, Bausch + Lomb"],
                ["Brand", "brand", "Oasys, Biofinity"],
                ["Wear Modality", "wear_modality", "Daily, monthly"],
                ["Trial Lens Used", "trial_lens_used", "Trial parameters used in chair"],
                ["Vendor Name", "vendor_name", "Manufacturer or distributor contact"],
                ["Quantity", "quantity", "Boxes, pairs, trial set"],
              ].map(([label, key, placeholder]) => (
                <label key={String(key)} className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                  <input value={form.contactLens[key as keyof ContactLensPayload] as string} onChange={(event) => updateContactLens({ [key]: event.target.value } as Partial<ContactLensPayload>)} placeholder={String(placeholder)} className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" />
                </label>
              ))}
            </div>
            <label className="mt-4 block"><span className="mb-2 block text-sm font-medium text-slate-700">Special Instructions</span><textarea rows={3} value={form.contactLens.special_instructions} onChange={(event) => updateContactLens({ special_instructions: event.target.value })} placeholder="Vendor notes, follow-up, handling instructions" className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400" /></label>
          </div>
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Right / Left Eye Parameters</p>
            <div className="grid gap-3 md:grid-cols-[110px_repeat(9,minmax(0,1fr))]">
              {["Eye", "Sphere", "Cylinder", "Axis", "BC", "Dia", "Add", "VA", "Over Ref", "Fit Notes"].map((label) => (
                <div key={label} className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</div>
              ))}
              {form.contactLens.eyes.map((entry) => (
                <Fragment key={entry.eye}>
                  <div className="rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-sm font-medium capitalize text-slate-700">{entry.eye}</div>
                  <input value={entry.sphere} onChange={(event) => updateContactLensEye(entry.eye, { sphere: event.target.value })} className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400" placeholder="-1.25" />
                  <input value={entry.cylinder} onChange={(event) => updateContactLensEye(entry.eye, { cylinder: event.target.value })} className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400" placeholder="-0.75" />
                  <input value={entry.axis} onChange={(event) => updateContactLensEye(entry.eye, { axis: event.target.value })} className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400" placeholder="90" />
                  <input value={entry.base_curve} onChange={(event) => updateContactLensEye(entry.eye, { base_curve: event.target.value })} className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400" placeholder="8.6" />
                  <input value={entry.diameter} onChange={(event) => updateContactLensEye(entry.eye, { diameter: event.target.value })} className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400" placeholder="14.2" />
                  <input value={entry.add_power} onChange={(event) => updateContactLensEye(entry.eye, { add_power: event.target.value })} className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400" placeholder="+1.50" />
                  <input value={entry.visual_acuity} onChange={(event) => updateContactLensEye(entry.eye, { visual_acuity: event.target.value })} className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400" placeholder="6/6" />
                  <input value={entry.over_refraction} onChange={(event) => updateContactLensEye(entry.eye, { over_refraction: event.target.value })} className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400" placeholder="-0.25 DS" />
                  <input value={entry.fit_notes} onChange={(event) => updateContactLensEye(entry.eye, { fit_notes: event.target.value })} className="rounded-2xl border border-sky-100 bg-sky-50/50 px-3 py-3 text-slate-800 outline-none transition focus:border-sky-400" placeholder="Good centration" />
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </StructuredModal>
      <BinocularVisionModal
        open={isBinocularVisionOpen}
        value={form.binocularVision}
        onClose={() => setIsBinocularVisionOpen(false)}
        onSave={saveBinocularVision}
      />
      <LowVisionModal
        open={isLowVisionOpen}
        value={form.lowVision}
        onClose={() => setIsLowVisionOpen(false)}
        onSave={saveLowVision}
      />
      <MyopiaManagementModal
        open={isMyopiaManagementOpen}
        value={form.myopiaManagement}
        patientAge={currentPatient.age}
        onClose={() => setIsMyopiaManagementOpen(false)}
        onSave={saveMyopiaManagement}
      />
    </aside>
  );
}
