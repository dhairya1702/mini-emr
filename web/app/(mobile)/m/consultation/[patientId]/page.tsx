"use client";

import Link from "next/link";
import { ArrowLeft, Check, FileText, Paperclip, Play, Wand2, X } from "lucide-react";
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
import type { Patient } from "@/lib/types";
import type { NoteAsset, PatientAttachment } from "@/lib/types";

const emptyForm = {
  symptoms: "",
  diagnosis: "",
  medications: "",
  notes: "",
  generatedNote: "",
  noteId: "",
  assets: [] as NoteAsset[],
};

const soapFields = [
  ["symptoms", "Complaint"],
  ["diagnosis", "Diagnosis"],
  ["medications", "Treatment"],
  ["notes", "Clinical notes"],
] as const;

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
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientAttachments, setPatientAttachments] = useState<PatientAttachment[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

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
    Promise.all([api.listPatients(), api.listPatientNotes(patientId), api.listPatientAttachments(patientId)])
      .then(([patientRows, noteRows, attachmentRows]) => {
        if (!active) {
          return;
        }
        setPatients(patientRows);
        setPatientAttachments(attachmentRows);
        const localDraft = scope ? readMobileConsultationDraft(scope) : null;
        const latestDraft = noteRows.find((note) => note.status === "draft");
        setForm({
          symptoms: localDraft?.symptoms || "",
          diagnosis: localDraft?.diagnosis || "",
          medications: localDraft?.medications || "",
          notes: localDraft?.notes || "",
          generatedNote: localDraft?.generatedNote || latestDraft?.content || "",
          noteId: localDraft?.noteId || latestDraft?.id || "",
          assets: localDraft?.assets?.length ? localDraft.assets : latestDraft?.asset_payload || [],
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
        medications: form.medications,
        notes: form.notes,
        assets: form.assets,
      });
      setForm((current) => ({
        ...current,
        generatedNote: generated.content,
        noteId: generated.note_id || current.noteId,
      }));
      setStatusMessage(generated.note_id ? "Draft saved." : "Draft generated.");
    } catch (generateError) {
      setStatusMessage(generateError instanceof Error ? generateError.message : "Failed to generate note.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleFinalize() {
    if (!patient || !form.noteId) {
      setStatusMessage("Generate a draft before finalizing.");
      return;
    }
    setIsFinalizing(true);
    setStatusMessage("");
    try {
      const synced = await api.generateNote({
        patient_id: patient.id,
        note_id: form.noteId,
        symptoms: form.symptoms,
        diagnosis: form.diagnosis,
        medications: form.medications,
        notes: form.notes,
        assets: form.assets,
      });
      await api.finalizeMobileConsultation(patient.id, synced.note_id || form.noteId);
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
        <form onSubmit={handleGenerate} className="grid gap-4">
          <section className="rounded-[18px] border border-[#dbe7ef] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(64,131,181,0.06)]">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="text-lg font-semibold text-slate-800">{patient.name}</h2>
              <p className="text-sm font-medium text-slate-600">{patient.reason}</p>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {patient.age ?? "-"} years | {patient.phone || "No phone"}
            </p>
          </section>

          {soapFields.map(([key, label]) => (
            <label key={key} className="grid gap-2 text-sm font-semibold text-slate-700">
              {label}
              <textarea
                value={form[key]}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                rows={key === "notes" ? 3 : 2}
                className="min-h-[72px] resize-none rounded-[18px] border border-[#bfd7e8] bg-white px-4 py-3 text-base font-normal leading-6 text-slate-800 outline-none focus:border-[#6daed8]"
              />
            </label>
          ))}

          <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Attachments</h2>
                <p className="mt-1 text-xs text-slate-500">Photos and PDFs go into the note. Videos save to the patient chart.</p>
              </div>
              <label className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[#9fc7e1] bg-[#f3f8fb] px-3 py-2 text-xs font-medium text-[#235f8e] transition hover:bg-[#dbeaf4]">
                Add
                <input
                  type="file"
                  accept="image/*,application/pdf,video/mp4,video/quicktime,video/webm"
                  multiple
                  onChange={handleAttachmentSelect}
                  className="hidden"
                />
              </label>
            </div>
            <div className="mt-3 grid gap-2">
              {form.assets.map((asset) => (
                <div key={asset.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    {asset.content_type.startsWith("image/") ? (
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
              {!form.assets.length && !patientAttachments.length ? (
                <p className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-3 py-4 text-sm text-slate-500">
                  No attachments added.
                </p>
              ) : null}
            </div>
          </section>

          <button
            type="submit"
            disabled={isGenerating}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#2f8fd3] text-sm font-semibold text-white disabled:opacity-60"
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

          <button
            type="button"
            onClick={handleFinalize}
            disabled={isFinalizing || !form.noteId}
            className="mb-4 flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#2f8fd3] text-sm font-semibold text-white disabled:opacity-50"
          >
            <Check className="h-5 w-5" />
            {isFinalizing ? "Finalizing..." : "Finalize"}
          </button>
        </form>
      ) : (
        <p className="clinic-empty-state">Patient not found.</p>
      )}
    </MobileShell>
  );
}
