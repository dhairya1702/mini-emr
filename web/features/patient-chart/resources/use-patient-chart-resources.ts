"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  collectNoteAttachments,
  createAttachmentSendDraft,
  type AttachmentSendDraft,
  validateAttachmentSendDraft,
  validateProfilePhoto,
} from "@/features/patient-chart/resources/patient-chart-resource-model";
import { api } from "@/lib/api";
import type {
  ConsultationNote,
  NoteAsset,
  OperationResult,
  Patient,
  PatientAttachment,
  PatientVisitAttachmentRow,
  SendPatientAttachmentPayload,
} from "@/lib/types";

export type PhotoPreview = {
  src: string;
  alt: string;
  title: string;
  isLoading?: boolean;
};

export type PatientChartResourceGateway = {
  listNotes: (patientId: string) => Promise<ConsultationNote[]>;
  listAttachments: (patientId: string) => Promise<PatientAttachment[]>;
  uploadAttachment: (patientId: string, file: File) => Promise<PatientAttachment>;
  deleteAttachment: (patientId: string, attachmentId: string) => Promise<PatientAttachment>;
  sendAttachment: (patientId: string, attachmentId: string, payload: SendPatientAttachmentPayload) => Promise<OperationResult>;
  downloadAttachment: (attachmentId: string) => Promise<Blob>;
  getProfilePhoto: (patientId: string) => Promise<Blob>;
  uploadProfilePhoto: (patientId: string, file: File) => Promise<Patient>;
  removeProfilePhoto: (patientId: string) => Promise<Patient>;
};

const defaultGateway: PatientChartResourceGateway = {
  listNotes: (patientId) => api.listPatientNotes(patientId),
  listAttachments: (patientId) => api.listPatientAttachments(patientId),
  uploadAttachment: (patientId, file) => api.uploadPatientAttachment(patientId, file),
  deleteAttachment: (patientId, attachmentId) => api.deletePatientAttachment(patientId, attachmentId),
  sendAttachment: (patientId, attachmentId, payload) => api.sendPatientAttachment(patientId, attachmentId, payload),
  downloadAttachment: (attachmentId) => api.downloadPatientAttachment(attachmentId),
  getProfilePhoto: (patientId) => api.getPatientProfilePhoto(patientId),
  uploadProfilePhoto: (patientId, file) => api.uploadPatientProfilePhoto(patientId, file),
  removeProfilePhoto: (patientId) => api.removePatientProfilePhoto(patientId),
};

type UsePatientChartResourcesOptions = {
  patient: Patient | null;
  attachmentsActive: boolean;
  isTrainingMode: boolean;
  readOnly: boolean;
  onPatientUpdated?: (patient: Patient) => void;
  onAttachmentDeleted?: (attachmentId: string) => void;
  gateway?: PatientChartResourceGateway;
};

function isImageContentType(contentType: string) {
  return contentType.startsWith("image/");
}

function openStoredAttachment(attachmentId: string) {
  window.open(`/attachment-view/${attachmentId}`, "_blank");
}

function openInlineNoteAttachment(asset: NoteAsset) {
  const key = `clinic_note_attachment:${globalThis.crypto?.randomUUID?.() || `${Date.now()}`}`;
  window.sessionStorage.setItem(key, JSON.stringify(asset));
  window.open(`/attachment-view/note?key=${encodeURIComponent(key)}`, "_blank");
}

