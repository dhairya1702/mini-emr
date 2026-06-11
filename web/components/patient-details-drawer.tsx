"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronDown, Clock3, FileText, Image as ImageIcon, Pencil, UserRound, X } from "lucide-react";

import type { ClinicSpecialty } from "@/lib/clinic-specialty";
import { HistoricalMyopiaModal } from "@/components/optometry/myopia/historical-myopia-modal";
import { MyopiaManagementModal } from "@/components/optometry/myopia/myopia-management-modal";
import { api } from "@/lib/api";
import { formatMillimeterDelta } from "@/lib/optometry/myopia/shared";
import { specialtyHasModule } from "@/lib/specialty";
import { createTrainingId } from "@/lib/training-mode";
import {
  ConsultationNote,
  MyopiaHistory,
  MyopiaMeasurementPayload,
  NoteAsset,
  Patient,
  PatientAttachment,
  PatientChartVisit,
  PatientVisitAttachmentRow,
  PatientVisitDetail,
  PatientTimelineEvent,
  PediatricGrowthSummary,
} from "@/lib/types";

type ChartTab = "visits" | "attachments" | "tests";

interface PatientDetailsDrawerProps {
  patient: Patient | null;
  clinicSpecialty?: ClinicSpecialty | null;
  onClose: () => void;
  onLoadVisits: (patientId: string) => Promise<PatientChartVisit[]>;
  onLoadVisitDetail: (patientId: string, visitId: string) => Promise<PatientVisitDetail>;
  onLoadMyopiaHistory?: (patientId: string) => Promise<MyopiaHistory>;
  onLoadGrowthHistory?: (patientId: string) => Promise<PediatricGrowthSummary>;
  isTrainingMode?: boolean;
  readOnly?: boolean;
  onSave: (payloadPatientId: string, payload: {
    name: string;
    phone: string;
    email: string;
    address: string;
    reason: string;
    age: number;
    weight: number;
    height: number | null;
    temperature: number;
  }) => Promise<void>;
}

function detailText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function assetDataUrl(asset: NoteAsset) {
  return `data:${asset.content_type};base64,${asset.data_base64}`;
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

function getPhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function patientMetadataLine(patient: Patient) {
  const parts = [
    patient.phone,
    typeof patient.age === "number" ? `Age ${patient.age}` : "",
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
  const details = (event.details ?? {}) as Record<string, unknown>;
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
          <p className="mt-2 text-sm leading-6 text-slate-600">{event.description}</p>
          {event.type === "consultation_note" && detailText(details.content) ? (
            <div className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#dbe7ef] bg-[#f7fbfd] px-3 py-2 text-sm leading-6 text-slate-700">
              {detailText(details.content)}
            </div>
          ) : null}
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
  openSections: Record<"note" | "attachments" | "other", boolean>;
  selectedVisit: PatientChartVisit | null;
  toggleSection: (section: "note" | "attachments" | "other") => void;
}) {
  if (!selectedVisit) {
    return (
      <section className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-6 py-10 text-center text-sm text-slate-500">
        No visits recorded yet.
      </section>
    );
  }

  const attachments = detail?.attachments ?? [];
  const relatedTimeline = detail?.timeline ?? [];
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

      {relatedTimeline.length || isLoadingDetail ? (
        <CollapsibleSection
          description="Timeline"
          count={relatedTimeline.length}
          isOpen={openSections.other}
          onToggle={() => toggleSection("other")}
        >
          {isLoadingDetail ? (
            <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-8 text-center text-sm text-slate-500">
              Loading timeline...
            </div>
          ) : relatedTimeline.length ? (
            <div className="space-y-2.5">
              {relatedTimeline.map((event) => <EventSummaryCard key={event.id} event={event} />)}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-4 py-8 text-center text-sm text-slate-500">
              No related records on this visit yet.
            </div>
          )}
        </CollapsibleSection>
      ) : null}
    </div>
  );
}

