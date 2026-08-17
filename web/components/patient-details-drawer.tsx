"use client";

import { type ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, CalendarClock, ChevronDown, ChevronRight, ClipboardList, Clock3, Eye, FileText, Image as ImageIcon, LineChart, Mail, Pencil, Sparkles, UserRound, X } from "lucide-react";

import type { ClinicSpecialty } from "@/lib/clinic-specialty";
import { BinocularVisionModal } from "@/components/optometry/binocular-vision-modal";
import { ContactLensModal } from "@/components/optometry/contact-lens-modal";
import { LowVisionModal } from "@/components/optometry/low-vision-modal";
import { HistoricalMyopiaModal } from "@/components/optometry/myopia/historical-myopia-modal";
import { MyopiaManagementModal } from "@/components/optometry/myopia/myopia-management-modal";
import { TbiEvaluationModal } from "@/components/optometry/tbi-evaluation-modal";
import { EyeExamModal } from "@/components/optometry/eye-exam-modal";
import { OptometryHistoryReadOnly } from "@/components/optometry/history-panel";
import { ReferralPackageModal } from "@/components/referral-package-modal";
import {
  PatientAttachmentsPanel,
  PatientChartResourceOverlays,
} from "@/features/patient-chart/resources/patient-chart-resource-panels";
import { usePatientChartData } from "@/features/patient-chart/data/use-patient-chart-data";
import {
  PatientEditorFooter,
  PatientEditorForm,
} from "@/features/patient-chart/editor/patient-editor-form";
import type { PatientEditSavePayload } from "@/features/patient-chart/editor/patient-editor-model";
import { usePatientEditor } from "@/features/patient-chart/editor/use-patient-editor";
import { usePatientChartResources } from "@/features/patient-chart/resources/use-patient-chart-resources";
import { api } from "@/lib/api";
import {
  buildBinocularVisionSummary,
  buildContactLensSummary,
  buildLowVisionSummary,
  createEmptyContactLens,
  createEmptyLowVision,
  hasContactLensEyeData,
  normalizeContactLensPayload,
  normalizeLowVisionPayload,
} from "@/lib/optometry/consultation";
import { getSpecialtyModules, specialtyHasModule, type SpecialtyModuleKey } from "@/lib/specialty";
import { createTrainingId } from "@/lib/training-mode";
import {
  BinocularVisionEvaluationCreatePayload,
  BinocularVisionEvaluationRecord,
  ContactLensEyeEntry,
  ContactLensPayload,
  EyeExamPayload,
  LongitudinalTrackRecord,
  LowVisionPayload,
  MyopiaHistory,
  MyopiaMeasurementPayload,
  Patient,
  PatientChartVisit,
  PatientVisitAttachmentRow,
  PatientVisitDetail,
  PatientTimelineEvent,
  PediatricGrowthSummary,
  TbiEvaluationCreatePayload,
  TbiEvaluationRecord,
} from "@/lib/types";
import {
  buildEyeExamSummary,
  createEmptyEyeExam,
  formatModuleSummary as formatSharedModuleSummary,
  moduleEntriesFor,
  normalizeEyeExamPayload,
} from "@/lib/structured-modules";

type ChartTab = "visits" | "attachments" | "tests" | "timeline";

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
  canAssignDoctor?: boolean;
  onAssignDoctor?: (patient: Patient) => void;
  canRefer?: boolean;
  /** Render as an edge-to-edge full-screen page (route) instead of a modal overlay. */
  fullScreen?: boolean;
  /** Breadcrumb label shown next to the back button in full-screen mode (e.g. "Patients"). */
  fullScreenBackLabel?: string;
  onPatientUpdated?: (patient: Patient) => void;
  onSave: (payloadPatientId: string, payload: PatientEditSavePayload) => Promise<void>;
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
  return formatSharedModuleSummary(
    entry,
    `${moduleLabel(entry.track_type as SpecialtyModuleKey)} saved.`,
  );
}

