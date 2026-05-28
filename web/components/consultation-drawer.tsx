"use client";

import { ChangeEvent, Fragment, FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus2, Eye, Eraser, FileText, Image as ImageIcon, Mail, Paperclip, PenLine, Plus, Sparkles, Undo2, X } from "lucide-react";
import NextImage from "next/image";
import type { ReactNode } from "react";

import type { ClinicSpecialty } from "@/lib/clinic-specialty";
import { specialtyHasModule } from "@/lib/specialty";
import { clearConsultationWorkspace, readConsultationWorkspace, writeConsultationWorkspace } from "@/lib/consultation-workspace";
import { AuthUser, BinocularVisionPayload, CatalogItem, ContactLensEyeEntry, ContactLensPayload, EyeExamEntry, LowVisionPayload, MyopiaMeasurementPayload, NoteAsset, Patient, PediatricGrowthMeasurementPayload, TestScoreEntry, WellChildVisitPayload } from "@/lib/types";
import { api } from "@/lib/api";
import { BinocularVisionModal } from "@/components/optometry/binocular-vision-modal";
import { ContactLensModal } from "@/components/optometry/contact-lens-modal";
import { LowVisionModal } from "@/components/optometry/low-vision-modal";
import { MyopiaManagementModal } from "@/components/optometry/myopia-management-modal";
import {
  buildBinocularVisionSummary,
  buildLowVisionSummary,
  buildMyopiaManagementSummary,
  createEmptyBinocularVision,
  createEmptyContactLens,
  createEmptyLowVision,
  createEmptyMyopiaManagement,
  formatLocalDateTimeInput,
  hasBinocularVisionData,
  hasContactLensData,
  hasContactLensEyeData,
  hasLowVisionData,
  hasMyopiaManagementData,
  type MyopiaMeasurementDraft,
} from "@/lib/optometry/consultation";