function TestsPanel({
  growthHistory,
  growthRecords,
  isOptometryClinic,
  isPediatricsClinic,
  latestGrowthRecord,
  measurementCount,
  myopiaError,
  myopiaHistory,
  onOpenMyopiaManagement,
}: {
  growthHistory: PediatricGrowthSummary | null;
  growthRecords: PediatricGrowthSummary["records"];
  isOptometryClinic: boolean;
  isPediatricsClinic: boolean;
  latestGrowthRecord: PediatricGrowthSummary["records"][number] | null;
  measurementCount: number;
  myopiaError: string;
  myopiaHistory: MyopiaHistory | null;
  onOpenMyopiaManagement: () => void;
}) {
  return (
    <div className="space-y-5">
      {isOptometryClinic ? (
        <section className="rounded-xl border border-[#dbe7ef] bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Myopia</p>
              <h4 className="mt-1 text-xl font-semibold text-slate-900">
                {measurementCount} readings · OD {formatMillimeterDelta(myopiaHistory?.baseline_delta?.right_mm)} · OS {formatMillimeterDelta(myopiaHistory?.baseline_delta?.left_mm)}
              </h4>
              {myopiaError ? <p className="mt-2 text-sm text-rose-600">{myopiaError}</p> : null}
            </div>
            <button
              type="button"
              onClick={onOpenMyopiaManagement}
              className="shrink-0 rounded-lg border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb]"
            >
              Open
            </button>
          </div>
        </section>
      ) : null}

      {isPediatricsClinic ? (
        <section className="rounded-xl border border-amber-100 bg-white p-5">
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Pediatric growth</p>
          <h4 className="mt-1 text-xl font-semibold text-slate-900">
            {growthRecords.length} readings · {latestGrowthRecord ? `${latestGrowthRecord.height_cm} cm · ${latestGrowthRecord.weight_kg} kg` : "No latest measurement"}
          </h4>
          <p className="mt-2 text-sm text-slate-500">{growthHistory?.trend_summary || "No trend yet"}</p>
        </section>
      ) : null}

      {!isOptometryClinic && !isPediatricsClinic ? (
        <section className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-6 py-10 text-center text-sm text-slate-500">
          No tests available for this patient yet.
        </section>
      ) : null}
    </div>
  );
}

