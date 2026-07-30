"use client";

import { type ChangeEvent, type ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, CalendarClock, ChevronDown, ChevronRight, ClipboardList, Clock3, Eye, FileText, Image as ImageIcon, LineChart, Mail, Pencil, Sparkles, Upload, UserRound, X } from "lucide-react";

import type { ClinicSpecialty } from "@/lib/clinic-specialty";
import { BinocularVisionModal } from "@/components/optometry/binocular-vision-modal";
import { ContactLensModal } from "@/components/optometry/contact-lens-modal";
import { LowVisionModal } from "@/components/optometry/low-vision-modal";
import { HistoricalMyopiaModal } from "@/components/optometry/myopia/historical-myopia-modal";
import { MyopiaManagementModal } from "@/components/optometry/myopia/myopia-management-modal";
import { TbiEvaluationModal } from "@/components/optometry/tbi-evaluation-modal";
import { EyeExamFields } from "@/components/optometry/eye-exam-fields";
import { api } from "@/lib/api";
import {
  buildBinocularVisionSummary,
  buildLowVisionSummary,
  createEmptyContactLens,
  createEmptyLowVision,
  hasContactLensEyeData,
} from "@/lib/optometry/consultation";
import { getSpecialtyModules, specialtyHasModule, type SpecialtyModuleKey } from "@/lib/specialty";
import { createTrainingId } from "@/lib/training-mode";
import {
  BinocularVisionEvaluationCreatePayload,
  BinocularVisionEvaluationRecord,
  ConsultationNote,
  ContactLensEyeEntry,
  ContactLensPayload,
  EyeExamEntry,
  EyeExamPayload,
  EyeExamRow,
  EyeExamSection,
  LongitudinalTrackRecord,
  LowVisionPayload,
  MyopiaHistory,
  MyopiaMeasurementPayload,
  NoteAsset,
  Patient,
  PatientAttachment,
  PatientChartVisit,
  PatientSummary,
  PatientVisitAttachmentRow,
  PatientVisitDetail,
  PatientTimelineEvent,
  PediatricGrowthSummary,
  SexAtBirth,
  TbiEvaluationCreatePayload,
  TbiEvaluationRecord,
} from "@/lib/types";
import {
  buildEyeExamSummary,
  createEmptyEyeExam,
  hasEyeExamData,
  normalizeEyeExamPayload,
} from "@/lib/structured-modules";

type ChartTab = "visits" | "attachments" | "tests" | "timeline";

type PhotoPreview = {
  src: string;
  alt: string;
  title: string;
  isLoading?: boolean;
  revokeOnClose?: boolean;
};

interface PatientDetailsDrawerProps {
  patient: Patient | null;
  clinicSpecialty?: ClinicSpecialty | null;
  workflowActionLabel?: string | null;
  workflowActionDisabled?: boolean;
  onWorkflowAction?: (() => void | Promise<void>) | null;
  onClose: () => void;
  onLoadVisits: (patientId: string) => Promise<PatientChartVisit[]>;
  onLoadVisitDetail: (patientId: string, visitId: string) => Promise<PatientVisitDetail>;
  onLoadTimeline: (patientId: string) => Promise<PatientTimelineEvent[]>;
  onLoadMyopiaHistory?: (patientId: string) => Promise<MyopiaHistory>;
  onLoadGrowthHistory?: (patientId: string) => Promise<PediatricGrowthSummary>;
  isTrainingMode?: boolean;
  readOnly?: boolean;
  /** Render as an edge-to-edge full-screen page (route) instead of a modal overlay. */
  fullScreen?: boolean;
  /** Breadcrumb label shown next to the back button in full-screen mode (e.g. "Patients"). */
  fullScreenBackLabel?: string;
  onPatientUpdated?: (patient: Patient) => void;
  onSave: (payloadPatientId: string, payload: {
    name: string;
    phone: string;
    email: string;
    address: string;
    reason: string;
    date_of_birth?: string | null;
    sex_at_birth?: SexAtBirth | null;
    gender_identity?: string;
    age: number | null;
    weight: number | null;
    height: number | null;
    temperature: number | null;
  }) => Promise<void>;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const MODULE_LABELS: Record<SpecialtyModuleKey, string> = {
  eye_exam: "Eye Exam",
  contact_lens: "Contact lens",
  binocular_vision: "Binocular vision",
  low_vision: "Low vision",
  myopia_management: "Myopia",
  tbi_evaluation: "Neurovision / TBI",
  pediatric_growth_measurement: "Pediatric growth",
  well_child_visit: "Well-child visit",
  parent_handout_request: "Parent handout",
  pediatric_follow_up_plan: "Pediatric follow-up",
};

function moduleLabel(moduleKey: SpecialtyModuleKey) {
  return MODULE_LABELS[moduleKey] ?? moduleKey.replaceAll("_", " ");
}

function formatModuleSummary(entry: LongitudinalTrackRecord) {
  const summary = entry.summary_fields?.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  const result = entry.summary_fields?.result;
  if (typeof result === "string" && result.trim()) {
    return result.trim();
  }
  return `${moduleLabel(entry.track_type as SpecialtyModuleKey)} saved.`;
}

function moduleEntriesFor(moduleEntries: LongitudinalTrackRecord[], moduleKey: SpecialtyModuleKey) {
  return moduleEntries
    .filter((entry) => entry.track_type === moduleKey)
    .sort((left, right) => new Date(right.measured_at).getTime() - new Date(left.measured_at).getTime());
}

const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function patientInitials(patient: Patient) {
  const parts = patient.name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "P";
}

function noteAttachmentKey(asset: NoteAsset) {
  if (asset.attachment_id?.trim()) {
    return `attachment:${asset.attachment_id.trim()}`;
  }
  return asset.id?.trim()
    ? `id:${asset.id.trim()}`
    : `fallback:${asset.name.trim()}:${asset.content_type.trim()}:${(asset.data_base64 || "").trim()}`;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function openPatientAttachmentViewer(attachmentId: string) {
  window.open(`/attachment-view/${attachmentId}`, "_blank");
}

function openNoteAttachmentViewer(asset: NoteAsset) {
  const key = `clinic_note_attachment:${globalThis.crypto?.randomUUID?.() || `${Date.now()}`}`;
  window.sessionStorage.setItem(key, JSON.stringify(asset));
  window.open(`/attachment-view/note?key=${encodeURIComponent(key)}`, "_blank");
}

function isImageContentType(contentType: string) {
  return contentType.startsWith("image/");
}

function noteAssetImageSrc(asset: NoteAsset) {
  return asset.data_base64 ? `data:${asset.content_type || "image/jpeg"};base64,${asset.data_base64}` : "";
}

function PhotoPreviewModal({
  preview,
  onClose,
}: {
  preview: PhotoPreview | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!preview) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, preview]);

