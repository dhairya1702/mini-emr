import type {
  Patient,
  ReferralPackageCreatePayload,
  ReferralRecipientType,
  ReferralUrgency,
} from "@/lib/types";

export interface ReferralDraft {
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  recipientType: ReferralRecipientType;
  doctorName: string;
  specialty: string;
  clinic: string;
  doctorEmail: string;
  doctorPhone: string;
  reason: string;
  clinicalQuestion: string;
  urgency: ReferralUrgency;
  referralNote: string;
  consultationNoteIds: string[];
  attachmentIds: string[];
  longitudinalTrackIds: string[];
  emailRecipients: string;
  whatsappRecipients: string;
}

export function createReferralDraft(patient: Patient): ReferralDraft {
  return {
    patientName: patient.name,
    patientEmail: patient.email || "",
    patientPhone: patient.phone || "",
    recipientType: "patient",
    doctorName: "",
    specialty: "",
    clinic: "",
    doctorEmail: "",
    doctorPhone: "",
    reason: patient.reason || "",
    clinicalQuestion: "",
    urgency: "routine",
    referralNote: "",
    consultationNoteIds: [],
    attachmentIds: [],
    longitudinalTrackIds: [],
    emailRecipients: patient.email || "",
    whatsappRecipients: patient.phone || "",
  };
}

export function referralDraftError(draft: ReferralDraft) {
  if (!draft.reason.trim()) return "Enter the reason for referral.";
  if (draft.recipientType !== "patient" && !draft.doctorName.trim()) {
    return "Enter the receiving doctor's name.";
  }
  if (
    !draft.consultationNoteIds.length &&
    !draft.attachmentIds.length &&
    !draft.longitudinalTrackIds.length
  ) {
    return "Select at least one consultation, test, or attachment.";
  }
  return "";
}

export function buildReferralCreatePayload(draft: ReferralDraft): ReferralPackageCreatePayload {
  return {
    recipient_type: draft.recipientType,
    recipient_name: draft.recipientType === "patient" ? draft.patientName : draft.doctorName.trim(),
    recipient_specialty: draft.specialty.trim(),
    recipient_clinic: draft.clinic.trim(),
    recipient_email: draft.recipientType === "patient" ? draft.patientEmail.trim() : draft.doctorEmail.trim(),
    recipient_phone: draft.recipientType === "patient" ? draft.patientPhone.trim() : draft.doctorPhone.trim(),
    reason: draft.reason.trim(),
    clinical_question: draft.clinicalQuestion.trim(),
    urgency: draft.urgency,
    referral_note: draft.referralNote.trim(),
    consultation_note_ids: draft.consultationNoteIds,
    attachment_ids: draft.attachmentIds,
    longitudinal_track_ids: draft.longitudinalTrackIds,
  };
}

export function splitRecipients(value: string) {
  return Array.from(new Set(value.split(/[;,\n]/).map((row) => row.trim()).filter(Boolean)));
}

export function referralRecordCount(draft: ReferralDraft) {
  return draft.consultationNoteIds.length
    + draft.attachmentIds.length
    + draft.longitudinalTrackIds.length;
}

export function referralConsultationReason(visitReason: string | null | undefined, patientReason: string | null | undefined) {
  return visitReason?.trim() || patientReason?.trim() || "Consultation";
}
