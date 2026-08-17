"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus2, Eye, FileText, Mail, MessageCircle, Paperclip, PenLine, Plus, Printer, Sparkles, X } from "lucide-react";
import NextImage from "next/image";
import type { ReactNode } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import {
  createConsultationId as createId,
  createEmptyConsultationForm as createEmptyForm,
  type PrescriptionDraft,
} from "@/features/consultation/model/consultation-form";
import {
  normalizePrescriptionNotes,
  syncDraftMedicationTable,
  togglePrescriptionNoteValue,
} from "@/features/consultation/model/medication-table";
import { buildConsultationNotePayload } from "@/features/consultation/model/note-payload";
import type { ClinicSpecialty } from "@/lib/clinic-specialty";
import { getSpecialtyModules, specialtyHasModule, type SpecialtyModuleKey } from "@/lib/specialty";
import { clearConsultationWorkspace, readConsultationWorkspace, writeConsultationWorkspace } from "@/lib/consultation-workspace";
import { zonedDateTimeInputToUtcIso } from "@/lib/timezone";
import { trackWhatsAppDelivery } from "@/lib/whatsapp-delivery";
import {
  AuthUser,
  BinocularVisionEvaluationCreatePayload,
  BinocularVisionEvaluationRecord,
  BinocularVisionPayload,
  ClinicalAnalysisResponse,
  ClinicalExtractions,
  ClinicalAssistantAnswer,
  ClinicalAssistantQuestion,
  ClinicalQuestionsResponse,
  ContactLensEyeEntry,
  ContactLensPayload,
  EyeExamEntry,
  GenerateNotePayload,
  LowVisionPayload,
  LongitudinalTrackRecord,
  MyopiaMeasurementPayload,
  NoteAsset,
  OperationResult,
  Patient,
  PediatricGrowthMeasurementPayload,
  TbiEvaluationCreatePayload,
  TbiEvaluationRecord,
  TestScoreEntry,
  WellChildVisitPayload,
  WhatsAppDeliveryStatus,
} from "@/lib/types";
import { api } from "@/lib/api";
import { printBlob } from "@/lib/print";
import { buildChiefComplaintText } from "@/lib/optometry/history";
import { BinocularVisionModal } from "@/components/optometry/binocular-vision-modal";
import { ContactLensModal } from "@/components/optometry/contact-lens-modal";
import { LowVisionModal } from "@/components/optometry/low-vision-modal";
import { MyopiaManagementModal } from "@/components/optometry/myopia-management-modal";
import { TbiEvaluationModal } from "@/components/optometry/tbi-evaluation-modal";
import { EyeExamModal } from "@/components/optometry/eye-exam-modal";
import { ClinicalDrawingModal } from "@/components/clinical-drawing-modal";
import {
  OptometryHistoryEditor,
  useOptometryHistory,
} from "@/components/optometry/history-panel";
import {
  buildEyeExamSummary,
  createEmptyEyeExam,
  formatModuleSummary as formatSharedModuleSummary,
  hasEyeExamData,
  moduleEntriesFor,
  normalizeEyeExamPayload,
} from "@/lib/structured-modules";
import {
  buildBinocularVisionSummary,
  buildContactLensSummary,
  buildLowVisionSummary,
  buildMyopiaManagementSummary,
  createEmptyBinocularVision,
  createEmptyContactLens,
  createEmptyLowVision,
  formatLocalDateTimeInput,
  hasContactLensData,
  hasContactLensEyeData,
  normalizeLowVisionPayload,
  normalizeContactLensPayload,
  type MyopiaMeasurementDraft,
} from "@/lib/optometry/consultation";

const MAX_ATTACHMENT_SIZE_BYTES = 6 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 6;
const SUPPORTED_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const PEDIATRIC_FOLLOW_UP_DEFAULTS: Record<string, { days: number; interval: string; notePrefix: string }> = {
  routine_review: { days: 90, interval: "3 months", notePrefix: "Routine pediatric review" },
  growth_recheck: { days: 60, interval: "2 months", notePrefix: "Growth recheck" },
  symptom_follow_up: { days: 14, interval: "2 weeks", notePrefix: "Symptom follow-up" },
  counseling_review: { days: 30, interval: "1 month", notePrefix: "Counseling review" },
};

const PRESCRIPTION_NOTE_OPTIONS = [
  "Before food",
  "After food",
  "PRN",
];

interface ConsultationDrawerProps {
  patient: Patient | null;
  currentUser?: AuthUser | null;
  clinicSpecialty?: ClinicSpecialty | null;
  clinicTimeZone?: string;
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
    prescriptions?: GenerateNotePayload["prescriptions"];
  }) => Promise<{
    content: string;
    noteId?: string | null;
    status?: "draft" | "final" | "sent" | null;
    usedFallback?: boolean;
    warning?: string | null;
    extractions?: ClinicalExtractions;
  }>;
  onGeneratePdf: (payload: { note_id?: string; patient_id: string; content: string; assets?: NoteAsset[] }) => Promise<Blob>;
  onSend: (payload: { note_id: string; patient_id: string; recipient_email: string }) => Promise<string>;
  onSendWhatsApp: (payload: { note_id: string; patient_id: string; recipient_phone: string }) => Promise<OperationResult>;
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
  isSent?: boolean;
  isEmailSent?: boolean;
  isWhatsAppSent?: boolean;
  recipientEmail: string;
  recipientPhone?: string;
  hasGeneratedNote: boolean;
  isFollowUpOpen: boolean;
  isDraftDirty?: boolean;
  clinicalExtractions?: ClinicalExtractions;
  currentConsultationModules?: Array<{ module_type: string; payload: Record<string, unknown> }>;
  activeOptometryStep?: OptometryConsultationStep;
  activeEyeExamPage?: number;
};

type OptometryConsultationStep = "history" | "examination" | "consultation";
type ConsultationHistoryModule = "" | "eye_exam" | "vitals" | "contact_lens" | "binocular_vision" | "low_vision" | "myopia_management" | "tbi_evaluation";
type InlineModuleKey = "vitals" | "medicines";
type PediatricModuleKey = "growth" | "wellChild" | "parentHandout" | "pediatricFollowUp";
type AssistantStage = "idle" | "questions" | "analysis";

const TEST_MODULE_COPY: Record<SpecialtyModuleKey, { label: string }> = {
  eye_exam: { label: "Eye Exam" },
  contact_lens: { label: "Contact lens" },
  binocular_vision: { label: "Binocular vision" },
  low_vision: { label: "Low vision" },
  myopia_management: { label: "Myopia" },
  tbi_evaluation: { label: "Neurovision / TBI" },
  pediatric_growth_measurement: { label: "Growth" },
  well_child_visit: { label: "Well-child" },
  parent_handout_request: { label: "Handout" },
  pediatric_follow_up_plan: { label: "Follow-up" },
};