  if (!preview) {
    return null;
  }

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
          {preview.isLoading ? (
            <p className="px-6 py-16 text-sm text-slate-200">Opening photo...</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.src} alt={preview.alt} className="max-h-[82dvh] max-w-full object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}

function ProfilePhotoManagerModal({
  open,
  patientName,
  photoSrc,
  isBusy,
  onChange,
  onRemove,
  onClose,
}: {
  open: boolean;
  patientName: string;
  photoSrc: string;
  isBusy: boolean;
  onChange: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label={`Manage ${patientName} profile photo`}>
      <button type="button" className="absolute inset-0" onClick={isBusy ? undefined : onClose} aria-label="Close profile photo manager" />
      <div className="relative z-10 w-full max-w-md rounded-[22px] border border-[#bfd7e8] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-slate-900">Profile photo</h3>
          <button type="button" disabled={isBusy} onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-[#bfd7e8] text-slate-600 transition hover:bg-[#f3f8fb] disabled:opacity-50" aria-label="Close profile photo manager">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 flex min-h-72 items-center justify-center overflow-hidden rounded-[18px] border border-[#dbe7ef] bg-[#f3f8fb]">
          {photoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoSrc} alt={`${patientName} profile photo`} className="max-h-[55vh] w-full object-contain" />
          ) : (
            <p className="text-sm text-slate-500">Loading photo...</p>
          )}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" disabled={isBusy} onClick={onChange} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
            {isBusy ? "Uploading..." : "Change photo"}
          </button>
          <button type="button" disabled={isBusy} onClick={onRemove} className="rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60">
            Remove photo
          </button>
        </div>
      </div>
    </div>
  );
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

function isAttachmentPanelPatientRow(row: AttachmentPanelNoteRow | AttachmentPanelPatientRow): row is AttachmentPanelPatientRow {
  return (row as AttachmentPanelPatientRow).kind === "patient_attachment";
}

function getEventTitle(event: PatientTimelineEvent) {
  if (event.type === "visit_recorded" && event.title.trim().toLowerCase() === "visit recorded") {
    return "Visit";
  }
  return event.title;
}

function getTimelineIcon(type: PatientTimelineEvent["type"]) {
  if (type === "follow_up_scheduled" || type === "follow_up_completed") {
    return <CalendarClock className="h-4 w-4 text-amber-600" />;
  }
  if (type === "appointment_booked" || type === "appointment_checked_in") {
    return <CalendarClock className="h-4 w-4 text-[#2f8fd3]" />;
  }
  if (type === "myopia_measurement") {
    return <Clock3 className="h-4 w-4 text-emerald-600" />;
  }
  if (type === "growth_measurement" || type === "well_child_visit") {
    return <Clock3 className="h-4 w-4 text-amber-600" />;
  }
  if (type === "visit_recorded") {
    return <UserRound className="h-4 w-4 text-[#2f8fd3]" />;
  }
  return <Clock3 className="h-4 w-4 text-[#2f8fd3]" />;
}

function timelineMeta(type: PatientTimelineEvent["type"]): { label: string; node: string; kind: string } {
  const value = String(type || "").toLowerCase();
  if (value.includes("care_program")) {
    return { label: "Care", node: "bg-emerald-500 border-emerald-100", kind: "text-emerald-700" };
  }
  if (value.includes("eval") || value.includes("measurement") || value === "myopia_measurement") {
    return { label: "Test", node: "bg-[#f0b44c] border-[#fff2da]", kind: "text-[#b45309]" };
  }
  if (value.includes("attachment") || value.includes("file")) {
    return { label: "File", node: "bg-[#4f9cf7] border-[#e2eefb]", kind: "text-[#2f7d55]" };
  }
  if (value.includes("invoice") || value.includes("bill")) {
    return { label: "Billing", node: "bg-[#4f9cf7] border-[#e2eefb]", kind: "text-[#2f7d55]" };
  }
  if (value.includes("follow_up")) {
    return { label: "Follow-up", node: "bg-[#2f8fd3] border-[#ecf6fd]", kind: "text-[#2a6fa8]" };
  }
  if (value.includes("appointment")) {
    return { label: "Appointment", node: "bg-[#2f8fd3] border-[#ecf6fd]", kind: "text-[#2a6fa8]" };
  }
  return { label: "Visit", node: "bg-[#2f8fd3] border-[#ecf6fd]", kind: "text-[#2a6fa8]" };
}

const MODULE_ICON: Partial<Record<SpecialtyModuleKey, typeof Activity>> = {
  myopia_management: Eye,
  tbi_evaluation: Activity,
  pediatric_growth_measurement: LineChart,
  eye_exam: Eye,
};

function timelineDescription(event: PatientTimelineEvent) {
  if (event.type !== "consultation_note") {
    return event.description;
  }
  const [summary] = event.description.split(" · status ");
  return summary.trim() || "Consultation note recorded.";
}

function getPhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function patientMetadataLine(patient: Patient) {
  const sexLabel = patient.sex_at_birth
    ? patient.sex_at_birth.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ")
    : "";
  const parts = [
    patient.phone,
    patient.date_of_birth ? `DOB ${patient.date_of_birth}` : typeof patient.age === "number" ? `Age ${patient.age}` : "",
    sexLabel,
    patient.address,
    `last visit ${formatDateTime(patient.last_visit_at)}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function ChartTabButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count?: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium transition ${
        active
          ? "bg-[#2f8fd3] text-white shadow-[0_10px_22px_rgba(47,143,211,0.18)]"
          : "border border-[#bfd7e8] bg-white text-slate-700 hover:bg-[#edf5fa]"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span className={`rounded-lg px-2 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-[#edf5fa] text-slate-500"}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function SummaryField({
  label,
  value,
  readOnly,
  onChange,
  inputMode,
  type = "text",
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  inputMode?: "numeric" | "decimal" | "tel";
  type?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {readOnly ? (
        <p className="mt-1 truncate text-sm font-medium text-slate-900">{value || "—"}</p>
      ) : (
        <input
          value={value}
          type={type}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-[#bfd7e8] bg-[#f7fbfd] px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-[#6daed8] focus:bg-white"
        />
      )}
    </label>
  );
}

function EventSummaryCard({ event }: { event: PatientTimelineEvent }) {
  return (
    <article className="rounded-xl border border-[#dbe7ef] bg-white px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-[#f3f8fb] p-2 ring-1 ring-[#dbe7ef]">
          {getTimelineIcon(event.type)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{getEventTitle(event)}</p>
            <p className="text-xs text-slate-500">{formatDateTime(event.timestamp)}</p>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{timelineDescription(event)}</p>
        </div>
      </div>
    </article>
  );
}

function CollapsibleSection({
  children,
  count,
  description,
  isOpen,
  onToggle,
}: {
  children: ReactNode;
  count?: number;
  description: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="rounded-xl border border-[#dbe7ef] bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h4 className="text-lg font-semibold text-slate-900">{description}</h4>
            {typeof count === "number" ? (
              <span className="rounded-xl border border-[#bfd7e8] bg-[#f3f8fb] px-3 py-1 text-xs font-medium text-slate-600">
                {count}
              </span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-slate-500">
          {isOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>
      {isOpen ? <div className="border-t border-[#dbe7ef] px-6 py-5">{children}</div> : null}
    </section>
  );
}

function VisitDetailPanel({
  detail,
  detailError,
  isLoadingDetail,
  onOpenVisitAttachment,
  openSections,
  selectedVisit,
  toggleSection,
}: {
  detail: PatientVisitDetail | null;
  detailError: string;
  isLoadingDetail: boolean;
  onOpenVisitAttachment: (attachment: PatientVisitAttachmentRow) => void;
  openSections: Record<"note" | "attachments", boolean>;
  selectedVisit: PatientChartVisit | null;
  toggleSection: (section: "note" | "attachments") => void;
}) {
  if (!selectedVisit) {
    return (
      <section className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-6 py-10 text-center text-sm text-slate-500">
        No visits recorded yet.
      </section>
    );
  }

  const attachments = detail?.attachments ?? [];
  const noteContent = detail?.consultation_note?.content?.trim() || "";
  const reason = detail?.reason || selectedVisit.reason || "Recorded visit";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#dbe7ef] bg-white p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Reason</p>
          <h4 className="mt-1 text-lg font-semibold text-slate-900">{reason}</h4>
          {detailError ? <p className="mt-2 text-sm text-rose-600">{detailError}</p> : null}
        </div>
      </section>

      <CollapsibleSection
        description="Consultation note"
        isOpen={openSections.note}
        onToggle={() => toggleSection("note")}
      >
        {isLoadingDetail ? (
          <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-8 text-center text-sm text-slate-500">
            Loading consultation note...
          </div>
        ) : noteContent ? (
          <div className="whitespace-pre-wrap rounded-xl border border-[#dbe7ef] bg-[#f7fbfd] px-4 py-3 text-sm leading-6 text-slate-700">
            {noteContent}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-8 text-center text-sm text-slate-500">
            No consultation note on this visit yet.
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        description="Files and media"
        count={attachments.length}
        isOpen={openSections.attachments}
        onToggle={() => toggleSection("attachments")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {isLoadingDetail ? (
            <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2">
              Loading attachments...
            </div>
          ) : null}
          {!isLoadingDetail ? attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => onOpenVisitAttachment(attachment)}
              className="flex items-center gap-3 rounded-xl border border-[#dbe7ef] bg-[#f7fbfd] p-3 text-left transition hover:border-[#9fc7e1] hover:bg-white"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#dbe7ef] bg-white text-slate-500">
                {attachment.content_type.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{attachment.label}</p>
                <p className="text-xs text-slate-500">{formatDateTime(attachment.timestamp)}</p>
              </div>
            </button>
          )) : null}
          {!isLoadingDetail && !attachments.length ? (
            <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2">
              No attachments on this visit yet.
            </div>
          ) : null}
        </div>
      </CollapsibleSection>
    </div>
  );
}

function TimelinePanel({
  error,
  isLoading,
  timeline,
  fullScreen = false,
}: {
  error: string;
  isLoading: boolean;
  timeline: PatientTimelineEvent[];
  fullScreen?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-10 text-center text-sm text-slate-500">
        Loading timeline...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-4 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!timeline.length) {
    return (
      <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-white px-4 py-10 text-center text-sm text-slate-500">
        No timeline records yet.
      </div>
    );
  }

  if (fullScreen) {
    return (
      <div>
        {timeline.map((event, index) => {
          const meta = timelineMeta(event.type);
          const last = index === timeline.length - 1;
          return (
            <div key={event.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border-[3px] ${meta.node}`} />
                {last ? null : <span className="my-1 w-0.5 flex-1 bg-[#dbe7ef]" />}
              </div>
              <div className="min-w-0 flex-1 pb-2">
                <div className="rounded-[14px] border border-[#dbe7ef] bg-white p-3 shadow-[0_6px_16px_rgba(64,131,181,0.07)]">
                  <span className={`mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] ${meta.kind}`}>{meta.label}</span>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900">{getEventTitle(event)}</span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400">{formatDateTime(event.timestamp)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-slate-500">{timelineDescription(event)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {timeline.map((event) => <EventSummaryCard key={event.id} event={event} />)}
    </div>
  );
}

function GrowthHistoryModal({
  growthHistory,
  onClose,
  open,
}: {
  growthHistory: PediatricGrowthSummary | null;
  onClose: () => void;
  open: boolean;
}) {
  if (!open) {
    return null;
  }
  const records = growthHistory?.records ?? [];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 px-4">
      <div className="w-full max-w-3xl rounded-[20px] border border-[#bfd7e8] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pediatric Growth</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Growth history</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#dbe7ef] p-2 text-slate-500 transition hover:text-slate-800"
            aria-label="Close growth history"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {growthHistory?.trend_summary ? (
          <p className="mt-4 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3 text-sm text-slate-700">
            {growthHistory.trend_summary}
          </p>
        ) : null}
        {records.length ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-[#dbe7ef]">
            <table className="min-w-full border-separate border-spacing-0">
              <thead className="bg-[#f3f8fb]/80">
                <tr className="text-left">
                  <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
                  <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Height</th>
                  <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Weight</th>
                  <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">BMI</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={`${record.measured_at}-${record.height_cm}-${record.weight_kg}`}>
                    <td className="border-b border-[#dbe7ef] px-4 py-3 text-sm text-slate-700">{formatDateTime(record.measured_at)}</td>
                    <td className="border-b border-[#dbe7ef] px-4 py-3 text-sm text-slate-700">{record.height_cm} cm</td>
                    <td className="border-b border-[#dbe7ef] px-4 py-3 text-sm text-slate-700">{record.weight_kg} kg</td>
                    <td className="border-b border-[#dbe7ef] px-4 py-3 text-sm text-slate-700">{record.bmi.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-6 py-10 text-center text-sm text-slate-500">
            No growth readings recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}

function PatientStructuredModuleShell({
  children,
  entries,
  moduleKey,
  onClose,
  onNew,
  onSelectEntry,
  open,
  patient,
  selectedEntryId,
}: {
  children: ReactNode;
  entries: LongitudinalTrackRecord[];
  moduleKey: SpecialtyModuleKey;
  onClose: () => void;
  onNew: () => void;
  onSelectEntry: (entry: LongitudinalTrackRecord) => void;
  open: boolean;
  patient: Patient;
  selectedEntryId: string;
}) {
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="flex max-h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-[18px] border border-slate-300 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">{moduleLabel(moduleKey)}</h3>
            <p className="text-sm text-slate-500">{patient.name} · {patient.phone}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 p-2 text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-b border-slate-200 bg-slate-50 p-4 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">Previous Evaluations</h4>
              <button type="button" onClick={onNew} className="rounded-lg border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-[#f3f8fb]">
                New
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {entries.length ? entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelectEntry(entry)}
                  className={`block w-full rounded-lg border p-3 text-left transition ${
                    selectedEntryId === entry.id
                      ? "border-[#9fc7e1] bg-white shadow-[inset_3px_0_0_#2f8fd3]"
                      : "border-slate-200 bg-white hover:border-[#bfd7e8]"
                  }`}
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
          </aside>

          <div className="min-h-0 overflow-y-auto bg-[#f4f8fb] p-4 sm:p-6">
            <div className="mx-auto w-full max-w-6xl rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-sm">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TestsPanel({
  latestGrowthRecord,
  moduleEntryError,
  moduleEntries,
  modules,
  myopiaError,
  myopiaRecords,
  binocularVisionError,
  binocularVisionEvaluations,
  tbiError,
  tbiEvaluations,
  onOpenBinocularVision,
  onOpenContactLens,
  onOpenEyeExam,
  onOpenGrowthHistory,
  onOpenLowVision,
  onOpenMyopiaManagement,
  onOpenTbiEvaluation,
  fullScreen = false,
}: {
  latestGrowthRecord: PediatricGrowthSummary["records"][number] | null;
  moduleEntryError: string;
  moduleEntries: LongitudinalTrackRecord[];
  modules: SpecialtyModuleKey[];
  myopiaError: string;
  myopiaRecords: MyopiaHistory["records"];
  binocularVisionError: string;
  binocularVisionEvaluations: BinocularVisionEvaluationRecord[];
  tbiError: string;
  tbiEvaluations: TbiEvaluationRecord[];
  onOpenBinocularVision: () => void;
  onOpenContactLens: () => void;
  onOpenEyeExam: () => void;
  onOpenGrowthHistory: () => void;
  onOpenLowVision: () => void;
  onOpenMyopiaManagement: () => void;
  onOpenTbiEvaluation: () => void;
  fullScreen?: boolean;
}) {
  const latestMyopiaRecord = myopiaRecords[myopiaRecords.length - 1] ?? null;
  const latestTbiEvaluation = tbiEvaluations[tbiEvaluations.length - 1] ?? null;
  const latestBinocularVisionEvaluation = binocularVisionEvaluations[binocularVisionEvaluations.length - 1] ?? null;
  const entriesByModule = moduleEntries.reduce<Record<string, LongitudinalTrackRecord[]>>((grouped, entry) => {
    grouped[entry.track_type] = [...(grouped[entry.track_type] ?? []), entry];
    return grouped;
  }, {});
  const structuredOpeners: Partial<Record<SpecialtyModuleKey, () => void>> = {
    eye_exam: onOpenEyeExam,
    contact_lens: onOpenContactLens,
    binocular_vision: onOpenBinocularVision,
    low_vision: onOpenLowVision,
  };
  const rows = modules.map((moduleKey) => {
    const latestGenericEntry = entriesByModule[moduleKey]?.at(-1) ?? null;
    if (moduleKey === "myopia_management") {
      return {
        key: moduleKey,
        label: moduleLabel(moduleKey),
        date: latestMyopiaRecord ? formatDateTime(latestMyopiaRecord.measured_at) : "—",
        count: myopiaRecords.length,
        error: myopiaError,
        open: onOpenMyopiaManagement,
      };
    }
    if (moduleKey === "tbi_evaluation") {
      return {
        key: moduleKey,
        label: moduleLabel(moduleKey),
        date: latestTbiEvaluation ? formatDateTime(latestTbiEvaluation.measured_at || latestTbiEvaluation.created_at) : "—",
        count: tbiEvaluations.length,
        error: tbiError,
        open: onOpenTbiEvaluation,
      };
    }
    if (moduleKey === "binocular_vision") {
      return {
        key: moduleKey,
        label: moduleLabel(moduleKey),
        date: latestBinocularVisionEvaluation ? formatDateTime(latestBinocularVisionEvaluation.measured_at || latestBinocularVisionEvaluation.created_at) : "—",
        count: binocularVisionEvaluations.length,
        error: binocularVisionError,
        open: onOpenBinocularVision,
      };
    }
    if (moduleKey === "pediatric_growth_measurement") {
      return {
        key: moduleKey,
        label: moduleLabel(moduleKey),
        date: latestGrowthRecord ? formatDateTime(latestGrowthRecord.measured_at) : "—",
        count: latestGrowthRecord ? undefined : 0,
        error: "",
        open: onOpenGrowthHistory,
      };
    }
    return {
      key: moduleKey,
      label: moduleLabel(moduleKey),
      date: latestGenericEntry ? formatDateTime(latestGenericEntry.measured_at) : "—",
      count: entriesByModule[moduleKey]?.length ?? 0,
      error: "",
      open: structuredOpeners[moduleKey] ?? (() => {}),
    };
  });

  function handleOpen(row: typeof rows[number]) {
    row.open();
  }

  if (fullScreen) {
    if (!rows.length) {
      return (
        <div className="rounded-[16px] border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-6 py-10 text-center text-sm text-slate-500">
          No tests available for this specialty yet.
        </div>
      );
    }
    return (
      <div>
        {moduleEntryError ? (
          <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-700">
            Saved module dates could not be loaded. Restart the backend if this just changed.
          </p>
        ) : null}
        <div className="overflow-hidden rounded-[16px] border border-[#dbe7ef] bg-white">
          {rows.map((row) => {
            const Icon = MODULE_ICON[row.key] ?? ClipboardList;
            const subline = row.error
              ? row.error
              : typeof row.count === "number"
                ? row.count
                  ? `${row.count} record${row.count === 1 ? "" : "s"}`
                  : "No records yet"
                : row.date !== "—"
                  ? "Recorded"
                  : "No records yet";
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => handleOpen(row)}
                className="flex w-full items-center gap-3 border-b border-[#dbe7ef] bg-white px-4 py-3.5 text-left transition last:border-b-0 hover:bg-[#f7fbfd]"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-[#dbe7ef] bg-[#f3f8fb] text-[#2f8fd3]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{row.label}</span>
                  <span className={`mt-0.5 block text-xs ${row.error ? "text-rose-600" : "text-slate-400"}`}>{subline}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-slate-500">{row.date}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-[#dbe7ef] bg-white">
      {rows.length ? (
        <div className="overflow-x-auto">
          {moduleEntryError ? (
            <p className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-medium text-amber-700">
              Saved module dates could not be loaded. Restart the backend if this just changed.
            </p>
          ) : null}
          <table className="min-w-full border-separate border-spacing-0">
            <thead className="bg-[#f3f8fb]/80">
              <tr className="text-left">
                <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Type</th>
                <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  onClick={() => handleOpen(row)}
                  className="cursor-pointer transition hover:bg-[#f3f8fb]/70"
                >
                  <td className="border-b border-[#dbe7ef] px-4 py-3.5 text-sm font-semibold text-slate-900">
                    {row.label}
                    {row.error ? <p className="mt-1 text-xs font-medium text-rose-600">{row.error}</p> : null}
                  </td>
                  <td className="border-b border-[#dbe7ef] px-4 py-3.5 text-sm text-slate-600">{row.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-6 py-10 text-center text-sm text-slate-500">
          No tests available for this specialty yet.
        </div>
      )}
    </section>
  );
}

function AttachmentsPanel({
  attachmentError,
  isLoading,
  isDeletingAttachmentId,
  isSendingAttachmentId,
  isUploadingAttachment,
  noteAssets,
  onDeletePatientAttachment,
  onPatientAttachmentFileChange,
  onOpenPatientAttachment,
  onOpenLinkedAttachment,
  onOpenNoteImage,
  onStartSendAttachment,
  patientAttachments,
}: {
  attachmentError: string;
  isLoading: boolean;
  isDeletingAttachmentId: string;
  isSendingAttachmentId: string;
  isUploadingAttachment: boolean;
  noteAssets: Array<NoteAsset & { note_id: string; note_created_at: string }>;
  onDeletePatientAttachment: (attachment: PatientAttachment) => Promise<void>;
  onPatientAttachmentFileChange: (file: File | null) => Promise<void>;
  onOpenPatientAttachment: (attachment: PatientAttachment) => void;
  onOpenLinkedAttachment: (attachmentId: string, label: string, contentType: string, timestamp: string) => void;
  onOpenNoteImage: (asset: NoteAsset) => void;
  onStartSendAttachment: (attachment: Pick<PatientAttachment, "id" | "file_name" | "content_type">) => void;
  patientAttachments: PatientAttachment[];
}) {
  const noteRows: AttachmentPanelNoteRow[] = [
    ...noteAssets.map((asset) => ({
      id: `note-${asset.note_id}-${asset.id}`,
      label: asset.name,
      timestamp: asset.note_created_at,
      attachmentId: asset.attachment_id,
      contentType: asset.content_type,
      open: () => {
        if (asset.attachment_id) {
          onOpenLinkedAttachment(asset.attachment_id, asset.name, asset.content_type, asset.note_created_at);
          return;
        }
        if (isImageContentType(asset.content_type) && asset.data_base64) {
          onOpenNoteImage(asset);
          return;
        }
        openNoteAttachmentViewer(asset);
      },
    })),
  ];
  const noteAttachmentIds = new Set(noteAssets.map((asset) => asset.attachment_id).filter(Boolean));
  const patientRows: AttachmentPanelPatientRow[] = patientAttachments
    .filter((attachment) => !noteAttachmentIds.has(attachment.id))
    .map((attachment) => ({
      id: `patient-${attachment.id}`,
      label: attachment.file_name,
      timestamp: attachment.created_at,
      fileSize: attachment.file_size,
      kind: "patient_attachment" as const,
      attachment,
      open: () => onOpenPatientAttachment(attachment),
    }));
  const rows: Array<AttachmentPanelNoteRow | AttachmentPanelPatientRow> = [...noteRows, ...patientRows]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());

  return (
    <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Attachments</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb]">
          <Upload className="h-4 w-4" />
          {isUploadingAttachment ? "Uploading..." : "Upload"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.pdf,.mp4,.mov,.webm"
            className="hidden"
            disabled={isUploadingAttachment}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void onPatientAttachmentFileChange(file).finally(() => {
                event.target.value = "";
              });
            }}
          />
        </label>
      </div>
      {isLoading ? <div className="flex justify-end"><span className="text-xs text-slate-500">Loading...</span></div> : null}
      {attachmentError ? <p className="mt-3 text-sm text-rose-600">{attachmentError}</p> : null}
      <div className={`${attachmentError || isLoading ? "mt-4" : ""} divide-y divide-[#edf3f8]`}>
        {rows.length ? (
          rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-4 py-3">
              <button
                type="button"
                onClick={row.open}
                className="min-w-0 flex-1 text-left transition hover:text-[#2f8fd3]"
              >
                <p className="truncate text-sm font-medium text-slate-900">{row.label}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDateTime(row.timestamp)}
                  {isAttachmentPanelPatientRow(row) ? ` · ${formatFileSize(row.fileSize)}` : ""}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {isAttachmentPanelPatientRow(row) || row.attachmentId ? (
                  <button
                    type="button"
                    disabled={isSendingAttachmentId === (isAttachmentPanelPatientRow(row) ? row.attachment.id : row.attachmentId)}
                    onClick={() => {
                      const attachmentId = isAttachmentPanelPatientRow(row) ? row.attachment.id : row.attachmentId;
                      if (!attachmentId) return;
                      onStartSendAttachment({
                        id: attachmentId,
                        file_name: row.label,
                        content_type: isAttachmentPanelPatientRow(row) ? row.attachment.content_type : "",
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#9fc7e1] bg-white px-3 py-1.5 text-xs font-medium text-[#235f8e] transition hover:bg-[#f3f8fb] disabled:opacity-60"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {isSendingAttachmentId === (isAttachmentPanelPatientRow(row) ? row.attachment.id : row.attachmentId) ? "Sending..." : "Send"}
                  </button>
                ) : null}
                {isAttachmentPanelPatientRow(row) ? (
                  <button
                    type="button"
                    disabled={isDeletingAttachmentId === row.attachment.id}
                    onClick={() => void onDeletePatientAttachment(row.attachment)}
                    className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                  >
                    {isDeletingAttachmentId === row.attachment.id ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-sm text-slate-500">No attachments yet.</div>
        )}
      </div>
    </section>
  );
}

export function PatientDetailsDrawer({
  patient,
  clinicSpecialty = null,
  workflowActionLabel = null,
  workflowActionDisabled = false,
  onWorkflowAction = null,
  onClose,
  onLoadVisits,
  onLoadVisitDetail,
  onLoadTimeline,
  onLoadMyopiaHistory,
  onLoadGrowthHistory,
  isTrainingMode = false,
  readOnly = false,
  fullScreen = false,
  fullScreenBackLabel = "Patients",
  onPatientUpdated,
  onSave,
}: PatientDetailsDrawerProps) {
  const hasMyopiaManagement = specialtyHasModule(clinicSpecialty, "myopia_management");
  const hasTbiEvaluation = specialtyHasModule(clinicSpecialty, "tbi_evaluation");
  const hasBinocularVision = specialtyHasModule(clinicSpecialty, "binocular_vision");
  const hasGrowthMeasurement = specialtyHasModule(clinicSpecialty, "pediatric_growth_measurement");
  const specialtyModules = getSpecialtyModules(clinicSpecialty);
  const [activeTab, setActiveTab] = useState<ChartTab>("visits");
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false);
  const [isEditingPatient, setIsEditingPatient] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    reason: "",
    dateOfBirth: "",
    sexAtBirth: "" as "" | SexAtBirth,
    genderIdentity: "",
    weight: "",
    height: "",
    temperature: "",
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [visits, setVisits] = useState<PatientChartVisit[]>([]);
  const [isVisitsLoading, setIsVisitsLoading] = useState(false);
  const [visitsError, setVisitsError] = useState("");
  const [visitDetailsById, setVisitDetailsById] = useState<Record<string, PatientVisitDetail>>({});
  const [visitDetailError, setVisitDetailError] = useState("");
  const [loadingVisitDetailId, setLoadingVisitDetailId] = useState("");
  const [notes, setNotes] = useState<ConsultationNote[]>([]);
  const [patientAttachments, setPatientAttachments] = useState<PatientAttachment[]>([]);
  const [isAttachmentsLoading, setIsAttachmentsLoading] = useState(false);
  const [isDeletingAttachmentId, setIsDeletingAttachmentId] = useState("");
  const [isSendingAttachmentId, setIsSendingAttachmentId] = useState("");
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isUploadingProfilePhoto, setIsUploadingProfilePhoto] = useState(false);
  const [profilePhotoVersion, setProfilePhotoVersion] = useState(0);
  const [profilePhotoObjectUrl, setProfilePhotoObjectUrl] = useState("");
  const [isProfilePhotoManagerOpen, setIsProfilePhotoManagerOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<PhotoPreview | null>(null);
  const [attachmentSendDraft, setAttachmentSendDraft] = useState<{
    attachmentId: string;
    fileName: string;
    recipientEmail: string;
    subject: string;
    message: string;
  } | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [myopiaHistory, setMyopiaHistory] = useState<MyopiaHistory | null>(null);
  const [growthHistory, setGrowthHistory] = useState<PediatricGrowthSummary | null>(null);
  const [moduleEntries, setModuleEntries] = useState<LongitudinalTrackRecord[]>([]);
  const [tbiEvaluations, setTbiEvaluations] = useState<TbiEvaluationRecord[]>([]);
  const [binocularVisionEvaluations, setBinocularVisionEvaluations] = useState<BinocularVisionEvaluationRecord[]>([]);
  const [eyeExam, setEyeExam] = useState<EyeExamPayload>(createEmptyEyeExam);
  const [contactLens, setContactLens] = useState<ContactLensPayload>(createEmptyContactLens);
  const [lowVision, setLowVision] = useState<LowVisionPayload>(createEmptyLowVision);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [isMyopiaLoading, setIsMyopiaLoading] = useState(false);
  const [myopiaError, setMyopiaError] = useState("");
  const [isTbiLoading, setIsTbiLoading] = useState(false);
  const [tbiError, setTbiError] = useState("");
  const [isBinocularVisionLoading, setIsBinocularVisionLoading] = useState(false);
  const [binocularVisionError, setBinocularVisionError] = useState("");
  const [moduleEntryError, setModuleEntryError] = useState("");
  const [patientTimeline, setPatientTimeline] = useState<PatientTimelineEvent[]>([]);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [hasLoadedAttachmentsTab, setHasLoadedAttachmentsTab] = useState(false);
  const [hasLoadedTestsTab, setHasLoadedTestsTab] = useState(false);
  const [hasLoadedTimelineTab, setHasLoadedTimelineTab] = useState(false);
  const [isHistoricalMyopiaOpen, setIsHistoricalMyopiaOpen] = useState(false);
  const [isMyopiaManagementOpen, setIsMyopiaManagementOpen] = useState(false);
  const [isTbiEvaluationOpen, setIsTbiEvaluationOpen] = useState(false);
  const [isGrowthHistoryOpen, setIsGrowthHistoryOpen] = useState(false);
  const [isEyeExamOpen, setIsEyeExamOpen] = useState(false);
  const [isContactLensOpen, setIsContactLensOpen] = useState(false);
  const [isBinocularVisionOpen, setIsBinocularVisionOpen] = useState(false);
  const [isLowVisionOpen, setIsLowVisionOpen] = useState(false);
  const [selectedEyeExamEntryId, setSelectedEyeExamEntryId] = useState("");
  const [selectedContactLensEntryId, setSelectedContactLensEntryId] = useState("");
  const [selectedLowVisionEntryId, setSelectedLowVisionEntryId] = useState("");
  const [genericModuleEntryError, setGenericModuleEntryError] = useState("");
  const [openVisitSections, setOpenVisitSections] = useState<Record<"note" | "attachments", boolean>>({
    note: false,
    attachments: false,
  });
  const [selectedVisitId, setSelectedVisitId] = useState("");
  const [currentPatient, setCurrentPatient] = useState<Patient | null>(patient);
  const [aiSummary, setAiSummary] = useState<PatientSummary | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const onLoadVisitsRef = useRef(onLoadVisits);
  const onLoadVisitDetailRef = useRef(onLoadVisitDetail);
  const onLoadTimelineRef = useRef(onLoadTimeline);
  const visitsPatientId = patient?.id ?? "";
  onLoadVisitsRef.current = onLoadVisits;
  onLoadVisitDetailRef.current = onLoadVisitDetail;
  onLoadTimelineRef.current = onLoadTimeline;

  useEffect(() => {
    setOpenVisitSections({ note: false, attachments: false });
  }, [selectedVisitId]);

  useEffect(() => {
    if (!currentPatient?.profile_photo_url) {
      setProfilePhotoObjectUrl("");
      return;
    }

    let active = true;
    let objectUrl = "";

    api.getPatientProfilePhoto(currentPatient.id)
      .then((blob) => {
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setProfilePhotoObjectUrl(objectUrl);
      })
      .catch(() => {
        if (active) {
          setProfilePhotoObjectUrl("");
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [
    currentPatient?.id,
    currentPatient?.profile_photo_url,
    currentPatient?.profile_photo_updated_at,
    profilePhotoVersion,
  ]);

  useEffect(() => {
    if (!patient) {
      setCurrentPatient(null);
      return;
    }

    setCurrentPatient(patient);
    setProfilePhotoVersion(0);
    setForm({
      name: patient.name,
      phone: patient.phone,
      email: patient.email ?? "",
      address: patient.address ?? "",
      reason: patient.reason,
      dateOfBirth: patient.date_of_birth ?? "",
      sexAtBirth: patient.sex_at_birth ?? "",
      genderIdentity: patient.gender_identity ?? "",
      weight: patient.weight?.toString() ?? "",
      height: patient.height?.toString() ?? "",
      temperature: patient.temperature?.toString() ?? "",
    });
    setActiveTab("visits");
    setIsEditingPatient(false);
    setError("");
    setVisits([]);
    setIsVisitsLoading(false);
    setVisitsError("");
    setVisitDetailsById({});
    setVisitDetailError("");
    setLoadingVisitDetailId("");
    setNotes([]);
    setPatientAttachments([]);
    setAttachmentError("");
    setAttachmentSendDraft(null);
    setIsProfilePhotoManagerOpen(false);
    setPhotoPreview((current) => {
      if (current?.revokeOnClose && current.src.startsWith("blob:")) {
        URL.revokeObjectURL(current.src);
      }
      return null;
    });
    setIsSendingAttachmentId("");
    setIsAttachmentsLoading(false);
    setHasLoadedAttachmentsTab(false);
    setMyopiaHistory(null);
    setGrowthHistory(null);
    setTbiEvaluations([]);
    setBinocularVisionEvaluations([]);
    setMyopiaError("");
    setTbiError("");
    setBinocularVisionError("");
    setIsMyopiaLoading(false);
    setIsTbiLoading(false);
    setIsBinocularVisionLoading(false);
    setHasLoadedTestsTab(false);
    setPatientTimeline([]);
    setTimelineError("");
    setIsTimelineLoading(false);
    setHasLoadedTimelineTab(false);
    setSelectedVisitId("");
    setAiSummary(null);
    setSummaryError("");
    setIsSummaryLoading(false);
    setIsTbiEvaluationOpen(false);
    setIsBinocularVisionOpen(false);
  }, [patient]);

  useEffect(() => {
    if (!patient || isTrainingMode) {
      return;
    }
    const patientId = patient.id;
    let active = true;
    async function loadSummary() {
      setIsSummaryLoading(true);
      setSummaryError("");
      try {
        const result = await api.getPatientSummary(patientId);
        if (active) {
          setAiSummary(result);
        }
      } catch (loadError) {
        if (active) {
          const message =
            loadError instanceof Error ? loadError.message : "Failed to load summary.";
          setSummaryError(message);
        }
      } finally {
        if (active) {
          setIsSummaryLoading(false);
        }
      }
    }
    void loadSummary();
    return () => {
      active = false;
    };
  }, [patient, isTrainingMode]);

  useEffect(() => {
    if (!visitsPatientId) {
      setVisits([]);
      setIsVisitsLoading(false);
      setVisitsError("");
      setVisitDetailsById({});
      setVisitDetailError("");
      setLoadingVisitDetailId("");
      setSelectedVisitId("");
      return;
    }

    let active = true;

    async function loadVisits() {
      setIsVisitsLoading(true);
      setVisitsError("");
      try {
        const rows = await onLoadVisitsRef.current(visitsPatientId);
        if (!active) {
          return;
        }
        setVisits(rows);
        setSelectedVisitId(rows[0]?.id ?? "");
      } catch (loadError) {
        if (!active) {
          return;
        }
        setVisits([]);
        const message = loadError instanceof Error ? loadError.message : "Failed to load visits.";
        setVisitsError(message);
        setSelectedVisitId("");
      } finally {
        if (active) {
          setIsVisitsLoading(false);
        }
      }
    }

    void loadVisits();
    return () => {
      active = false;
    };
  }, [visitsPatientId]);

  useEffect(() => {
    if (!patient || !selectedVisitId || visitDetailsById[selectedVisitId]) {
      return;
    }

    const patientId = patient.id;
    let active = true;

    async function loadVisitDetail() {
      setLoadingVisitDetailId(selectedVisitId);
      setVisitDetailError("");
      try {
        const detail = await onLoadVisitDetailRef.current(patientId, selectedVisitId);
        if (!active) {
          return;
        }
        setVisitDetailsById((current) => ({ ...current, [selectedVisitId]: detail }));
      } catch (loadError) {
        if (!active) {
          return;
        }
        setVisitDetailError(loadError instanceof Error ? loadError.message : "Failed to load visit detail.");
      } finally {
        if (active) {
          setLoadingVisitDetailId((current) => (current === selectedVisitId ? "" : current));
        }
      }
    }

    void loadVisitDetail();
    return () => {
      active = false;
    };
  }, [patient, selectedVisitId, visitDetailsById]);

  useEffect(() => {
    if (!patient || activeTab !== "attachments" || hasLoadedAttachmentsTab) {
      return;
    }

    const patientId = patient.id;
    let active = true;

    async function loadAttachments() {
      setIsAttachmentsLoading(true);
      setAttachmentError("");
      try {
        const [noteRows, attachmentRows] = isTrainingMode
          ? [[], []] as [ConsultationNote[], PatientAttachment[]]
          : await Promise.all([
              api.listPatientNotes(patientId),
              api.listPatientAttachments(patientId),
            ]);
        if (!active) {
          return;
        }
        setNotes(noteRows);
        setPatientAttachments(attachmentRows);
        setHasLoadedAttachmentsTab(true);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setNotes([]);
        setPatientAttachments([]);
        setAttachmentError(loadError instanceof Error ? loadError.message : "Failed to load attachments.");
      } finally {
        if (active) {
          setIsAttachmentsLoading(false);
        }
      }
    }

    void loadAttachments();
    return () => {
      active = false;
    };
  }, [activeTab, hasLoadedAttachmentsTab, isTrainingMode, patient]);

  useEffect(() => {
    if (!patient || activeTab !== "tests" || hasLoadedTestsTab) {
      return;
    }

    const patientId = patient.id;
    let active = true;

    async function loadTests() {
      setIsMyopiaLoading(hasMyopiaManagement);
      setIsTbiLoading(hasTbiEvaluation);
      setIsBinocularVisionLoading(hasBinocularVision);
      setMyopiaError("");
      setTbiError("");
      setBinocularVisionError("");
      setModuleEntryError("");
      try {
        const emptyMyopiaHistory = {
          patient_id: patientId,
          records: [],
          baseline_delta: null,
          last_delta: null,
          annualized_growth: null,
          overlay_version: "clinic-reference-v1",
        } satisfies MyopiaHistory;
        const emptyGrowthHistory = {
          patient_id: patientId,
          latest_measurement: null,
          previous_measurement: null,
          interval_change: null,
          trend_summary: "",
          flags: [],
          records: [],
        } satisfies PediatricGrowthSummary;
        const [nextMyopiaHistory, nextGrowthHistory, nextTbiEvaluations, nextBinocularVisionEvaluations, nextModuleEntries] = await Promise.allSettled([
          hasMyopiaManagement && onLoadMyopiaHistory ? onLoadMyopiaHistory(patientId) : Promise.resolve(emptyMyopiaHistory),
          hasGrowthMeasurement && onLoadGrowthHistory ? onLoadGrowthHistory(patientId) : Promise.resolve(emptyGrowthHistory),
          hasTbiEvaluation && !isTrainingMode ? api.listPatientTbiEvaluations(patientId) : Promise.resolve([] as TbiEvaluationRecord[]),
          hasBinocularVision && !isTrainingMode ? api.listPatientBinocularVisionEvaluations(patientId) : Promise.resolve([] as BinocularVisionEvaluationRecord[]),
          isTrainingMode ? Promise.resolve([] as LongitudinalTrackRecord[]) : api.listPatientModuleEntries(patientId),
        ]);
        if (!active) {
          return;
        }
        if (nextMyopiaHistory.status === "fulfilled") {
          setMyopiaHistory(nextMyopiaHistory.value);
        } else {
          setMyopiaHistory(emptyMyopiaHistory);
          setMyopiaError(nextMyopiaHistory.reason instanceof Error ? nextMyopiaHistory.reason.message : "Failed to load myopia history.");
        }
        if (nextGrowthHistory.status === "fulfilled") {
          setGrowthHistory(nextGrowthHistory.value);
        } else {
          setGrowthHistory(emptyGrowthHistory);
        }
        if (nextTbiEvaluations.status === "fulfilled") {
          setTbiEvaluations(nextTbiEvaluations.value);
        } else {
          setTbiEvaluations([]);
          setTbiError(nextTbiEvaluations.reason instanceof Error ? nextTbiEvaluations.reason.message : "Failed to load TBI evaluations.");
        }
        if (nextBinocularVisionEvaluations.status === "fulfilled") {
          setBinocularVisionEvaluations(nextBinocularVisionEvaluations.value);
        } else {
          setBinocularVisionEvaluations([]);
          setBinocularVisionError(nextBinocularVisionEvaluations.reason instanceof Error ? nextBinocularVisionEvaluations.reason.message : "Failed to load binocular vision evaluations.");
        }
        if (nextModuleEntries.status === "fulfilled") {
          setModuleEntries(nextModuleEntries.value);
        } else {
          setModuleEntries([]);
          setModuleEntryError(nextModuleEntries.reason instanceof Error ? nextModuleEntries.reason.message : "Failed to load module entries.");
        }
        setHasLoadedTestsTab(true);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setMyopiaHistory(null);
        setGrowthHistory(null);
        setModuleEntries([]);
        setTbiEvaluations([]);
        setBinocularVisionEvaluations([]);
        setMyopiaError(loadError instanceof Error ? loadError.message : "Failed to load tests.");
        setTbiError(loadError instanceof Error ? loadError.message : "Failed to load TBI evaluations.");
        setBinocularVisionError(loadError instanceof Error ? loadError.message : "Failed to load binocular vision evaluations.");
      } finally {
        if (active) {
          setIsMyopiaLoading(false);
          setIsTbiLoading(false);
          setIsBinocularVisionLoading(false);
        }
      }
    }

    void loadTests();
    return () => {
      active = false;
    };
  }, [activeTab, hasBinocularVision, hasGrowthMeasurement, hasLoadedTestsTab, hasMyopiaManagement, hasTbiEvaluation, isTrainingMode, onLoadGrowthHistory, onLoadMyopiaHistory, patient]);

  useEffect(() => {
    if (!patient || activeTab !== "timeline" || hasLoadedTimelineTab) {
      return;
    }

    const patientId = patient.id;
    let active = true;

    async function loadTimeline() {
      setIsTimelineLoading(true);
      setTimelineError("");
      try {
        const rows = await onLoadTimelineRef.current(patientId);
        if (!active) {
          return;
        }
        setPatientTimeline(rows);
        setHasLoadedTimelineTab(true);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setPatientTimeline([]);
        setTimelineError(loadError instanceof Error ? loadError.message : "Failed to load timeline.");
      } finally {
        if (active) {
          setIsTimelineLoading(false);
        }
      }
    }

    void loadTimeline();
    return () => {
      active = false;
    };
  }, [activeTab, hasLoadedTimelineTab, patient]);

  const noteAssets = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<NoteAsset & { note_id: string; note_created_at: string }> = [];
    for (const note of notes) {
      const assets = note.snapshot_asset_payload?.length ? note.snapshot_asset_payload : note.asset_payload || [];
      for (const asset of assets) {
        if (asset.kind === "attachment") {
          const key = noteAttachmentKey(asset);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          rows.push({ ...asset, note_id: note.id, note_created_at: note.finalized_at || note.created_at });
        }
      }
    }
    return rows;
  }, [notes]);

  if (!currentPatient) {
    return null;
  }

  const selectedVisit = visits.find((visit) => visit.id === selectedVisitId) ?? visits[0] ?? null;
  const selectedVisitDetail = selectedVisit ? visitDetailsById[selectedVisit.id] ?? null : null;
  const myopiaRecords = myopiaHistory?.records ?? [];
  const growthRecords = growthHistory?.records ?? [];
  const latestGrowthRecord = growthRecords[growthRecords.length - 1] ?? null;
  const eyeExamEntries = moduleEntriesFor(moduleEntries, "eye_exam");
  const contactLensEntries = moduleEntriesFor(moduleEntries, "contact_lens");
  const lowVisionEntries = moduleEntriesFor(moduleEntries, "low_vision");

  function toggleVisitSection(section: "note" | "attachments") {
    setOpenVisitSections((current) => ({ ...current, [section]: !current[section] }));
  }

  async function handleSaveHistoricalMyopia(payload: MyopiaMeasurementPayload) {
    if (!currentPatient) {
      return;
    }
    const patientId = currentPatient.id;
    setIsMyopiaLoading(true);
    setMyopiaError("");
    try {
      if (isTrainingMode) {
        const saved = {
          ...payload,
          id: createTrainingId("myopia"),
          org_id: "training",
          patient_id: patientId,
          created_at: new Date().toISOString(),
        };
        setMyopiaHistory((current) => ({
          patient_id: patientId,
          records: [...(current?.records ?? []), saved],
          baseline_delta: current?.baseline_delta ?? null,
          last_delta: current?.last_delta ?? null,
          annualized_growth: current?.annualized_growth ?? null,
          overlay_version: current?.overlay_version ?? "training",
        }));
        setHasLoadedTestsTab(true);
        setActiveTab("tests");
        return;
      }
      await api.createPatientMyopiaRecord(patientId, payload);
      if (onLoadMyopiaHistory) {
        setMyopiaHistory(await onLoadMyopiaHistory(patientId));
      }
      setHasLoadedTestsTab(true);
      setActiveTab("tests");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save historical myopia data.";
      setMyopiaError(message);
      throw saveError;
    } finally {
      setIsMyopiaLoading(false);
    }
  }

  async function handleSaveTbiEvaluation(payload: TbiEvaluationCreatePayload) {
    if (!currentPatient) {
      return;
    }
    const patientId = currentPatient.id;
    setIsTbiLoading(true);
    setTbiError("");
    try {
      if (isTrainingMode) {
        const saved: TbiEvaluationRecord = {
          id: createTrainingId("tbi"),
          org_id: "training",
          patient_id: patientId,
          measured_at: payload.measured_at,
          payload: payload.payload,
          summary_fields: { summary: "Neurovision / TBI evaluation saved." },
          created_at: new Date().toISOString(),
        };
        setTbiEvaluations((current) => [...current, saved]);
        setHasLoadedTestsTab(true);
        setActiveTab("tests");
        return;
      }
      const saved = await api.createPatientTbiEvaluation(patientId, payload);
      setTbiEvaluations((current) => [...current.filter((record) => record.id !== saved.id), saved]);
      setHasLoadedTimelineTab(false);
      setPatientTimeline([]);
      setHasLoadedTestsTab(true);
      setActiveTab("tests");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save TBI evaluation.";
      setTbiError(message);
      throw saveError;
    } finally {
      setIsTbiLoading(false);
    }
  }

  function updateEyeExam(section: EyeExamSection, row: EyeExamRow, patch: Partial<EyeExamEntry>) {
    setEyeExam((current) => ({
      ...current,
      [section]: current[section].map((entry) => (entry.eye === row ? { ...entry, ...patch } : entry)),
    }));
  }

  function updateContactLens(patch: Partial<ContactLensPayload>) {
    setContactLens((current) => ({ ...current, ...patch }));
  }

  function updateContactLensEye(eye: "right" | "left", patch: Partial<ContactLensEyeEntry>) {
    setContactLens((current) => ({
      ...current,
      eyes: current.eyes.map((entry) => (entry.eye === eye ? { ...entry, ...patch } : entry)),
    }));
  }

  function startNewStructuredModule(moduleKey: SpecialtyModuleKey) {
    if (moduleKey === "eye_exam") {
      setEyeExam(createEmptyEyeExam());
      setSelectedEyeExamEntryId("");
    } else if (moduleKey === "contact_lens") {
      setContactLens(createEmptyContactLens());
      setSelectedContactLensEntryId("");
    } else if (moduleKey === "low_vision") {
      setLowVision(createEmptyLowVision());
      setSelectedLowVisionEntryId("");
    }
  }

  function selectEyeExamEntry(entry: LongitudinalTrackRecord) {
    setEyeExam(normalizeEyeExamPayload(entry.raw_payload));
    setSelectedEyeExamEntryId(entry.id);
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
    setContactLens(nextContactLens);
    setSelectedContactLensEntryId(entry.id);
  }

  function selectLowVisionEntry(entry: LongitudinalTrackRecord) {
    setLowVision({ ...createEmptyLowVision(), ...(entry.raw_payload as Partial<LowVisionPayload>) });
    setSelectedLowVisionEntryId(entry.id);
  }

  async function saveStructuredModuleEntry(
    moduleKey: SpecialtyModuleKey,
    payload: Record<string, unknown>,
    summary: string,
  ) {
    if (!currentPatient) {
      return;
    }
    const patientId = currentPatient.id;
    const measuredAtIso = new Date().toISOString();
    setGenericModuleEntryError("");
    try {
      let saved: LongitudinalTrackRecord;
      if (isTrainingMode) {
        saved = {
          id: createTrainingId("module"),
          org_id: "training",
          patient_id: patientId,
          track_type: moduleKey,
          measured_at: measuredAtIso,
          summary_fields: { summary },
          raw_payload: payload,
          derived_metrics: {},
          created_at: new Date().toISOString(),
        };
        setModuleEntries((current) => [...current, saved]);
      } else {
        saved = await api.createPatientModuleEntry(patientId, {
          track_type: moduleKey,
          measured_at: measuredAtIso,
          summary_fields: { summary },
          raw_payload: payload,
          derived_metrics: {},
        });
        setModuleEntries((current) => [...current.filter((entry) => entry.id !== saved.id), saved]);
      }
      setModuleEntryError("");
      setHasLoadedTimelineTab(false);
      setPatientTimeline([]);
      setHasLoadedTestsTab(true);
      setActiveTab("tests");
      return saved;
    } catch (saveError) {
      setGenericModuleEntryError(saveError instanceof Error ? saveError.message : "Failed to save entry.");
      throw saveError;
    }
  }

  async function handleSaveEyeExam() {
    if (!hasEyeExamData(eyeExam)) {
      setGenericModuleEntryError("Enter eye exam values before saving.");
      return;
    }
    const saved = await saveStructuredModuleEntry(
      "eye_exam",
      eyeExam as unknown as Record<string, unknown>,
      buildEyeExamSummary(eyeExam),
    );
    if (saved) {
      setSelectedEyeExamEntryId(saved.id);
    }
  }

  async function handleSaveContactLens() {
    const saved = await saveStructuredModuleEntry(
      "contact_lens",
      {
        ...contactLens,
        eyes: contactLens.eyes.filter((entry) => hasContactLensEyeData(entry)),
      },
      "Contact lens details saved.",
    );
    if (saved) {
      setSelectedContactLensEntryId(saved.id);
    }
  }

  async function handleSaveBinocularVisionEvaluation(payload: BinocularVisionEvaluationCreatePayload) {
    if (!currentPatient) {
      return;
    }
    const patientId = currentPatient.id;
    setIsBinocularVisionLoading(true);
    setBinocularVisionError("");
    try {
      if (isTrainingMode) {
        const saved: BinocularVisionEvaluationRecord = {
          id: createTrainingId("binocular-vision"),
          org_id: "training",
          patient_id: patientId,
          measured_at: payload.measured_at,
          payload: payload.payload,
          summary_fields: { summary: buildBinocularVisionSummary(payload.payload) },
          created_at: new Date().toISOString(),
        };
        setBinocularVisionEvaluations((current) => [...current, saved]);
      } else {
        const saved = await api.createPatientBinocularVisionEvaluation(patientId, payload);
        setBinocularVisionEvaluations((current) => [...current.filter((record) => record.id !== saved.id), saved]);
      }
      setHasLoadedTimelineTab(false);
      setPatientTimeline([]);
      setHasLoadedTestsTab(true);
      setActiveTab("tests");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save binocular vision evaluation.";
      setBinocularVisionError(message);
      throw saveError;
    } finally {
      setIsBinocularVisionLoading(false);
    }
  }

  async function handleSaveLowVision(next: LowVisionPayload) {
    setLowVision(next);
    const saved = await saveStructuredModuleEntry("low_vision", next as unknown as Record<string, unknown>, buildLowVisionSummary(next));
    if (saved) {
      setSelectedLowVisionEntryId(saved.id);
    }
  }

  async function handleOpenPatientAttachment(attachment: PatientAttachment) {
    try {
      if (isImageContentType(attachment.content_type)) {
        setPhotoPreview({
          src: "",
          alt: attachment.file_name || "Patient attachment",
          title: attachment.file_name || "Patient attachment",
          isLoading: true,
        });
        const blob = await api.downloadPatientAttachment(attachment.id);
        const objectUrl = URL.createObjectURL(blob);
        setPhotoPreview((current) => {
          if (!current?.isLoading) {
            URL.revokeObjectURL(objectUrl);
            return current;
          }
          if (current.revokeOnClose && current.src.startsWith("blob:")) {
            URL.revokeObjectURL(current.src);
          }
          return {
            src: objectUrl,
            alt: attachment.file_name || "Patient attachment",
            title: attachment.file_name || "Patient attachment",
            revokeOnClose: true,
          };
        });
        return;
      }
      openPatientAttachmentViewer(attachment.id);
    } catch (downloadError) {
      setPhotoPreview(null);
      setAttachmentError(downloadError instanceof Error ? downloadError.message : "Failed to open attachment.");
    }
  }

  async function handleOpenVisitAttachment(attachment: PatientVisitAttachmentRow) {
    if (attachment.attachment_id) {
      await handleOpenLinkedAttachment(attachment.attachment_id, attachment.label, attachment.content_type, attachment.timestamp);
      return;
    }
    if (attachment.source_type === "note_attachment" && attachment.data_base64) {
      if (isImageContentType(attachment.content_type)) {
        handleOpenNoteImage({
          id: attachment.id,
          kind: "attachment",
          name: attachment.label,
          content_type: attachment.content_type,
          data_base64: attachment.data_base64,
        });
        return;
      }
      openNoteAttachmentViewer({
        id: attachment.id,
        kind: "attachment",
        name: attachment.label,
        content_type: attachment.content_type,
        data_base64: attachment.data_base64,
      });
      return;
    }
  }

  async function handleOpenLinkedAttachment(attachmentId: string, label: string, contentType: string, timestamp: string) {
    if (!currentPatient) {
      return;
    }
    await handleOpenPatientAttachment({
      id: attachmentId,
      org_id: "",
      patient_id: currentPatient.id,
      uploaded_by: null,
      file_name: label,
      content_type: contentType,
      file_size: 0,
      storage_path: "",
      created_at: timestamp,
    });
  }

  function closePhotoPreview() {
    setPhotoPreview((current) => {
      if (current?.revokeOnClose && current.src.startsWith("blob:")) {
        URL.revokeObjectURL(current.src);
      }
      return null;
    });
  }

  function handleOpenProfilePhotoPreview() {
    if (!profilePhotoObjectUrl || !currentPatient) {
      return;
    }
    setPhotoPreview({
      src: profilePhotoObjectUrl,
      alt: `${currentPatient.name} profile photo`,
      title: `${currentPatient.name} profile photo`,
    });
  }

  function handleProfilePhotoClick() {
    if (!currentPatient) {
      return;
    }
    if (!readOnly && !isTrainingMode) {
      if (currentPatient.profile_photo_url) {
        setIsProfilePhotoManagerOpen(true);
      } else {
        profilePhotoInputRef.current?.click();
      }
      return;
    }
    handleOpenProfilePhotoPreview();
  }

  function handleOpenNoteImage(asset: NoteAsset) {
    const src = noteAssetImageSrc(asset);
    if (!src) {
      openNoteAttachmentViewer(asset);
      return;
    }
    setPhotoPreview({
      src,
      alt: asset.name || "Patient attachment",
      title: asset.name || "Patient attachment",
    });
  }

  async function handleDeletePatientAttachment(attachment: PatientAttachment) {
    if (!currentPatient) {
      return;
    }
    if (!window.confirm(`Delete ${attachment.file_name}? This will remove the stored media file.`)) {
      return;
    }
    setIsDeletingAttachmentId(attachment.id);
    setAttachmentError("");
    try {
      await api.deletePatientAttachment(currentPatient.id, attachment.id);
      setPatientAttachments((current) => current.filter((row) => row.id !== attachment.id));
      setVisitDetailsById((current) => Object.fromEntries(
        Object.entries(current).map(([visitId, detail]) => [
          visitId,
          {
            ...detail,
            attachments: detail.attachments.filter((row) => row.attachment_id !== attachment.id),
          },
        ]),
      ));
    } catch (deleteError) {
      setAttachmentError(deleteError instanceof Error ? deleteError.message : "Failed to delete attachment.");
    } finally {
      setIsDeletingAttachmentId("");
    }
  }

  async function handlePatientAttachmentFileChange(file: File | null) {
    if (!currentPatient || !file) {
      return;
    }
    setIsUploadingAttachment(true);
    setAttachmentError("");
    try {
      const uploaded = await api.uploadPatientAttachment(currentPatient.id, file);
      setPatientAttachments((current) => [uploaded, ...current.filter((row) => row.id !== uploaded.id)]);
    } catch (uploadError) {
      setAttachmentError(uploadError instanceof Error ? uploadError.message : "Failed to upload attachment.");
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  function handleStartSendAttachment(attachment: Pick<PatientAttachment, "id" | "file_name" | "content_type">) {
    if (!currentPatient) {
      return;
    }
    const patientName = currentPatient.name.trim() || "Patient";
    const patientEmail = (currentPatient.email || "").trim();
    setAttachmentError("");
    setAttachmentSendDraft({
      attachmentId: attachment.id,
      fileName: attachment.file_name,
      recipientEmail: patientEmail,
      subject: `${patientName} attachment: ${attachment.file_name}`,
      message: `Please find attached ${attachment.file_name} for ${patientName}.`,
    });
  }

  async function handleSendAttachment() {
    if (!currentPatient || !attachmentSendDraft) {
      return;
    }
    const recipientEmail = attachmentSendDraft.recipientEmail.trim();
    const subject = attachmentSendDraft.subject.trim();
    if (!recipientEmail) {
      setAttachmentError("Confirm the recipient email before sending.");
      return;
    }
    if (!recipientEmail.includes("@")) {
      setAttachmentError("Enter a valid recipient email.");
      return;
    }
    if (!subject) {
      setAttachmentError("Enter an email subject before sending.");
      return;
    }

    setIsSendingAttachmentId(attachmentSendDraft.attachmentId);
    setAttachmentError("");
    try {
      const response = await api.sendPatientAttachment(currentPatient.id, attachmentSendDraft.attachmentId, {
        recipient_email: recipientEmail,
        subject,
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

  async function handleProfilePhotoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!currentPatient || !file) {
      return;
    }
    if (!PROFILE_PHOTO_TYPES.has(file.type)) {
      setError("Only JPG, PNG, and WEBP patient photos are supported.");
      return;
    }
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setError("Patient photo must be 5 MB or smaller.");
      return;
    }
    setIsUploadingProfilePhoto(true);
    setError("");
    try {
      const updated = await api.uploadPatientProfilePhoto(currentPatient.id, file);
      setCurrentPatient(updated);
      setProfilePhotoVersion((current) => current + 1);
      onPatientUpdated?.(updated);
      setIsProfilePhotoManagerOpen(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload patient photo.");
    } finally {
      setIsUploadingProfilePhoto(false);
    }
  }

  async function handleRemoveProfilePhoto() {
    if (!currentPatient?.profile_photo_url) {
      return;
    }
    if (!window.confirm("Remove this patient photo?")) {
      return;
    }
    setIsUploadingProfilePhoto(true);
    setError("");
    try {
      const updated = await api.removePatientProfilePhoto(currentPatient.id);
      setCurrentPatient(updated);
      setProfilePhotoVersion((current) => current + 1);
      onPatientUpdated?.(updated);
      setIsProfilePhotoManagerOpen(false);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to remove patient photo.");
    } finally {
      setIsUploadingProfilePhoto(false);
    }
  }

  async function handleSave() {
    if (readOnly || !currentPatient) {
      return;
    }

    const digits = getPhoneDigits(form.phone);
    const weight = form.weight.trim() ? Number(form.weight) : null;
    const temperature = form.temperature.trim() ? Number(form.temperature) : null;
    const height = form.height.trim() ? Number(form.height) : null;
    const normalizedEmail = form.email.trim().toLowerCase();

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (digits.length !== 10) {
      setError("Phone number must be exactly 10 digits.");
      return;
    }
    if (!form.reason.trim()) {
      setError("Reason for visit is required.");
      return;
    }
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      setError("Enter a valid weight.");
      return;
    }
    if (temperature !== null && (!Number.isFinite(temperature) || temperature < 90 || temperature > 110)) {
      setError("Enter a valid temperature in F.");
      return;
    }
    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      setError("Enter a valid height.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSave(currentPatient.id, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: normalizedEmail,
        address: form.address.trim(),
        reason: form.reason.trim(),
        date_of_birth: form.dateOfBirth || null,
        sex_at_birth: form.sexAtBirth || null,
        gender_identity: form.genderIdentity.trim(),
        age: null,
        weight,
        height,
        temperature,
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update patient.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={fullScreen ? "flex h-[100dvh] flex-col" : "fixed inset-0 z-30 bg-slate-950/35 p-2 backdrop-blur-sm sm:p-4"}>
      <div className={fullScreen ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-white" : "mx-auto flex h-full max-h-[97vh] w-full max-w-[1700px] flex-col overflow-hidden rounded-[20px] border border-[#dbe7ef] bg-white shadow-[0_35px_90px_rgba(15,23,42,0.18)]"}>
        {fullScreen ? (
          <>
            {/* app bar: back + breadcrumb */}
            <div className="flex items-center gap-3 border-b border-[#dbe7ef] bg-white/90 px-6 py-2.5 backdrop-blur">
              <button
                type="button"
                onClick={() => { setError(""); onClose(); }}
                className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#bfd7e8] bg-white px-3 text-sm font-semibold text-slate-600 transition hover:bg-[#edf5fa]"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <span className="truncate text-sm text-slate-400">
                {fullScreenBackLabel}&nbsp;/&nbsp;<span className="font-semibold text-slate-700">{currentPatient.name}</span>
              </span>
            </div>

            {/* identity header */}
            <div className="border-b border-[#dbe7ef] px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={handleProfilePhotoClick}
                      disabled={!profilePhotoObjectUrl && (readOnly || isTrainingMode)}
                      className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] bg-gradient-to-br from-[#2f8fd3] to-[#245f92] text-xl font-bold text-white shadow-[0_10px_22px_rgba(37,111,168,0.28)] transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#6daed8] disabled:cursor-default disabled:hover:opacity-100"
                      aria-label={currentPatient.profile_photo_url && !readOnly && !isTrainingMode ? "Manage patient photo" : currentPatient.profile_photo_url ? "Open patient photo" : "Add patient photo"}
                    >
                      {profilePhotoObjectUrl ? (
                        <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={profilePhotoObjectUrl} alt={`${currentPatient.name} profile photo`} className="h-full w-full object-cover" />
                        </>
                      ) : (
                        <span aria-hidden="true">{patientInitials(currentPatient)}</span>
                      )}
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Patient Chart</p>
                    <h2 className="mt-0.5 truncate text-2xl font-bold text-slate-900">{currentPatient.name}</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(() => {
                        const sexLabel = currentPatient.sex_at_birth
                          ? currentPatient.sex_at_birth.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ")
                          : "";
                        const ageChip = typeof currentPatient.age === "number"
                          ? `${currentPatient.age} yrs${sexLabel ? ` · ${sexLabel}` : ""}`
                          : sexLabel || null;
                        const chips: { text: string; key: boolean }[] = [];
                        if (ageChip) chips.push({ text: ageChip, key: true });
                        if (currentPatient.phone) chips.push({ text: currentPatient.phone, key: false });
                        chips.push({ text: currentPatient.address || "No address on file", key: false });
                        chips.push({ text: `Last visit ${formatDateTime(currentPatient.last_visit_at)}`, key: false });
                        return chips.map((chip, index) => (
                          <span
                            key={index}
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              chip.key ? "border-[#bfe0f5] bg-[#ecf6fd] text-[#2a6fa8]" : "border-[#dbe7ef] bg-[#f3f8fb] text-slate-600"
                            }`}
                          >
                            {chip.text}
                          </span>
                        ));
                      })()}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => setIsEditingPatient((current) => !current)}
                      className={`inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${
                        isEditingPatient ? "border-[#9fc7e1] bg-[#edf5fa] text-[#2a6fa8]" : "border-[#bfd7e8] bg-white text-slate-600 hover:bg-[#edf5fa]"
                      }`}
                    >
                      <Pencil className="h-4 w-4" /> Edit
                    </button>
                  ) : null}
                  {workflowActionLabel && onWorkflowAction ? (
                    <button
                      type="button"
                      onClick={() => { setError(""); void onWorkflowAction(); }}
                      disabled={workflowActionDisabled}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-[#14a38b] px-5 text-sm font-semibold text-white shadow-sm shadow-teal-900/10 transition hover:bg-[#108873] disabled:opacity-60"
                    >
                      {workflowActionLabel}
                    </button>
                  ) : null}
                </div>
              </div>
              {isEditingPatient ? (
                <div className="mt-4 rounded-xl border border-[#dbe7ef] bg-[#f7fbfd] p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(180px,1.35fr)_repeat(4,minmax(110px,0.8fr))]">
                    <SummaryField label="Name" value={form.name} readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, name: value })); }} />
                    <SummaryField label="Phone" value={form.phone} readOnly={false} inputMode="tel" onChange={(value) => { setError(""); setForm((current) => ({ ...current, phone: value })); }} />
                    <SummaryField label="DOB" value={form.dateOfBirth} type="date" readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, dateOfBirth: value })); }} />
                    <SummaryField label="Reason" value={form.reason} readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, reason: value })); }} />
                    <SummaryField label="Email" value={form.email} type="email" readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, email: value })); }} />
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(180px,1.35fr)_repeat(4,minmax(110px,0.8fr))]">
                    <SummaryField label="Address" value={form.address} readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, address: value })); }} />
                    <SummaryField label="Weight" value={form.weight} readOnly={false} inputMode="decimal" onChange={(value) => { setError(""); setForm((current) => ({ ...current, weight: value })); }} />
                    <SummaryField label="Height" value={form.height} readOnly={false} inputMode="decimal" onChange={(value) => { setError(""); setForm((current) => ({ ...current, height: value })); }} />
                    <SummaryField label="Temp" value={form.temperature} readOnly={false} inputMode="decimal" onChange={(value) => { setError(""); setForm((current) => ({ ...current, temperature: value })); }} />
                  </div>
                  <div className="mt-3 max-w-xs">
                    <label className="block text-xs font-medium text-slate-500">
                      Sex
                      <select
                        value={form.sexAtBirth}
                        onChange={(event) => { setError(""); setForm((current) => ({ ...current, sexAtBirth: event.target.value as "" | SexAtBirth })); }}
                        className="mt-1 w-full rounded-lg border border-[#dbe7ef] bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#6daed8]"
                      >
                        <option value="">Not recorded</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                  </div>
                </div>
              ) : null}
            </div>

            {/* AI summary band */}
            {!isTrainingMode ? (
              <div className="border-b border-[#bfe0f5] bg-[#ecf6fd] px-6 py-3">
                <button type="button" onClick={() => setIsSummaryCollapsed((current) => !current)} className="flex w-full items-center gap-2.5 text-left">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#2f8fd3]/15 text-[#2f8fd3]">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex-1 text-xs font-bold tracking-[0.06em] text-[#1d4d72]">AI SUMMARY</span>
                  <ChevronDown className={`h-4 w-4 text-[#2a6fa8] transition ${isSummaryCollapsed ? "-rotate-90" : ""}`} />
                </button>
                {!isSummaryCollapsed ? (
                  <div className="mt-2 w-full">
                    {isSummaryLoading && !aiSummary ? (
                      <div className="space-y-2">
                        <div className="h-3 w-11/12 animate-pulse rounded bg-[#d7e9f7]" />
                        <div className="h-3 w-9/12 animate-pulse rounded bg-[#d7e9f7]" />
                      </div>
                    ) : summaryError ? (
                      <p className="text-sm text-rose-600">{summaryError}</p>
                    ) : aiSummary?.summary ? (
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#33587a]">{aiSummary.summary}</p>
                    ) : (
                      <p className="text-[13px] text-[#5b6b80]">No summary available yet.</p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* underline tabs */}
            <div className="flex gap-7 border-b border-[#dbe7ef] bg-white px-6">
              {([
                { key: "visits", label: "Visits" },
                { key: "tests", label: "Tests" },
                { key: "attachments", label: "Files" },
                { key: "timeline", label: "Timeline" },
              ] as { key: ChartTab; label: string }[]).map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative py-3.5 text-sm font-semibold transition ${isActive ? "text-[#287fc0]" : "text-slate-400 hover:text-slate-600"}`}
                  >
                    {tab.label}
                    {isActive ? <span className="absolute inset-x-0 -bottom-px h-[3px] rounded bg-[#2f8fd3]" /> : null}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
        <div className="border-b border-[#dbe7ef] px-5 py-4 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={handleProfilePhotoClick}
                  disabled={!profilePhotoObjectUrl && (readOnly || isTrainingMode)}
                  className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-[#dbe7ef] bg-[#f3f8fb] text-2xl font-semibold text-[#2a6fa8] shadow-[0_10px_26px_rgba(64,131,181,0.08)] transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#6daed8] disabled:cursor-default disabled:hover:opacity-100"
                  aria-label={currentPatient.profile_photo_url && !readOnly && !isTrainingMode ? "Manage patient photo" : currentPatient.profile_photo_url ? "Open patient photo" : "Add patient photo"}
                >
                  {profilePhotoObjectUrl ? (
                    <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={profilePhotoObjectUrl}
                      alt={`${currentPatient.name} profile photo`}
                      className="h-full w-full object-cover"
                    />
                    </>
                  ) : (
                    <span aria-hidden="true">{patientInitials(currentPatient)}</span>
                  )}
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Patient Chart</p>
                <h2 className="mt-2 truncate text-3xl font-semibold text-slate-900">{currentPatient.name}</h2>
                <p className="mt-2 text-sm text-slate-500">{patientMetadataLine(currentPatient)}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setError("");
                  onClose();
                }}
                className="rounded-xl border border-[#dbe7ef] p-2 text-slate-500 transition hover:text-slate-800"
                aria-label="Close patient chart"
              >
                <X className="h-4 w-4" />
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => setIsEditingPatient((current) => !current)}
                  className={`rounded-xl border p-2 transition ${
                    isEditingPatient
                      ? "border-[#9fc7e1] bg-[#edf5fa] text-[#2a6fa8]"
                      : "border-[#dbe7ef] text-slate-500 hover:text-slate-800"
                  }`}
                  aria-label="Edit patient details"
                  title="Edit patient details"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
          {isEditingPatient ? (
            <div className="mt-4 rounded-xl border border-[#dbe7ef] bg-[#f7fbfd] p-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(180px,1.35fr)_repeat(4,minmax(110px,0.8fr))]">
                <SummaryField label="Name" value={form.name} readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, name: value })); }} />
                <SummaryField label="Phone" value={form.phone} readOnly={false} inputMode="tel" onChange={(value) => { setError(""); setForm((current) => ({ ...current, phone: value })); }} />
                <SummaryField label="DOB" value={form.dateOfBirth} type="date" readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, dateOfBirth: value })); }} />
                <SummaryField label="Reason" value={form.reason} readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, reason: value })); }} />
                <SummaryField label="Email" value={form.email} type="email" readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, email: value })); }} />
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(180px,1.35fr)_repeat(4,minmax(110px,0.8fr))]">
                <SummaryField label="Address" value={form.address} readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, address: value })); }} />
                <SummaryField label="Weight" value={form.weight} readOnly={false} inputMode="decimal" onChange={(value) => { setError(""); setForm((current) => ({ ...current, weight: value })); }} />
                <SummaryField label="Height" value={form.height} readOnly={false} inputMode="decimal" onChange={(value) => { setError(""); setForm((current) => ({ ...current, height: value })); }} />
                <SummaryField label="Temp" value={form.temperature} readOnly={false} inputMode="decimal" onChange={(value) => { setError(""); setForm((current) => ({ ...current, temperature: value })); }} />
              </div>
              <div className="mt-3 max-w-xs">
                <label className="block text-xs font-medium text-slate-500">
                  Sex
                  <select
                    value={form.sexAtBirth}
                    onChange={(event) => { setError(""); setForm((current) => ({ ...current, sexAtBirth: event.target.value as "" | SexAtBirth })); }}
                    className="mt-1 w-full rounded-lg border border-[#dbe7ef] bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#6daed8]"
                  >
                    <option value="">Not recorded</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              <ChartTabButton active={activeTab === "visits"} label="Visits" onClick={() => setActiveTab("visits")} />
              <ChartTabButton
                active={activeTab === "tests"}
                label="Tests"
                onClick={() => setActiveTab("tests")}
              />
              <ChartTabButton
                active={activeTab === "attachments"}
                label="Attachments"
                onClick={() => setActiveTab("attachments")}
              />
              <ChartTabButton
                active={activeTab === "timeline"}
                label="Timeline"
                onClick={() => setActiveTab("timeline")}
              />
            </div>
            {workflowActionLabel && onWorkflowAction ? (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  void onWorkflowAction();
                }}
                disabled={workflowActionDisabled}
                className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#14a38b] px-4 text-sm font-medium text-white shadow-sm shadow-teal-900/10 transition hover:bg-[#108873] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14a38b]/30 disabled:opacity-60 sm:ml-auto sm:w-auto"
              >
                {workflowActionLabel}
              </button>
            ) : null}
          </div>
        </div>
        )}

        <section className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="w-full">
            {!fullScreen && !isTrainingMode ? (
              <div className="mb-5 rounded-xl border border-[#cfe3f3] bg-gradient-to-br from-[#f3f9fe] to-[#eaf4fc] p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#2f8fd3]/10 text-[#2f8fd3]">
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-sm font-semibold text-[#1d4d72]">Summary</span>
                  </div>
                </div>

                <div className="mt-3">
                  {isSummaryLoading && !aiSummary ? (
                    <div className="space-y-2">
                      <div className="h-3 w-11/12 animate-pulse rounded bg-[#d7e9f7]" />
                      <div className="h-3 w-9/12 animate-pulse rounded bg-[#d7e9f7]" />
                      <div className="h-3 w-10/12 animate-pulse rounded bg-[#d7e9f7]" />
                    </div>
                  ) : summaryError ? (
                    <p className="text-sm text-rose-600">{summaryError}</p>
                  ) : aiSummary?.summary ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {aiSummary.summary}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">No summary available yet.</p>
                  )}
                </div>
              </div>
            ) : null}
            {activeTab === "visits" ? (
              <div className="grid min-h-0 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="self-start rounded-xl border border-[#dbe7ef] bg-white p-3">
                  {visitsError ? <p className="mt-2 text-sm text-rose-600">{visitsError}</p> : null}
                  <div className="max-h-[58vh] space-y-1.5 overflow-y-auto pr-1">
                    {visits.length ? (
                      visits.map((visit, index) => (
                        <button
                          key={visit.id}
                          type="button"
                          onClick={() => setSelectedVisitId(visit.id)}
                          className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                            visit.id === selectedVisit?.id
                              ? "border-[#9fc7e1] bg-[#f3f8fb] shadow-[inset_3px_0_0_#2f8fd3]"
                              : "border-transparent bg-white hover:border-[#dbe7ef] hover:bg-[#f7fbfd]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="rounded-lg bg-[#f3f8fb] p-1.5 ring-1 ring-[#dbe7ef]">
                                <UserRound className="h-4 w-4 text-[#2f8fd3]" />
                              </div>
                              <p className="truncate text-sm font-semibold text-slate-900">Visit {index + 1}</p>
                            </div>
                            <p className="shrink-0 text-xs text-slate-500">{formatDateTime(visit.created_at)}</p>
                          </div>
                        </button>
                      ))
                    ) : !isVisitsLoading ? (
                      <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-white px-4 py-8 text-center text-sm text-slate-500">
                        No visits recorded yet.
                      </div>
                    ) : null}
                  </div>
                </aside>
                <div className="space-y-4">
                  <VisitDetailPanel
                    detail={selectedVisitDetail}
                    detailError={visitDetailError}
                    isLoadingDetail={loadingVisitDetailId === selectedVisit?.id}
                    onOpenVisitAttachment={handleOpenVisitAttachment}
                    openSections={openVisitSections}
                    selectedVisit={selectedVisit}
                    toggleSection={toggleVisitSection}
                  />
                </div>
              </div>
            ) : null}

            {activeTab === "tests" ? (
              <TestsPanel
                latestGrowthRecord={latestGrowthRecord}
                moduleEntryError={moduleEntryError}
                moduleEntries={moduleEntries}
                modules={specialtyModules}
                myopiaError={myopiaError}
                myopiaRecords={myopiaRecords}
                binocularVisionError={binocularVisionError}
                binocularVisionEvaluations={binocularVisionEvaluations}
                tbiError={tbiError}
                tbiEvaluations={tbiEvaluations}
                onOpenBinocularVision={() => setIsBinocularVisionOpen(true)}
                onOpenContactLens={() => setIsContactLensOpen(true)}
                onOpenEyeExam={() => setIsEyeExamOpen(true)}
                onOpenTbiEvaluation={() => setIsTbiEvaluationOpen(true)}
                onOpenGrowthHistory={() => setIsGrowthHistoryOpen(true)}
                onOpenLowVision={() => setIsLowVisionOpen(true)}
                onOpenMyopiaManagement={() => setIsMyopiaManagementOpen(true)}
                fullScreen={fullScreen}
              />
            ) : null}

            {activeTab === "attachments" ? (
              <AttachmentsPanel
                attachmentError={attachmentError}
                isLoading={isAttachmentsLoading}
                noteAssets={noteAssets}
                onOpenPatientAttachment={handleOpenPatientAttachment}
                onOpenLinkedAttachment={handleOpenLinkedAttachment}
                onOpenNoteImage={handleOpenNoteImage}
                onDeletePatientAttachment={handleDeletePatientAttachment}
                onPatientAttachmentFileChange={handlePatientAttachmentFileChange}
                onStartSendAttachment={handleStartSendAttachment}
                patientAttachments={patientAttachments}
                isDeletingAttachmentId={isDeletingAttachmentId}
                isSendingAttachmentId={isSendingAttachmentId}
                isUploadingAttachment={isUploadingAttachment}
              />
            ) : null}

            {activeTab === "timeline" ? (
              <TimelinePanel
                error={timelineError}
                isLoading={isTimelineLoading}
                timeline={patientTimeline}
                fullScreen={fullScreen}
              />
            ) : null}
          </div>
        </section>

        {attachmentSendDraft ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 px-4">
            <div className="w-full max-w-lg rounded-[20px] border border-[#bfd7e8] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Send attachment</h3>
                  <p className="mt-1 text-sm text-slate-500">{attachmentSendDraft.fileName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachmentSendDraft(null)}
                  className="rounded-xl border border-[#dbe7ef] p-2 text-slate-500 transition hover:text-slate-800"
                  aria-label="Close send attachment"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Confirm patient email</span>
                  <input
                    type="email"
                    value={attachmentSendDraft.recipientEmail}
                    onChange={(event) => setAttachmentSendDraft((current) => current ? { ...current, recipientEmail: event.target.value } : current)}
                    placeholder="patient@example.com"
                    className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
                  />
                  {!attachmentSendDraft.recipientEmail.trim() ? (
                    <span className="mt-2 block text-xs text-amber-700">This patient has no email saved. Enter one to send this attachment.</span>
                  ) : null}
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Subject</span>
                  <input
                    value={attachmentSendDraft.subject}
                    onChange={(event) => setAttachmentSendDraft((current) => current ? { ...current, subject: event.target.value } : current)}
                    className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Message</span>
                  <textarea
                    rows={4}
                    value={attachmentSendDraft.message}
                    onChange={(event) => setAttachmentSendDraft((current) => current ? { ...current, message: event.target.value } : current)}
                    className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
                  />
                </label>
              </div>
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAttachmentSendDraft(null)}
                  className="rounded-xl border border-[#9fc7e1] bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-[#f3f8fb]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSendingAttachmentId === attachmentSendDraft.attachmentId}
                  onClick={() => void handleSendAttachment()}
                  className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                >
                  {isSendingAttachmentId === attachmentSendDraft.attachmentId ? "Sending..." : "Send attachment"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {error || (!readOnly && isEditingPatient) ? (
          <div className="border-t border-[#dbe7ef] px-5 py-4 sm:px-7">
            {error ? <p className="mb-3 text-sm font-medium text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-3">
              {!readOnly && isEditingPatient ? (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <input
        ref={profilePhotoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="sr-only"
        disabled={isUploadingProfilePhoto}
        onChange={handleProfilePhotoFileChange}
      />
      <ProfilePhotoManagerModal
        open={isProfilePhotoManagerOpen}
        patientName={currentPatient.name}
        photoSrc={profilePhotoObjectUrl}
        isBusy={isUploadingProfilePhoto}
        onChange={() => profilePhotoInputRef.current?.click()}
        onRemove={() => void handleRemoveProfilePhoto()}
        onClose={() => setIsProfilePhotoManagerOpen(false)}
      />
      <PhotoPreviewModal preview={photoPreview} onClose={closePhotoPreview} />
      {hasMyopiaManagement ? (
        <HistoricalMyopiaModal
          open={isHistoricalMyopiaOpen}
          patientAge={currentPatient.age}
          onClose={() => setIsHistoricalMyopiaOpen(false)}
          onSave={handleSaveHistoricalMyopia}
        />
      ) : null}
      {hasMyopiaManagement ? (
        <MyopiaManagementModal
          open={isMyopiaManagementOpen}
          readOnly={readOnly}
          history={myopiaHistory}
          isLoading={isMyopiaLoading}
          error={myopiaError}
          onClose={() => setIsMyopiaManagementOpen(false)}
          onAddPastReading={() => {
            setIsMyopiaManagementOpen(false);
            setIsHistoricalMyopiaOpen(true);
          }}
        />
      ) : null}
      {hasTbiEvaluation ? (
        <TbiEvaluationModal
          open={isTbiEvaluationOpen}
          patient={currentPatient}
          evaluations={tbiEvaluations}
          isLoading={isTbiLoading}
          error={tbiError}
          readOnly={readOnly}
          onClose={() => setIsTbiEvaluationOpen(false)}
          onSave={handleSaveTbiEvaluation}
        />
      ) : null}
      {hasBinocularVision ? (
        <BinocularVisionModal
          open={isBinocularVisionOpen}
          patient={currentPatient}
          evaluations={binocularVisionEvaluations}
          isLoading={isBinocularVisionLoading}
          error={binocularVisionError}
          readOnly={readOnly}
          onClose={() => setIsBinocularVisionOpen(false)}
          onSave={handleSaveBinocularVisionEvaluation}
        />
      ) : null}
      {hasGrowthMeasurement ? (
        <GrowthHistoryModal
          open={isGrowthHistoryOpen}
          growthHistory={growthHistory}
          onClose={() => setIsGrowthHistoryOpen(false)}
        />
      ) : null}
      <PatientStructuredModuleShell
        open={isEyeExamOpen}
        patient={currentPatient}
        moduleKey="eye_exam"
        entries={eyeExamEntries}
        selectedEntryId={selectedEyeExamEntryId}
        onClose={() => setIsEyeExamOpen(false)}
        onNew={() => startNewStructuredModule("eye_exam")}
        onSelectEntry={selectEyeExamEntry}
      >
        <div>
          <EyeExamFields value={eyeExam} onChange={updateEyeExam} />
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={handleSaveEyeExam} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
              Save
            </button>
          </div>
        </div>
        {genericModuleEntryError ? <p className="mt-3 text-sm font-medium text-rose-600">{genericModuleEntryError}</p> : null}
      </PatientStructuredModuleShell>
      <PatientStructuredModuleShell
        open={isContactLensOpen}
        patient={currentPatient}
        moduleKey="contact_lens"
        entries={contactLensEntries}
        selectedEntryId={selectedContactLensEntryId}
        onClose={() => setIsContactLensOpen(false)}
        onNew={() => startNewStructuredModule("contact_lens")}
        onSelectEntry={selectContactLensEntry}
      >
        <ContactLensModal
          open
          inline
          value={contactLens}
          onClose={() => {}}
          onSave={() => {
            void handleSaveContactLens();
          }}
          onChange={updateContactLens}
          onEyeChange={updateContactLensEye}
        />
        {genericModuleEntryError ? <p className="mt-3 text-sm font-medium text-rose-600">{genericModuleEntryError}</p> : null}
      </PatientStructuredModuleShell>
      <PatientStructuredModuleShell
        open={isLowVisionOpen}
        patient={currentPatient}
        moduleKey="low_vision"
        entries={lowVisionEntries}
        selectedEntryId={selectedLowVisionEntryId}
        onClose={() => setIsLowVisionOpen(false)}
        onNew={() => startNewStructuredModule("low_vision")}
        onSelectEntry={selectLowVisionEntry}
      >
        <LowVisionModal
          open
          inline
          value={lowVision}
          onClose={() => {}}
          onSave={(next) => {
            void handleSaveLowVision(next);
          }}
        />
        {genericModuleEntryError ? <p className="mt-3 text-sm font-medium text-rose-600">{genericModuleEntryError}</p> : null}
      </PatientStructuredModuleShell>
    </div>
  );
}
