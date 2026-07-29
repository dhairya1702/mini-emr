"use client";

import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, FileText, Mail, MessageCircle, Paperclip, Play, Plus, Wand2, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, Fragment, useEffect, useMemo, useState } from "react";

import { MobileShell } from "@/components/mobile/mobile-shell";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { BinocularVisionModal } from "@/components/optometry/binocular-vision-modal";
import { ContactLensModal } from "@/components/optometry/contact-lens-modal";
import { LowVisionModal } from "@/components/optometry/low-vision-modal";
import { MyopiaManagementModal } from "@/components/optometry/myopia-management-modal";
import { TbiEvaluationModal } from "@/components/optometry/tbi-evaluation-modal";
import { api } from "@/lib/api";
import { trackWhatsAppDelivery } from "@/lib/whatsapp-delivery";
import {
  assetDataUrl,
  isNoteAssetFile,
  isPatientMediaFile,
  validateMobileAttachmentFile,
} from "@/lib/mobile/attachments";
import {
  buildBinocularVisionSummary,
  buildLowVisionSummary,
  buildMyopiaManagementSummary,
  createEmptyBinocularVision,
  createEmptyContactLens,
  createEmptyLowVision,
  createEmptyMyopiaManagement,
  formatLocalDateTimeInput,
  hasContactLensData,
  hasContactLensEyeData,
  hasLowVisionData,
  type MyopiaMeasurementDraft,
} from "@/lib/optometry/consultation";
import {
  clearMobileConsultationDraft,
  readMobileConsultationDraft,
  resolveMobileConsultationScope,
  writeMobileConsultationDraft,
} from "@/lib/mobile/consultation";
import { getSpecialtyModules, type SpecialtyModuleKey } from "@/lib/specialty";
import { formatModuleSummary, moduleEntriesFor, moduleLabel } from "@/lib/structured-modules";
import type { NoteAsset, PatientAttachment } from "@/lib/types";
import type {
  BinocularVisionEvaluationCreatePayload,
  BinocularVisionEvaluationRecord,
  ContactLensEyeEntry,
  ContactLensPayload,
  EyeExamEntry,
  LongitudinalTrackRecord,
  LowVisionPayload,
  MyopiaMeasurementPayload,
  Patient,
  TbiEvaluationCreatePayload,
  TbiEvaluationRecord,
} from "@/lib/types";

const emptyForm = {
  symptoms: "",
  diagnosis: "",
  medications: "",
  treatment: "",
  notes: "",
  bloodPressureSystolic: "",
  bloodPressureDiastolic: "",
  pulse: "",
  spo2: "",
  bloodSugar: "",
  testScores: [] as Array<{ label: string; value: string }>,
  structuredModules: [] as Array<{ module_type: string; payload: Record<string, unknown> }>,
  eyeExam: createEmptyEyeExam(),
  contactLens: createEmptyContactLens(),
  binocularVision: createEmptyBinocularVision(),
  lowVision: createEmptyLowVision(),
  myopiaManagement: createEmptyMyopiaManagement(),
  generatedNote: "",
  noteId: "",
  assets: [] as NoteAsset[],
};

const soapFields = [
  ["symptoms", "Complaint"],
  ["diagnosis", "Diagnosis"],
  ["medications", "Medication"],
  ["treatment", "Treatment"],
  ["notes", "Clinical notes"],
] as const;

function buildTreatmentPayload(medications: string, treatment: string) {
  const medicationText = medications.trim();
  const treatmentText = treatment.trim();
  if (medicationText && treatmentText) {
    return `Medications:\n${medicationText}\n\nTreatment:\n${treatmentText}`;
  }
  return treatmentText || medicationText;
}

function createId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyEyeExam(): EyeExamEntry[] {
  return [
    { eye: "right", sphere: "", cylinder: "", axis: "", vision: "" },
    { eye: "left", sphere: "", cylinder: "", axis: "", vision: "" },
  ];
}

function hasEyeExamData(entries: EyeExamEntry[]) {
  return entries.some((entry) =>
    entry.sphere.trim() ||
    entry.cylinder.trim() ||
    entry.axis.trim() ||
    entry.vision.trim(),
  );
}

function buildEyeExamSummary(entries: EyeExamEntry[]) {
  const parts = entries
    .filter((entry) => entry.sphere.trim() || entry.cylinder.trim() || entry.axis.trim() || entry.vision.trim())
    .map((entry) => {
      const eye = entry.eye === "right" ? "OD" : "OS";
      const refraction = [entry.sphere, entry.cylinder, entry.axis ? `x ${entry.axis}` : ""]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" ");
      return [eye, refraction, entry.vision.trim() ? `VA ${entry.vision.trim()}` : ""].filter(Boolean).join(" ");
    });
  return parts.join(" · ") || "Eye exam saved.";
}