function formatModuleSummary(entry: LongitudinalTrackRecord) {
  return formatSharedModuleSummary(entry, "Evaluation saved.");
}

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
  description?: string;
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
          <p className="text-sm font-medium text-black">{title}</p>
          {description ? <p className="mt-1 text-xs leading-5 text-black">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {badge}
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl border text-black transition ${toneClasses.icon}`}>
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
        <span className="block text-base font-semibold leading-tight text-black">{title}</span>
        <span className="mt-1 block text-sm leading-5 text-black">{description}</span>
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
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-black">{title}</p>
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
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black">Specialty Module</p>
            <h3 className="mt-2 text-2xl font-semibold text-black">{title}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-black">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-[#bfd7e8] p-2 text-black transition hover:bg-[#f3f8fb]">
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
  clinicTimeZone = "UTC",
  isTrainingMode = false,
  onClose,
  onDone,
  onGenerate,
  onGeneratePdf,
  onSend,
  onSendWhatsApp,
}: ConsultationDrawerProps) {
  const {
    activeMedicines: medicineItems,
    activeMedicinesError,
    isActiveMedicinesLoading,
    loadActiveMedicines,
  } = useClinicShell();
  const isOptometryClinic = specialtyHasModule(clinicSpecialty, "eye_exam");
  const isPediatricsClinic = specialtyHasModule(clinicSpecialty, "pediatric_growth_measurement");
  const specialtyModules = getSpecialtyModules(clinicSpecialty);
  const [form, setForm] = useState(createEmptyForm);
  const [activeOptometryStep, setActiveOptometryStep] = useState<OptometryConsultationStep>("history");
  const [activeEyeExamPage, setActiveEyeExamPage] = useState(0);
  const [activeContactLensPage, setActiveContactLensPage] = useState(0);
  const [activeLowVisionPage, setActiveLowVisionPage] = useState(0);
  const [hydratedConsultationKey, setHydratedConsultationKey] = useState("");
  const [openSections, setOpenSections] = useState(createClosedConsultationSections);
  const [activeInlineModule, setActiveInlineModule] = useState<InlineModuleKey | null>(null);
  const [activePediatricModule, setActivePediatricModule] = useState<PediatricModuleKey | null>(null);
  const [medicineSearch, setMedicineSearch] = useState("");
  const [selectedMedicineIds, setSelectedMedicineIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [isContactLensOpen, setIsContactLensOpen] = useState(false);
  const [isBinocularVisionOpen, setIsBinocularVisionOpen] = useState(false);
  const [isLowVisionOpen, setIsLowVisionOpen] = useState(false);
  const [isMyopiaManagementOpen, setIsMyopiaManagementOpen] = useState(false);
  const [isTbiEvaluationOpen, setIsTbiEvaluationOpen] = useState(false);
  const [tbiEvaluations, setTbiEvaluations] = useState<TbiEvaluationRecord[]>([]);
  const [binocularVisionEvaluations, setBinocularVisionEvaluations] = useState<BinocularVisionEvaluationRecord[]>([]);
  const [isBinocularVisionLoading, setIsBinocularVisionLoading] = useState(false);
  const [binocularVisionError, setBinocularVisionError] = useState("");
  const [isTbiLoading, setIsTbiLoading] = useState(false);
  const [tbiError, setTbiError] = useState("");
  const [moduleEntries, setModuleEntries] = useState<LongitudinalTrackRecord[]>([]);
  const [isModuleEntriesLoading, setIsModuleEntriesLoading] = useState(false);
  const [moduleEntryError, setModuleEntryError] = useState("");
  const [currentConsultationModules, setCurrentConsultationModules] = useState<Array<{ module_type: string; payload: Record<string, unknown> }>>([]);
  const [hasGeneratedNote, setHasGeneratedNote] = useState(false);
  const [currentNoteId, setCurrentNoteId] = useState("");
  const [clinicalExtractions, setClinicalExtractions] = useState<ClinicalExtractions>({
    services_performed: [],
    medications_prescribed: [],
  });
  const [noteStatus, setNoteStatus] = useState<"draft" | "final" | "sent" | "">("");
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [isWhatsAppSent, setIsWhatsAppSent] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [whatsappDeliveryStatus, setWhatsAppDeliveryStatus] = useState<WhatsAppDeliveryStatus | "">("");
  const [isDrawingModalOpen, setIsDrawingModalOpen] = useState(false);
  const [isGeneratingHandout, setIsGeneratingHandout] = useState(false);
  const [isGeneratingHandoutPdf, setIsGeneratingHandoutPdf] = useState(false);
  const [assistantQuestions, setAssistantQuestions] = useState<ClinicalQuestionsResponse | null>(null);
  const [assistantAnswers, setAssistantAnswers] = useState<Record<string, string>>({});
  const [assistantQuestionIndex, setAssistantQuestionIndex] = useState(0);
  const [assistantAnalysis, setAssistantAnalysis] = useState<ClinicalAnalysisResponse | null>(null);
  const [assistantStage, setAssistantStage] = useState<AssistantStage>("idle");
  const [isLoadingAssistantQuestions, setIsLoadingAssistantQuestions] = useState(false);
  const [isAnalyzingAssistant, setIsAnalyzingAssistant] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const cancelWhatsAppDeliveryTrackingRef = useRef<(() => void) | null>(null);
  const patientId = patient?.id ?? "";
  const patientVisitId = patient?.current_visit?.id ?? "";
  const currentUserId = currentUser?.id ?? "";
  const currentOrgId = currentUser?.org_id ?? "";
  const hydrationPatientRef = useRef(patient);
  const hydratedWorkspaceKeyRef = useRef("");
  hydrationPatientRef.current = patient;
  const consultationHydrationKey = patientId
    ? [currentOrgId, currentUserId, patientId, patientVisitId, clinicSpecialty ?? "", isTrainingMode ? "training" : "live"].join(":")
    : "";
  const workspaceScope = useMemo(
    () => {
      if (!patientId || !patientVisitId || !currentUserId || !currentOrgId) {
        return null;
      }
      return { orgId: currentOrgId, userId: currentUserId, patientId, visitId: patientVisitId };
    },
    [currentOrgId, currentUserId, patientId, patientVisitId],
  );
  const pendingWorkspaceWriteRef = useRef<{
    scope: { orgId: string; userId: string; patientId: string; visitId: string };
    snapshot: ConsultationWorkspaceSnapshot;
  } | null>(null);
  const formRef = useRef(form);
  formRef.current = form;
  const optometryHistory = useOptometryHistory(
    patientId,
    patient?.current_visit?.id,
    Boolean(patientId && isOptometryClinic && !isTrainingMode),
  );

  function buildWorkspaceSnapshot(
    overrides: Partial<ConsultationWorkspaceSnapshot> = {},
  ): ConsultationWorkspaceSnapshot {
    return {
      form: formRef.current,
      openSections,
      selectedMedicineIds,
      medicineSearch,
      currentNoteId,
      noteStatus,
      isEmailSent,
      isWhatsAppSent,
      recipientEmail,
      recipientPhone,
      hasGeneratedNote,
      isFollowUpOpen,
      isDraftDirty,
      clinicalExtractions,
      currentConsultationModules,
      activeOptometryStep,
      activeEyeExamPage,
      ...overrides,
    };
  }

  function persistWorkspaceNow(overrides: Partial<ConsultationWorkspaceSnapshot> = {}) {
    if (!workspaceScope) return;
    writeConsultationWorkspace(workspaceScope, buildWorkspaceSnapshot(overrides));
    pendingWorkspaceWriteRef.current = null;
  }

  function handleCloseConsultation() {
    persistWorkspaceNow();
    onClose();
  }

  useEffect(() => {
    const hydrationPatient = hydrationPatientRef.current;
    if (!hydrationPatient || !consultationHydrationKey) {
      return;
    }
    if (hydratedWorkspaceKeyRef.current === consultationHydrationKey) {
      return;
    }
    hydratedWorkspaceKeyRef.current = consultationHydrationKey;

    let active = true;
    const cachedWorkspace = workspaceScope
      ? readConsultationWorkspace<ConsultationWorkspaceSnapshot>(workspaceScope, {
          legacyPatientId: hydrationPatient.id,
        })
      : null;
    const baseForm = createEmptyForm();
    const cachedForm = cachedWorkspace?.form;
    setActiveOptometryStep(
      cachedWorkspace?.activeOptometryStep ?? (cachedWorkspace ? "consultation" : "history"),
    );
    setActiveEyeExamPage(cachedWorkspace?.activeEyeExamPage ?? 0);
    setStatusMessage("");
    setIsGenerating(false);
    setIsGeneratingPdf(false);
    setIsGeneratingHandout(false);
    setIsGeneratingHandoutPdf(false);
    setAssistantQuestions(null);
    setAssistantAnswers({});
    setAssistantQuestionIndex(0);
    setAssistantAnalysis(null);
    setAssistantStage("idle");
    setAssistantError("");
    setIsLoadingAssistantQuestions(false);
    setIsAnalyzingAssistant(false);
    setIsCompleting(false);
    setIsFinalizing(false);
    setIsSavingDraft(false);
    setIsDraftDirty(cachedWorkspace?.isDraftDirty ?? false);
    setIsSending(false);
    setIsSendingWhatsApp(false);
    setIsContactLensOpen(false);
    setIsBinocularVisionOpen(false);
    setIsLowVisionOpen(false);
    setIsMyopiaManagementOpen(false);
    setIsTbiEvaluationOpen(false);
    setIsDrawingModalOpen(false);
    setTbiEvaluations([]);
    setBinocularVisionEvaluations([]);
    setIsBinocularVisionLoading(false);
    setBinocularVisionError("");
    setIsTbiLoading(false);
    setTbiError("");
    setModuleEntries([]);
    setIsModuleEntriesLoading(Boolean(specialtyModules.length));
    setModuleEntryError("");
    setCurrentConsultationModules(cachedWorkspace?.currentConsultationModules ?? []);
    setMedicineSearch(cachedWorkspace?.medicineSearch ?? "");
    setForm(
      cachedForm
        ? {
            ...baseForm,
            ...cachedForm,
            eyeExam: normalizeEyeExamPayload(cachedForm.eyeExam),
            testScores: Array.isArray(cachedForm.testScores) && cachedForm.testScores.length
              ? cachedForm.testScores
              : baseForm.testScores,
            assets: Array.isArray(cachedForm.assets) ? cachedForm.assets : baseForm.assets,
            prescriptions: Array.isArray(cachedForm.prescriptions) ? cachedForm.prescriptions : baseForm.prescriptions,
            contactLens: normalizeContactLensPayload(cachedForm.contactLens),
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
    setClinicalExtractions(cachedWorkspace?.clinicalExtractions ?? { services_performed: [], medications_prescribed: [] });
    setNoteStatus(cachedWorkspace?.noteStatus ?? "");
    setIsEmailSent(cachedWorkspace?.isEmailSent ?? false);
    setIsWhatsAppSent(cachedWorkspace?.isWhatsAppSent ?? false);
    setRecipientEmail(cachedWorkspace?.recipientEmail ?? hydrationPatient.email ?? "");
    setRecipientPhone(cachedWorkspace?.recipientPhone ?? hydrationPatient.phone ?? "");
    setWhatsAppDeliveryStatus("");
    setHydratedConsultationKey(consultationHydrationKey);

    void loadActiveMedicines()
      .catch((loadError) => {
        if (!active) return;
        setStatusMessage(loadError instanceof Error ? loadError.message : "Failed to load inventory medicines.");
      });

    if (specialtyModules.length) {
      void api.listPatientModuleEntries(hydrationPatient.id)
        .then((entries) => {
          if (!active) return;
          setModuleEntries(entries);
          setModuleEntryError("");
        })
        .catch((loadError) => {
          if (!active) return;
          setModuleEntries([]);
          setModuleEntryError(loadError instanceof Error ? loadError.message : "Failed to load previous evaluations.");
        })
        .finally(() => {
          if (active) setIsModuleEntriesLoading(false);
        });
    } else {
      setIsModuleEntriesLoading(false);
    }

    return () => {
      active = false;
      cancelWhatsAppDeliveryTrackingRef.current?.();
      cancelWhatsAppDeliveryTrackingRef.current = null;
    };
  }, [consultationHydrationKey, loadActiveMedicines, specialtyModules.length, workspaceScope]);

  useEffect(() => {
    if (
      !patientId
      || !workspaceScope
      || hydratedConsultationKey !== consultationHydrationKey
    ) {
      return;
    }

    const snapshot: ConsultationWorkspaceSnapshot = {
      form,
      openSections,
      selectedMedicineIds,
      medicineSearch,
      currentNoteId,
      noteStatus,
      isEmailSent,
      isWhatsAppSent,
      recipientEmail,
      recipientPhone,
      hasGeneratedNote,
      isFollowUpOpen,
      isDraftDirty,
      clinicalExtractions,
      currentConsultationModules,
      activeOptometryStep,
      activeEyeExamPage,
    };
    pendingWorkspaceWriteRef.current = { scope: workspaceScope, snapshot };
    const timeoutId = window.setTimeout(() => {
      const pending = pendingWorkspaceWriteRef.current;
      if (!pending) return;
      writeConsultationWorkspace(pending.scope, pending.snapshot);
      pendingWorkspaceWriteRef.current = null;
    }, 150);
    return () => window.clearTimeout(timeoutId);
  }, [
    activeEyeExamPage,
    activeOptometryStep,
    currentNoteId,
    clinicalExtractions,
    currentConsultationModules,
    form,
    hasGeneratedNote,
    hydratedConsultationKey,
    isFollowUpOpen,
    isDraftDirty,
    isEmailSent,
    isWhatsAppSent,
    medicineSearch,
    noteStatus,
    openSections,
    patientId,
    recipientEmail,
    recipientPhone,
    selectedMedicineIds,
    consultationHydrationKey,
    workspaceScope,
  ]);

  useEffect(() => () => {
    const pending = pendingWorkspaceWriteRef.current;
    if (!pending) return;
    writeConsultationWorkspace(pending.scope, pending.snapshot);
    pendingWorkspaceWriteRef.current = null;
  }, [consultationHydrationKey]);

  useEffect(() => {
    function flushPendingWorkspace() {
      const pending = pendingWorkspaceWriteRef.current;
      if (!pending) return;
      writeConsultationWorkspace(pending.scope, pending.snapshot);
      pendingWorkspaceWriteRef.current = null;
    }

    function flushWhenHidden() {
      if (document.visibilityState === "hidden") flushPendingWorkspace();
    }

    window.addEventListener("pagehide", flushPendingWorkspace);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushPendingWorkspace);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flushPendingWorkspace();
    };
  }, []);

  useEffect(() => {
    if (!patientId || !isOptometryClinic || !hydratedConsultationKey) {
      return;
    }

    function restoreConsultationLocation() {
      const url = new URL(window.location.href);
      if (url.searchParams.get("workspace") !== "consultation" || url.searchParams.get("patient") !== patientId) {
        return;
      }
      const stepParam = url.searchParams.get("consultationStep");
      if (!stepParam) {
        url.searchParams.set("consultationStep", activeOptometryStep);
        if (activeOptometryStep === "examination") {
          url.searchParams.set("consultationModule", "eye_exam");
          url.searchParams.set("consultationPage", String(activeEyeExamPage));
        }
        window.history.replaceState(window.history.state, "", url.toString());
        return;
      }
      if (!(["history", "examination", "consultation"] as string[]).includes(stepParam)) {
        return;
      }

      const step = stepParam as OptometryConsultationStep;
      const moduleParam = (url.searchParams.get("consultationModule") || "") as ConsultationHistoryModule;
      const pageParam = Number.parseInt(url.searchParams.get("consultationPage") || "0", 10);
      const page = Number.isFinite(pageParam) && pageParam >= 0 ? pageParam : 0;
      setActiveOptometryStep(step);
      setActiveInlineModule(step === "examination" && moduleParam === "vitals" ? "vitals" : null);
      setIsContactLensOpen(step === "examination" && moduleParam === "contact_lens");
      setIsBinocularVisionOpen(step === "examination" && moduleParam === "binocular_vision");
      setIsLowVisionOpen(step === "examination" && moduleParam === "low_vision");
      setIsMyopiaManagementOpen(step === "examination" && moduleParam === "myopia_management");
      setIsTbiEvaluationOpen(step === "examination" && moduleParam === "tbi_evaluation");
      if (step === "examination" && (!moduleParam || moduleParam === "eye_exam")) setActiveEyeExamPage(page);
      if (step === "examination" && moduleParam === "contact_lens") setActiveContactLensPage(page);
      if (step === "examination" && moduleParam === "low_vision") setActiveLowVisionPage(page);
    }

    restoreConsultationLocation();
    window.addEventListener("popstate", restoreConsultationLocation);
    return () => window.removeEventListener("popstate", restoreConsultationLocation);
  }, [activeEyeExamPage, activeOptometryStep, hydratedConsultationKey, isOptometryClinic, patientId]);

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
  useEffect(() => {
    if (!patientId || !isOptometryClinic || !isBinocularVisionOpen) {
      return;
    }
    if (isTrainingMode) {
      setBinocularVisionEvaluations([]);
      return;
    }

    let active = true;
    setIsBinocularVisionLoading(true);
    setBinocularVisionError("");
    api.listPatientBinocularVisionEvaluations(patientId)
      .then((rows) => {
        if (active) {
          setBinocularVisionEvaluations(rows);
        }
      })
      .catch((loadError) => {
        if (active) {
          setBinocularVisionError(loadError instanceof Error ? loadError.message : "Failed to load binocular vision evaluations.");
        }
      })
      .finally(() => {
        if (active) {
          setIsBinocularVisionLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isBinocularVisionOpen, isOptometryClinic, isTrainingMode, patientId]);

  useEffect(() => {
    if (!patientId || !isOptometryClinic || !isTbiEvaluationOpen) {
      return;
    }
    if (isTrainingMode) {
      setTbiEvaluations([]);
      return;
    }

    let active = true;
    setIsTbiLoading(true);
    setTbiError("");
    api.listPatientTbiEvaluations(patientId)
      .then((rows) => {
        if (active) {
          setTbiEvaluations(rows);
        }
      })
      .catch((loadError) => {
        if (active) {
          setTbiError(loadError instanceof Error ? loadError.message : "Failed to load TBI evaluations.");
        }
      })
      .finally(() => {
        if (active) {
          setIsTbiLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOptometryClinic, isTbiEvaluationOpen, isTrainingMode, patientId]);

  if (patient && consultationHydrationKey && hydratedConsultationKey !== consultationHydrationKey) {
    return (
      <aside className="fixed inset-0 z-30 flex w-screen items-center justify-center border-l-2 border-[#9fc7e1] bg-white p-6">
        <div role="status" className="rounded-2xl border border-[#bfd7e8] bg-[#f7fbfd] px-6 py-5 text-center shadow-sm">
          <p className="text-sm font-semibold text-black">Restoring consultation…</p>
          <p className="mt-1 text-xs text-black">Your examination entries are stored locally and will appear momentarily.</p>
        </div>
      </aside>
    );
  }

  if (!patient) {
    return null;
  }

  const currentPatient = patient;

  function buildConsultationPayload(options?: { includeNoteId?: boolean }): GenerateNotePayload {
    return buildConsultationNotePayload({
      patientId: currentPatient.id,
      visitId: currentPatient.current_visit?.id,
      form,
      currentModules: currentConsultationModules,
      isPediatricsClinic,
      currentNoteId,
      noteStatus,
      includeNoteId: options?.includeNoteId,
    });
  }

  async function handleGenerate(event?: FormEvent) {
    event?.preventDefault();
    if (isDraftDirty && !window.confirm("Regenerating will replace your unsaved note edits. Continue?")) {
      return;
    }
    setIsGenerating(true);
    setStatusMessage("");
    try {
      const refreshingDraft = Boolean(currentNoteId && noteStatus === "draft");
      const generated = await onGenerate(buildConsultationPayload({ includeNoteId: true }));
      const generatedForm = { ...formRef.current, generatedNote: generated.content };
      formRef.current = generatedForm;
      setForm(generatedForm);
      setHasGeneratedNote(true);
      setCurrentNoteId(generated.noteId || "");
      const generatedExtractions = generated.extractions ?? { services_performed: [], medications_prescribed: [] };
      const generatedStatus = generated.status || "draft";
      setClinicalExtractions(generatedExtractions);
      setNoteStatus(generatedStatus);
      setIsDraftDirty(false);
      setIsEmailSent(false);
      setIsWhatsAppSent(false);
      persistWorkspaceNow({
        form: generatedForm,
        hasGeneratedNote: true,
        currentNoteId: generated.noteId || "",
        noteStatus: generatedStatus,
        clinicalExtractions: generatedExtractions,
        isDraftDirty: false,
        isEmailSent: false,
        isWhatsAppSent: false,
      });
      const baseMessage = refreshingDraft ? "Draft note refreshed." : "Draft SOAP note generated.";
      setStatusMessage(generated.usedFallback ? `${baseMessage} ${generated.warning || "AI unavailable, used fallback template."}` : baseMessage);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to generate SOAP note.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function persistDraftIfNeeded() {
    if (!isDraftDirty) {
      return;
    }
    if (!currentNoteId || noteStatus !== "draft") {
      throw new Error("Only an active draft note can be saved.");
    }
    if (isTrainingMode) {
      setIsDraftDirty(false);
      return;
    }
    const syncedContent = syncDraftMedicationTable(form.generatedNote, clinicalExtractions);
    if (syncedContent !== form.generatedNote) {
      setForm((current) => ({ ...current, generatedNote: syncedContent }));
    }
    const saved = await api.updateNoteDraft(currentNoteId, {
      content: syncedContent.trim(),
      extractions: clinicalExtractions,
    });
    setForm((current) => ({ ...current, generatedNote: saved.content }));
    setIsDraftDirty(false);
  }

  function updateExtractedMedication(index: number, patch: Partial<ClinicalExtractions["medications_prescribed"][number]>) {
    setClinicalExtractions((current) => ({
      ...current,
      medications_prescribed: current.medications_prescribed.map((medicine, medicineIndex) =>
        medicineIndex === index ? { ...medicine, ...patch } : medicine,
      ),
    }));
    setIsDraftDirty(true);
  }

  function removeExtractedMedication(index: number) {
    setClinicalExtractions((current) => ({
      ...current,
      medications_prescribed: current.medications_prescribed.filter((_medicine, medicineIndex) => medicineIndex !== index),
    }));
    setIsDraftDirty(true);
  }

  function updateExtractedService(index: number, patch: Partial<ClinicalExtractions["services_performed"][number]>) {
    setClinicalExtractions((current) => ({
      ...current,
      services_performed: current.services_performed.map((service, serviceIndex) =>
        serviceIndex === index ? { ...service, ...patch } : service,
      ),
    }));
    setIsDraftDirty(true);
  }

  function removeExtractedService(index: number) {
    setClinicalExtractions((current) => ({
      ...current,
      services_performed: current.services_performed.filter((_service, serviceIndex) => serviceIndex !== index),
    }));
    setIsDraftDirty(true);
  }

  async function handleSaveDraft() {
    setIsSavingDraft(true);
    setStatusMessage("");
    try {
      await persistDraftIfNeeded();
      setStatusMessage("Draft note saved.");
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : "Failed to save draft note.");
    } finally {
      setIsSavingDraft(false);
    }
  }

  function setAssistantAnswer(question: ClinicalAssistantQuestion, answer: string) {
    setAssistantAnswers((current) => ({ ...current, [question.id]: answer }));
  }

  function toggleAssistantMultiAnswer(question: ClinicalAssistantQuestion, option: string) {
    setAssistantAnswers((current) => {
      const existing = String(current[question.id] || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const next = existing.includes(option)
        ? existing.filter((entry) => entry !== option)
        : [...existing, option];
      return { ...current, [question.id]: next.join(", ") };
    });
  }

  function assistantAnswerPayload(): ClinicalAssistantAnswer[] {
    return (assistantQuestions?.questions || [])
      .map((question) => ({
        question_id: question.id,
        label: question.label,
        answer: String(assistantAnswers[question.id] || "").trim(),
      }))
      .filter((answer) => answer.answer);
  }

  async function handleAskClinicalQuestions() {
    setIsLoadingAssistantQuestions(true);
    setAssistantError("");
    setAssistantAnalysis(null);
    setAssistantStage("idle");
    try {
      const response = await api.generateClinicalQuestions({
        patient_id: currentPatient.id,
        consultation: buildConsultationPayload(),
      });
      setAssistantQuestions(response);
      setAssistantAnswers({});
      setAssistantQuestionIndex(0);
      setAssistantStage("questions");
      if (response.warning) {
        setAssistantError(response.warning);
      }
    } catch (error) {
      setAssistantError(error instanceof Error ? error.message : "Failed to generate clinical questions.");
    } finally {
      setIsLoadingAssistantQuestions(false);
    }
  }

  async function handleAnalyzeClinicalAnswers() {
    if (!assistantQuestions?.questions.length) {
      setAssistantError("Ask clinical questions before analyzing.");
      return;
    }
    setIsAnalyzingAssistant(true);
    setAssistantError("");
    try {
      const response = await api.generateClinicalAnalysis({
        patient_id: currentPatient.id,
        consultation: buildConsultationPayload(),
        answers: assistantAnswerPayload(),
      });
      setAssistantAnalysis(response);
      setAssistantStage("analysis");
      if (response.warning) {
        setAssistantError(response.warning);
      }
    } catch (error) {
      setAssistantError(error instanceof Error ? error.message : "Failed to analyze clinical answers.");
    } finally {
      setIsAnalyzingAssistant(false);
    }
  }

  function appendAssistantNoteAdditions() {
    const additions = assistantAnalysis?.note_additions.trim();
    if (!additions) {
      setAssistantError("No note additions available yet.");
      return;
    }
    setForm((current) => ({
      ...current,
      notes: [current.notes.trim(), additions].filter(Boolean).join("\n\n"),
    }));
    setStatusMessage("AI Q&A added to clinical notes.");
  }

  function applyAssistantDiagnosis(label: string) {
    setForm((current) => ({ ...current, diagnosis: label }));
    setStatusMessage("AI consideration copied into diagnosis for clinician review.");
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
    setIsSending(true);
    try {
      await persistDraftIfNeeded();
      const message = await onSend({
        note_id: currentNoteId,
        patient_id: currentPatient.id,
        recipient_email: recipientEmail.trim(),
      });
      setNoteStatus("sent");
      setIsEmailSent(true);
      setStatusMessage(message);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send email.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSendWhatsApp() {
    if (!form.generatedNote.trim() || !currentNoteId) {
      setStatusMessage("Generate and save the note before sending it.");
      return;
    }
    if (!recipientPhone.trim()) {
      setStatusMessage("Enter a WhatsApp number before sending.");
      return;
    }

    setIsSendingWhatsApp(true);
    setStatusMessage("");
    try {
      await persistDraftIfNeeded();
      const result = await onSendWhatsApp({
        note_id: currentNoteId,
        patient_id: currentPatient.id,
        recipient_phone: recipientPhone.trim(),
      });
      setNoteStatus("sent");
      setIsWhatsAppSent(true);
      setStatusMessage(result.message);
      cancelWhatsAppDeliveryTrackingRef.current?.();
      cancelWhatsAppDeliveryTrackingRef.current = null;
      if (result.delivery) {
        cancelWhatsAppDeliveryTrackingRef.current = trackWhatsAppDelivery(
          result.delivery,
          "Consultation note",
          (message, delivery) => {
            setWhatsAppDeliveryStatus(delivery.status);
            setStatusMessage(message);
          },
        );
      } else {
        setWhatsAppDeliveryStatus("accepted");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send on WhatsApp. The note remains finalized; retry when ready.");
    } finally {
      setIsSendingWhatsApp(false);
    }
  }

  async function handlePdf(action: "preview" | "download" | "print") {
    if (!form.generatedNote.trim()) {
      setStatusMessage("Generate a note before creating the PDF.");
      return;
    }

    setIsGeneratingPdf(true);
    try {
      const syncedContent = syncDraftMedicationTable(form.generatedNote, clinicalExtractions);
      if (syncedContent !== form.generatedNote) {
        setForm((current) => ({ ...current, generatedNote: syncedContent }));
      }
      const blob = await onGeneratePdf({
        note_id: currentNoteId && (noteStatus === "final" || noteStatus === "sent") ? currentNoteId : undefined,
        patient_id: currentPatient.id,
        content: syncedContent,
        assets: form.assets,
      });
      const url = URL.createObjectURL(blob);

      if (action === "preview") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else if (action === "print") {
        URL.revokeObjectURL(url);
        printBlob(blob, `${currentPatient.name.replace(/\s+/g, "_")}_note.pdf`);
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${currentPatient.name.replace(/\s+/g, "_")}_note.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      setStatusMessage(action === "print" ? "Print dialog opened." : "PDF ready.");
      if (action !== "print") {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
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
              scheduled_for: zonedDateTimeInputToUtcIso(`${form.followUpDate}T09:00`, clinicTimeZone),
              notes: form.followUpNotes.trim(),
            }
          : undefined;
      await onDone(currentPatient, followUp);
      if (workspaceScope) {
        pendingWorkspaceWriteRef.current = null;
        clearConsultationWorkspace(workspaceScope);
      }
      onClose();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to complete consultation.");
    } finally {
      setIsCompleting(false);
    }
  }

  async function handleFinalize() {
    if (!currentNoteId || !hasGeneratedNote || !form.generatedNote.trim()) {
      setStatusMessage("Generate a consultation note before finalizing it.");
      return;
    }
    if (noteStatus === "final" || noteStatus === "sent") {
      setStatusMessage(noteStatus === "sent" ? "Note was already sent and locked." : "Note already finalized.");
      return;
    }
    setIsFinalizing(true);
    setStatusMessage("");
    try {
      if (isTrainingMode) {
        setIsDraftDirty(false);
        setNoteStatus("final");
        setStatusMessage("Training note finalized. You can mark the patient done without sending.");
        return;
      }
      await persistDraftIfNeeded();
      const finalized = await api.finalizeNote(currentNoteId);
      setCurrentNoteId(finalized.id);
      setNoteStatus(finalized.status);
      setForm((current) => ({
        ...current,
        generatedNote: finalized.snapshot_content || finalized.content || current.generatedNote,
        assets: (finalized.snapshot_asset_payload || finalized.asset_payload || current.assets) as NoteAsset[],
      }));
      setStatusMessage("Note Finalized");
    } catch (finalizeError) {
      setStatusMessage(finalizeError instanceof Error ? finalizeError.message : "Failed to finalize note.");
    } finally {
      setIsFinalizing(false);
    }
  }

  function openOptometryModule(section: "contactLens" | "binocularVision" | "lowVision" | "myopiaManagement" | "tbiEvaluation") {
    const moduleBySection: Record<typeof section, ConsultationHistoryModule> = {
      contactLens: "contact_lens",
      binocularVision: "binocular_vision",
      lowVision: "low_vision",
      myopiaManagement: "myopia_management",
      tbiEvaluation: "tbi_evaluation",
    };
    navigateConsultationHistory("examination", moduleBySection[section]);
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

  function selectContactLensEntry(entry: LongitudinalTrackRecord) {
    const nextContactLens = normalizeContactLensPayload(entry.raw_payload as Partial<ContactLensPayload>);
    setForm((current) => ({ ...current, contactLens: nextContactLens }));
  }

  function selectLowVisionEntry(entry: LongitudinalTrackRecord) {
    setForm((current) => ({
      ...current,
      lowVision: normalizeLowVisionPayload(entry.raw_payload as Partial<LowVisionPayload>),
    }));
  }

  function renderPreviousEvaluations(moduleKey: SpecialtyModuleKey, onSelectEntry: (entry: LongitudinalTrackRecord) => void) {
    const entries = moduleEntriesFor(moduleEntries, moduleKey);
    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-black">Previous Evaluations</h4>
          <button
            type="button"
            onClick={() => {
              if (moduleKey === "eye_exam") {
                setForm((current) => ({ ...current, eyeExam: createEmptyEyeExam() }));
              } else if (moduleKey === "contact_lens") {
                setForm((current) => ({ ...current, contactLens: createEmptyContactLens() }));
              } else if (moduleKey === "binocular_vision") {
                setForm((current) => ({ ...current, binocularVision: createEmptyBinocularVision() }));
              } else if (moduleKey === "low_vision") {
                setForm((current) => ({ ...current, lowVision: createEmptyLowVision() }));
              }
            }}
            className="rounded-lg border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-[#f3f8fb]"
          >
            New
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {isModuleEntriesLoading ? (
            <p role="status" className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-5 text-center text-sm text-black">
              Loading previous evaluations…
            </p>
          ) : entries.length ? entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelectEntry(entry)}
              className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-[#bfd7e8]"
            >
              <p className="text-sm font-medium text-black">
                {new Date(entry.measured_at).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-black">{formatModuleSummary(entry)}</p>
            </button>
          )) : (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-5 text-center text-sm text-black">
              No evaluations yet.
            </p>
          )}
        </div>
      </div>
    );
  }

  function rememberCurrentConsultationModule(moduleKey: SpecialtyModuleKey, payload: Record<string, unknown>) {
    setCurrentConsultationModules((current) => [
      ...current.filter((entry) => entry.module_type !== moduleKey),
      { module_type: moduleKey, payload },
    ]);
    setIsDraftDirty(true);
  }

  async function saveStructuredModuleEntry(
    moduleKey: SpecialtyModuleKey,
    payload: Record<string, unknown>,
    summary: string,
  ) {
    if (!currentPatient) {
      return;
    }
    const measuredAtIso = new Date().toISOString();
    setModuleEntryError("");
    try {
      let saved: LongitudinalTrackRecord;
      if (isTrainingMode) {
        saved = {
          id: createId(),
          org_id: "training",
          patient_id: currentPatient.id,
          track_type: moduleKey,
          measured_at: measuredAtIso,
          summary_fields: { summary },
          raw_payload: payload,
          derived_metrics: {},
          created_at: measuredAtIso,
        };
      } else {
        saved = await api.createPatientModuleEntry(currentPatient.id, {
          track_type: moduleKey,
          measured_at: measuredAtIso,
          summary_fields: { summary },
          raw_payload: payload,
          derived_metrics: {},
        });
      }
      setModuleEntries((current) => [...current.filter((entry) => entry.id !== saved.id), saved]);
      rememberCurrentConsultationModule(moduleKey, payload);
      setStatusMessage(summary);
      return saved;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save evaluation.";
      setModuleEntryError(message);
      throw saveError;
    }
  }

  async function saveContactLens() {
    if (!hasContactLensData(form.contactLens)) {
      setModuleEntryError("Enter contact lens values before saving.");
      return;
    }
    await saveStructuredModuleEntry(
      "contact_lens",
      {
        ...form.contactLens,
        eyes: form.contactLens.eyes.filter((entry) => hasContactLensEyeData(entry)),
      },
      buildContactLensSummary(form.contactLens),
    );
  }

  async function saveBinocularVisionEvaluation(payload: BinocularVisionEvaluationCreatePayload) {
    if (!currentPatient) {
      return;
    }
    setIsBinocularVisionLoading(true);
    setBinocularVisionError("");
    try {
      if (isTrainingMode) {
        const saved: BinocularVisionEvaluationRecord = {
          id: createId(),
          org_id: "training",
          patient_id: currentPatient.id,
          measured_at: payload.measured_at,
          payload: payload.payload,
          summary_fields: { summary: buildBinocularVisionSummary(payload.payload) },
          created_at: new Date().toISOString(),
        };
        setBinocularVisionEvaluations((current) => [...current, saved]);
        setForm((current) => ({ ...current, binocularVision: payload.payload }));
        rememberCurrentConsultationModule("binocular_vision", {
          measured_at: payload.measured_at,
          ...payload.payload,
        });
        setStatusMessage("Binocular vision evaluation saved.");
        return;
      }
      const saved = await api.createPatientBinocularVisionEvaluation(currentPatient.id, payload);
      setBinocularVisionEvaluations((current) => [...current.filter((record) => record.id !== saved.id), saved]);
      setForm((current) => ({ ...current, binocularVision: saved.payload }));
      rememberCurrentConsultationModule("binocular_vision", {
        measured_at: saved.measured_at,
        ...saved.payload,
      });
      setStatusMessage("Binocular vision evaluation saved.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save binocular vision evaluation.";
      setBinocularVisionError(message);
      throw saveError;
    } finally {
      setIsBinocularVisionLoading(false);
    }
  }

  async function saveLowVision(next: LowVisionPayload) {
    setForm((current) => ({ ...current, lowVision: next }));
    await saveStructuredModuleEntry("low_vision", next as unknown as Record<string, unknown>, buildLowVisionSummary(next));
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
      rememberCurrentConsultationModule("myopia_management", payload as unknown as Record<string, unknown>);
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
    rememberCurrentConsultationModule("myopia_management", payload as unknown as Record<string, unknown>);
  }

  async function saveTbiEvaluation(payload: TbiEvaluationCreatePayload) {
    if (!currentPatient) {
      return;
    }
    setIsTbiLoading(true);
    setTbiError("");
    try {
      if (isTrainingMode) {
        const saved: TbiEvaluationRecord = {
          id: createId(),
          org_id: "training",
          patient_id: currentPatient.id,
          measured_at: payload.measured_at,
          payload: payload.payload,
          summary_fields: { summary: "Neurovision / TBI evaluation saved." },
          created_at: new Date().toISOString(),
        };
        setTbiEvaluations((current) => [...current, saved]);
        rememberCurrentConsultationModule("tbi_evaluation", {
          measured_at: payload.measured_at,
          ...payload.payload,
        });
        setStatusMessage("TBI evaluation saved.");
        return;
      }
      const saved = await api.createPatientTbiEvaluation(currentPatient.id, payload);
      setTbiEvaluations((current) => [...current.filter((record) => record.id !== saved.id), saved]);
      rememberCurrentConsultationModule("tbi_evaluation", {
        measured_at: saved.measured_at,
        ...saved.payload,
      });
      setStatusMessage("TBI evaluation saved.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save TBI evaluation.";
      setTbiError(message);
      throw saveError;
    } finally {
      setIsTbiLoading(false);
    }
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
        assets: [...current.assets, ...nextAssets],
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


  const lifecycleLabel =
    noteStatus === "sent"
      ? "Sent and locked"
      : noteStatus === "final"
        ? "Finalized"
        : noteStatus === "draft"
        ? "Draft"
          : null;
  const patientInfoDetails = [
    { label: "Age", value: currentPatient.age !== null ? String(currentPatient.age) : "-" },
    { label: "Temp", value: currentPatient.temperature !== null ? `${currentPatient.temperature} F` : "-" },
    { label: "Height", value: currentPatient.height !== null ? `${currentPatient.height} cm` : "-" },
    { label: "Weight", value: currentPatient.weight !== null ? `${currentPatient.weight} kg` : "-" },
  ];
  const completedExaminations = [
    hasEyeExamData(form.eyeExam) ? "Examination" : "",
    currentConsultationModules.some((entry) => entry.module_type === "contact_lens") ? "Contact lens" : "",
    currentConsultationModules.some((entry) => entry.module_type === "binocular_vision") ? "Binocular vision" : "",
    currentConsultationModules.some((entry) => entry.module_type === "low_vision") ? "Low vision" : "",
    currentConsultationModules.some((entry) => entry.module_type === "myopia_management") ? "Myopia" : "",
    currentConsultationModules.some((entry) => entry.module_type === "tbi_evaluation") ? "Neurovision / TBI" : "",
    [form.bloodPressureSystolic, form.bloodPressureDiastolic, form.pulse, form.spo2, form.bloodSugar].some((value) => value.trim()) ? "Vitals" : "",
  ].filter(Boolean);

  function navigateConsultationHistory(
    step: OptometryConsultationStep,
    module: ConsultationHistoryModule = "",
    page = 0,
    replace = false,
  ) {
    const normalizedModule = step === "examination" ? (module || "eye_exam") : "";
    const normalizedPage = Math.max(0, page);
    setActiveOptometryStep(step);
    setActiveInlineModule(step === "examination" && normalizedModule === "vitals" ? "vitals" : null);
    setIsContactLensOpen(step === "examination" && normalizedModule === "contact_lens");
    setIsBinocularVisionOpen(step === "examination" && normalizedModule === "binocular_vision");
    setIsLowVisionOpen(step === "examination" && normalizedModule === "low_vision");
    setIsMyopiaManagementOpen(step === "examination" && normalizedModule === "myopia_management");
    setIsTbiEvaluationOpen(step === "examination" && normalizedModule === "tbi_evaluation");
    if (normalizedModule === "eye_exam") setActiveEyeExamPage(normalizedPage);
    if (normalizedModule === "contact_lens") setActiveContactLensPage(normalizedPage);
    if (normalizedModule === "low_vision") setActiveLowVisionPage(normalizedPage);

    const url = new URL(window.location.href);
    url.searchParams.set("consultationStep", step);
    if (normalizedModule) {
      url.searchParams.set("consultationModule", normalizedModule);
      url.searchParams.set("consultationPage", String(normalizedPage));
    } else {
      url.searchParams.delete("consultationModule");
      url.searchParams.delete("consultationPage");
    }
    if (url.toString() === window.location.href) return;
    const currentDepth = Number(window.history.state?.consultationDepth);
    const consultationDepth = Number.isFinite(currentDepth) && currentDepth >= 0 ? currentDepth : 0;
    const nextHistoryState = {
      ...(window.history.state || {}),
      consultationDepth: replace ? consultationDepth : consultationDepth + 1,
    };
    window.history[replace ? "replaceState" : "pushState"](nextHistoryState, "", url.toString());
  }

  async function leaveHistory() {
    if (activeOptometryStep !== "history" || await optometryHistory.save()) {
      setForm((current) => {
        const generatedSymptoms = buildChiefComplaintText(current.chiefComplaints);
        const canReplaceSymptoms = !current.symptoms.trim()
          || current.symptoms === current.lastAppliedChiefComplaintText;
        return canReplaceSymptoms
          ? {
              ...current,
              symptoms: generatedSymptoms,
              lastAppliedChiefComplaintText: generatedSymptoms,
            }
          : current;
      });
      return true;
    }
    return false;
  }

  async function openExamination() {
    if (!await leaveHistory()) return;
    navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage);
  }

  async function openConsultation() {
    if (!await leaveHistory()) return;
    navigateConsultationHistory("consultation");
  }

  function renderAssistantQuestionControl(question: ClinicalAssistantQuestion) {
    const value = String(assistantAnswers[question.id] || "");
    const options = question.options.length
      ? question.options
      : question.type === "yes_no"
        ? ["No", "Yes", "Not asked"]
        : [];
    if (["yes_no", "single_choice", "module_request"].includes(question.type)) {
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setAssistantAnswer(question, option)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                value === option
                  ? "border-[#6daed8] bg-[#e8f2fa] text-[#235f8e]"
                  : "border-[#bfd7e8] bg-white text-black hover:bg-[#f3f8fb]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      );
    }
    if (question.type === "multi_choice") {
      const selected = value.split(",").map((entry) => entry.trim()).filter(Boolean);
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => toggleAssistantMultiAnswer(question, option)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                selected.includes(option)
                  ? "border-[#6daed8] bg-[#e8f2fa] text-[#235f8e]"
                  : "border-[#bfd7e8] bg-white text-black hover:bg-[#f3f8fb]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      );
    }
    return (
      <input
        value={value}
        inputMode={question.type === "number" ? "decimal" : "text"}
        onChange={(event) => setAssistantAnswer(question, event.target.value)}
        placeholder={question.type === "duration" ? "e.g. 2 days" : "Answer"}
        className="mt-3 w-full rounded-xl border border-[#dbe7ef] bg-white px-3 py-2.5 text-sm text-black outline-none transition focus:border-[#6daed8]"
      />
    );
  }

  function renderModuleButton(label: string, active: boolean, onClick: () => void) {
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={`min-w-[140px] flex-1 shrink-0 border-r border-[#bfd7e8] px-5 py-3 text-center text-sm font-semibold transition last:border-r-0 ${
          active
            ? "bg-[#376f9f] text-white"
            : "bg-white text-black hover:bg-[#f3f8fb] hover:text-black"
        }`}
      >
        {label}
      </button>
    );
  }

  function renderAttachmentsSection() {
    return (
      <section className="rounded-[18px] border border-[#bfd7e8] bg-white/80 p-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-black">Attachments</p>
          <div className="flex shrink-0 items-center gap-3">
            {attachmentAssets.length ? (
              <span className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2a6fa8]">
                {attachmentAssets.length} file{attachmentAssets.length === 1 ? "" : "s"}
              </span>
            ) : null}
            <label
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-[#bfd7e8] bg-[#f3f8fb] text-black transition hover:bg-[#dbeaf4]"
              aria-label="Add attachment"
              title="Add attachment"
            >
              <Plus className="h-6 w-6" />
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={handleAttachmentSelect}
                className="hidden"
              />
            </label>
          </div>
        </div>
        {attachmentAssets.length ? (
          <div className="mt-4 space-y-2">
            {attachmentAssets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center justify-between gap-3 rounded-[18px] border border-[#dbe7ef] bg-[#f3f8fb]/40 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {asset.content_type.startsWith("image/") && asset.data_base64 ? (
                    <NextImage
                      src={`data:${asset.content_type};base64,${asset.data_base64}`}
                      alt={asset.name}
                      width={48}
                      height={48}
                      className="h-12 w-12 rounded-xl border border-[#dbe7ef] object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#dbe7ef] bg-white text-black">
                      <Paperclip className="h-4 w-4" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-black">{asset.name}</p>
                    <p className="text-xs text-black">{asset.content_type}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeAsset(asset.id)}
                  className="rounded-xl border border-[#bfd7e8] p-2 text-black transition hover:bg-white"
                  aria-label={`Remove ${asset.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  function renderTestsSection(examinationWorkspace = false) {
    return (
      <section>
        <div className="w-full overflow-x-auto border-y border-[#bfd7e8] bg-white">
          <div className="flex min-w-max" role="tablist" aria-label="Clinical modules">
            {renderModuleButton(
              "Vitals",
              activeInlineModule === "vitals",
              () => navigateConsultationHistory("examination", activeInlineModule === "vitals" ? "eye_exam" : "vitals"),
            )}
            {specialtyModules.map((moduleKey) => {
            const copy = TEST_MODULE_COPY[moduleKey];
            const openModule = () => {
              if (moduleKey === "eye_exam") {
                navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage);
              } else if (moduleKey === "contact_lens") {
                setActiveInlineModule(null);
                openOptometryModule("contactLens");
              } else if (moduleKey === "binocular_vision") {
                setActiveInlineModule(null);
                openOptometryModule("binocularVision");
              } else if (moduleKey === "low_vision") {
                setActiveInlineModule(null);
                openOptometryModule("lowVision");
              } else if (moduleKey === "myopia_management") {
                setActiveInlineModule(null);
                openOptometryModule("myopiaManagement");
              } else if (moduleKey === "tbi_evaluation") {
                setActiveInlineModule(null);
                openOptometryModule("tbiEvaluation");
              } else if (moduleKey === "pediatric_growth_measurement") {
                setActivePediatricModule("growth");
              } else if (moduleKey === "well_child_visit") {
                setActivePediatricModule("wellChild");
              } else if (moduleKey === "parent_handout_request") {
                setActivePediatricModule("parentHandout");
              } else if (moduleKey === "pediatric_follow_up_plan") {
                setActivePediatricModule("pediatricFollowUp");
              }
            };
            return renderModuleButton(copy.label, examinationWorkspace && moduleKey === "eye_exam" && activeInlineModule !== "vitals", openModule);
            })}
          </div>
        </div>
        {moduleEntryError ? <p className="mt-3 text-sm font-medium text-rose-600">{moduleEntryError}</p> : null}
        {activeInlineModule ? <div className="mt-4">{renderInlineModuleDetail()}</div> : null}
      </section>
    );
  }

  function renderInlineModuleDetail() {
    if (activeInlineModule === "vitals") {
      return (
        <ConsultationModuleDetail title="Vitals">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["BP Systolic", "bloodPressureSystolic", "120", "numeric"],
              ["BP Diastolic", "bloodPressureDiastolic", "80", "numeric"],
              ["Pulse", "pulse", "72", "numeric"],
              ["SpO2", "spo2", "98", "numeric"],
              ["Blood Sugar", "bloodSugar", "110", "decimal"],
            ].map(([label, key, placeholder, inputMode]) => (
              <label key={key} className="block">
                <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">{label}</span>
                <input
                  value={String(form[key as keyof typeof form] || "")}
                  inputMode={inputMode as "numeric" | "decimal"}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder={placeholder}
                  className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-black outline-none transition focus:border-[#6daed8]"
                />
              </label>
            ))}
          </div>
        </ConsultationModuleDetail>
      );
    }
    if (activeInlineModule === "medicines") {
      return (
        <ConsultationModuleDetail title="Medicines">
          <input
            value={medicineSearch}
            onChange={(event) => setMedicineSearch(event.target.value)}
            placeholder="Search medicines by name or unit"
            className="w-full rounded-xl border border-emerald-100 bg-white px-4 py-3 text-black outline-none transition focus:border-emerald-400"
          />
          {form.prescriptions.length ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {form.prescriptions.map((entry) => (
                <div key={entry.itemId} className="rounded-[20px] border border-emerald-100 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-black">{entry.name}</p>
                      <p className="mt-1 text-xs text-black">{entry.unit || "unit not set"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePrescription(entry.itemId)}
                      className="rounded-xl border border-emerald-200 p-2 text-black transition hover:bg-emerald-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input
                      value={entry.quantity}
                      inputMode="decimal"
                      onChange={(event) => updatePrescription(entry.itemId, { quantity: event.target.value })}
                      placeholder="Quantity"
                      className="w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-emerald-400"
                    />
                    <input
                      value={entry.duration}
                      onChange={(event) => updatePrescription(entry.itemId, { duration: event.target.value })}
                      placeholder="Duration"
                      className="w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-emerald-400"
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["morning", "afternoon", "night"] as const).map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => updatePrescription(entry.itemId, { [slot]: !entry[slot] })}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-medium capitalize transition ${
                          entry[slot]
                            ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                            : "border-emerald-200 bg-white text-black hover:bg-emerald-50"
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {PRESCRIPTION_NOTE_OPTIONS.map((option) => {
                      const active = normalizePrescriptionNotes(entry.notes).includes(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => updatePrescription(entry.itemId, { notes: togglePrescriptionNoteValue(entry.notes, option) })}
                          className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                            active
                              ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                              : "border-emerald-200 bg-white text-black hover:bg-emerald-50"
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {!medicineItems.length && isActiveMedicinesLoading ? (
            <p className="mt-3 rounded-[18px] border border-dashed border-emerald-200 bg-white px-4 py-6 text-sm text-black">Loading medicines…</p>
          ) : null}
          {!medicineItems.length && activeMedicinesError && !isActiveMedicinesLoading ? (
            <div className="mt-3 rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              <p>{activeMedicinesError}</p>
              <button type="button" onClick={() => void loadActiveMedicines(true).catch(() => undefined)} className="mt-3 font-semibold">Try again</button>
            </div>
          ) : null}
          <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
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
                    className={`flex items-center justify-between gap-3 rounded-[18px] border px-4 py-3 text-left transition ${
                      active
                        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                        : "border-emerald-100 bg-white text-black hover:bg-emerald-50"
                    } disabled:cursor-not-allowed disabled:opacity-100`}
                  >
                    <span>
                      <span className="block text-sm font-medium text-black">{item.name}</span>
                      <span className="mt-1 block text-xs text-black">
                        {item.default_price.toFixed(2)}{item.unit ? ` · ${item.unit}` : ""}
                      </span>
                    </span>
                    <span className="rounded-xl border border-emerald-200 px-3 py-1 text-xs font-medium">
                      {active ? "Selected" : outOfStock ? "Out" : "Add"}
                    </span>
                  </button>
                );
              })
            ) : !isActiveMedicinesLoading && !activeMedicinesError ? (
              <p className="rounded-[18px] border border-dashed border-emerald-200 bg-white px-4 py-6 text-sm text-black">
                No medicines match this search.
              </p>
            ) : null}
          </div>
        </ConsultationModuleDetail>
      );
    }
    return null;
  }

  function renderAssistantPanel() {
    const questions = assistantQuestions?.questions || [];
    const safeQuestionIndex = questions.length
      ? Math.min(assistantQuestionIndex, questions.length - 1)
      : 0;
    const currentQuestion = questions[safeQuestionIndex];
    const answeredCount = questions.filter((question) => String(assistantAnswers[question.id] || "").trim()).length;
    const currentFlagStatus = (flag: ClinicalAnalysisResponse["red_flags"][number]) => {
      if (flag.present === true) {
        return "present";
      }
      if (flag.present === false) {
        return "not present";
      }
      return "ask/check";
    };

    return (
      <section className="rounded-[18px] border border-[#bfd7e8] bg-white/90 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-black">AI Assistant</p>
          </div>
          <Sparkles className="h-5 w-5 text-[#2f8fd3]" />
        </div>
        <div className="mt-4 space-y-4">
            <button
              type="button"
              onClick={() => void handleAskClinicalQuestions()}
              disabled={isLoadingAssistantQuestions}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-100"
            >
              <Sparkles className="h-4 w-4" />
              {isLoadingAssistantQuestions ? "Building questions..." : assistantQuestions ? "New Questions" : "Ask AI Questions"}
            </button>
            {assistantError ? (
              <p className="rounded-[16px] border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900">{assistantError}</p>
            ) : null}
            {assistantQuestions?.warning ? (
              <p className="rounded-[16px] border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900">{assistantQuestions.warning}</p>
            ) : null}
            {assistantQuestions && assistantStage === "questions" ? (
              <div className="space-y-3">
                {currentQuestion ? (
                  <div className="rounded-[16px] border border-[#dbe7ef] bg-white p-3">
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#edf3f7] pb-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-black">
                        Question {safeQuestionIndex + 1} of {questions.length}
                      </span>
                      <span className="rounded-full border border-[#dbe7ef] bg-[#f3f8fb] px-2.5 py-1 text-[11px] font-medium text-black">
                        {answeredCount}/{questions.length} answered
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-5 text-black">{currentQuestion.label}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                        currentQuestion.priority === "high" ? "bg-rose-50 text-rose-700" : currentQuestion.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-black"
                      }`}>
                        {currentQuestion.priority}
                      </span>
                    </div>
                    {currentQuestion.rationale ? <p className="mt-2 text-xs leading-5 text-black">{currentQuestion.rationale}</p> : null}
                    {renderAssistantQuestionControl(currentQuestion)}
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setAssistantQuestionIndex((current) => Math.max(0, current - 1))}
                        disabled={safeQuestionIndex === 0}
                        className="inline-flex items-center justify-center rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
                      >
                        ← Previous
                      </button>
                      <div className="flex items-center gap-1.5">
                        {questions.map((question, index) => (
                          <button
                            key={question.id}
                            type="button"
                            aria-label={`Go to question ${index + 1}`}
                            onClick={() => setAssistantQuestionIndex(index)}
                            className={`h-2.5 rounded-full transition ${
                              index === safeQuestionIndex
                                ? "w-6 bg-[#2f8fd3]"
                                : assistantAnswers[question.id]
                                  ? "w-2.5 bg-emerald-300"
                                  : "w-2.5 bg-[#dbe7ef]"
                            }`}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setAssistantQuestionIndex((current) => Math.min(questions.length - 1, current + 1))}
                        disabled={safeQuestionIndex >= questions.length - 1}
                        className="inline-flex items-center justify-center rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleAnalyzeClinicalAnswers()}
                  disabled={isAnalyzingAssistant}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
                >
                  {isAnalyzingAssistant ? "Analyzing..." : "Analyze Answers"}
                </button>
              </div>
            ) : null}
            {assistantAnalysis && assistantStage === "analysis" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-[16px] border border-[#dbe7ef] bg-[#f3f8fb]/50 p-3">
                  <div>
                    <p className="text-sm font-semibold text-black">Recommendations</p>
                    <p className="mt-1 text-xs text-black">{answeredCount}/{questions.length} answers used</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAssistantStage("questions")}
                    className="rounded-xl border border-[#9fc7e1] bg-white px-3 py-1.5 text-xs font-medium text-[#235f8e] transition hover:bg-[#f3f8fb]"
                  >
                    Edit answers
                  </button>
                </div>
                {assistantAnalysis.possibilities.map((possibility) => (
                  <div key={possibility.label} className="rounded-[16px] border border-[#dbe7ef] bg-[#f3f8fb]/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-black">{possibility.label}</p>
                        <p className="mt-1 text-xs leading-5 text-black">{possibility.why}</p>
                        {possibility.what_to_check ? (
                          <p className="mt-1 text-xs leading-5 text-black">Check: {possibility.what_to_check}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => applyAssistantDiagnosis(possibility.label)}
                        className="rounded-xl border border-[#9fc7e1] bg-white px-3 py-1.5 text-xs font-medium text-[#235f8e] transition hover:bg-[#f3f8fb]"
                      >
                        Use
                      </button>
                    </div>
                  </div>
                ))}
                {assistantAnalysis.red_flags.length ? (
                  <div className="rounded-[16px] border border-rose-200 bg-rose-50/70 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">Red flags</p>
                    <div className="mt-2 space-y-2">
                      {assistantAnalysis.red_flags.map((flag) => (
                        <p key={flag.label} className="text-sm leading-5 text-rose-900">
                          <span className="font-medium">{flag.label}</span> · {currentFlagStatus(flag)} · {flag.severity}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
                {assistantAnalysis.suggested_tests.length ? (
                  <div className="flex flex-wrap gap-2">
                    {assistantAnalysis.suggested_tests.map((test) => (
                      <span key={test} className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-medium text-black">
                        {test}
                      </span>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={appendAssistantNoteAdditions}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0]"
                >
                  Add AI summary to notes
                </button>
              </div>
            ) : null}
        </div>
      </section>
    );
  }

  return (
    <aside className="fixed inset-0 z-30 w-screen overflow-y-auto border-l-2 border-[#9fc7e1] bg-white p-5 text-black shadow-[0_20px_60px_rgba(64,131,181,0.10)] [&_input]:placeholder:text-black [&_textarea]:placeholder:text-black sm:p-6">
      <div className="flex min-h-full flex-col">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-black">Consultation</p>
            <h2 className="mt-2 text-3xl font-semibold text-black">{currentPatient.name}</h2>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-black">
              <span>{currentPatient.phone}</span>
              <span aria-hidden="true">·</span>
              <span>{currentPatient.reason}</span>
              {patientInfoDetails.map((entry) => (
                <span key={entry.label} className="contents">
                  <span aria-hidden="true">·</span>
                  <span>{entry.label} {entry.value}</span>
                </span>
              ))}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCloseConsultation}
            aria-label="Close consultation"
            className="rounded-xl border border-[#bfd7e8] p-2 text-black transition hover:text-black"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isOptometryClinic ? (
          <nav aria-label="Consultation steps" className="mb-7 flex w-full max-w-[880px]">
            {([
              ["history", "Step 1", "History"],
              ["examination", "Step 2", "Examination"],
              ["consultation", "Step 3", "Consultation"],
            ] as const).map(([step, eyebrow, label], index) => {
              const active = activeOptometryStep === step;
              const complete = step === "history"
                ? activeOptometryStep !== "history"
                : step === "examination" && hasEyeExamData(form.eyeExam);
              return (
                <button
                  key={step}
                  type="button"
                  aria-current={active ? "step" : undefined}
                  onClick={() => {
                    if (step === "history") {
                      navigateConsultationHistory("history");
                    } else if (step === "examination") {
                      void openExamination();
                    } else {
                      void openConsultation();
                    }
                  }}
                  style={{
                    clipPath: index === 0
                      ? "polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%)"
                      : index === 2
                        ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 18px 50%)"
                        : "polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%, 18px 50%)",
                  }}
                  className={`flex h-12 flex-1 items-center justify-center gap-2 border border-[#bfd7e8] px-5 text-sm transition ${
                    index > 0 ? "-ml-2 pl-8" : "relative z-10 pr-7"
                  } ${
                    active
                      ? "bg-[#e2f0fa] font-semibold text-[#174f78]"
                      : "bg-white text-black hover:bg-[#f3f8fb] hover:text-black"
                  }`}
                >
                  <span className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-white ${
                    complete ? "bg-emerald-600" : active ? "bg-[#174f78]" : "bg-slate-700"
                  }`}>
                    {complete ? "Done" : eyebrow}
                  </span>
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {isOptometryClinic && activeOptometryStep === "history" ? (
          <div className="space-y-6">
            <OptometryHistoryEditor
              controller={optometryHistory}
              chiefComplaints={form.chiefComplaints}
              onChiefComplaintsChange={(chiefComplaints) => (
                setForm((current) => ({ ...current, chiefComplaints }))
              )}
              onContinue={openExamination}
            />
            {renderAttachmentsSection()}
          </div>
        ) : isOptometryClinic && activeOptometryStep === "examination" ? (
          <div className="space-y-4">
            {renderTestsSection(true)}
            {activeInlineModule !== "vitals" ? <EyeExamModal
              open
              inline
              value={form.eyeExam}
              onDraftChange={(next) => setForm((current) => ({ ...current, eyeExam: next }))}
              activePage={activeEyeExamPage}
              onActivePageChange={(nextPage) => navigateConsultationHistory("examination", "eye_exam", nextPage)}
              onClose={() => undefined}
              onSave={async (next) => {
                setForm((current) => ({ ...current, eyeExam: next }));
                await saveStructuredModuleEntry("eye_exam", next as unknown as Record<string, unknown>, buildEyeExamSummary(next));
              }}
              onContinue={async () => {
                navigateConsultationHistory("consultation");
              }}
            /> : null}
          </div>
        ) : (
        <form className="grid gap-5 pr-1 xl:grid-cols-[minmax(0,1fr)_410px]" onSubmit={handleGenerate}>
          <div className="space-y-4">
            {isOptometryClinic ? (
              <section className="rounded-[18px] border border-[#bfd7e8] bg-[#f7fbfd] px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black">Examinations completed</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {completedExaminations.length ? completedExaminations.map((label) => (
                        <span key={label} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {label}
                        </span>
                      )) : <span className="text-sm text-black">No examination findings saved yet.</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage)}
                    className="rounded-xl border border-[#2f8fd3] bg-white px-4 py-2 text-sm font-semibold text-[#287fc0] transition hover:bg-[#edf5fa]"
                  >
                    Review Examination
                  </button>
                </div>
              </section>
            ) : null}
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-black">Symptoms</span>
              <textarea
                rows={3}
                value={form.symptoms}
                onChange={(event) =>
                  setForm((current) => ({ ...current, symptoms: event.target.value }))
                }
                className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-black outline-none transition focus:border-[#6daed8]"
                placeholder="Chief complaints, duration, key context"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-black">Diagnosis</span>
              <input
                value={form.diagnosis}
                onChange={(event) =>
                  setForm((current) => ({ ...current, diagnosis: event.target.value }))
                }
                className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-black outline-none transition focus:border-[#6daed8]"
                placeholder="Provisional or confirmed diagnosis"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-black">
                {isOptometryClinic ? "Medications prescribed" : "Medications"}
              </span>
              <textarea
                rows={3}
                value={form.medications}
                onChange={(event) =>
                  setForm((current) => ({ ...current, medications: event.target.value }))
                }
                className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-black outline-none transition focus:border-[#6daed8]"
                placeholder="Prescriptions, dosage, duration"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-black">Treatment</span>
              <textarea
                rows={3}
                value={form.treatment}
                onChange={(event) =>
                  setForm((current) => ({ ...current, treatment: event.target.value }))
                }
                className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-black outline-none transition focus:border-[#6daed8]"
                placeholder="Advice, procedures, therapy plan, lifestyle instructions"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-black">Clinical Notes</span>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-4 py-3 text-black outline-none transition focus:border-[#6daed8]"
                placeholder="Exam findings, vitals, advice, follow-up"
              />
            </label>

            {!isOptometryClinic ? renderTestsSection() : null}

              <div className="grid gap-4 xl:grid-cols-2">
                {renderAttachmentsSection()}

              <ConsultationExpandableCard
                title="Drawing"
                description="Open a large canvas to sketch findings, markings, or procedure notes."
                open={false}
                onToggle={() => {
                  setIsDrawingModalOpen(true);
                }}
                badge={
                  drawingAsset ? (
                    <span className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2a6fa8]">
                      Drawing added
                    </span>
                  ) : null
                }
              />
            </div>

            <div className="rounded-[18px] border border-[#bfd7e8] bg-[#f3f8fb]/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[#2f8fd3]" />
                  <span className="text-sm font-medium text-black">Generated Note</span>
                </div>
                <div className="flex items-center gap-2">
                  {lifecycleLabel ? (
                    <span className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-black">
                      {lifecycleLabel}
                    </span>
                  ) : null}
                  <button
                    type="submit"
                    disabled={isGenerating}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-100"
                  >
                    <Sparkles className="h-4 w-4" />
                    {isGenerating ? "Generating..." : noteStatus === "draft" ? "Refresh Draft" : "Generate Note"}
                  </button>
                  {noteStatus === "draft" ? (
                    <button
                      type="button"
                      onClick={() => void handleSaveDraft()}
                      disabled={isSavingDraft || !isDraftDirty || !form.generatedNote.trim()}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
                    >
                      <PenLine className="h-4 w-4" />
                      {isSavingDraft ? "Saving..." : isDraftDirty ? "Save Draft" : "Saved"}
                    </button>
                  ) : null}
                </div>
              </div>
              <textarea
                rows={14}
                value={form.generatedNote}
                readOnly={noteStatus !== "draft"}
                onChange={(event) => {
                  if (noteStatus !== "draft") {
                    return;
                  }
                  setForm((current) => ({ ...current, generatedNote: event.target.value }));
                  setIsDraftDirty(true);
                }}
                className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-sm leading-6 text-black outline-none transition focus:border-[#6daed8]"
                placeholder="Saved SOAP note will appear here"
              />
              {hasGeneratedNote && (clinicalExtractions.services_performed.length || clinicalExtractions.medications_prescribed.length) ? (
                <div className="mt-4 space-y-4 rounded-xl border border-[#dbe7ef] bg-white p-4">
                  {clinicalExtractions.services_performed.length ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-black">Performed services</p>
                      <div className="mt-2 space-y-2">
                        {clinicalExtractions.services_performed.map((service, index) => (
                          <div key={`${service.name}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_110px_auto]">
                            <input
                              value={service.name}
                              readOnly={noteStatus !== "draft"}
                              onChange={(event) => updateExtractedService(index, { name: event.target.value })}
                              className="rounded-lg border border-[#dbe7ef] px-3 py-2 text-sm"
                              aria-label={`Service ${index + 1} name`}
                            />
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={service.quantity}
                              readOnly={noteStatus !== "draft"}
                              onChange={(event) => updateExtractedService(index, { quantity: Math.max(1, Number(event.target.value) || 1) })}
                              className="rounded-lg border border-[#dbe7ef] px-3 py-2 text-sm"
                              aria-label={`Service ${index + 1} quantity`}
                            />
                            {noteStatus === "draft" ? (
                              <button type="button" onClick={() => removeExtractedService(index)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700">Remove</button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {clinicalExtractions.medications_prescribed.length ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-black">Prescribed medicines</p>
                      <div className="mt-2 space-y-3">
                        {clinicalExtractions.medications_prescribed.map((medicine, index) => (
                          <div key={`${medicine.name}-${index}`} className="rounded-lg border border-[#dbe7ef] p-3">
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                              {([
                                ["name", "Medicine"],
                                ["strength", "Strength"],
                                ["dose", "Dose"],
                                ["route", "Route"],
                                ["schedule", "Schedule"],
                                ["duration", "Duration"],
                                ["quantity", "Quantity"],
                                ["instructions", "Instructions"],
                              ] as const).map(([field, label]) => (
                                <label key={field} className="block">
                                  <span className="mb-1 block text-xs text-black">{label}</span>
                                  <input
                                    value={medicine[field] ?? ""}
                                    readOnly={noteStatus !== "draft"}
                                    onChange={(event) => updateExtractedMedication(index, { [field]: event.target.value })}
                                    className="w-full rounded-lg border border-[#dbe7ef] px-3 py-2 text-sm"
                                  />
                                </label>
                              ))}
                            </div>
                            {noteStatus === "draft" ? (
                              <button type="button" onClick={() => removeExtractedMedication(index)} className="mt-2 rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-700">Remove medicine</button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <p className="mt-2 text-xs text-black">
                {noteStatus === "draft" ? "Edit the note prose here and use the structured fields in this card to change services or the medicine table, then save or finalize." : "Finalized notes are read-only."}
                {noteStatus === "sent" ? " This note has been sent and is locked." : ""}
              </p>
            </div>
          </div>
          <div className={isOptometryClinic ? "space-y-4 xl:col-start-2 xl:row-start-1 xl:self-start xl:sticky xl:top-4" : "space-y-4"}>
            {renderAssistantPanel()}
            <section className="hidden overflow-hidden rounded-[18px] border border-[#bfd7e8] bg-white/90">
              <div className="border-b border-[#dbe7ef] px-4 py-4">
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-black">Modules</p>
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
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">BP Systolic</span>
                      <input
                        value={form.bloodPressureSystolic}
                        inputMode="numeric"
                        onChange={(event) => setForm((current) => ({ ...current, bloodPressureSystolic: event.target.value }))}
                        placeholder="120"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-black outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">BP Diastolic</span>
                      <input
                        value={form.bloodPressureDiastolic}
                        inputMode="numeric"
                        onChange={(event) => setForm((current) => ({ ...current, bloodPressureDiastolic: event.target.value }))}
                        placeholder="80"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-black outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">Pulse</span>
                      <input
                        value={form.pulse}
                        inputMode="numeric"
                        onChange={(event) => setForm((current) => ({ ...current, pulse: event.target.value }))}
                        placeholder="72"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-black outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">SpO2</span>
                      <input
                        value={form.spo2}
                        inputMode="numeric"
                        onChange={(event) => setForm((current) => ({ ...current, spo2: event.target.value }))}
                        placeholder="98"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-black outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">Blood Sugar</span>
                      <input
                        value={form.bloodSugar}
                        inputMode="decimal"
                        onChange={(event) => setForm((current) => ({ ...current, bloodSugar: event.target.value }))}
                        placeholder="110"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-black outline-none transition focus:border-[#6daed8]"
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
                    className="w-full rounded-xl border border-emerald-100 bg-white px-4 py-3 text-black outline-none transition focus:border-emerald-400"
                  />
                  {form.prescriptions.length ? (
                    <div className="mt-3 space-y-3">
                      {form.prescriptions.map((entry) => (
                        <div key={entry.itemId} className="rounded-[22px] border border-emerald-100 bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-black">{entry.name}</p>
                              <p className="mt-1 text-xs text-black">{entry.unit || "unit not set"}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removePrescription(entry.itemId)}
                              className="rounded-xl border border-emerald-200 p-2 text-black transition hover:bg-emerald-50"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="block">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">Quantity</span>
                              <input
                                value={entry.quantity}
                                inputMode="decimal"
                                onChange={(event) => updatePrescription(entry.itemId, { quantity: event.target.value })}
                                placeholder="10"
                                className="w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-emerald-400"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">Duration</span>
                              <input
                                value={entry.duration}
                                onChange={(event) => updatePrescription(entry.itemId, { duration: event.target.value })}
                                placeholder="5 days"
                                className="w-full rounded-xl border border-emerald-100 bg-emerald-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-emerald-400"
                              />
                            </label>
                          </div>
                          <div className="mt-3">
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black">Notes</p>
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
                                        : "border-emerald-200 bg-white text-black hover:bg-emerald-50"
                                    }`}
                                  >
                                    {option}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="mt-3">
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black">Schedule</p>
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
                                      : "border-emerald-200 bg-white text-black hover:bg-emerald-50"
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
                  {!medicineItems.length && isActiveMedicinesLoading ? (
                    <p className="mt-3 rounded-[22px] border border-dashed border-emerald-200 bg-white px-4 py-6 text-sm text-black">Loading medicines…</p>
                  ) : null}
                  {!medicineItems.length && activeMedicinesError && !isActiveMedicinesLoading ? (
                    <div className="mt-3 rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                      <p>{activeMedicinesError}</p>
                      <button type="button" onClick={() => void loadActiveMedicines(true).catch(() => undefined)} className="mt-3 font-semibold">Try again</button>
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
                                : "border-emerald-100 bg-white text-black hover:bg-emerald-50"
                            } disabled:cursor-not-allowed disabled:opacity-100`}
                          >
                            <div>
                              <p className="text-sm font-medium text-black">{item.name}</p>
                              <p className="mt-1 text-xs text-black">
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
                    ) : !isActiveMedicinesLoading && !activeMedicinesError ? (
                      <p className="rounded-[22px] border border-dashed border-emerald-200 bg-white px-4 py-6 text-sm text-black">
                        No medicines match this search.
                      </p>
                    ) : null}
                  </div>
                </ConsultationModuleDetail>
              </ConsultationModuleRailItem>
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
                <p className="text-sm text-black">{statusMessage || "Ready to generate and send."}</p>
                <div className="flex flex-col gap-3">
                  <div className="rounded-[16px] border border-[#bfd7e8] bg-[#f3f8fb]/40 p-4">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">
                        Recipient email
                      </span>
                      <input
                        type="email"
                        value={recipientEmail}
                        onChange={(event) => setRecipientEmail(event.target.value)}
                        placeholder="patient@example.com"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-white px-3 py-2.5 text-sm text-black outline-none transition focus:border-[#6daed8]"
                      />
                    </label>
                    <label className="mt-3 block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">
                        WhatsApp number
                      </span>
                      <input
                        type="tel"
                        value={recipientPhone}
                        onChange={(event) => setRecipientPhone(event.target.value)}
                        placeholder="+91 98765 43210"
                        className="w-full rounded-xl border border-[#dbe7ef] bg-white px-3 py-2.5 text-sm text-black outline-none transition focus:border-[#6daed8]"
                      />
                      {whatsappDeliveryStatus ? (
                        <span className="mt-2 block text-xs font-medium text-black">
                          WhatsApp: {whatsappDeliveryStatus === "accepted" ? "Accepted" : whatsappDeliveryStatus.charAt(0).toUpperCase() + whatsappDeliveryStatus.slice(1)}
                        </span>
                      ) : null}
                    </label>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      disabled={isFinalizing || !currentNoteId || !form.generatedNote.trim() || noteStatus !== "draft"}
                      onClick={handleFinalize}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
                    >
                      <PenLine className="h-4 w-4" />
                      {isFinalizing ? "Finalizing..." : noteStatus === "draft" ? "Finalize Note" : "Note Finalized"}
                    </button>
                    <button
                      type="button"
                      disabled={isSending || isSendingWhatsApp || !currentNoteId || !recipientEmail.trim()}
                      onClick={handleSend}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
                    >
                      <Mail className="h-4 w-4" />
                      {isSending ? "Sending..." : isEmailSent ? "Send Email Again" : "Send Email"}
                    </button>
                    <button
                      type="button"
                      disabled={isSending || isSendingWhatsApp || !currentNoteId || !recipientPhone.trim()}
                      onClick={handleSendWhatsApp}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1f9d68] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#18885a] disabled:opacity-100"
                    >
                      <MessageCircle className="h-4 w-4" />
                      {isSendingWhatsApp ? "Sending..." : isWhatsAppSent ? "Send WhatsApp Again" : "Send WhatsApp"}
                    </button>
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          disabled={isGeneratingPdf || !currentNoteId}
                          onClick={() => handlePdf("preview")}
                          className="inline-flex min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
                        >
                          <Eye className="h-4 w-4" />
                          {isGeneratingPdf ? "Preparing..." : "Preview"}
                        </button>
                        <button
                          type="button"
                          disabled={isGeneratingPdf || !currentNoteId}
                          onClick={() => handlePdf("print")}
                          className="inline-flex min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-[#f3f8fb] disabled:opacity-100"
                        >
                          <Printer className="h-4 w-4" />
                          Print
                        </button>
                      </div>
                      <div className="w-full sm:max-w-[320px]">
                        <button
                          type="button"
                          onClick={() => setIsFollowUpOpen((current) => !current)}
                          className={`inline-flex w-full min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-5 py-2.5 text-sm font-medium transition disabled:opacity-100 ${
                            isFollowUpOpen
                              ? "border-[#2b60c6] bg-white text-black shadow-sm shadow-blue-900/10"
                              : "border-[#9fc7e1] bg-white text-black hover:bg-[#f3f8fb]"
                          }`}
                        >
                          <CalendarPlus2 className="h-4 w-4" />
                          Follow-up
                        </button>
                        {isFollowUpOpen ? (
                          <div className="mt-3 rounded-[16px] border border-[#bfd7e8] bg-[#f3f8fb]/40 p-4">
                            <div className="grid gap-3">
                              <label className="block">
                                <span className="mb-2 block text-sm font-medium text-black">Date</span>
                                <input
                                  type="date"
                                  value={form.followUpDate}
                                  onChange={(event) =>
                                    setForm((current) => ({ ...current, followUpDate: event.target.value }))
                                  }
                                  className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-black outline-none transition focus:border-[#6daed8]"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-2 block text-sm font-medium text-black">Notes</span>
                                <input
                                  value={form.followUpNotes}
                                  onChange={(event) =>
                                    setForm((current) => ({ ...current, followUpNotes: event.target.value }))
                                  }
                                  placeholder="Review symptoms, BP check, lab result review"
                                  className="w-full rounded-xl border border-[#dbe7ef] bg-white px-4 py-3 text-black outline-none transition focus:border-[#6daed8]"
                                />
                              </label>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={isCompleting || noteStatus === "draft" || !currentNoteId}
                        onClick={handleDone}
                        className="inline-flex min-w-[160px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-100"
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
        )}
      </div>
      <SpecialtyModuleModal
        open={isPediatricsClinic && activePediatricModule === "growth"}
        title="Growth Tracking"
        description="Pediatric height, weight, BMI, and head circumference."
        onClose={() => setActivePediatricModule(null)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">Measured At</span>
            <input type="datetime-local" value={form.growthMeasurement.measured_at} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, measured_at: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">Height (cm)</span>
            <input value={form.growthMeasurement.height_cm} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, height_cm: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">Weight (kg)</span>
            <input value={form.growthMeasurement.weight_kg} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, weight_kg: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400" />
          </label>
          <label className="block">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">Head Circumference (cm)</span>
            <input value={form.growthMeasurement.head_circumference_cm} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, head_circumference_cm: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400" />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">Visit Notes</span>
          <textarea rows={3} value={form.growthMeasurement.visit_notes} onChange={(event) => setForm((current) => ({ ...current, growthMeasurement: { ...current.growthMeasurement, visit_notes: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400" />
        </label>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-black">
            {form.growthMeasurement.savedRecord ? `Latest BMI ${form.growthMeasurement.savedRecord.bmi.toFixed(2)}` : "Save to add the growth record to the patient timeline."}
          </p>
          <button type="button" onClick={() => void saveGrowthMeasurement()} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-50">
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
          <select value={form.wellChildVisit.visit_band} onChange={(event) => setForm((current) => ({ ...current, wellChildVisit: { ...current.wellChildVisit, visit_band: event.target.value } }))} className="rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400">
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
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-black">{label}</span>
              <textarea rows={2} value={form.wellChildVisit[field as keyof WellChildVisitPayload] as string} onChange={(event) => setForm((current) => ({ ...current, wellChildVisit: { ...current.wellChildVisit, [field]: event.target.value } }))} className="w-full rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400" />
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
          <select value={form.parentHandoutRequest.template_key} onChange={(event) => setForm((current) => ({ ...current, parentHandoutRequest: { ...current.parentHandoutRequest, template_key: event.target.value, generated_title: "", generated_content: "" } }))} className="rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400">
            <option value="fever_home_care">Fever home care</option>
            <option value="nutrition_guidance">Nutrition guidance</option>
            <option value="well_visit_summary">Well-visit summary</option>
            <option value="hydration_uri_home_care">Hydration / URI home care</option>
          </select>
          <textarea rows={3} value={form.parentHandoutRequest.instructions} onChange={(event) => setForm((current) => ({ ...current, parentHandoutRequest: { ...current.parentHandoutRequest, instructions: event.target.value, generated_title: "", generated_content: "" } }))} placeholder="Optional context for the handout" className="w-full rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400" />
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void handleGenerateParentHandout()} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-50">
              {isGeneratingHandout ? "Generating..." : "Generate Handout"}
            </button>
            <button type="button" disabled={!form.parentHandoutRequest.generated_content.trim() || isGeneratingHandoutPdf} onClick={() => void handleParentHandoutPdf("preview")} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-50 disabled:opacity-100">
              {isGeneratingHandoutPdf ? "Preparing..." : "Preview PDF"}
            </button>
            <button type="button" disabled={!form.parentHandoutRequest.generated_content.trim() || isGeneratingHandoutPdf} onClick={() => void handleParentHandoutPdf("download")} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-50 disabled:opacity-100">
              Download PDF
            </button>
          </div>
          {form.parentHandoutRequest.generated_content.trim() ? (
            <div className="rounded-[22px] border border-amber-100 bg-amber-50/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-black">
                {form.parentHandoutRequest.generated_title || "Generated handout"}
              </p>
              <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-black">{form.parentHandoutRequest.generated_content}</pre>
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
          <select value={form.pediatricFollowUpPlan.preset_key} onChange={(event) => setForm((current) => ({ ...current, pediatricFollowUpPlan: { ...current.pediatricFollowUpPlan, preset_key: event.target.value } }))} className="rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400">
            <option value="routine_review">Routine review</option>
            <option value="growth_recheck">Growth recheck</option>
            <option value="symptom_follow_up">Symptom follow-up</option>
            <option value="counseling_review">Counseling review</option>
          </select>
          <input value={form.pediatricFollowUpPlan.suggested_interval} onChange={(event) => setForm((current) => ({ ...current, pediatricFollowUpPlan: { ...current.pediatricFollowUpPlan, suggested_interval: event.target.value } }))} placeholder="Suggested interval, e.g. 3 months" className="w-full rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400" />
          <input value={form.pediatricFollowUpPlan.notes} onChange={(event) => setForm((current) => ({ ...current, pediatricFollowUpPlan: { ...current.pediatricFollowUpPlan, notes: event.target.value } }))} placeholder="Scheduling notes" className="w-full rounded-xl border border-amber-100 bg-amber-50/30 px-4 py-3 text-sm text-black outline-none transition focus:border-amber-400" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-black">
              Apply this preset to the real follow-up section below. Marking the consultation done will create the follow-up record.
            </p>
            <button type="button" onClick={applyPediatricFollowUpPreset} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-50">
              Apply to Follow-up
            </button>
          </div>
        </div>
      </SpecialtyModuleModal>

      <ClinicalDrawingModal
        open={isDrawingModalOpen}
        title="Consultation drawing"
        value={drawingAsset?.data_base64 ? `data:${drawingAsset.content_type};base64,${drawingAsset.data_base64}` : null}
        onClose={() => setIsDrawingModalOpen(false)}
        onSave={(dataUrl) => {
          setForm((current) => ({
            ...current,
            assets: dataUrl
              ? [
                  ...current.assets.filter((asset) => asset.kind !== "drawing"),
                  {
                    id: current.assets.find((asset) => asset.kind === "drawing")?.id || createId(),
                    kind: "drawing",
                    name: "consultation-drawing.png",
                    content_type: "image/png",
                    data_base64: dataUrl.split(",", 2)[1] || "",
                  },
                ]
              : current.assets.filter((asset) => asset.kind !== "drawing"),
          }));
          setIsDrawingModalOpen(false);
        }}
      />

      <ContactLensModal
        open={isOptometryClinic && isContactLensOpen}
        value={form.contactLens}
        activePage={activeContactLensPage}
        onActivePageChange={(nextPage) => navigateConsultationHistory("examination", "contact_lens", nextPage)}
        onClose={() => navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage, true)}
        onSave={async () => {
          await saveContactLens();
        }}
        onContinue={() => navigateConsultationHistory("consultation")}
        onChange={updateContactLens}
        onEyeChange={updateContactLensEye}
        sidebar={renderPreviousEvaluations("contact_lens", selectContactLensEntry)}
      />
      <BinocularVisionModal
        open={isOptometryClinic && isBinocularVisionOpen}
        patient={currentPatient}
        evaluations={binocularVisionEvaluations}
        isLoading={isBinocularVisionLoading}
        error={binocularVisionError}
        readOnly={false}
        onClose={() => navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage, true)}
        onSave={async (payload) => {
          await saveBinocularVisionEvaluation(payload);
          navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage, true);
        }}
      />
      <LowVisionModal
        open={isOptometryClinic && isLowVisionOpen}
        value={form.lowVision}
        onDraftChange={(next) => setForm((current) => ({ ...current, lowVision: next }))}
        activePage={activeLowVisionPage}
        onActivePageChange={(nextPage) => navigateConsultationHistory("examination", "low_vision", nextPage)}
        onClose={() => navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage, true)}
        onSave={async (next) => {
          await saveLowVision(next);
        }}
        onContinue={() => navigateConsultationHistory("consultation")}
        sidebar={renderPreviousEvaluations("low_vision", selectLowVisionEntry)}
      />
      <MyopiaManagementModal
        open={isOptometryClinic && isMyopiaManagementOpen}
        value={form.myopiaManagement}
        patientAge={currentPatient.age}
        onClose={() => navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage, true)}
        onSave={async (next) => {
          await saveMyopiaManagement(next);
          navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage, true);
        }}
      />
      <TbiEvaluationModal
        open={isOptometryClinic && isTbiEvaluationOpen}
        patient={currentPatient}
        evaluations={tbiEvaluations}
        isLoading={isTbiLoading}
        error={tbiError}
        readOnly={false}
        onClose={() => navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage, true)}
        onSave={async (payload) => {
          await saveTbiEvaluation(payload);
          navigateConsultationHistory("examination", "eye_exam", activeEyeExamPage, true);
        }}
      />
    </aside>
  );
}
