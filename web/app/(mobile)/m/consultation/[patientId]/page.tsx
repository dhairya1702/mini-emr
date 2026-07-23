"use client";

import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, FileText, Mail, MessageCircle, Paperclip, Play, Plus, Wand2, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

import { MobileShell } from "@/components/mobile/mobile-shell";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import {
  assetDataUrl,
  isNoteAssetFile,
  isPatientMediaFile,
  validateMobileAttachmentFile,
} from "@/lib/mobile/attachments";
import {
  clearMobileConsultationDraft,
  readMobileConsultationDraft,
  resolveMobileConsultationScope,
  writeMobileConsultationDraft,
} from "@/lib/mobile/consultation";
import { getSpecialtyModules, type SpecialtyModuleKey } from "@/lib/specialty";
import { genericStructuredSummary, moduleLabel } from "@/lib/structured-modules";
import type { Patient } from "@/lib/types";
import type { NoteAsset, PatientAttachment } from "@/lib/types";

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
    const existing = form.structuredModules.find((entry) => entry.module_type === moduleKey);
    const summary = existing ? genericStructuredSummary(existing.payload) : "";
    setModuleNotes(summary === "Evaluation saved." ? "" : summary);
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

          {activeModule && activeModule !== "vitals" && activeModule !== "test_scores" ? (
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
        </form>
      ) : (
        <p className="clinic-empty-state">Patient not found.</p>
      )}
    </MobileShell>
  );
}