function patientInitials(patient: Patient) {
  const parts = patient.name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "P";
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
          : "border border-[#bfd7e8] bg-white text-black hover:bg-[#edf5fa]"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span className={`rounded-lg px-2 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-[#edf5fa] text-black"}`}>
          {count}
        </span>
      ) : null}
    </button>
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
            <p className="text-sm font-semibold text-black">{getEventTitle(event)}</p>
            <p className="text-xs text-black">{formatDateTime(event.timestamp)}</p>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-black">{timelineDescription(event)}</p>
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
            <h4 className="text-lg font-semibold text-black">{description}</h4>
            {typeof count === "number" ? (
              <span className="rounded-xl border border-[#bfd7e8] bg-[#f3f8fb] px-3 py-1 text-xs font-medium text-black">
                {count}
              </span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-black">
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
  openSections: Record<"history" | "attachments", boolean>;
  selectedVisit: PatientChartVisit | null;
  toggleSection: (section: "history" | "attachments") => void;
}) {
  const [notePreviewError, setNotePreviewError] = useState("");
  const [isOpeningNotePreview, setIsOpeningNotePreview] = useState(false);
  if (!selectedVisit) {
    return (
      <section className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-6 py-10 text-center text-sm text-black">
        No visits recorded yet.
      </section>
    );
  }

  const attachments = detail?.attachments ?? [];
  const reason = detail?.reason || selectedVisit.reason || "Recorded visit";

  async function openNotePreview() {
    const noteId = detail?.consultation_note?.note_id;
    if (!noteId || isOpeningNotePreview) return;
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      setNotePreviewError("Allow pop-ups to preview the consultation note.");
      return;
    }
    previewWindow.opener = null;
    setIsOpeningNotePreview(true);
    setNotePreviewError("");
    try {
      const blob = await api.generateSavedNotePdf(noteId);
      const objectUrl = URL.createObjectURL(blob);
      previewWindow.location.href = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (previewError) {
      previewWindow.close();
      setNotePreviewError(previewError instanceof Error ? previewError.message : "Failed to preview consultation note.");
    } finally {
      setIsOpeningNotePreview(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#dbe7ef] bg-white p-4">
        <div>
          <h4 className="text-lg font-semibold text-black">Reason: {reason}</h4>
          {detailError ? <p className="mt-2 text-sm text-rose-600">{detailError}</p> : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#dbe7ef] bg-white">
        <button
          type="button"
          disabled={isLoadingDetail || !detail?.consultation_note?.note_id || isOpeningNotePreview}
          onClick={() => void openNotePreview()}
          className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-[#f7fbfd] disabled:cursor-default"
        >
          <h4 className="text-lg font-semibold text-black">Consultation note</h4>
          <ChevronRight className="h-5 w-5 text-black" />
        </button>
        {notePreviewError ? <p className="border-t border-[#dbe7ef] px-6 py-3 text-sm text-rose-600">{notePreviewError}</p> : null}
      </section>

      {detail?.optometry_history ? (
        <CollapsibleSection
          description="History"
          isOpen={openSections.history}
          onToggle={() => toggleSection("history")}
        >
          <OptometryHistoryReadOnly payload={detail.optometry_history} />
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection
        description="Files and media"
        count={attachments.length}
        isOpen={openSections.attachments}
        onToggle={() => toggleSection("attachments")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {isLoadingDetail ? (
            <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-8 text-center text-sm text-black sm:col-span-2">
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
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#dbe7ef] bg-white text-black">
                {attachment.content_type.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-black">{attachment.label}</p>
                <p className="text-xs text-black">{formatDateTime(attachment.timestamp)}</p>
              </div>
            </button>
          )) : null}
          {!isLoadingDetail && !attachments.length ? (
            <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-8 text-center text-sm text-black sm:col-span-2">
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
      <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-10 text-center text-sm text-black">
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
      <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-white px-4 py-10 text-center text-sm text-black">
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
                  <span className="mb-1 block text-xs font-semibold text-black">{meta.label}</span>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-black">{getEventTitle(event)}</span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-black">{formatDateTime(event.timestamp)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-black">{timelineDescription(event)}</p>
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
  isLoading,
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
  isLoading: boolean;
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
    <div className="fixed inset-0 z-[80] bg-white">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white">
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
          <aside className="max-h-[180px] overflow-y-auto border-b border-slate-200 bg-slate-50 p-4 lg:max-h-none lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">Previous Evaluations</h4>
              <button type="button" onClick={onNew} className="rounded-lg border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-[#f3f8fb]">
                New
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {isLoading ? (
                <p role="status" className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-5 text-center text-sm text-slate-500">
                  Loading previous evaluations…
                </p>
              ) : entries.length ? entries.map((entry) => (
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

          <div className="min-h-0 overflow-y-auto bg-[#f4f8fb] p-3 sm:p-6">
            <div className="w-full border border-[#dbe7ef] bg-white p-4 shadow-sm sm:p-6">
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
        <div className="rounded-[16px] border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-6 py-10 text-center text-sm text-black">
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
                  <span className="block text-sm font-semibold text-black">{row.label}</span>
                  <span className={`mt-0.5 block text-xs ${row.error ? "text-rose-600" : "text-black"}`}>{subline}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-black">{row.date}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-black" />
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
                <th className="border-b border-[#dbe7ef] px-4 py-3 text-sm font-semibold text-black">Type</th>
                <th className="border-b border-[#dbe7ef] px-4 py-3 text-sm font-semibold text-black">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  onClick={() => handleOpen(row)}
                  className="cursor-pointer transition hover:bg-[#f3f8fb]/70"
                >
                  <td className="border-b border-[#dbe7ef] px-4 py-3.5 text-sm font-semibold text-black">
                    {row.label}
                    {row.error ? <p className="mt-1 text-xs font-medium text-rose-600">{row.error}</p> : null}
                  </td>
                  <td className="border-b border-[#dbe7ef] px-4 py-3.5 text-sm text-black">{row.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-6 py-10 text-center text-sm text-black">
          No tests available for this specialty yet.
        </div>
      )}
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
  canAssignDoctor = false,
  onAssignDoctor,
  canRefer = false,
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
  const [myopiaHistory, setMyopiaHistory] = useState<MyopiaHistory | null>(null);
  const [growthHistory, setGrowthHistory] = useState<PediatricGrowthSummary | null>(null);
  const [moduleEntries, setModuleEntries] = useState<LongitudinalTrackRecord[]>([]);
  const [isModuleEntriesLoading, setIsModuleEntriesLoading] = useState(false);
  const [tbiEvaluations, setTbiEvaluations] = useState<TbiEvaluationRecord[]>([]);
  const [binocularVisionEvaluations, setBinocularVisionEvaluations] = useState<BinocularVisionEvaluationRecord[]>([]);
  const [eyeExam, setEyeExam] = useState<EyeExamPayload>(createEmptyEyeExam);
  const [contactLens, setContactLens] = useState<ContactLensPayload>(createEmptyContactLens);
  const [lowVision, setLowVision] = useState<LowVisionPayload>(createEmptyLowVision);
  const [isMyopiaLoading, setIsMyopiaLoading] = useState(false);
  const [myopiaError, setMyopiaError] = useState("");
  const [isTbiLoading, setIsTbiLoading] = useState(false);
  const [tbiError, setTbiError] = useState("");
  const [isBinocularVisionLoading, setIsBinocularVisionLoading] = useState(false);
  const [binocularVisionError, setBinocularVisionError] = useState("");
  const [moduleEntryError, setModuleEntryError] = useState("");
  const [hasLoadedTestsTab, setHasLoadedTestsTab] = useState(false);
  const [isHistoricalMyopiaOpen, setIsHistoricalMyopiaOpen] = useState(false);
  const [isMyopiaManagementOpen, setIsMyopiaManagementOpen] = useState(false);
  const [isTbiEvaluationOpen, setIsTbiEvaluationOpen] = useState(false);
  const [isGrowthHistoryOpen, setIsGrowthHistoryOpen] = useState(false);
  const [isEyeExamOpen, setIsEyeExamOpen] = useState(false);
  const [isContactLensOpen, setIsContactLensOpen] = useState(false);
  const [isBinocularVisionOpen, setIsBinocularVisionOpen] = useState(false);
  const [isLowVisionOpen, setIsLowVisionOpen] = useState(false);
  const [isReferralPackageOpen, setIsReferralPackageOpen] = useState(false);
  const [selectedEyeExamEntryId, setSelectedEyeExamEntryId] = useState("");
  const [selectedContactLensEntryId, setSelectedContactLensEntryId] = useState("");
  const [selectedLowVisionEntryId, setSelectedLowVisionEntryId] = useState("");
  const [genericModuleEntryError, setGenericModuleEntryError] = useState("");
  const [openVisitSections, setOpenVisitSections] = useState<Record<"history" | "attachments", boolean>>({
    history: false,
    attachments: false,
  });
  const [currentPatient, setCurrentPatient] = useState<Patient | null>(patient);
  const editor = usePatientEditor({
    patient: currentPatient,
    readOnly,
    onSave,
    onSaved: onClose,
  });
  const chartData = usePatientChartData({
    patientId: currentPatient?.id ?? "",
    isTrainingMode,
    timelineActive: activeTab === "timeline",
    loadVisits: onLoadVisits,
    loadVisitDetail: onLoadVisitDetail,
    loadTimeline: onLoadTimeline,
  });
  const resources = usePatientChartResources({
    patient: currentPatient,
    attachmentsActive: activeTab === "attachments",
    isTrainingMode,
    readOnly,
    onPatientUpdated: (updated) => {
      setCurrentPatient(updated);
      onPatientUpdated?.(updated);
    },
    onAttachmentDeleted: chartData.removeAttachmentFromCachedVisits,
  });
  const initializedPatientIdRef = useRef("");

  useEffect(() => {
    setOpenVisitSections({ history: false, attachments: false });
  }, [chartData.selectedVisitId]);

  useEffect(() => {
    if (!patient) {
      initializedPatientIdRef.current = "";
      setCurrentPatient(null);
      return;
    }

    setCurrentPatient(patient);
    if (initializedPatientIdRef.current === patient.id) {
      return;
    }
    initializedPatientIdRef.current = patient.id;
    setActiveTab("visits");
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
    setIsTbiEvaluationOpen(false);
    setIsBinocularVisionOpen(false);
  }, [patient]);

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
      setIsModuleEntriesLoading(true);
      const moduleEntriesPromise = isTrainingMode
        ? Promise.resolve([] as LongitudinalTrackRecord[])
        : api.listPatientModuleEntries(patientId);
      void moduleEntriesPromise
        .then((entries) => {
          if (!active) return;
          setModuleEntries(entries);
          setModuleEntryError("");
        })
        .catch((loadError) => {
          if (!active) return;
          setModuleEntries([]);
          setModuleEntryError(loadError instanceof Error ? loadError.message : "Failed to load module entries.");
        })
        .finally(() => {
          if (active) setIsModuleEntriesLoading(false);
        });
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
        const [nextMyopiaHistory, nextGrowthHistory, nextTbiEvaluations, nextBinocularVisionEvaluations] = await Promise.allSettled([
          hasMyopiaManagement && onLoadMyopiaHistory ? onLoadMyopiaHistory(patientId) : Promise.resolve(emptyMyopiaHistory),
          hasGrowthMeasurement && onLoadGrowthHistory ? onLoadGrowthHistory(patientId) : Promise.resolve(emptyGrowthHistory),
          hasTbiEvaluation && !isTrainingMode ? api.listPatientTbiEvaluations(patientId) : Promise.resolve([] as TbiEvaluationRecord[]),
          hasBinocularVision && !isTrainingMode ? api.listPatientBinocularVisionEvaluations(patientId) : Promise.resolve([] as BinocularVisionEvaluationRecord[]),
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

  if (!currentPatient) {
    return null;
  }

  const myopiaRecords = myopiaHistory?.records ?? [];
  const growthRecords = growthHistory?.records ?? [];
  const latestGrowthRecord = growthRecords[growthRecords.length - 1] ?? null;
  const eyeExamEntries = moduleEntriesFor(moduleEntries, "eye_exam");
  const contactLensEntries = moduleEntriesFor(moduleEntries, "contact_lens");
  const lowVisionEntries = moduleEntriesFor(moduleEntries, "low_vision");

  function toggleVisitSection(section: "history" | "attachments") {
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
      chartData.invalidateTimeline();
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
    const nextContactLens = normalizeContactLensPayload(entry.raw_payload as Partial<ContactLensPayload>);
    setContactLens(nextContactLens);
    setSelectedContactLensEntryId(entry.id);
  }

  function selectLowVisionEntry(entry: LongitudinalTrackRecord) {
    setLowVision(normalizeLowVisionPayload(entry.raw_payload as Partial<LowVisionPayload>));
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
      chartData.invalidateTimeline();
      setHasLoadedTestsTab(true);
      setActiveTab("tests");
      return saved;
    } catch (saveError) {
      setGenericModuleEntryError(saveError instanceof Error ? saveError.message : "Failed to save entry.");
      throw saveError;
    }
  }

  async function handleSaveContactLens() {
    const saved = await saveStructuredModuleEntry(
      "contact_lens",
      {
        ...contactLens,
        eyes: contactLens.eyes.filter((entry) => hasContactLensEyeData(entry)),
      },
      buildContactLensSummary(contactLens),
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
      chartData.invalidateTimeline();
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

  return (
    <div className={fullScreen ? "flex h-[100dvh] flex-col" : "fixed inset-0 z-30 flex h-[100dvh] flex-col bg-white"}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        {fullScreen ? (
          <>
            {/* app bar: back + breadcrumb */}
            <div className="flex items-center gap-3 border-b border-[#dbe7ef] bg-white/90 px-6 py-2.5 backdrop-blur">
              <button
                type="button"
                onClick={() => { editor.clearError(); onClose(); }}
                className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#bfd7e8] bg-white px-3 text-sm font-semibold text-black transition hover:bg-[#edf5fa]"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <span className="truncate text-sm text-black">
                {fullScreenBackLabel}&nbsp;/&nbsp;<span className="font-semibold text-black">{currentPatient.name}</span>
              </span>
            </div>

            {/* identity header */}
            <div className="border-b border-[#dbe7ef] px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={resources.openProfilePhoto}
                      disabled={!resources.profilePhotoObjectUrl && (readOnly || isTrainingMode)}
                      className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] bg-gradient-to-br from-[#2f8fd3] to-[#245f92] text-xl font-bold text-white shadow-[0_10px_22px_rgba(37,111,168,0.28)] transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#6daed8] disabled:cursor-default disabled:hover:opacity-100"
                      aria-label={currentPatient.profile_photo_url && !readOnly && !isTrainingMode ? "Manage patient photo" : currentPatient.profile_photo_url ? "Open patient photo" : "Add patient photo"}
                    >
                      {resources.profilePhotoObjectUrl ? (
                        <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={resources.profilePhotoObjectUrl} alt={`${currentPatient.name} profile photo`} className="h-full w-full object-cover" />
                        </>
                      ) : (
                        <span aria-hidden="true">{patientInitials(currentPatient)}</span>
                      )}
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-2xl font-bold text-slate-900">{currentPatient.name}</h2>
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
                              chip.key ? "border-[#bfe0f5] bg-[#ecf6fd] text-[#2a6fa8]" : "border-[#dbe7ef] bg-[#f3f8fb] text-black"
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
                  {canAssignDoctor && onAssignDoctor && !readOnly && !isTrainingMode ? (
                    <button
                      type="button"
                      onClick={() => onAssignDoctor(currentPatient)}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#2f8fd3] bg-white px-4 text-sm font-semibold text-[#287fc0] transition hover:bg-[#edf5fa]"
                    >
                      <UserRound className="h-4 w-4" /> Assign Doctor
                    </button>
                  ) : null}
                  {canRefer && !readOnly && !isTrainingMode ? (
                    <button
                      type="button"
                      onClick={() => setIsReferralPackageOpen(true)}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#2f8fd3] bg-white px-4 text-sm font-semibold text-[#287fc0] transition hover:bg-[#edf5fa]"
                    >
                      <Mail className="h-4 w-4" /> Refer
                    </button>
                  ) : null}
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={editor.toggleEditing}
                      className={`inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${
                        editor.isEditing ? "border-[#9fc7e1] bg-[#edf5fa] text-[#2a6fa8]" : "border-[#bfd7e8] bg-white text-black hover:bg-[#edf5fa]"
                      }`}
                    >
                      <Pencil className="h-4 w-4" /> Edit
                    </button>
                  ) : null}
                  {workflowActionLabel && onWorkflowAction ? (
                    <button
                      type="button"
                      onClick={() => { editor.clearError(); void onWorkflowAction(); }}
                      disabled={workflowActionDisabled}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-[#14a38b] px-5 text-sm font-semibold text-white shadow-sm shadow-teal-900/10 transition hover:bg-[#108873] disabled:opacity-60"
                    >
                      {workflowActionLabel}
                    </button>
                  ) : null}
                </div>
              </div>
              <PatientEditorForm workflow={editor} />
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
                    {chartData.isSummaryLoading && !chartData.summary ? (
                      <div className="space-y-2">
                        <div className="h-3 w-11/12 animate-pulse rounded bg-[#d7e9f7]" />
                        <div className="h-3 w-9/12 animate-pulse rounded bg-[#d7e9f7]" />
                      </div>
                    ) : chartData.summaryError ? (
                      <p className="text-sm text-rose-600">{chartData.summaryError}</p>
                    ) : chartData.summary?.summary ? (
                      <div className="space-y-1.5">
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-black">{chartData.summary.summary}</p>
                        {chartData.summary.stale ? (
                          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6d8191]">Summary needs refresh</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-[13px] text-black">No summary available yet.</p>
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
                    className={`relative py-3.5 text-sm font-semibold text-black transition ${isActive ? "text-[#287fc0]" : "hover:text-[#287fc0]"}`}
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
                  onClick={resources.openProfilePhoto}
                  disabled={!resources.profilePhotoObjectUrl && (readOnly || isTrainingMode)}
                  className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-[#dbe7ef] bg-[#f3f8fb] text-2xl font-semibold text-[#2a6fa8] shadow-[0_10px_26px_rgba(64,131,181,0.08)] transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#6daed8] disabled:cursor-default disabled:hover:opacity-100"
                  aria-label={currentPatient.profile_photo_url && !readOnly && !isTrainingMode ? "Manage patient photo" : currentPatient.profile_photo_url ? "Open patient photo" : "Add patient photo"}
                >
                  {resources.profilePhotoObjectUrl ? (
                    <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resources.profilePhotoObjectUrl}
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
                <h2 className="mt-2 truncate text-3xl font-semibold text-slate-900">{currentPatient.name}</h2>
                <p className="mt-2 text-sm text-slate-950">{patientMetadataLine(currentPatient)}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  editor.clearError();
                  onClose();
                }}
                className="rounded-xl border border-[#dbe7ef] p-2 text-black transition hover:text-[#287fc0]"
                aria-label="Close patient chart"
              >
                <X className="h-4 w-4" />
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={editor.toggleEditing}
                  className={`rounded-xl border p-2 transition ${
                    editor.isEditing
                      ? "border-[#9fc7e1] bg-[#edf5fa] text-[#2a6fa8]"
                      : "border-[#dbe7ef] text-black hover:text-[#287fc0]"
                  }`}
                  aria-label="Edit patient details"
                  title="Edit patient details"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
          <PatientEditorForm workflow={editor} />
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
            {canAssignDoctor && onAssignDoctor && !readOnly && !isTrainingMode ? (
              <button
                type="button"
                onClick={() => onAssignDoctor(currentPatient)}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#2f8fd3] bg-white px-4 text-sm font-semibold text-[#287fc0] transition hover:bg-[#edf5fa] sm:ml-auto sm:w-auto"
              >
                <UserRound className="h-4 w-4" /> Assign Doctor
              </button>
            ) : null}
            {canRefer && !readOnly && !isTrainingMode ? (
              <button
                type="button"
                onClick={() => setIsReferralPackageOpen(true)}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#2f8fd3] bg-white px-4 text-sm font-semibold text-[#287fc0] transition hover:bg-[#edf5fa] sm:ml-auto sm:w-auto"
              >
                <Mail className="h-4 w-4" /> Refer
              </button>
            ) : null}
            {workflowActionLabel && onWorkflowAction ? (
              <button
                type="button"
                onClick={() => {
                  editor.clearError();
                  void onWorkflowAction();
                }}
                disabled={workflowActionDisabled}
                className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#14a38b] px-4 text-sm font-medium text-white shadow-sm shadow-teal-900/10 transition hover:bg-[#108873] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14a38b]/30 disabled:opacity-60 sm:w-auto"
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
              <div className="-mx-5 -mt-5 mb-4 border-b border-[#cfe3f3] bg-gradient-to-br from-[#f3f9fe] to-[#eaf4fc] px-5 py-4 sm:-mx-7 sm:px-7 sm:py-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#2f8fd3]/10 text-[#2f8fd3]">
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-sm font-semibold text-[#1d4d72]">Summary</span>
                  </div>
                </div>

                <div className="mt-3">
                  {chartData.isSummaryLoading && !chartData.summary ? (
                    <div className="space-y-2">
                      <div className="h-3 w-11/12 animate-pulse rounded bg-[#d7e9f7]" />
                      <div className="h-3 w-9/12 animate-pulse rounded bg-[#d7e9f7]" />
                      <div className="h-3 w-10/12 animate-pulse rounded bg-[#d7e9f7]" />
                    </div>
                  ) : chartData.summaryError ? (
                    <p className="text-sm text-rose-600">{chartData.summaryError}</p>
                  ) : chartData.summary?.summary ? (
                    <div className="space-y-1.5">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-black">
                        {chartData.summary.summary}
                      </p>
                      {chartData.summary.stale ? (
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6d8191]">Summary needs refresh</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-black">No summary available yet.</p>
                  )}
                </div>
              </div>
            ) : null}
            {activeTab === "visits" ? (
              <div className="grid min-h-0 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="self-start rounded-xl border border-[#dbe7ef] bg-white p-3">
                  {chartData.visitsError ? <p className="mt-2 text-sm text-rose-600">{chartData.visitsError}</p> : null}
                  <div className="max-h-[58vh] space-y-1.5 overflow-y-auto pr-1">
                    {chartData.visits.length ? (
                      chartData.visits.map((visit) => (
                        <button
                          key={visit.id}
                          type="button"
                          onClick={() => chartData.selectVisit(visit.id)}
                          className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                            visit.id === chartData.selectedVisit?.id
                              ? "border-[#9fc7e1] bg-[#f3f8fb] shadow-[inset_3px_0_0_#2f8fd3]"
                              : "border-transparent bg-white hover:border-[#dbe7ef] hover:bg-[#f7fbfd]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="rounded-lg bg-[#f3f8fb] p-1.5 ring-1 ring-[#dbe7ef]">
                                <UserRound className="h-4 w-4 text-[#2f8fd3]" />
                              </div>
                              <p className="truncate text-sm font-semibold text-black">Visit {visit.visit_number}</p>
                            </div>
                            <p className="shrink-0 text-xs text-black">{formatDateTime(visit.created_at)}</p>
                          </div>
                        </button>
                      ))
                    ) : !chartData.isVisitsLoading ? (
                      <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-white px-4 py-8 text-center text-sm text-black">
                        No visits recorded yet.
                      </div>
                    ) : null}
                  </div>
                </aside>
                <div className="space-y-4">
                  <VisitDetailPanel
                    detail={chartData.selectedVisitDetail}
                    detailError={chartData.visitDetailError}
                    isLoadingDetail={chartData.loadingVisitDetailId === chartData.selectedVisit?.id}
                    onOpenVisitAttachment={resources.openVisitAttachment}
                    openSections={openVisitSections}
                    selectedVisit={chartData.selectedVisit}
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
              <PatientAttachmentsPanel workflow={resources} />
            ) : null}

            {activeTab === "timeline" ? (
              <TimelinePanel
                error={chartData.timelineError}
                isLoading={chartData.isTimelineLoading}
                timeline={chartData.timeline}
                fullScreen={fullScreen}
              />
            ) : null}
          </div>
        </section>

        <PatientEditorFooter
          workflow={editor}
          profilePhotoError={resources.profilePhotoError}
          readOnly={readOnly}
        />
      </div>
      <PatientChartResourceOverlays workflow={resources} />
      {canRefer && !readOnly && !isTrainingMode ? (
        <ReferralPackageModal
          open={isReferralPackageOpen}
          patient={currentPatient}
          onClose={() => setIsReferralPackageOpen(false)}
        />
      ) : null}
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
        isLoading={isModuleEntriesLoading}
        entries={eyeExamEntries}
        selectedEntryId={selectedEyeExamEntryId}
        onClose={() => setIsEyeExamOpen(false)}
        onNew={() => startNewStructuredModule("eye_exam")}
        onSelectEntry={selectEyeExamEntry}
      >
        <EyeExamModal
          open
          value={eyeExam}
          onDraftChange={setEyeExam}
          inline
          onClose={() => setIsEyeExamOpen(false)}
          onSave={async (next) => {
            setEyeExam(next);
            const saved = await saveStructuredModuleEntry("eye_exam", next as unknown as Record<string, unknown>, buildEyeExamSummary(next));
            if (saved) setSelectedEyeExamEntryId(saved.id);
          }}
        />
        {genericModuleEntryError ? <p className="mt-3 text-sm font-medium text-rose-600">{genericModuleEntryError}</p> : null}
      </PatientStructuredModuleShell>
      <PatientStructuredModuleShell
        open={isContactLensOpen}
        patient={currentPatient}
        moduleKey="contact_lens"
        isLoading={isModuleEntriesLoading}
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
        isLoading={isModuleEntriesLoading}
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
          onDraftChange={setLowVision}
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