function createId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const MAX_ATTACHMENT_SIZE_BYTES = 6 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 6;
const SUPPORTED_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const PEDIATRIC_FOLLOW_UP_DEFAULTS: Record<string, { days: number; interval: string; notePrefix: string }> = {
  routine_review: { days: 90, interval: "3 months", notePrefix: "Routine pediatric review" },
  growth_recheck: { days: 60, interval: "2 months", notePrefix: "Growth recheck" },
  symptom_follow_up: { days: 14, interval: "2 weeks", notePrefix: "Symptom follow-up" },
  counseling_review: { days: 30, interval: "1 month", notePrefix: "Counseling review" },
};

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
  currentUser?: AuthUser | null;
  clinicSpecialty?: ClinicSpecialty | null;
  emailConfigured?: boolean;
  hasUserSignature?: boolean;
  hasClinicDocumentTemplate?: boolean;
  isTrainingMode?: boolean;
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
    structured_modules?: Array<{ module_type: string; payload: Record<string, unknown> }>;
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
    contactLens: createEmptyContactLens(),
    binocularVision: createEmptyBinocularVision(),
    lowVision: createEmptyLowVision(),
    myopiaManagement: createEmptyMyopiaManagement(),
    growthMeasurement: {
      measured_at: formatLocalDateTimeInput(new Date()),
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

type ConsultationWorkspaceSnapshot = {
  form: ReturnType<typeof createEmptyForm>;
  openSections: {
    attachments?: boolean;
    drawing?: boolean;
    medicines?: boolean;
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

type InlineModuleKey = "vitals" | "medicines";
type PediatricModuleKey = "growth" | "wellChild" | "parentHandout" | "pediatricFollowUp";

function createClosedConsultationSections() {
  return {
    attachments: false,
    drawing: false,
    medicines: false,
    vitals: false,
    testScores: false,
    eyeExam: false,
    contactLens: false,
    binocularVision: false,
    lowVision: false,
    myopiaManagement: false,
  };
}

function prescriptionScheduleLabel(prescription: PrescriptionDraft) {
  const parts = [
    prescription.morning ? "Morning" : "",
    prescription.afternoon ? "Afternoon" : "",
    prescription.night ? "Night" : "",
  ].filter(Boolean);
  return parts.join(", ") || "As directed";
}

function addDaysToDateInput(days: number) {
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function ConsultationExpandableCard({
  title,
  description,
  open,
  onToggle,
  badge,
  tone = "sky",
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  badge?: ReactNode;
  tone?: "sky" | "amber" | "emerald";
  children?: ReactNode;
}) {
  const toneClasses = {
    sky: {
      section: "border-[#bfd7e8] bg-white/80",
      icon: "border-[#bfd7e8] bg-[#f3f8fb] hover:bg-[#dbeaf4]",
    },
    amber: {
      section: "border-amber-200 bg-white/80",
      icon: "border-amber-200 bg-amber-50 hover:bg-amber-100",
    },
    emerald: {
      section: "border-emerald-200 bg-white/80",
      icon: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100",
    },
  }[tone];

  return (
    <section className={`rounded-[18px] border p-4 ${toneClasses.section}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 text-left"
      >
        <div>
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {badge}
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl border text-slate-900 transition ${toneClasses.icon}`}>
            <Plus className={`h-6 w-6 transition-transform ${open ? "rotate-45" : ""}`} />
          </span>
        </div>
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

function ConsultationModuleRailItem({
  title,
  description,
  active = false,
  onSelect,
  children,
}: {
  title: string;
  description: string;
  active?: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="border-t border-[#dbe7ef] first:border-t-0">
      <button
        type="button"
        onClick={onSelect}
        className={`block w-full px-4 py-4 text-left transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#6daed8] ${
          active ? "bg-[#f3f8fb]/70" : "bg-white hover:bg-[#f3f8fb]/60"
        }`}
      >
        <span className="block text-base font-semibold leading-tight text-slate-900">{title}</span>
        <span className="mt-1 block text-sm leading-5 text-slate-500">{description}</span>
      </button>
      {active && children ? <div className="bg-[#f3f8fb]/30 px-3 pb-3">{children}</div> : null}
    </div>
  );
}

function ConsultationModuleDetail({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-[#bfd7e8] bg-white/90 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{title}</p>
      {children}
    </section>
  );
}

function SpecialtyModuleModal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[20px] border border-[#bfd7e8] bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Specialty Module</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-[#bfd7e8] p-2 text-slate-600 transition hover:bg-[#f3f8fb]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function ConsultationDrawer({
  patient,
  currentUser = null,
  clinicSpecialty = null,
  emailConfigured = false,
  hasUserSignature = false,
  hasClinicDocumentTemplate = false,
  isTrainingMode = false,
  onClose,
  onDone,
  onGenerate,
  onGeneratePdf,
  onSend,
}: ConsultationDrawerProps) {
  const isOptometryClinic = specialtyHasModule(clinicSpecialty, "eye_exam");
  const isPediatricsClinic = specialtyHasModule(clinicSpecialty, "pediatric_growth_measurement");
  const [form, setForm] = useState(createEmptyForm);
  const [openSections, setOpenSections] = useState(createClosedConsultationSections);
  const [activeInlineModule, setActiveInlineModule] = useState<InlineModuleKey | null>(null);
  const [activePediatricModule, setActivePediatricModule] = useState<PediatricModuleKey | null>(null);
  const [medicineItems, setMedicineItems] = useState<CatalogItem[]>([]);
  const [medicineSearch, setMedicineSearch] = useState("");
  const [selectedMedicineIds, setSelectedMedicineIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
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
  const [isGeneratingHandout, setIsGeneratingHandout] = useState(false);
  const [isGeneratingHandoutPdf, setIsGeneratingHandoutPdf] = useState(false);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingHistoryRef = useRef<string[]>([]);
  const patientId = patient?.id ?? "";
  const currentUserId = currentUser?.id ?? "";
  const currentOrgId = currentUser?.org_id ?? "";
  const workspaceScope = useMemo(
    () => {
      if (!patientId || !currentUserId || !currentOrgId) {
        return null;
      }
      return { orgId: currentOrgId, userId: currentUserId, patientId };
    },
    [currentOrgId, currentUserId, patientId],
  );

  useEffect(() => {
    if (!patient) {
      return;
    }

    let active = true;
    const cachedWorkspace = workspaceScope
      ? readConsultationWorkspace<ConsultationWorkspaceSnapshot>(workspaceScope, {
          legacyPatientId: patient.id,
        })
      : null;
    const baseForm = createEmptyForm();
    const cachedForm = cachedWorkspace?.form;
    setStatusMessage("");
    setIsGenerating(false);
    setIsGeneratingPdf(false);
    setIsGeneratingHandout(false);
    setIsGeneratingHandoutPdf(false);
    setIsCompleting(false);
    setIsSending(false);
    setIsEyeExamOpen(false);
    setIsContactLensOpen(false);
    setIsBinocularVisionOpen(false);
    setIsLowVisionOpen(false);
    setIsMyopiaManagementOpen(false);
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
            growthMeasurement: {
              ...baseForm.growthMeasurement,
              ...(cachedForm.growthMeasurement || {}),
            },
            wellChildVisit: {
              ...baseForm.wellChildVisit,
              ...(cachedForm.wellChildVisit || {}),
            },
            parentHandoutRequest: {
              ...baseForm.parentHandoutRequest,
              ...(cachedForm.parentHandoutRequest || {}),
            },
            pediatricFollowUpPlan: {
              ...baseForm.pediatricFollowUpPlan,
              ...(cachedForm.pediatricFollowUpPlan || {}),
            },
          }
        : baseForm,
    );
    setOpenSections(
      {
        ...createClosedConsultationSections(),
        ...(cachedWorkspace?.openSections ?? {}),
      },
    );
    setActiveInlineModule(null);
    setActivePediatricModule(null);
    setSelectedMedicineIds(
      cachedWorkspace?.selectedMedicineIds ?? cachedWorkspace?.form.prescriptions.map((entry) => entry.itemId) ?? [],
    );
    setIsFollowUpOpen(cachedWorkspace?.isFollowUpOpen ?? false);
    setHasGeneratedNote(cachedWorkspace?.hasGeneratedNote ?? false);
    setCurrentNoteId(cachedWorkspace?.currentNoteId ?? "");
    setNoteStatus(cachedWorkspace?.noteStatus ?? "");
    setIsSent(cachedWorkspace?.isSent ?? false);
    setRecipientEmail(cachedWorkspace?.recipientEmail ?? patient.email ?? "");

    void Promise.all([
      api.listCatalogItems(),
      isTrainingMode ? Promise.resolve([]) : api.listPatientNotes(patient.id),
    ])
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
  }, [isTrainingMode, patient, workspaceScope]);

  useEffect(() => {
    if (!patient || !workspaceScope) {
      return;
    }

    writeConsultationWorkspace(workspaceScope, {
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
    workspaceScope,
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
  const setupWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (!emailConfigured) {
      warnings.push("Clinic sender email is not configured yet. Email actions can fail until Clinic Settings is finished.");
    }
    if (!hasUserSignature) {
      warnings.push("Your signature is missing. Generated notes and letters will not include doctor signoff yet.");
    }
    if (!hasClinicDocumentTemplate) {
      warnings.push("No clinic paper template is uploaded. PDFs will use the fallback header and footer layout.");
    }
    return warnings;
  }, [emailConfigured, hasClinicDocumentTemplate, hasUserSignature]);

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
  }, [drawingAsset, openSections.drawing]);

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
      const structuredModules: Array<{ module_type: string; payload: Record<string, unknown> }> = [];
      if (isPediatricsClinic && form.growthMeasurement.height_cm && form.growthMeasurement.weight_kg) {
        structuredModules.push({
          module_type: "pediatric_growth_measurement",
          payload: {
            measured_at: new Date(form.growthMeasurement.measured_at).toISOString(),
            height_cm: Number(form.growthMeasurement.height_cm),
            weight_kg: Number(form.growthMeasurement.weight_kg),
            head_circumference_cm: form.growthMeasurement.head_circumference_cm ? Number(form.growthMeasurement.head_circumference_cm) : null,
            visit_notes: form.growthMeasurement.visit_notes.trim(),
          },
        });
      }
      if (isPediatricsClinic && (
        form.wellChildVisit.nutrition_summary.trim() ||
        form.wellChildVisit.sleep_summary.trim() ||
        form.wellChildVisit.elimination_summary.trim() ||
        form.wellChildVisit.school_behavior_summary.trim() ||
        form.wellChildVisit.parent_concerns.trim() ||
        form.wellChildVisit.assessment_summary.trim()
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
        form.pediatricFollowUpPlan.preset_key.trim() ||
        form.pediatricFollowUpPlan.suggested_interval.trim() ||
        form.pediatricFollowUpPlan.notes.trim()
      )) {
        structuredModules.push({
          module_type: "pediatric_follow_up_plan",
          payload: form.pediatricFollowUpPlan,
        });
      }
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
        eye_exam: isOptometryClinic
          ? form.eyeExam.filter((entry) =>
              entry.sphere.trim() || entry.cylinder.trim() || entry.axis.trim() || entry.vision.trim(),
            )
          : [],
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
        structured_modules: structuredModules,
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
      if (workspaceScope) {
        clearConsultationWorkspace(workspaceScope);
      }
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
      if (workspaceScope) {
        clearConsultationWorkspace(workspaceScope);
      }
      onClose();
    } finally {
      setIsCompleting(false);
    }
  }

  function toggleConsultationSection(section: keyof ReturnType<typeof createClosedConsultationSections>) {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  function openOptometryModule(section: "contactLens" | "binocularVision" | "lowVision" | "myopiaManagement") {
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
    setIsMyopiaManagementOpen(true);
  }

  function openEyeExamModule() {
    setIsEyeExamOpen(true);
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
    if (isTrainingMode) {
      const recordId = next.record_id || createId();
      setForm((current) => ({
        ...current,
        myopiaManagement: {
          ...next,
          record_id: recordId,
        },
      }));
      setStatusMessage(buildMyopiaManagementSummary({
        ...next,
        record_id: recordId,
      }));
      return;
    }
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

  async function saveGrowthMeasurement() {
    if (!currentPatient || !form.growthMeasurement.height_cm || !form.growthMeasurement.weight_kg) {
      setStatusMessage("Enter pediatric height and weight before saving growth.");
      return;
    }
    const payload: PediatricGrowthMeasurementPayload = {
      measured_at: new Date(form.growthMeasurement.measured_at).toISOString(),
      height_cm: Number(form.growthMeasurement.height_cm),
      weight_kg: Number(form.growthMeasurement.weight_kg),
      head_circumference_cm: form.growthMeasurement.head_circumference_cm ? Number(form.growthMeasurement.head_circumference_cm) : null,
      visit_notes: form.growthMeasurement.visit_notes.trim(),
    };
    if (isTrainingMode) {
      const bmi = payload.weight_kg / ((payload.height_cm / 100) ** 2);
      setForm((current) => ({
        ...current,
        growthMeasurement: {
          ...current.growthMeasurement,
          savedRecord: { bmi, track_id: "training" },
        },
      }));
      setStatusMessage(`Growth saved in Training Mode · BMI ${bmi.toFixed(2)}`);
      return;
    }
    const saved = await api.createPatientGrowthRecord(currentPatient.id, payload);
    setForm((current) => ({
      ...current,
      growthMeasurement: {
        ...current.growthMeasurement,
        measured_at: formatLocalDateTimeInput(new Date(saved.measured_at)),
        height_cm: String(saved.height_cm),
        weight_kg: String(saved.weight_kg),
        head_circumference_cm: saved.head_circumference_cm !== null ? String(saved.head_circumference_cm) : "",
        visit_notes: saved.visit_notes,
        savedRecord: { bmi: saved.bmi, track_id: saved.track_id },
      },
    }));
    setStatusMessage(`Growth saved · BMI ${saved.bmi.toFixed(2)}`);
  }

  async function handleGenerateParentHandout() {
    if (!currentPatient) {
      return;
    }
    setIsGeneratingHandout(true);
    setStatusMessage("");
    try {
      if (isTrainingMode) {
        const title = "Training Parent Handout";
        const content = [
          title,
          "",
          `Patient: ${currentPatient.name}`,
          form.parentHandoutRequest.instructions.trim() || "Practice instructions entered in Training Mode.",
          "",
          "This handout was generated locally in Training Mode.",
        ].join("\n");
        setForm((current) => ({
          ...current,
          parentHandoutRequest: {
            ...current.parentHandoutRequest,
            generated_title: title,
            generated_content: content,
          },
        }));
        setStatusMessage(`${title} generated.`);
        return;
      }
      const response = await api.generateParentHandout({
        patient_id: currentPatient.id,
        template_key: form.parentHandoutRequest.template_key,
        instructions: form.parentHandoutRequest.instructions.trim(),
        well_child_visit: form.wellChildVisit,
      });
      setForm((current) => ({
        ...current,
        parentHandoutRequest: {
          ...current.parentHandoutRequest,
          generated_title: response.title,
          generated_content: response.content,
        },
      }));
      setStatusMessage(`${response.title} generated.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to generate parent handout.");
    } finally {
      setIsGeneratingHandout(false);
    }
  }

  async function handleParentHandoutPdf(action: "preview" | "download") {
    if (!form.parentHandoutRequest.generated_content.trim()) {
      setStatusMessage("Generate the parent handout before previewing the PDF.");
      return;
    }
    setIsGeneratingHandoutPdf(true);
    try {
      if (isTrainingMode) {
        setStatusMessage("Disabled in Training Mode. Nothing is sent or saved to the clinic.");
        return;
      }
      const blob = await api.generateLetterPdf({
        content: form.parentHandoutRequest.generated_content,
      });
      const url = URL.createObjectURL(blob);
      const fileBase = (form.parentHandoutRequest.generated_title || "parent_handout")
        .replace(/\s+/g, "_")
        .toLowerCase();

      if (action === "preview") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${fileBase}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setStatusMessage("Parent handout PDF ready.");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare parent handout PDF.");
    } finally {
      setIsGeneratingHandoutPdf(false);
    }
  }

  function applyPediatricFollowUpPreset() {
    const preset = PEDIATRIC_FOLLOW_UP_DEFAULTS[form.pediatricFollowUpPlan.preset_key] ?? PEDIATRIC_FOLLOW_UP_DEFAULTS.routine_review;
    const interval = form.pediatricFollowUpPlan.suggested_interval.trim() || preset.interval;
    const extraNotes = form.pediatricFollowUpPlan.notes.trim();
    const noteParts = [`${preset.notePrefix} in ${interval}.`];
    if (extraNotes) {
      noteParts.push(extraNotes);
    }
    setForm((current) => ({
      ...current,
      pediatricFollowUpPlan: {
        ...current.pediatricFollowUpPlan,
        suggested_interval: interval,
      },
      followUpDate: addDaysToDateInput(preset.days),
      followUpNotes: noteParts.join(" "),
    }));
    setIsFollowUpOpen(true);
    setStatusMessage(`Follow-up preset applied for ${interval}.`);
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
    <aside className="fixed inset-0 z-30 w-screen overflow-y-auto border-l-2 border-[#9fc7e1] bg-white p-5 shadow-[0_20px_60px_rgba(64,131,181,0.10)] sm:p-6">
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
                  className="rounded-xl border border-[#bfd7e8] bg-[#f3f8fb] px-3 py-1 text-xs font-medium text-slate-700"
                >
                  {entry.label} {entry.value}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#bfd7e8] p-2 text-slate-700 transition hover:text-slate-900"
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
                className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
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
                className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
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
                className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
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
                className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
                placeholder="Exam findings, vitals, advice, follow-up"
              />
            </label>

            <div className="grid gap-4 xl:grid-cols-2">
              <ConsultationExpandableCard
                title="Attachments"
                description="Upload JPG, PNG, or PDF files. Images are appended to the PDF, PDFs are emailed as attachments."
                open={openSections.attachments}
                onToggle={() => toggleConsultationSection("attachments")}
                badge={
                  attachmentAssets.length ? (
                    <span className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2a6fa8]">
                      {attachmentAssets.length} file{attachmentAssets.length === 1 ? "" : "s"}
                    </span>
                  ) : null
                }
              >
                <label className="mb-3 inline-flex rounded-xl border border-[#9fc7e1] bg-[#f3f8fb] px-3 py-1.5 text-xs font-medium text-[#235f8e] transition hover:bg-[#dbeaf4]">
                  Add files
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    onChange={handleAttachmentSelect}
                    className="hidden"
                  />
                </label>
                <div className="space-y-2">
                  {attachmentAssets.length ? attachmentAssets.map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-[#dbe7ef] bg-[#f3f8fb]/40 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        {asset.content_type.startsWith("image/") ? (
                          <NextImage
                            src={`data:${asset.content_type};base64,${asset.data_base64}`}
                            alt={asset.name}
                            width={48}
                            height={48}
                            className="h-12 w-12 rounded-xl border border-[#dbe7ef] object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#dbe7ef] bg-white text-slate-500">
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
                        className="rounded-xl border border-[#bfd7e8] p-2 text-slate-600 transition hover:bg-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )) : (
                    <p className="rounded-[18px] border border-dashed border-[#bfd7e8] bg-[#f3f8fb]/20 px-4 py-5 text-sm text-slate-500">
                      No consultation attachments yet.
                    </p>
                  )}
                </div>
              </ConsultationExpandableCard>

              <ConsultationExpandableCard
                title="Drawing"
                description="Sketch findings, markings, or procedure notes."
                open={openSections.drawing}
                onToggle={() => toggleConsultationSection("drawing")}
                badge={
                  drawingAsset ? (
                    <span className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2a6fa8]">
                      Drawing added
                    </span>
                  ) : null
                }
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDrawingMode("draw")}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${drawingMode === "draw" ? "border-[#9fc7e1] bg-[#dbeaf4] text-[#235f8e]" : "border-[#bfd7e8] bg-white text-slate-700 hover:bg-[#f3f8fb]"}`}
                    >
                      <PenLine className="mr-1 inline h-3.5 w-3.5" />
                      Draw
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawingMode("erase")}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${drawingMode === "erase" ? "border-[#9fc7e1] bg-[#dbeaf4] text-[#235f8e]" : "border-[#bfd7e8] bg-white text-slate-700 hover:bg-[#f3f8fb]"}`}
                    >
                      <Eraser className="mr-1 inline h-3.5 w-3.5" />
                      Erase
                    </button>
                    <button
                      type="button"
                      onClick={undoDrawing}
                      className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-[#f3f8fb]"
                    >
                      <Undo2 className="mr-1 inline h-3.5 w-3.5" />
                      Undo
                    </button>
                    <button
                      type="button"
                      onClick={clearDrawing}
                      className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-[#f3f8fb]"
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
                    className="w-36 accent-[#2f8fd3]"
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
                  className="h-[220px] w-full rounded-[20px] border border-[#dbe7ef] bg-[#f3f8fb]/30"
                />
                {drawingAsset ? (
                  <div className="mt-3 flex items-center gap-2 rounded-[18px] border border-[#dbe7ef] bg-[#f3f8fb]/40 px-3 py-2 text-xs text-slate-600">
                    <ImageIcon className="h-4 w-4 text-[#2f8fd3]" />
                    Drawing will be appended as an extra page in the generated consultation PDF.
                  </div>
                ) : null}
              </ConsultationExpandableCard>
            </div>

            <div className="rounded-[18px] border border-[#bfd7e8] bg-[#f3f8fb]/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[#2f8fd3]" />
                  <span className="text-sm font-medium text-slate-900">Generated Note</span>
                </div>
                <div className="flex items-center gap-2">
                  {lifecycleLabel ? (
                    <span className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-600">
                      {lifecycleLabel}
                    </span>
                  ) : null}
                  <button
                    type="submit"
                    disabled={isGenerating}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
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
                className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-[#6daed8]"
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
            <section className="overflow-hidden rounded-[18px] border border-[#bfd7e8] bg-white/90">
              <div className="border-b border-[#dbe7ef] px-4 py-4">
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-600">Modules</p>
              </div>
              <ConsultationModuleRailItem
                title="Vitals"
                description="Structured table for the note"
                active={activeInlineModule === "vitals"}
                onSelect={() => setActiveInlineModule((current) => (current === "vitals" ? null : "vitals"))}
              >
                <ConsultationModuleDetail title="Vitals">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">BP Systolic</span>
                      <input
                        value={form.bloodPressureSystolic}
                        inputMode="numeric"
                        onChange={(event) => setForm((current) => ({ ...current, bloodPressureSystolic: event.target.value }))}
                        placeholder="120"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">BP Diastolic</span>
                      <input
                        value={form.bloodPressureDiastolic}
                        inputMode="numeric"
                        onChange={(event) => setForm((current) => ({ ...current, bloodPressureDiastolic: event.target.value }))}
                        placeholder="80"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Pulse</span>
                      <input
                        value={form.pulse}
                        inputMode="numeric"
                        onChange={(event) => setForm((current) => ({ ...current, pulse: event.target.value }))}
                        placeholder="72"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">SpO2</span>
                      <input
                        value={form.spo2}
                        inputMode="numeric"
                        onChange={(event) => setForm((current) => ({ ...current, spo2: event.target.value }))}
                        placeholder="98"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Blood Sugar</span>
                      <input
                        value={form.bloodSugar}
                        inputMode="decimal"
                        onChange={(event) => setForm((current) => ({ ...current, bloodSugar: event.target.value }))}
                        placeholder="110"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                  </div>
                </ConsultationModuleDetail>
              </ConsultationModuleRailItem>
              <ConsultationModuleRailItem
                title="Medicines"
                description="Inventory and treatment schedule"
                active={activeInlineModule === "medicines"}
                onSelect={() => setActiveInlineModule((current) => (current === "medicines" ? null : "medicines"))}
              >
                <ConsultationModuleDetail title="Medicines">
                  <input
                    value={medicineSearch}
                    onChange={(event) => setMedicineSearch(event.target.value)}
                    placeholder="Search medicines by name or unit"
                    className="w-full rounded-xl border border-emerald-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-emerald-400"
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
                              className="rounded-xl border border-emerald-200 p-2 text-slate-600 transition hover:bg-emerald-50"
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
                                className="w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-400"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Duration</span>
                              <input
                                value={entry.duration}
                                onChange={(event) => updatePrescription(entry.itemId, { duration: event.target.value })}
                                placeholder="5 days"
                                className="w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-400"
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
                                    className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
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
                                  className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
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
                            <span className="rounded-xl border border-emerald-200 px-3 py-1 text-xs font-medium">
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
                </ConsultationModuleDetail>
              </ConsultationModuleRailItem>
              {isOptometryClinic ? (
                <>
                  <ConsultationModuleRailItem
                    title="Eye exam"
                    description="Refraction and vision entries"
                    onSelect={openEyeExamModule}
                  />
                  <ConsultationModuleRailItem
                    title="Contact lens"
                    description="Trial fit and order details"
                    onSelect={() => openOptometryModule("contactLens")}
                  />
                  <ConsultationModuleRailItem
                    title="Binocular vision"
                    description="Symptoms, alignment, vergence"
                    onSelect={() => openOptometryModule("binocularVision")}
                  />
                  <ConsultationModuleRailItem
                    title="Low vision"
                    description="Functional vision and aids"
                    onSelect={() => openOptometryModule("lowVision")}
                  />
                  <ConsultationModuleRailItem
                    title="Myopia management"
                    description="Axial length and treatment"
                    onSelect={() => openOptometryModule("myopiaManagement")}
                  />
                </>
              ) : null}
              {isPediatricsClinic ? (
                <>
                  <ConsultationModuleRailItem
                    title="Growth tracking"
                    description="Height, weight, BMI, and head circumference"
                    onSelect={() => setActivePediatricModule("growth")}
                  />
                  <ConsultationModuleRailItem
                    title="Well-child visit"
                    description="Nutrition, sleep, behavior, and concerns"
                    onSelect={() => setActivePediatricModule("wellChild")}
                  />
                  <ConsultationModuleRailItem
                    title="Parent handout"
                    description="Parent-facing instructions and PDF"
                    onSelect={() => setActivePediatricModule("parentHandout")}
                  />
                  <ConsultationModuleRailItem
                    title="Pediatric follow-up"
                    description="Apply common follow-up timing"
                    onSelect={() => setActivePediatricModule("pediatricFollowUp")}
                  />
                </>
              ) : null}
            </section>

            <div className="border-t border-[#bfd7e8] pt-4">
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-700">{statusMessage || "Ready to generate and send."}</p>
                <div className="flex flex-col gap-3">
                  {setupWarnings.length ? (
                    <div className="rounded-[16px] border border-amber-200 bg-amber-50/80 p-4">
                      <p className="text-sm font-semibold text-amber-900">Setup notes</p>
                      <div className="mt-2 space-y-2 text-sm leading-6 text-amber-900">
                        {setupWarnings.map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {isFollowUpOpen ? (
                    <div className="rounded-[16px] border border-[#bfd7e8] bg-[#f3f8fb]/40 p-4">
                      <div className="grid gap-3">
                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-slate-700">Follow-up Date</span>
                          <input
                            type="date"
                            value={form.followUpDate}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, followUpDate: event.target.value }))
                            }
                            className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
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
                            className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-[16px] border border-[#bfd7e8] bg-[#f3f8fb]/40 p-4">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                        Recipient email
                      </span>
                      <input
                        type="email"
                        value={recipientEmail}
                        onChange={(event) => setRecipientEmail(event.target.value)}
                        placeholder="patient@example.com"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      disabled={isSending || !currentNoteId || isSent || !recipientEmail.trim()}
                      onClick={handleSend}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb] disabled:opacity-60"
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
                          className="inline-flex min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb] disabled:opacity-60"
                        >
                          <Eye className="h-4 w-4" />
                          {isGeneratingPdf ? "Preparing..." : "Preview"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsFollowUpOpen((current) => !current)}
                          className="inline-flex min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb] disabled:opacity-60"
                        >
                          <CalendarPlus2 className="h-4 w-4" />
                          {isFollowUpOpen ? "Hide" : "Follow-up"}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={isCompleting || noteStatus === "draft" || !currentNoteId}
                        onClick={handleDone}
                        className="inline-flex min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
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
      <SpecialtyModuleModal
        open={isPediatricsClinic && activePediatricModule === "growth"}
        title="Growth Tracking"
        description="Pediatric height, weight, BMI, and head circumference."
        onClose={() => setActivePediatricModule(null)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Measured At</span>
            <input type="datetime-local" value={form.growthMeasurement.measured_at} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, measured_at: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Height (cm)</span>
            <input value={form.growthMeasurement.height_cm} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, height_cm: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Weight (kg)</span>
            <input value={form.growthMeasurement.weight_kg} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, weight_kg: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Head Circumference (cm)</span>
            <input value={form.growthMeasurement.head_circumference_cm} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, head_circumference_cm: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400" />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Visit Notes</span>
          <textarea rows={3} value={form.growthMeasurement.visit_notes} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, visit_notes: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400" />
        </label>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {form.growthMeasurement.savedRecord ? `Latest BMI ${form.growthMeasurement.savedRecord.bmi.toFixed(2)}` : "Save to add the growth record to the patient timeline."}
          </p>
          <button type="button" onClick={() => void saveGrowthMeasurement()} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-amber-50">
            Save Growth
          </button>
        </div>
      </SpecialtyModuleModal>

      <SpecialtyModuleModal
        open={isPediatricsClinic && activePediatricModule === "wellChild"}
        title="Well-Child Visit"
        description="Nutrition, sleep, elimination, behavior, concerns, and visit summary."
        onClose={() => setActivePediatricModule(null)}
      >
        <div className="grid gap-3">
          <select value={form.wellChildVisit.visit_band} onChange={(event) => setForm((current) => ({ ...current, wellChildVisit: { ...current.wellChildVisit, visit_band: event.target.value } }))} className="rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400">
            <option value="infant">Infant</option>
            <option value="toddler">Toddler</option>
            <option value="preschool">Preschool</option>
            <option value="school_age">School-age</option>
            <option value="adolescent">Adolescent</option>
          </select>
          {[
            ["nutrition_summary", "Nutrition / Feeding"],
            ["sleep_summary", "Sleep"],
            ["elimination_summary", "Elimination"],
            ["school_behavior_summary", "School / Behavior"],
            ["parent_concerns", "Parent Concerns"],
            ["assessment_summary", "Review Summary"],
          ].map(([field, label]) => (
            <label key={field} className="block">
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{label}</span>
              <textarea rows={2} value={form.wellChildVisit[field as keyof WellChildVisitPayload] as string} onChange={(event) => setForm((current) => ({ ...current, wellChildVisit: { ...current.wellChildVisit, [field]: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400" />
            </label>
          ))}
        </div>
      </SpecialtyModuleModal>

      <SpecialtyModuleModal
        open={isPediatricsClinic && activePediatricModule === "parentHandout"}
        title="Parent Handout"
        description="Generate parent-facing instructions and export them as a PDF."
        onClose={() => setActivePediatricModule(null)}
      >
        <div className="grid gap-3">
          <select value={form.parentHandoutRequest.template_key} onChange={(event) => setForm((current) => ({ ...current, parentHandoutRequest: { ...current.parentHandoutRequest, template_key: event.target.value, generated_title: "", generated_content: "" } }))} className="rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400">
            <option value="fever_home_care">Fever home care</option>
            <option value="nutrition_guidance">Nutrition guidance</option>
            <option value="well_visit_summary">Well-visit summary</option>
            <option value="hydration_uri_home_care">Hydration / URI home care</option>
          </select>
          <textarea rows={3} value={form.parentHandoutRequest.instructions} onChange={(event) => setForm((current) => ({ ...current, parentHandoutRequest: { ...current.parentHandoutRequest, instructions: event.target.value, generated_title: "", generated_content: "" } }))} placeholder="Optional context for the handout" className="w-full rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400" />
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void handleGenerateParentHandout()} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-amber-50">
              {isGeneratingHandout ? "Generating..." : "Generate Handout"}
            </button>
            <button type="button" disabled={!form.parentHandoutRequest.generated_content.trim() || isGeneratingHandoutPdf} onClick={() => void handleParentHandoutPdf("preview")} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-amber-50 disabled:opacity-60">
              {isGeneratingHandoutPdf ? "Preparing..." : "Preview PDF"}
            </button>
            <button type="button" disabled={!form.parentHandoutRequest.generated_content.trim() || isGeneratingHandoutPdf} onClick={() => void handleParentHandoutPdf("download")} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-amber-50 disabled:opacity-60">
              Download PDF
            </button>
          </div>
          {form.parentHandoutRequest.generated_content.trim() ? (
            <div className="rounded-[22px] border border-amber-100 bg-amber-50/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {form.parentHandoutRequest.generated_title || "Generated handout"}
              </p>
              <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{form.parentHandoutRequest.generated_content}</pre>
            </div>
          ) : null}
        </div>
      </SpecialtyModuleModal>

      <SpecialtyModuleModal
        open={isPediatricsClinic && activePediatricModule === "pediatricFollowUp"}
        title="Pediatric Follow-up"
        description="Apply common pediatric follow-up timing into the main follow-up section."
        onClose={() => setActivePediatricModule(null)}
      >
        <div className="grid gap-3">
          <select value={form.pediatricFollowUpPlan.preset_key} onChange={(event) => setForm((current) => ({ ...current, pediatricFollowUpPlan: { ...current.pediatricFollowUpPlan, preset_key: event.target.value } }))} className="rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400">
            <option value="routine_review">Routine review</option>
            <option value="growth_recheck">Growth recheck</option>
            <option value="symptom_follow_up">Symptom follow-up</option>
            <option value="counseling_review">Counseling review</option>
          </select>
          <input value={form.pediatricFollowUpPlan.suggested_interval} onChange={(event) => setForm((current) => ({ ...current, pediatricFollowUpPlan: { ...current.pediatricFollowUpPlan, suggested_interval: event.target.value } }))} placeholder="Suggested interval, e.g. 3 months" className="w-full rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400" />
          <input value={form.pediatricFollowUpPlan.notes} onChange={(event) => setForm((current) => ({ ...current, pediatricFollowUpPlan: { ...current.pediatricFollowUpPlan, notes: event.target.value } }))} placeholder="Scheduling notes" className="w-full rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-400" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Apply this preset to the real follow-up section below. Marking the consultation done will create the follow-up record.
            </p>
            <button type="button" onClick={applyPediatricFollowUpPreset} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-amber-50">
              Apply to Follow-up
            </button>
          </div>
        </div>
      </SpecialtyModuleModal>

      <ContactLensModal
        open={isOptometryClinic && isContactLensOpen}
        value={form.contactLens}
        onClose={() => setIsContactLensOpen(false)}
        onSave={() => {
          setStatusMessage("Contact lens details added.");
          setIsContactLensOpen(false);
        }}
        onChange={updateContactLens}
        onEyeChange={updateContactLensEye}
      />
      {isOptometryClinic && isEyeExamOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-6">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[20px] border border-[#bfd7e8] bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Structured Module</p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-900">Eye Exam</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  Capture refraction and vision entries for the right and left eye.
                </p>
              </div>
              <button type="button" onClick={() => setIsEyeExamOpen(false)} className="rounded-xl border border-[#bfd7e8] p-2 text-slate-600 transition hover:bg-[#f3f8fb]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-6 grid gap-3 md:grid-cols-[110px_repeat(4,minmax(0,1fr))]">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Eye</div>
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Sphere</div>
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Cylinder</div>
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Axis</div>
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Vision</div>
              {form.eyeExam.map((entry) => (
                <Fragment key={entry.eye}>
                  <div className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm font-medium capitalize text-slate-700">{entry.eye}</div>
                  <input value={entry.sphere} onChange={(event) => updateEyeExam(entry.eye, { sphere: event.target.value })} placeholder="-1.25" className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
                  <input value={entry.cylinder} onChange={(event) => updateEyeExam(entry.eye, { cylinder: event.target.value })} placeholder="-0.50" className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
                  <input value={entry.axis} onChange={(event) => updateEyeExam(entry.eye, { axis: event.target.value })} placeholder="90" className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
                  <input value={entry.vision} onChange={(event) => updateEyeExam(entry.eye, { vision: event.target.value })} placeholder="6/6" className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]" />
                </Fragment>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" onClick={() => setIsEyeExamOpen(false)} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                Save Eye Exam
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <BinocularVisionModal
        open={isOptometryClinic && isBinocularVisionOpen}
        value={form.binocularVision}
        onClose={() => setIsBinocularVisionOpen(false)}
        onSave={(next) => {
          saveBinocularVision(next);
          setIsBinocularVisionOpen(false);
        }}
      />
      <LowVisionModal
        open={isOptometryClinic && isLowVisionOpen}
        value={form.lowVision}
        onClose={() => setIsLowVisionOpen(false)}
        onSave={(next) => {
          saveLowVision(next);
          setIsLowVisionOpen(false);
        }}
      />
      <MyopiaManagementModal
        open={isOptometryClinic && isMyopiaManagementOpen}
        value={form.myopiaManagement}
        patientAge={currentPatient.age}
        onClose={() => setIsMyopiaManagementOpen(false)}
        onSave={async (next) => {
          await saveMyopiaManagement(next);
          setIsMyopiaManagementOpen(false);
        }}
      />
    </aside>
  );
}
