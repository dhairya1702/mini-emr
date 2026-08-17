import type { ConsultationNote, NoteAsset, Patient, PatientAttachment } from "@/lib/types";

export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PatientChartNoteAttachment = NoteAsset & {
  note_id: string;
  note_created_at: string;
};

export type AttachmentSendDraft = {
  attachmentId: string;
  fileName: string;
  recipientEmail: string;
  subject: string;
  message: string;
};

function noteAttachmentKey(asset: NoteAsset) {
  if (asset.attachment_id?.trim()) {
    return `attachment:${asset.attachment_id.trim()}`;
  }
  return asset.id?.trim()
    ? `id:${asset.id.trim()}`
    : `fallback:${asset.name.trim()}:${asset.content_type.trim()}:${(asset.data_base64 || "").trim()}`;
}

export function collectNoteAttachments(notes: ConsultationNote[]) {
  const seen = new Set<string>();
  const rows: PatientChartNoteAttachment[] = [];
  for (const note of notes) {
    const assets = note.snapshot_asset_payload?.length ? note.snapshot_asset_payload : note.asset_payload || [];
    for (const asset of assets) {
      if (asset.kind !== "attachment") continue;
      const key = noteAttachmentKey(asset);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        ...asset,
        note_id: note.id,
        note_created_at: note.finalized_at || note.created_at,
      });
    }
  }
  return rows;
}

export function validateProfilePhoto(file: Pick<File, "type" | "size">) {
  if (!PROFILE_PHOTO_TYPES.has(file.type)) {
    return "Only JPG, PNG, and WEBP patient photos are supported.";
  }
  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    return "Patient photo must be 5 MB or smaller.";
  }
  return "";
}

export function createAttachmentSendDraft(
  patient: Patient,
  attachment: Pick<PatientAttachment, "id" | "file_name">,
): AttachmentSendDraft {
  const patientName = patient.name.trim() || "Patient";
  return {
    attachmentId: attachment.id,
    fileName: attachment.file_name,
    recipientEmail: (patient.email || "").trim(),
    subject: `${patientName} attachment: ${attachment.file_name}`,
    message: `Please find attached ${attachment.file_name} for ${patientName}.`,
  };
}

export function validateAttachmentSendDraft(draft: AttachmentSendDraft) {
  if (!draft.recipientEmail.trim()) return "Confirm the recipient email before sending.";
  if (!draft.recipientEmail.trim().includes("@")) return "Enter a valid recipient email.";
  if (!draft.subject.trim()) return "Enter an email subject before sending.";
  return "";
}