function AttachmentsPanel({
  attachmentError,
  isLoading,
  noteAssets,
  onOpenPatientAttachment,
  patientAttachments,
}: {
  attachmentError: string;
  isLoading: boolean;
  noteAssets: Array<NoteAsset & { note_id: string; note_created_at: string }>;
  onOpenPatientAttachment: (attachment: PatientAttachment) => void;
  patientAttachments: PatientAttachment[];
}) {
  const rows = [
    ...noteAssets.map((asset) => ({
      id: `note-${asset.note_id}-${asset.id}`,
      label: asset.name,
      timestamp: asset.note_created_at,
      open: () => window.open(assetDataUrl(asset), "_blank", "noopener,noreferrer"),
    })),
    ...patientAttachments.map((attachment) => ({
      id: `patient-${attachment.id}`,
      label: attachment.file_name,
      timestamp: attachment.created_at,
      open: () => onOpenPatientAttachment(attachment),
    })),
  ].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());

  return (
    <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5">
      {isLoading ? <div className="flex justify-end"><span className="text-xs text-slate-500">Loading...</span></div> : null}
      {attachmentError ? <p className="mt-3 text-sm text-rose-600">{attachmentError}</p> : null}
      <div className={`${attachmentError || isLoading ? "mt-4" : ""} divide-y divide-[#edf3f8]`}>
        {rows.length ? (
          rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={row.open}
              className="flex w-full items-center justify-between gap-4 py-3 text-left transition hover:bg-[#f7fbfd]"
            >
              <p className="min-w-0 truncate text-sm font-medium text-slate-900">{row.label}</p>
              <p className="shrink-0 text-xs text-slate-500">{formatDateTime(row.timestamp)}</p>
            </button>
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
  onClose,
  onLoadVisits,
  onLoadVisitDetail,
  onLoadMyopiaHistory,
  onLoadGrowthHistory,
  isTrainingMode = false,
  readOnly = false,
  onSave,
}: PatientDetailsDrawerProps) {
  const isOptometryClinic = specialtyHasModule(clinicSpecialty, "myopia_management");
  const isPediatricsClinic = specialtyHasModule(clinicSpecialty, "pediatric_growth_measurement");
  const [activeTab, setActiveTab] = useState<ChartTab>("visits");
  const [isEditingPatient, setIsEditingPatient] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    reason: "",
    age: "",
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
  const [attachmentError, setAttachmentError] = useState("");
  const [myopiaHistory, setMyopiaHistory] = useState<MyopiaHistory | null>(null);
  const [growthHistory, setGrowthHistory] = useState<PediatricGrowthSummary | null>(null);
  const [isMyopiaLoading, setIsMyopiaLoading] = useState(false);
  const [myopiaError, setMyopiaError] = useState("");
  const [hasLoadedAttachmentsTab, setHasLoadedAttachmentsTab] = useState(false);
  const [hasLoadedTestsTab, setHasLoadedTestsTab] = useState(false);
  const [isHistoricalMyopiaOpen, setIsHistoricalMyopiaOpen] = useState(false);
  const [isMyopiaManagementOpen, setIsMyopiaManagementOpen] = useState(false);
  const [openVisitSections, setOpenVisitSections] = useState<Record<"note" | "attachments" | "other", boolean>>({
    note: false,
    attachments: false,
    other: false,
  });
  const [selectedVisitId, setSelectedVisitId] = useState("");

  useEffect(() => {
    setOpenVisitSections({ note: false, attachments: false, other: false });
  }, [selectedVisitId]);

  useEffect(() => {
    if (!patient) {
      return;
    }

    setForm({
      name: patient.name,
      phone: patient.phone,
      email: patient.email ?? "",
      address: patient.address ?? "",
      reason: patient.reason,
      age: patient.age?.toString() ?? "",
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
    setIsAttachmentsLoading(false);
    setHasLoadedAttachmentsTab(false);
    setMyopiaHistory(null);
    setGrowthHistory(null);
    setMyopiaError("");
    setIsMyopiaLoading(false);
    setHasLoadedTestsTab(false);
    setSelectedVisitId("");
  }, [patient]);

  useEffect(() => {
    if (!patient) {
      setVisits([]);
      setIsVisitsLoading(false);
      setVisitsError("");
      setVisitDetailsById({});
      setVisitDetailError("");
      setLoadingVisitDetailId("");
      setSelectedVisitId("");
      return;
    }

    const currentPatient = patient;
    let active = true;

    async function loadVisits() {
      setIsVisitsLoading(true);
      setVisitsError("");
      try {
        const rows = await onLoadVisits(currentPatient.id);
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
  }, [onLoadVisits, patient]);

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
        const detail = await onLoadVisitDetail(patientId, selectedVisitId);
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
  }, [onLoadVisitDetail, patient, selectedVisitId, visitDetailsById]);

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
      setIsMyopiaLoading(true);
      setMyopiaError("");
      try {
        const [nextMyopiaHistory, nextGrowthHistory] = await Promise.all([
          isOptometryClinic && onLoadMyopiaHistory
            ? onLoadMyopiaHistory(patientId)
            : Promise.resolve({
                patient_id: patientId,
                records: [],
                baseline_delta: null,
                last_delta: null,
                annualized_growth: null,
                overlay_version: "clinic-reference-v1",
              } satisfies MyopiaHistory),
          isPediatricsClinic && onLoadGrowthHistory
            ? onLoadGrowthHistory(patientId)
            : Promise.resolve({
                patient_id: patientId,
                latest_measurement: null,
                previous_measurement: null,
                interval_change: null,
                trend_summary: "",
                flags: [],
                records: [],
              } satisfies PediatricGrowthSummary),
        ]);
        if (!active) {
          return;
        }
        setMyopiaHistory(nextMyopiaHistory);
        setGrowthHistory(nextGrowthHistory);
        setHasLoadedTestsTab(true);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setMyopiaHistory(null);
        setGrowthHistory(null);
        setMyopiaError(loadError instanceof Error ? loadError.message : "Failed to load tests.");
      } finally {
        if (active) {
          setIsMyopiaLoading(false);
        }
      }
    }

    void loadTests();
    return () => {
      active = false;
    };
  }, [activeTab, hasLoadedTestsTab, isOptometryClinic, isPediatricsClinic, onLoadGrowthHistory, onLoadMyopiaHistory, patient]);

  const noteAssets = useMemo(() => {
    const rows: Array<NoteAsset & { note_id: string; note_created_at: string }> = [];
    for (const note of notes) {
      const assets = note.snapshot_asset_payload?.length ? note.snapshot_asset_payload : note.asset_payload || [];
      for (const asset of assets) {
        if (asset.kind === "attachment") {
          rows.push({ ...asset, note_id: note.id, note_created_at: note.finalized_at || note.created_at });
        }
      }
    }
    return rows;
  }, [notes]);

  const currentPatient = patient;

  if (!currentPatient) {
    return null;
  }

  const selectedVisit = visits.find((visit) => visit.id === selectedVisitId) ?? visits[0] ?? null;
  const selectedVisitDetail = selectedVisit ? visitDetailsById[selectedVisit.id] ?? null : null;
  const myopiaRecords = myopiaHistory?.records ?? [];
  const growthRecords = growthHistory?.records ?? [];
  const measurementCount = myopiaRecords.length;
  const latestGrowthRecord = growthRecords[growthRecords.length - 1] ?? null;

  function toggleVisitSection(section: "note" | "attachments" | "other") {
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

  async function handleOpenPatientAttachment(attachment: PatientAttachment) {
    try {
      const blob = await api.downloadPatientAttachment(attachment.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (downloadError) {
      setAttachmentError(downloadError instanceof Error ? downloadError.message : "Failed to open attachment.");
    }
  }

  async function handleOpenVisitAttachment(attachment: PatientVisitAttachmentRow) {
    if (attachment.source_type === "note_attachment" && attachment.data_base64) {
      window.open(`data:${attachment.content_type};base64,${attachment.data_base64}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (attachment.attachment_id) {
      if (!currentPatient) {
        return;
      }
      await handleOpenPatientAttachment({
        id: attachment.attachment_id,
        org_id: "",
        patient_id: currentPatient.id,
        uploaded_by: null,
        file_name: attachment.label,
        content_type: attachment.content_type,
        file_size: 0,
        storage_path: "",
        created_at: attachment.timestamp,
      });
    }
  }

  async function handleSave() {
    if (readOnly || !patient) {
      return;
    }

    const digits = getPhoneDigits(form.phone);
    const age = Number(form.age);
    const weight = Number(form.weight);
    const temperature = Number(form.temperature);
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
    if (!Number.isFinite(age) || age <= 0) {
      setError("Enter a valid age.");
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      setError("Enter a valid weight.");
      return;
    }
    if (!Number.isFinite(temperature) || temperature < 90 || temperature > 110) {
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
      await onSave(patient.id, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: normalizedEmail,
        address: form.address.trim(),
        reason: form.reason.trim(),
        age,
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
    <div className="fixed inset-0 z-30 bg-slate-950/35 p-3 backdrop-blur-sm sm:p-5">
      <div className="mx-auto flex h-full max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-[20px] border border-[#dbe7ef] bg-white shadow-[0_35px_90px_rgba(15,23,42,0.18)]">
        <div className="border-b border-[#dbe7ef] px-5 py-4 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Patient Chart</p>
              <h2 className="mt-2 truncate text-3xl font-semibold text-slate-900">{currentPatient.name}</h2>
              <p className="mt-2 text-sm text-slate-500">{patientMetadataLine(currentPatient)}</p>
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
                <SummaryField label="Age" value={form.age} readOnly={false} inputMode="numeric" onChange={(value) => { setError(""); setForm((current) => ({ ...current, age: value })); }} />
                <SummaryField label="Reason" value={form.reason} readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, reason: value })); }} />
                <SummaryField label="Email" value={form.email} type="email" readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, email: value })); }} />
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(180px,1.35fr)_repeat(4,minmax(110px,0.8fr))]">
                <SummaryField label="Address" value={form.address} readOnly={false} onChange={(value) => { setError(""); setForm((current) => ({ ...current, address: value })); }} />
                <SummaryField label="Weight" value={form.weight} readOnly={false} inputMode="decimal" onChange={(value) => { setError(""); setForm((current) => ({ ...current, weight: value })); }} />
                <SummaryField label="Height" value={form.height} readOnly={false} inputMode="decimal" onChange={(value) => { setError(""); setForm((current) => ({ ...current, height: value })); }} />
                <SummaryField label="Temp" value={form.temperature} readOnly={false} inputMode="decimal" onChange={(value) => { setError(""); setForm((current) => ({ ...current, temperature: value })); }} />
              </div>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <ChartTabButton active={activeTab === "visits"} count={visits.length} label="Visits" onClick={() => setActiveTab("visits")} />
            <ChartTabButton
              active={activeTab === "tests"}
              count={measurementCount + growthRecords.length}
              label="Tests"
              onClick={() => setActiveTab("tests")}
            />
            <ChartTabButton
              active={activeTab === "attachments"}
              count={noteAssets.length + patientAttachments.length}
              label="Attachments"
              onClick={() => setActiveTab("attachments")}
            />
          </div>
        </div>

        <section className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="w-full">
            {activeTab === "visits" ? (
              <div className="grid min-h-0 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="self-start rounded-xl border border-[#dbe7ef] bg-white p-3">
                  {isVisitsLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
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
                growthHistory={growthHistory}
                growthRecords={growthRecords}
                isOptometryClinic={isOptometryClinic}
                isPediatricsClinic={isPediatricsClinic}
                latestGrowthRecord={latestGrowthRecord}
                measurementCount={measurementCount}
                myopiaError={myopiaError}
                myopiaHistory={myopiaHistory}
                onOpenMyopiaManagement={() => setIsMyopiaManagementOpen(true)}
              />
            ) : null}

            {activeTab === "attachments" ? (
              <AttachmentsPanel
                attachmentError={attachmentError}
                isLoading={isAttachmentsLoading}
                noteAssets={noteAssets}
                onOpenPatientAttachment={handleOpenPatientAttachment}
                patientAttachments={patientAttachments}
              />
            ) : null}
          </div>
        </section>

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
      {isOptometryClinic ? (
        <HistoricalMyopiaModal
          open={isHistoricalMyopiaOpen}
          patientAge={currentPatient.age}
          onClose={() => setIsHistoricalMyopiaOpen(false)}
          onSave={handleSaveHistoricalMyopia}
        />
      ) : null}
      {isOptometryClinic ? (
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
    </div>
  );
}