function isOptometryModule(moduleKey: string): moduleKey is "eye_exam" | "contact_lens" | "binocular_vision" | "low_vision" | "myopia_management" | "tbi_evaluation" {
  return ["eye_exam", "contact_lens", "binocular_vision", "low_vision", "myopia_management", "tbi_evaluation"].includes(moduleKey);
}

async function fileToBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",", 2)[1] || "";
}

export default function MobileConsultationPage() {
  const params = useParams<{ patientId: string }>();
  const patientId = params.patientId;
  const router = useRouter();
  const { clinicSettings, currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientAttachments, setPatientAttachments] = useState<PatientAttachment[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [activeModule, setActiveModule] = useState<SpecialtyModuleKey | "vitals" | "test_scores" | null>(null);
  const [moduleNotes, setModuleNotes] = useState("");
  const [isEyeExamOpen, setIsEyeExamOpen] = useState(false);
  const [isContactLensOpen, setIsContactLensOpen] = useState(false);
  const [isBinocularVisionOpen, setIsBinocularVisionOpen] = useState(false);
  const [isLowVisionOpen, setIsLowVisionOpen] = useState(false);
  const [isMyopiaManagementOpen, setIsMyopiaManagementOpen] = useState(false);
  const [isTbiEvaluationOpen, setIsTbiEvaluationOpen] = useState(false);
  const [moduleEntries, setModuleEntries] = useState<LongitudinalTrackRecord[]>([]);
  const [hasLoadedModuleEntries, setHasLoadedModuleEntries] = useState(false);
  const [moduleEntryError, setModuleEntryError] = useState("");
  const [tbiEvaluations, setTbiEvaluations] = useState<TbiEvaluationRecord[]>([]);
  const [isTbiLoading, setIsTbiLoading] = useState(false);
  const [tbiError, setTbiError] = useState("");
  const [binocularVisionEvaluations, setBinocularVisionEvaluations] = useState<BinocularVisionEvaluationRecord[]>([]);
  const [isBinocularVisionLoading, setIsBinocularVisionLoading] = useState(false);
  const [binocularVisionError, setBinocularVisionError] = useState("");
  const specialtyModules = useMemo(
    () => getSpecialtyModules(clinicSettings?.clinic_specialty ?? null),
    [clinicSettings?.clinic_specialty],
  );
  const selectedTestValue = activeModule ?? "";

  const patient = useMemo(() => patients.find((row) => row.id === patientId) ?? null, [patientId, patients]);
  const scope = useMemo(
    () => resolveMobileConsultationScope(currentUser, patientId || ""),
    [currentUser, patientId],
  );

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser || !patientId) {
      return;
    }
    let active = true;
    setIsLoading(true);
    Promise.all([api.getPatient(patientId), api.listPatientAttachments(patientId)])
      .then(([patientRow, attachmentRows]) => {
        if (!active) {
          return;
        }
        setPatients([patientRow]);
        setPatientAttachments(attachmentRows);
        setRecipientEmail(patientRow.email ?? "");
        const localDraft = scope ? readMobileConsultationDraft(scope) : null;
        setForm({
          symptoms: localDraft?.symptoms || "",
          diagnosis: localDraft?.diagnosis || "",
          medications: localDraft?.medications || "",
          treatment: localDraft?.treatment || "",
          notes: localDraft?.notes || "",
          bloodPressureSystolic: localDraft?.bloodPressureSystolic || "",
          bloodPressureDiastolic: localDraft?.bloodPressureDiastolic || "",
          pulse: localDraft?.pulse || "",
          spo2: localDraft?.spo2 || "",
          bloodSugar: localDraft?.bloodSugar || "",
          testScores: localDraft?.testScores?.length ? localDraft.testScores : [],
          structuredModules: localDraft?.structuredModules?.length ? localDraft.structuredModules : [],
          eyeExam: createEmptyEyeExam(),
          contactLens: createEmptyContactLens(),
          binocularVision: createEmptyBinocularVision(),
          lowVision: createEmptyLowVision(),
          myopiaManagement: createEmptyMyopiaManagement(),
          generatedNote: localDraft?.generatedNote || "",
          noteId: localDraft?.noteId || "",
          assets: localDraft?.assets?.length ? localDraft.assets : [],
        });
        setError("");
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load consultation.");
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin, patientId, scope]);

  useEffect(() => {
    if (!scope || isLoading) {
      return;
    }
    writeMobileConsultationDraft(scope, form);
  }, [form, isLoading, scope]);

  useEffect(() => {
    if (!patientId || hasLoadedModuleEntries || (!isEyeExamOpen && !isContactLensOpen && !isLowVisionOpen)) {
      return;
    }
    let active = true;
    setModuleEntryError("");
    api.listPatientModuleEntries(patientId)
      .then((entries) => {
        if (active) {
          setModuleEntries(entries);
          setHasLoadedModuleEntries(true);
        }
      })
      .catch((loadError) => {
        if (active) {
          setModuleEntryError(loadError instanceof Error ? loadError.message : "Failed to load previous evaluations.");
        }
      });
    return () => {
      active = false;
    };
  }, [hasLoadedModuleEntries, isContactLensOpen, isEyeExamOpen, isLowVisionOpen, patientId]);

  useEffect(() => {
    if (!patientId || !isTbiEvaluationOpen || tbiEvaluations.length) {
      return;
    }
    let active = true;
    setIsTbiLoading(true);
    setTbiError("");
    api.listPatientTbiEvaluations(patientId)
      .then((evaluations) => {
        if (active) {
          setTbiEvaluations(evaluations);
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
  }, [isTbiEvaluationOpen, patientId, tbiEvaluations.length]);

  useEffect(() => {
    if (!patientId || !isBinocularVisionOpen || binocularVisionEvaluations.length) {
      return;
    }
    let active = true;
    setIsBinocularVisionLoading(true);
    setBinocularVisionError("");
    api.listPatientBinocularVisionEvaluations(patientId)
      .then((evaluations) => {
        if (active) {
          setBinocularVisionEvaluations(evaluations);
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
  }, [binocularVisionEvaluations.length, isBinocularVisionOpen, patientId]);

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    if (!patient) {
      return;
    }
    setIsGenerating(true);
    setStatusMessage("");
    try {
      const generated = await api.generateNote({
        patient_id: patient.id,
        note_id: form.noteId || undefined,
        symptoms: form.symptoms,
        diagnosis: form.diagnosis,
        medications: buildTreatmentPayload(form.medications, form.treatment),
        notes: form.notes,
        blood_pressure_systolic: form.bloodPressureSystolic ? Number(form.bloodPressureSystolic) : null,
        blood_pressure_diastolic: form.bloodPressureDiastolic ? Number(form.bloodPressureDiastolic) : null,
        pulse: form.pulse ? Number(form.pulse) : null,
        spo2: form.spo2 ? Number(form.spo2) : null,
        blood_sugar: form.bloodSugar ? Number(form.bloodSugar) : null,
        test_scores: form.testScores.filter((entry) => entry.label.trim() && entry.value.trim()),
        structured_modules: form.structuredModules,
        assets: form.assets,
      });
      setForm((current) => ({
        ...current,
        generatedNote: generated.content,
        noteId: generated.note_id || current.noteId,
      }));
      const baseMessage = generated.note_id ? "Draft saved." : "Draft generated.";
      setStatusMessage(generated.used_fallback ? `${baseMessage} ${generated.warning || "AI unavailable, used fallback template."}` : baseMessage);
    } catch (generateError) {
      setStatusMessage(generateError instanceof Error ? generateError.message : "Failed to generate note.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function syncDraft() {
    if (!patient || !form.noteId) {
      throw new Error("Generate a draft first.");
    }
    const synced = await api.generateNote({
      patient_id: patient.id,
      note_id: form.noteId,
      symptoms: form.symptoms,
      diagnosis: form.diagnosis,
      medications: buildTreatmentPayload(form.medications, form.treatment),
      notes: form.notes,
      blood_pressure_systolic: form.bloodPressureSystolic ? Number(form.bloodPressureSystolic) : null,
      blood_pressure_diastolic: form.bloodPressureDiastolic ? Number(form.bloodPressureDiastolic) : null,
      pulse: form.pulse ? Number(form.pulse) : null,
      spo2: form.spo2 ? Number(form.spo2) : null,
      blood_sugar: form.bloodSugar ? Number(form.bloodSugar) : null,
      test_scores: form.testScores.filter((entry) => entry.label.trim() && entry.value.trim()),
      structured_modules: form.structuredModules,
      assets: form.assets,
    });
    setForm((current) => ({
      ...current,
      generatedNote: synced.content,
      noteId: synced.note_id || current.noteId,
    }));
    return synced.note_id || form.noteId;
  }

  async function handleFinalize() {
    if (!patient || !form.noteId) {
      setStatusMessage("Generate a draft before finalizing.");
      return;
    }
    setIsFinalizing(true);
    setStatusMessage("");
    try {
      const noteId = await syncDraft();
      await api.finalizeMobileConsultation(patient.id, noteId);
      if (scope) {
        clearMobileConsultationDraft(scope);
      }
      router.replace("/m");
    } catch (finalizeError) {
      setStatusMessage(finalizeError instanceof Error ? finalizeError.message : "Failed to finalize consultation.");
    } finally {
      setIsFinalizing(false);
    }
  }

  async function handleSendEmail() {
    if (!patient || !form.noteId) {
      setStatusMessage("Generate a draft before sending.");
      return;
    }
    const email = recipientEmail.trim();
    if (!email) {
      setStatusMessage("This patient does not have an email address saved.");
      return;
    }
    if (!email.includes("@")) {
      setStatusMessage("Enter a valid recipient email.");
      return;
    }
    setIsSendingEmail(true);
    setStatusMessage("");
    try {
      const noteId = await syncDraft();
      const result = await api.sendNote({
        note_id: noteId,
        patient_id: patient.id,
        recipient_email: email,
      });
      setStatusMessage(result.message || "Note emailed.");
      if (scope) {
        clearMobileConsultationDraft(scope);
      }
    } catch (sendError) {
      setStatusMessage(sendError instanceof Error ? sendError.message : "Failed to send email.");
    } finally {
      setIsSendingEmail(false);
    }
  }

  async function handleSendWhatsApp() {
    if (!patient || !form.noteId) {
      setStatusMessage("Generate a draft before sending.");
      return;
    }
    const phone = patient.phone.trim();
    if (!phone) {
      setStatusMessage("This patient does not have a phone number saved.");
      return;
    }
    setIsSendingWhatsApp(true);
    setStatusMessage("");
    try {
      const noteId = await syncDraft();
      const result = await api.sendNoteWhatsApp({
        note_id: noteId,
        patient_id: patient.id,
        recipient_phone: phone,
      });
      setStatusMessage(result.message || "Note sent on WhatsApp.");
      trackWhatsAppDelivery(result.delivery, "Consultation note", (message) => setStatusMessage(message));
      if (scope) {
        clearMobileConsultationDraft(scope);
      }
    } catch (sendError) {
      setStatusMessage(sendError instanceof Error ? sendError.message : "Failed to send WhatsApp.");
    } finally {
      setIsSendingWhatsApp(false);
    }
  }

  async function handleAttachmentSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length || !patient) {
      return;
    }
    setStatusMessage("");
    try {
      const nextAssets: NoteAsset[] = [];
      const uploadedMedia: PatientAttachment[] = [];
      for (const file of files) {
        const validationError = validateMobileAttachmentFile(file);
        if (validationError) {
          throw new Error(validationError);
        }
        if (isNoteAssetFile(file)) {
          nextAssets.push({
            id: createId(),
            kind: "attachment",
            name: file.name,
            content_type: file.type || "application/octet-stream",
            data_base64: await fileToBase64(file),
          });
        } else if (isPatientMediaFile(file)) {
          uploadedMedia.push(await api.uploadPatientAttachment(patient.id, file));
        }
      }
      if (nextAssets.length) {
        setForm((current) => ({
          ...current,
          assets: [...current.assets, ...nextAssets],
        }));
      }
      if (uploadedMedia.length) {
        setPatientAttachments((current) => [...uploadedMedia, ...current]);
      }
      setStatusMessage("Attachment saved.");
    } catch (attachmentError) {
      setStatusMessage(attachmentError instanceof Error ? attachmentError.message : "Failed to attach file.");
    } finally {
      event.target.value = "";
    }
  }

  function removeNoteAsset(assetId: string) {
    setForm((current) => ({
      ...current,
      assets: current.assets.filter((asset) => asset.id !== assetId),
    }));
  }

  function openModule(moduleKey: SpecialtyModuleKey) {
    setActiveModule(null);
    if (moduleKey === "eye_exam") {
      setIsEyeExamOpen(true);
      return;
    }
    if (moduleKey === "contact_lens") {
      setIsContactLensOpen(true);
      return;
    }
    if (moduleKey === "binocular_vision") {
      setIsBinocularVisionOpen(true);
      return;
    }
    if (moduleKey === "low_vision") {
      setIsLowVisionOpen(true);
      return;
    }
    if (moduleKey === "myopia_management") {
      setIsMyopiaManagementOpen(true);
      return;
    }
    if (moduleKey === "tbi_evaluation") {
      setIsTbiEvaluationOpen(true);
      return;
    }
    const existing = form.structuredModules.find((entry) => entry.module_type === moduleKey);
    const summary = existing?.payload?.summary;
    setModuleNotes(typeof summary === "string" ? summary : "");
    setActiveModule(moduleKey);
  }

  function saveModuleNotes() {
    if (!activeModule || activeModule === "vitals" || activeModule === "test_scores") {
      return;
    }
    const summary = moduleNotes.trim();
    setForm((current) => ({
      ...current,
      structuredModules: [
        ...current.structuredModules.filter((entry) => entry.module_type !== activeModule),
        {
          module_type: activeModule,
          payload: {
            measured_at: new Date().toISOString(),
            summary,
            notes: summary,
          },
        },
      ],
    }));
    setActiveModule(null);
    setModuleNotes("");
  }

  function rememberStructuredModule(moduleKey: SpecialtyModuleKey, payload: Record<string, unknown>) {
    setForm((current) => ({
      ...current,
      structuredModules: [
        ...current.structuredModules.filter((entry) => entry.module_type !== moduleKey),
        { module_type: moduleKey, payload },
      ],
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

  function selectEyeExamEntry(entry: LongitudinalTrackRecord) {
    const entries = Array.isArray(entry.raw_payload?.entries) ? entry.raw_payload.entries : [];
    const normalized = createEmptyEyeExam().map((emptyEntry) => {
      const saved = entries.find((candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "eye" in candidate &&
        (candidate as { eye?: unknown }).eye === emptyEntry.eye,
      ) as Partial<EyeExamEntry> | undefined;
      return { ...emptyEntry, ...saved };
    });
    setForm((current) => ({ ...current, eyeExam: normalized }));
  }

  function selectContactLensEntry(entry: LongitudinalTrackRecord) {
    const savedPayload = entry.raw_payload as Partial<ContactLensPayload>;
    const savedEyes = Array.isArray(savedPayload.eyes) ? savedPayload.eyes : [];
    const nextContactLens = {
      ...createEmptyContactLens(),
      ...savedPayload,
      eyes: createEmptyContactLens().eyes.map((emptyEntry) => {
        const saved = savedEyes.find((candidate) => candidate.eye === emptyEntry.eye);
        return saved ? { ...emptyEntry, ...saved } : emptyEntry;
      }),
    };
    setForm((current) => ({ ...current, contactLens: nextContactLens }));
  }

  function selectLowVisionEntry(entry: LongitudinalTrackRecord) {
    setForm((current) => ({
      ...current,
      lowVision: { ...createEmptyLowVision(), ...(entry.raw_payload as Partial<LowVisionPayload>) },
    }));
  }

  function renderPreviousEvaluations(moduleKey: SpecialtyModuleKey, onSelectEntry: (entry: LongitudinalTrackRecord) => void) {
    const entries = moduleEntriesFor(moduleEntries, moduleKey);
    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900">Previous Evaluations</h4>
          <button
            type="button"
            onClick={() => {
              if (moduleKey === "eye_exam") {
                setForm((current) => ({ ...current, eyeExam: createEmptyEyeExam() }));
              } else if (moduleKey === "contact_lens") {
                setForm((current) => ({ ...current, contactLens: createEmptyContactLens() }));
              } else if (moduleKey === "low_vision") {
                setForm((current) => ({ ...current, lowVision: createEmptyLowVision() }));
              }
            }}
            className="rounded-lg border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
          >
            New
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {entries.length ? entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelectEntry(entry)}
              className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left"
            >
              <p className="text-sm font-medium text-slate-900">
                {new Date(entry.measured_at).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{formatModuleSummary(entry)}</p>
            </button>
          )) : (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-5 text-center text-sm text-slate-500">
              No evaluations yet.
            </p>
          )}
        </div>
        {moduleEntryError ? <p className="mt-3 text-xs font-medium text-rose-600">{moduleEntryError}</p> : null}
      </div>
    );
  }

  async function saveStructuredModuleEntry(moduleKey: SpecialtyModuleKey, payload: Record<string, unknown>, summary: string) {
    if (!patientId) {
      return;
    }
    const measuredAt = new Date().toISOString();
    setModuleEntryError("");
    const saved = await api.createPatientModuleEntry(patientId, {
      track_type: moduleKey,
      measured_at: measuredAt,
      summary_fields: { summary },
      raw_payload: payload,
      derived_metrics: {},
    });
    setModuleEntries((current) => [...current.filter((entry) => entry.id !== saved.id), saved]);
    setHasLoadedModuleEntries(true);
    rememberStructuredModule(moduleKey, { measured_at: saved.measured_at, ...payload });
    setStatusMessage(summary);
  }

  async function saveEyeExam() {
    const payload = { entries: form.eyeExam.filter((entry) => hasEyeExamData([entry])) };
    if (!payload.entries.length) {
      setModuleEntryError("Enter eye exam values before saving.");
      return;
    }
    await saveStructuredModuleEntry("eye_exam", payload, buildEyeExamSummary(form.eyeExam));
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
      "Contact lens details saved.",
    );
  }

  async function saveBinocularVisionEvaluation(payload: BinocularVisionEvaluationCreatePayload) {
    if (!patientId) {
      return;
    }
    setIsBinocularVisionLoading(true);
    setBinocularVisionError("");
    try {
      const saved = await api.createPatientBinocularVisionEvaluation(patientId, payload);
      setBinocularVisionEvaluations((current) => [...current.filter((record) => record.id !== saved.id), saved]);
      setForm((current) => ({ ...current, binocularVision: saved.payload }));
      rememberStructuredModule("binocular_vision", {
        measured_at: saved.measured_at,
        ...saved.payload,
      });
      setStatusMessage(buildBinocularVisionSummary(saved.payload));
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save binocular vision evaluation.";
      setBinocularVisionError(message);
      throw saveError;
    } finally {
      setIsBinocularVisionLoading(false);
    }
  }

  async function saveLowVision(next: LowVisionPayload) {
    if (!hasLowVisionData(next)) {
      setModuleEntryError("Enter low vision values before saving.");
      return;
    }
    setForm((current) => ({ ...current, lowVision: next }));
    await saveStructuredModuleEntry("low_vision", next as unknown as Record<string, unknown>, buildLowVisionSummary(next));
  }

  async function saveMyopiaManagement(next: MyopiaMeasurementDraft) {
    if (!patientId) {
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
    const saved = await api.createPatientMyopiaRecord(patientId, payload);
    const draft = {
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
    };
    setForm((current) => ({ ...current, myopiaManagement: draft }));
    rememberStructuredModule("myopia_management", payload as unknown as Record<string, unknown>);
    setStatusMessage(buildMyopiaManagementSummary(draft));
  }

  async function saveTbiEvaluation(payload: TbiEvaluationCreatePayload) {
    if (!patientId) {
      return;
    }
    setIsTbiLoading(true);
    setTbiError("");
    try {
      const saved = await api.createPatientTbiEvaluation(patientId, payload);
      setTbiEvaluations((current) => [...current.filter((record) => record.id !== saved.id), saved]);
      rememberStructuredModule("tbi_evaluation", {
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

  function updateTestScore(index: number, patch: Partial<{ label: string; value: string }>) {
    setForm((current) => ({
      ...current,
      testScores: current.testScores.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry),
    }));
  }

  function handleTestSelect(value: string) {
    if (!value) {
      setActiveModule(null);
      return;
    }
    if (value === "vitals") {
      setActiveModule("vitals");
      return;
    }
    if (value === "test_scores") {
      setForm((current) => ({
        ...current,
        testScores: current.testScores.length ? current.testScores : [{ label: "", value: "" }],
      }));
      setActiveModule("test_scores");
      return;
    }
    openModule(value as SpecialtyModuleKey);
  }

  async function openPatientAttachment(attachment: PatientAttachment) {
    try {
      const blob = await api.downloadPatientAttachment(attachment.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (downloadError) {
      setStatusMessage(downloadError instanceof Error ? downloadError.message : "Failed to open attachment.");
    }
  }

  return (
    <MobileShell
      title={patient?.name || "Consultation"}
      subtitle={patient?.reason || "Simple SOAP note"}
      action={
        <Link
          href="/m"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[#bfd7e8] bg-white text-slate-700"
          aria-label="Back to queue"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      }
    >
      {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {isLoading ? (
        <p className="clinic-empty-state">Loading consultation...</p>
      ) : patient ? (
        <form onSubmit={handleGenerate} className="grid gap-2.5">
          <section className="rounded-xl border border-[#dbe7ef] bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(64,131,181,0.06)]">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="text-base font-semibold text-slate-800">{patient.name}</h2>
              <p className="text-xs font-medium text-slate-600">{patient.reason}</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {patient.age ?? "-"} years | {patient.phone || "No phone"}
            </p>
          </section>

          <section className="grid gap-2 rounded-xl border border-[#dbe7ef] bg-white px-3 py-2.5">
            {soapFields.map(([key, label]) => (
            <label key={key} className="grid grid-cols-[82px_minmax(0,1fr)] items-start gap-2 text-xs font-semibold text-slate-700">
              <span className="pt-1.5">{label}:</span>
              <textarea
                value={form[key]}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                rows={1}
                className="min-h-8 resize-none rounded-lg border border-[#bfd7e8] bg-white px-2.5 py-1.5 text-xs font-normal leading-5 text-slate-800 outline-none focus:border-[#6daed8]"
              />
            </label>
            ))}
          </section>

          <section className="rounded-lg border border-[#dbe7ef] bg-white px-3 py-2">
            <div className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-2">
              <h2 className="text-xs font-semibold text-slate-800">Tests</h2>
              <div className="relative">
                <select
                  value={selectedTestValue}
                  onChange={(event) => handleTestSelect(event.target.value)}
                  className="h-8 w-full appearance-none rounded-lg border border-[#bfd7e8] bg-white px-2.5 pr-8 text-xs font-medium text-slate-800 outline-none focus:border-[#6daed8]"
                  aria-label="Select test"
                >
                  <option value="">Select</option>
                  <option value="vitals">Vitals</option>
                  <option value="test_scores">Test score</option>
                  {specialtyModules.map((moduleKey) => (
                    <option key={moduleKey} value={moduleKey}>{moduleLabel(moduleKey)}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              </div>
            </div>

            {activeModule === "vitals" ? (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                {[
                  ["bloodPressureSystolic", "BP sys"],
                  ["bloodPressureDiastolic", "BP dia"],
                  ["pulse", "Pulse"],
                  ["spo2", "SpO2"],
                  ["bloodSugar", "Sugar"],
                ].map(([key, label]) => (
                  <label key={key} className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-2 text-[11px] font-medium text-slate-600">
                    <span>{label}</span>
                    <input
                      value={form[key as keyof typeof emptyForm] as string}
                      inputMode="decimal"
                      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                      className="h-8 rounded-lg border border-[#bfd7e8] bg-white px-2 text-xs text-slate-800 outline-none focus:border-[#6daed8]"
                    />
                  </label>
                ))}
              </div>
            ) : null}

            {activeModule === "test_scores" && form.testScores.length ? (
              <div className="mt-2.5 grid gap-2">
                {form.testScores.map((entry, index) => (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_30px] gap-2">
                    <input
                      value={entry.label}
                      onChange={(event) => updateTestScore(index, { label: event.target.value })}
                      placeholder="Test"
                      className="h-8 rounded-lg border border-[#bfd7e8] px-2.5 text-xs outline-none focus:border-[#6daed8]"
                    />
                    <input
                      value={entry.value}
                      onChange={(event) => updateTestScore(index, { value: event.target.value })}
                      placeholder="Value"
                      className="h-8 rounded-lg border border-[#bfd7e8] px-2.5 text-xs outline-none focus:border-[#6daed8]"
                    />
                    <button
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, testScores: current.testScores.filter((_, itemIndex) => itemIndex !== index) }))}
                      className="clinic-icon-button h-8 w-8"
                      aria-label="Remove test score"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, testScores: [...current.testScores, { label: "", value: "" }] }))}
                  className="h-8 rounded-lg border border-[#bfd7e8] bg-white px-3 text-xs font-medium text-slate-700"
                >
                  Add score
                </button>
              </div>
            ) : null}

            {form.structuredModules.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {form.structuredModules.map((entry) => (
                  <button
                    key={entry.module_type}
                    type="button"
                    onClick={() => openModule(entry.module_type as SpecialtyModuleKey)}
                    className="rounded-full border border-[#bfd7e8] bg-[#f3f8fb] px-2.5 py-1 text-[11px] font-medium text-[#235f8e]"
                  >
                    {moduleLabel(entry.module_type as SpecialtyModuleKey)}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-[#dbe7ef] bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold text-slate-800">Attachments</h2>
              <label className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#9fc7e1] bg-[#f3f8fb] text-[#235f8e] transition hover:bg-[#dbeaf4]" aria-label="Add attachments">
                <Plus className="h-3.5 w-3.5" />
                <input
                  type="file"
                  accept="image/*,application/pdf,video/mp4,video/quicktime,video/webm"
                  multiple
                  onChange={handleAttachmentSelect}
                  className="hidden"
                />
              </label>
            </div>
            {form.assets.length || patientAttachments.length ? (
              <div className="mt-2 grid gap-2">
              {form.assets.map((asset) => (
                <div key={asset.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    {asset.content_type.startsWith("image/") && asset.data_base64 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={assetDataUrl(asset)} alt="" className="h-10 w-10 rounded-lg border border-[#dbe7ef] object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#dbe7ef] bg-white text-slate-500">
                        <FileText className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{asset.name}</p>
                      <p className="text-xs text-slate-500">Note attachment</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => removeNoteAsset(asset.id)} className="clinic-icon-button h-8 w-8">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {patientAttachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => openPatientAttachment(attachment)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-2 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#dbe7ef] bg-white text-slate-500">
                      <Play className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{attachment.file_name}</p>
                      <p className="text-xs text-slate-500">Patient video</p>
                    </div>
                  </div>
                  <Paperclip className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </div>
            ) : null}
          </section>

          <button
            type="submit"
            disabled={isGenerating}
            className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] text-sm font-semibold text-white disabled:opacity-60"
          >
            <Wand2 className="h-5 w-5" />
            {isGenerating ? "Generating..." : form.noteId ? "Refresh draft" : "Generate draft"}
          </button>

          {form.generatedNote ? (
            <section className="rounded-[22px] border border-[#dbe7ef] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Draft note</p>
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{form.generatedNote}</p>
            </section>
          ) : null}

          {statusMessage ? (
            <p className="rounded-[18px] bg-[#edf5fa] px-4 py-3 text-sm text-slate-700">{statusMessage}</p>
          ) : null}

          {form.noteId ? (
            <section className="mb-4 grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={isSendingEmail || isSendingWhatsApp || isFinalizing}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <Mail className="h-4 w-4" />
                  {isSendingEmail ? "Sending..." : "Send Email"}
                </button>
                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  disabled={isSendingEmail || isSendingWhatsApp || isFinalizing}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#4da572] px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <MessageCircle className="h-4 w-4" />
                  {isSendingWhatsApp ? "Sending..." : "Send WhatsApp"}
                </button>
              </div>
              <button
                type="button"
                onClick={handleFinalize}
                disabled={isSendingEmail || isSendingWhatsApp || isFinalizing}
                className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#bfd7e8] bg-white text-sm font-semibold text-slate-800 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {isFinalizing ? "Finishing..." : "Done"}
              </button>
            </section>
          ) : null}

          {activeModule && activeModule !== "vitals" && activeModule !== "test_scores" && !isOptometryModule(activeModule) ? (
            <div className="fixed inset-0 z-50 flex items-end bg-slate-950/35">
              <div className="max-h-[86vh] w-full overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-[0_-16px_48px_rgba(15,23,42,0.24)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current Visit</p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-900">{moduleLabel(activeModule)}</h3>
                  </div>
                  <button type="button" onClick={() => setActiveModule(null)} className="clinic-icon-button">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <label className="mt-4 block text-sm font-semibold text-slate-700">
                  Notes
                  <textarea
                    value={moduleNotes}
                    onChange={(event) => setModuleNotes(event.target.value)}
                    rows={6}
                    className="mt-2 w-full resize-none rounded-[18px] border border-[#bfd7e8] bg-white px-4 py-3 text-base font-normal leading-6 text-slate-800 outline-none focus:border-[#6daed8]"
                  />
                </label>
                <button type="button" onClick={saveModuleNotes} className="mt-4 h-12 w-full rounded-2xl bg-[#2f8fd3] text-sm font-semibold text-white">
                  Save
                </button>
              </div>
            </div>
          ) : null}
          {isEyeExamOpen ? (
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 p-0">
              <div className="min-h-dvh w-full bg-white">
                <div className="sticky top-0 z-10 border-b border-[#dbe7ef] bg-white px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Structured Module</p>
                      <h3 className="mt-1 text-xl font-semibold text-slate-900">Refraction</h3>
                      <p className="mt-1 text-xs text-slate-500">{patient.name} · {patient.phone || "No phone"}</p>
                    </div>
                    <button type="button" onClick={() => setIsEyeExamOpen(false)} className="clinic-icon-button h-10 w-10">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-4 px-4 py-4">
                  <aside className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 p-3">
                    {renderPreviousEvaluations("eye_exam", selectEyeExamEntry)}
                  </aside>
                  <div className="overflow-x-auto">
                    <div className="grid min-w-[640px] grid-cols-[82px_repeat(4,minmax(0,1fr))] gap-2">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Eye</div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Sphere</div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Cylinder</div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Axis</div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Vision</div>
                      {form.eyeExam.map((entry) => (
                        <Fragment key={entry.eye}>
                          <div className="rounded-lg border border-[#dbe7ef] bg-[#f3f8fb]/40 px-3 py-2 text-xs font-medium capitalize text-slate-700">{entry.eye}</div>
                          <input value={entry.sphere} onChange={(event) => updateEyeExam(entry.eye, { sphere: event.target.value })} placeholder="-1.25" className="rounded-lg border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#6daed8]" />
                          <input value={entry.cylinder} onChange={(event) => updateEyeExam(entry.eye, { cylinder: event.target.value })} placeholder="-0.50" className="rounded-lg border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#6daed8]" />
                          <input value={entry.axis} onChange={(event) => updateEyeExam(entry.eye, { axis: event.target.value })} placeholder="90" className="rounded-lg border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#6daed8]" />
                          <input value={entry.vision} onChange={(event) => updateEyeExam(entry.eye, { vision: event.target.value })} placeholder="6/6" className="rounded-lg border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#6daed8]" />
                        </Fragment>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await saveEyeExam();
                      if (hasEyeExamData(form.eyeExam)) {
                        setIsEyeExamOpen(false);
                      }
                    }}
                    className="h-11 rounded-xl bg-slate-900 text-sm font-semibold text-white"
                  >
                    Save Refraction
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <ContactLensModal
            open={isContactLensOpen}
            value={form.contactLens}
            onClose={() => setIsContactLensOpen(false)}
            onSave={async () => {
              await saveContactLens();
              setIsContactLensOpen(false);
            }}
            onChange={updateContactLens}
            onEyeChange={updateContactLensEye}
            sidebar={renderPreviousEvaluations("contact_lens", selectContactLensEntry)}
          />
          <BinocularVisionModal
            open={isBinocularVisionOpen}
            patient={patient}
            evaluations={binocularVisionEvaluations}
            isLoading={isBinocularVisionLoading}
            error={binocularVisionError}
            readOnly={false}
            onClose={() => setIsBinocularVisionOpen(false)}
            onSave={async (payload) => {
              await saveBinocularVisionEvaluation(payload);
              setIsBinocularVisionOpen(false);
            }}
          />
          <LowVisionModal
            open={isLowVisionOpen}
            value={form.lowVision}
            onClose={() => setIsLowVisionOpen(false)}
            onSave={async (next) => {
              await saveLowVision(next);
              setIsLowVisionOpen(false);
            }}
            sidebar={renderPreviousEvaluations("low_vision", selectLowVisionEntry)}
          />
          <MyopiaManagementModal
            open={isMyopiaManagementOpen}
            value={form.myopiaManagement}
            patientAge={patient.age}
            onClose={() => setIsMyopiaManagementOpen(false)}
            onSave={async (next) => {
              await saveMyopiaManagement(next);
              setIsMyopiaManagementOpen(false);
            }}
          />
          <TbiEvaluationModal
            open={isTbiEvaluationOpen}
            patient={patient}
            evaluations={tbiEvaluations}
            isLoading={isTbiLoading}
            error={tbiError}
            readOnly={false}
            onClose={() => setIsTbiEvaluationOpen(false)}
            onSave={async (payload) => {
              await saveTbiEvaluation(payload);
              setIsTbiEvaluationOpen(false);
            }}
          />
        </form>
      ) : (
        <p className="clinic-empty-state">Patient not found.</p>
      )}
    </MobileShell>
  );
}
