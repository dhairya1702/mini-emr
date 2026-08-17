"use client";

import { useEffect } from "react";
import { Mail, Upload, X } from "lucide-react";

import type { PatientChartNoteAttachment } from "@/features/patient-chart/resources/patient-chart-resource-model";
import type { PatientChartResourcesWorkflow, PhotoPreview } from "@/features/patient-chart/resources/use-patient-chart-resources";
import type { PatientAttachment } from "@/lib/types";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

type AttachmentPanelNoteRow = {
  id: string;
  label: string;
  timestamp: string;
  attachmentId?: string;
  contentType: string;
  open: () => void;
};

type AttachmentPanelPatientRow = {
  id: string;
  label: string;
  timestamp: string;
  fileSize: number;
  kind: "patient_attachment";
  attachment: PatientAttachment;
  open: () => void;
};

function isPatientRow(row: AttachmentPanelNoteRow | AttachmentPanelPatientRow): row is AttachmentPanelPatientRow {
  return (row as AttachmentPanelPatientRow).kind === "patient_attachment";
}

function buildRows(workflow: PatientChartResourcesWorkflow) {
  const noteRows: AttachmentPanelNoteRow[] = workflow.noteAssets.map((asset: PatientChartNoteAttachment) => ({
    id: `note-${asset.note_id}-${asset.id}`,
    label: asset.name,
    timestamp: asset.note_created_at,
    attachmentId: asset.attachment_id,
    contentType: asset.content_type,
    open: () => {
      if (asset.attachment_id) {
        void workflow.openLinkedAttachment(asset.attachment_id, asset.name, asset.content_type, asset.note_created_at);
      } else if (asset.content_type.startsWith("image/") && asset.data_base64) {
        workflow.openNoteImage(asset);
      } else {
        workflow.openNoteAttachment(asset);
      }
    },
  }));
  const noteAttachmentIds = new Set(workflow.noteAssets.map((asset) => asset.attachment_id).filter(Boolean));
  const patientRows: AttachmentPanelPatientRow[] = workflow.patientAttachments
    .filter((attachment) => !noteAttachmentIds.has(attachment.id))
    .map((attachment) => ({
      id: `patient-${attachment.id}`,
      label: attachment.file_name,
      timestamp: attachment.created_at,
      fileSize: attachment.file_size,
      kind: "patient_attachment" as const,
      attachment,
      open: () => { void workflow.openPatientAttachment(attachment); },
    }));
  return [...noteRows, ...patientRows]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}

export function PatientAttachmentsPanel({ workflow }: { workflow: PatientChartResourcesWorkflow }) {
  const rows = buildRows(workflow);
  return (
    <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-black">Attachments</p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-[#f3f8fb]">
          <Upload className="h-4 w-4" />
          {workflow.isUploadingAttachment ? "Uploading..." : "Upload"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.pdf,.mp4,.mov,.webm"
            className="hidden"
            disabled={workflow.isUploadingAttachment}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void workflow.uploadPatientAttachment(file).finally(() => { event.target.value = ""; });
            }}
          />
        </label>
      </div>
      {workflow.isAttachmentsLoading ? <div className="flex justify-end"><span className="text-xs text-black">Loading...</span></div> : null}
      {workflow.attachmentError ? <p className="mt-3 text-sm text-rose-600">{workflow.attachmentError}</p> : null}
      <div className={`${workflow.attachmentError || workflow.isAttachmentsLoading ? "mt-4" : ""} divide-y divide-[#edf3f8]`}>
        {rows.length ? rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-4 py-3">
            <button type="button" onClick={row.open} className="min-w-0 flex-1 text-left transition hover:text-[#2f8fd3]">
              <p className="truncate text-sm font-medium text-black">{row.label}</p>
              <p className="mt-1 text-xs text-black">
                {formatDateTime(row.timestamp)}
                {isPatientRow(row) ? ` · ${formatFileSize(row.fileSize)}` : ""}
              </p>
            </button>
            <div className="flex shrink-0 items-center gap-2">
              {isPatientRow(row) || row.attachmentId ? (
                <button
                  type="button"
                  disabled={workflow.isSendingAttachmentId === (isPatientRow(row) ? row.attachment.id : row.attachmentId)}
                  onClick={() => {
                    const attachmentId = isPatientRow(row) ? row.attachment.id : row.attachmentId;
                    if (!attachmentId) return;
                    workflow.startSendAttachment({
                      id: attachmentId,
                      file_name: row.label,
                      content_type: isPatientRow(row) ? row.attachment.content_type : "",
                    });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#9fc7e1] bg-white px-3 py-1.5 text-xs font-medium text-[#235f8e] transition hover:bg-[#f3f8fb] disabled:opacity-60"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {workflow.isSendingAttachmentId === (isPatientRow(row) ? row.attachment.id : row.attachmentId) ? "Sending..." : "Send"}
                </button>
              ) : null}
              {isPatientRow(row) ? (
                <button
                  type="button"
                  disabled={workflow.isDeletingAttachmentId === row.attachment.id}
                  onClick={() => { void workflow.deletePatientAttachment(row.attachment); }}
                  className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  {workflow.isDeletingAttachmentId === row.attachment.id ? "Deleting..." : "Delete"}
                </button>
              ) : null}
            </div>
          </div>
        )) : <div className="py-8 text-center text-sm text-black">No attachments yet.</div>}
      </div>
    </section>
  );
}