export function usePatientChartResources({
  patient,
  attachmentsActive,
  isTrainingMode,
  readOnly,
  onPatientUpdated,
  onAttachmentDeleted,
  gateway = defaultGateway,
}: UsePatientChartResourcesOptions) {
  const [notes, setNotes] = useState<ConsultationNote[]>([]);
  const [patientAttachments, setPatientAttachments] = useState<PatientAttachment[]>([]);
  const [isAttachmentsLoading, setIsAttachmentsLoading] = useState(false);
  const [hasLoadedAttachments, setHasLoadedAttachments] = useState(false);
  const [isDeletingAttachmentId, setIsDeletingAttachmentId] = useState("");
  const [isSendingAttachmentId, setIsSendingAttachmentId] = useState("");
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentSendDraft, setAttachmentSendDraft] = useState<AttachmentSendDraft | null>(null);
  const [profilePhotoObjectUrl, setProfilePhotoObjectUrl] = useState("");
  const [profilePhotoRevision, setProfilePhotoRevision] = useState(0);
  const [profilePhotoError, setProfilePhotoError] = useState("");
  const [isUploadingProfilePhoto, setIsUploadingProfilePhoto] = useState(false);
  const [isProfilePhotoManagerOpen, setIsProfilePhotoManagerOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<PhotoPreview | null>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const previewObjectUrlRef = useRef("");
  const patientId = patient?.id ?? "";

  const noteAssets = useMemo(() => collectNoteAttachments(notes), [notes]);

  function revokePreviewObjectUrl() {
    if (!previewObjectUrlRef.current) return;
    URL.revokeObjectURL(previewObjectUrlRef.current);
    previewObjectUrlRef.current = "";
  }

  function closePhotoPreview() {
    revokePreviewObjectUrl();
    setPhotoPreview(null);
  }

  useEffect(() => {
    setNotes([]);
    setPatientAttachments([]);
    setIsAttachmentsLoading(false);
    setHasLoadedAttachments(false);
    setIsDeletingAttachmentId("");
    setIsSendingAttachmentId("");
    setIsUploadingAttachment(false);
    setAttachmentError("");
    setAttachmentSendDraft(null);
    setProfilePhotoError("");
    setIsUploadingProfilePhoto(false);
    setIsProfilePhotoManagerOpen(false);
    revokePreviewObjectUrl();
    setPhotoPreview(null);
  }, [patientId]);

  useEffect(() => () => revokePreviewObjectUrl(), []);

  useEffect(() => {
    if (!patient?.profile_photo_url) {
      setProfilePhotoObjectUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    void gateway.getProfilePhoto(patient.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setProfilePhotoObjectUrl(objectUrl);
      })
      .catch(() => {
        if (active) setProfilePhotoObjectUrl("");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [gateway, patient?.id, patient?.profile_photo_updated_at, patient?.profile_photo_url, profilePhotoRevision]);

  useEffect(() => {
    if (!patientId || !attachmentsActive || hasLoadedAttachments) return;
    let active = true;
    setIsAttachmentsLoading(true);
    setAttachmentError("");
    const request = isTrainingMode
      ? Promise.resolve([[], []] as [ConsultationNote[], PatientAttachment[]])
      : Promise.all([gateway.listNotes(patientId), gateway.listAttachments(patientId)]);
    void request
      .then(([noteRows, attachmentRows]) => {
        if (!active) return;
        setNotes(noteRows);
        setPatientAttachments(attachmentRows);
        setHasLoadedAttachments(true);
      })
      .catch((loadError) => {
        if (!active) return;
        setNotes([]);
        setPatientAttachments([]);
        setAttachmentError(loadError instanceof Error ? loadError.message : "Failed to load attachments.");
      })
      .finally(() => {
        if (active) setIsAttachmentsLoading(false);
      });
    return () => { active = false; };
  }, [attachmentsActive, gateway, hasLoadedAttachments, isTrainingMode, patientId]);

  async function openPatientAttachment(attachment: PatientAttachment) {
    try {
      if (!isImageContentType(attachment.content_type)) {
        openStoredAttachment(attachment.id);
        return;
      }
      revokePreviewObjectUrl();
      setPhotoPreview({
        src: "",
        alt: attachment.file_name || "Patient attachment",
        title: attachment.file_name || "Patient attachment",
        isLoading: true,
      });
      const blob = await gateway.downloadAttachment(attachment.id);
      const objectUrl = URL.createObjectURL(blob);
      previewObjectUrlRef.current = objectUrl;
      setPhotoPreview((current) => {
        if (!current?.isLoading) {
          revokePreviewObjectUrl();
          return current;
        }
        return {
          src: objectUrl,
          alt: attachment.file_name || "Patient attachment",
          title: attachment.file_name || "Patient attachment",
        };
      });
    } catch (downloadError) {
      closePhotoPreview();
      setAttachmentError(downloadError instanceof Error ? downloadError.message : "Failed to open attachment.");
    }
  }

  async function openLinkedAttachment(attachmentId: string, label: string, contentType: string, timestamp: string) {
    if (!patient) return;
    await openPatientAttachment({
      id: attachmentId,
      org_id: "",
      patient_id: patient.id,
      uploaded_by: null,
      file_name: label,
      content_type: contentType,
      file_size: 0,
      storage_path: "",
      created_at: timestamp,
    });
  }

  function openNoteImage(asset: NoteAsset) {
    const src = asset.data_base64 ? `data:${asset.content_type || "image/jpeg"};base64,${asset.data_base64}` : "";
    if (!src) {
      openInlineNoteAttachment(asset);
      return;
    }
    setPhotoPreview({ src, alt: asset.name || "Patient attachment", title: asset.name || "Patient attachment" });
  }

  function openNoteAttachment(asset: NoteAsset) {
    openInlineNoteAttachment(asset);
  }

  async function openVisitAttachment(attachment: PatientVisitAttachmentRow) {
    if (attachment.attachment_id) {
      await openLinkedAttachment(attachment.attachment_id, attachment.label, attachment.content_type, attachment.timestamp);
      return;
    }
    if (attachment.source_type !== "note_attachment" || !attachment.data_base64) return;
    const asset: NoteAsset = {
      id: attachment.id,
      kind: "attachment",
      name: attachment.label,
      content_type: attachment.content_type,
      data_base64: attachment.data_base64,
    };
    if (isImageContentType(attachment.content_type)) {
      openNoteImage(asset);
      return;
    }
    openInlineNoteAttachment(asset);
  }

  async function deletePatientAttachment(attachment: PatientAttachment) {
    if (!patient || !window.confirm(`Delete ${attachment.file_name}? This will remove the stored media file.`)) return;
    setIsDeletingAttachmentId(attachment.id);
    setAttachmentError("");
    try {
      await gateway.deleteAttachment(patient.id, attachment.id);
      setPatientAttachments((current) => current.filter((row) => row.id !== attachment.id));
      onAttachmentDeleted?.(attachment.id);
    } catch (deleteError) {
      setAttachmentError(deleteError instanceof Error ? deleteError.message : "Failed to delete attachment.");
    } finally {
      setIsDeletingAttachmentId("");
    }
  }

  async function uploadPatientAttachment(file: File | null) {
    if (!patient || !file) return;
    setIsUploadingAttachment(true);
    setAttachmentError("");
    try {
      const uploaded = await gateway.uploadAttachment(patient.id, file);
      setPatientAttachments((current) => [uploaded, ...current.filter((row) => row.id !== uploaded.id)]);
    } catch (uploadError) {
      setAttachmentError(uploadError instanceof Error ? uploadError.message : "Failed to upload attachment.");
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  function startSendAttachment(attachment: Pick<PatientAttachment, "id" | "file_name" | "content_type">) {
    if (!patient) return;
    setAttachmentError("");
    setAttachmentSendDraft(createAttachmentSendDraft(patient, attachment));
  }

  function updateAttachmentSendDraft(patch: Partial<AttachmentSendDraft>) {
    setAttachmentSendDraft((current) => current ? { ...current, ...patch } : current);
  }

  async function sendAttachment() {
    if (!patient || !attachmentSendDraft) return;
    const validationError = validateAttachmentSendDraft(attachmentSendDraft);
    if (validationError) {
      setAttachmentError(validationError);
      return;
    }
    setIsSendingAttachmentId(attachmentSendDraft.attachmentId);
    setAttachmentError("");
    try {
      const response = await gateway.sendAttachment(patient.id, attachmentSendDraft.attachmentId, {
        recipient_email: attachmentSendDraft.recipientEmail.trim(),
        subject: attachmentSendDraft.subject.trim(),
        message: attachmentSendDraft.message.trim(),
      });
      setAttachmentError(response.message);
      setAttachmentSendDraft(null);
    } catch (sendError) {
      setAttachmentError(sendError instanceof Error ? sendError.message : "Failed to send attachment.");
    } finally {
      setIsSendingAttachmentId("");
    }
  }

  function openProfilePhoto() {
    if (!patient) return;
    if (!readOnly && !isTrainingMode) {
      if (patient.profile_photo_url) setIsProfilePhotoManagerOpen(true);
      else profilePhotoInputRef.current?.click();
      return;
    }
    if (!profilePhotoObjectUrl) return;
    setPhotoPreview({
      src: profilePhotoObjectUrl,
      alt: `${patient.name} profile photo`,
      title: `${patient.name} profile photo`,
    });
  }

  async function uploadProfilePhoto(file: File | null) {
    if (!patient || !file) return;
    const validationError = validateProfilePhoto(file);
    if (validationError) {
      setProfilePhotoError(validationError);
      return;
    }
    setIsUploadingProfilePhoto(true);
    setProfilePhotoError("");
    try {
      const updated = await gateway.uploadProfilePhoto(patient.id, file);
      setProfilePhotoRevision((current) => current + 1);
      onPatientUpdated?.(updated);
      setIsProfilePhotoManagerOpen(false);
    } catch (uploadError) {
      setProfilePhotoError(uploadError instanceof Error ? uploadError.message : "Failed to upload patient photo.");
    } finally {
      setIsUploadingProfilePhoto(false);
    }
  }

  async function removeProfilePhoto() {
    if (!patient?.profile_photo_url || !window.confirm("Remove this patient photo?")) return;
    setIsUploadingProfilePhoto(true);
    setProfilePhotoError("");
    try {
      const updated = await gateway.removeProfilePhoto(patient.id);
      setProfilePhotoRevision((current) => current + 1);
      onPatientUpdated?.(updated);
      setIsProfilePhotoManagerOpen(false);
    } catch (deleteError) {
      setProfilePhotoError(deleteError instanceof Error ? deleteError.message : "Failed to remove patient photo.");
    } finally {
      setIsUploadingProfilePhoto(false);
    }
  }

  return {
    patient,
    noteAssets,
    patientAttachments,
    isAttachmentsLoading,
    isDeletingAttachmentId,
    isSendingAttachmentId,
    isUploadingAttachment,
    attachmentError,
    attachmentSendDraft,
    profilePhotoObjectUrl,
    profilePhotoError,
    isUploadingProfilePhoto,
    isProfilePhotoManagerOpen,
    photoPreview,
    profilePhotoInputRef,
    openPatientAttachment,
    openLinkedAttachment,
    openNoteImage,
    openNoteAttachment,
    openVisitAttachment,
    deletePatientAttachment,
    uploadPatientAttachment,
    startSendAttachment,
    updateAttachmentSendDraft,
    closeAttachmentSendDraft: () => setAttachmentSendDraft(null),
    sendAttachment,
    openProfilePhoto,
    uploadProfilePhoto,
    removeProfilePhoto,
    closeProfilePhotoManager: () => setIsProfilePhotoManagerOpen(false),
    requestProfilePhotoChange: () => profilePhotoInputRef.current?.click(),
    closePhotoPreview,
  };
}

export type PatientChartResourcesWorkflow = ReturnType<typeof usePatientChartResources>;