function PhotoPreviewModal({ preview, onClose }: { preview: PhotoPreview | null; onClose: () => void }) {
  useEffect(() => {
    if (!preview) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, preview]);
  if (!preview) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/85 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={preview.title}>
      <button type="button" className="absolute inset-0 cursor-zoom-out" onClick={onClose} aria-label="Close photo preview" />
      <div className="relative z-10 flex max-h-full w-full max-w-6xl flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between gap-4 text-white">
          <p className="truncate text-sm font-semibold sm:text-base">{preview.title}</p>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20" aria-label="Close photo preview">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative flex min-h-[240px] w-full items-center justify-center overflow-hidden rounded-[18px] bg-slate-950/60">
          {preview.isLoading ? <p className="px-6 py-16 text-sm text-slate-200">Opening photo...</p> : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.src} alt={preview.alt} className="max-h-[82dvh] max-w-full object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}

function ProfilePhotoManager({ workflow }: { workflow: PatientChartResourcesWorkflow }) {
  const patientName = workflow.patient?.name ?? "Patient";
  useEffect(() => {
    if (!workflow.isProfilePhotoManagerOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !workflow.isUploadingProfilePhoto) workflow.closeProfilePhotoManager();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [workflow]);
  if (!workflow.isProfilePhotoManagerOpen) return null;
  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label={`Manage ${patientName} profile photo`}>
      <button type="button" className="absolute inset-0" onClick={workflow.isUploadingProfilePhoto ? undefined : workflow.closeProfilePhotoManager} aria-label="Close profile photo manager" />
      <div className="relative z-10 w-full max-w-md rounded-[22px] border border-[#bfd7e8] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-slate-900">Profile photo</h3>
          <button type="button" disabled={workflow.isUploadingProfilePhoto} onClick={workflow.closeProfilePhotoManager} className="grid h-10 w-10 place-items-center rounded-xl border border-[#bfd7e8] text-slate-600 transition hover:bg-[#f3f8fb] disabled:opacity-50" aria-label="Close profile photo manager"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 flex min-h-72 items-center justify-center overflow-hidden rounded-[18px] border border-[#dbe7ef] bg-[#f3f8fb]">
          {workflow.profilePhotoObjectUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={workflow.profilePhotoObjectUrl} alt={`${patientName} profile photo`} className="max-h-[55vh] w-full object-contain" />
          ) : <p className="text-sm text-slate-500">Loading photo...</p>}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" disabled={workflow.isUploadingProfilePhoto} onClick={workflow.requestProfilePhotoChange} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{workflow.isUploadingProfilePhoto ? "Uploading..." : "Change photo"}</button>
          <button type="button" disabled={workflow.isUploadingProfilePhoto} onClick={() => { void workflow.removeProfilePhoto(); }} className="rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60">Remove photo</button>
        </div>
      </div>
    </div>
  );
}

function SendAttachmentModal({ workflow }: { workflow: PatientChartResourcesWorkflow }) {
  const draft = workflow.attachmentSendDraft;
  if (!draft) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 px-4">
      <div className="w-full max-w-lg rounded-[20px] border border-[#bfd7e8] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
        <div className="flex items-start justify-between gap-4">
          <div><h3 className="text-base font-semibold text-slate-900">Send attachment</h3><p className="mt-1 text-sm text-slate-500">{draft.fileName}</p></div>
          <button type="button" onClick={workflow.closeAttachmentSendDraft} className="rounded-xl border border-[#dbe7ef] p-2 text-slate-500 transition hover:text-slate-800" aria-label="Close send attachment"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Confirm patient email</span>
            <input type="email" value={draft.recipientEmail} onChange={(event) => workflow.updateAttachmentSendDraft({ recipientEmail: event.target.value })} placeholder="patient@example.com" className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]" />
            {!draft.recipientEmail.trim() ? <span className="mt-2 block text-xs text-amber-700">This patient has no email saved. Enter one to send this attachment.</span> : null}
          </label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Subject</span><input value={draft.subject} onChange={(event) => workflow.updateAttachmentSendDraft({ subject: event.target.value })} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Message</span><textarea rows={4} value={draft.message} onChange={(event) => workflow.updateAttachmentSendDraft({ message: event.target.value })} className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]" /></label>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={workflow.closeAttachmentSendDraft} className="rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb]">Cancel</button>
          <button type="button" disabled={workflow.isSendingAttachmentId === draft.attachmentId} onClick={() => { void workflow.sendAttachment(); }} className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60">{workflow.isSendingAttachmentId === draft.attachmentId ? "Sending..." : "Send attachment"}</button>
        </div>
      </div>
    </div>
  );
}

export function PatientChartResourceOverlays({ workflow }: { workflow: PatientChartResourcesWorkflow }) {
  return (
    <>
      <input
        ref={workflow.profilePhotoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="sr-only"
        disabled={workflow.isUploadingProfilePhoto}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          void workflow.uploadProfilePhoto(file);
        }}
      />
      <SendAttachmentModal workflow={workflow} />
      <ProfilePhotoManager workflow={workflow} />
      <PhotoPreviewModal preview={workflow.photoPreview} onClose={workflow.closePhotoPreview} />
    </>
  );
}
