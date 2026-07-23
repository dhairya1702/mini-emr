"use client";

import Link from "next/link";
import NextImage from "next/image";
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  Eye,
  FileText,
  Image as ImageIcon,
  LineChart,
  Menu,
  Sparkles,
  X,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { BinocularVisionModal } from "@/components/optometry/binocular-vision-modal";
import { TbiEvaluationModal } from "@/components/optometry/tbi-evaluation-modal";
import { api } from "@/lib/api";
import type {
  ConsultationNote,
  NoteAsset,
  Patient,
  PatientAttachment,
  PatientChartVisit,
  PatientSummary,
  PatientTimelineEvent,
  PatientVisitAttachmentRow,
  PatientVisitDetail,
  PediatricGrowthSummary,
  MyopiaHistory,
  LongitudinalTrackRecord,
  BinocularVisionEvaluationCreatePayload,
  BinocularVisionEvaluationRecord,
  TbiEvaluationCreatePayload,
  TbiEvaluationRecord,
} from "@/lib/types";
import { getSpecialtyModules, specialtyHasModule, type SpecialtyModuleKey } from "@/lib/specialty";
import { formatModuleSummary, moduleEntriesFor, moduleLabel } from "@/lib/structured-modules";

type MobileTab = "visits" | "tests" | "attachments" | "timeline";
type VisitSectionKey = "note" | "attachments";
type PhotoPreview = {
  src: string;
  alt: string;
  title: string;
  isLoading?: boolean;
  revokeOnClose?: boolean;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function noteAttachmentKey(asset: NoteAsset) {
  if (asset.attachment_id?.trim()) {
    return `attachment:${asset.attachment_id.trim()}`;
  }
  return asset.id?.trim()
    ? `id:${asset.id.trim()}`
    : `fallback:${asset.name.trim()}:${asset.content_type.trim()}:${(asset.data_base64 || "").trim()}`;
}

function openNoteAttachmentViewer(asset: NoteAsset) {
  const key = `clinic_note_attachment:${globalThis.crypto?.randomUUID?.() || `${Date.now()}`}`;
  window.sessionStorage.setItem(key, JSON.stringify(asset));
  window.open(`/attachment-view/note?key=${encodeURIComponent(key)}`, "_blank");
}

function openPatientAttachmentViewer(attachmentId: string) {
  window.open(`/attachment-view/${attachmentId}`, "_blank");
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
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/90 p-3" role="dialog" aria-modal="true" aria-label={preview.title}>
      <button type="button" className="absolute inset-0 cursor-zoom-out" onClick={onClose} aria-label="Close photo preview" />
      <div className="relative z-10 flex h-full w-full flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-white">
          <p className="min-w-0 flex-1 truncate text-sm font-bold">{preview.title}</p>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 text-white" aria-label="Close photo preview">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[16px] bg-slate-950/50">
          {preview.isLoading ? (
            <p className="px-6 py-16 text-sm text-slate-200">Opening photo...</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.src} alt={preview.alt} className="max-h-full max-w-full object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}

function shortDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString([], { month: "short", day: "numeric" });
}

function isImageName(name: string) {
  return /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(name.trim());
}

type RailColor = "accent" | "dim" | "amber" | "green";

const RAIL_NODE_CLASS: Record<RailColor, string> = {
  accent: "bg-[#2f8fd3] border-[#ecf6fd]",
  dim: "bg-[#9fc7e1] border-[#ecf6fd]",
  amber: "bg-[#f0b44c] border-[#fff2da]",
  green: "bg-[#4f9cf7] border-[#e2eefb]",
};

function timelineMeta(type: PatientTimelineEvent["type"]): { label: string; color: RailColor; kindClass: string } {
  const value = String(type || "").toLowerCase();
  if (value.includes("eval") || value.includes("measurement")) {
    return { label: "Test", color: "amber", kindClass: "text-[#b45309]" };
  }
  if (value.includes("attachment") || value.includes("file")) {
    return { label: "File", color: "green", kindClass: "text-[#2f7d55]" };
  }
  if (value.includes("invoice") || value.includes("bill")) {
    return { label: "Billing", color: "green", kindClass: "text-[#2f7d55]" };
  }
  if (value.includes("follow_up")) {
    return { label: "Follow-up", color: "accent", kindClass: "text-[#2a6fa8]" };
  }
  return { label: "Visit", color: "accent", kindClass: "text-[#2a6fa8]" };
}

const TAB_ITEMS: { key: MobileTab; label: string }[] = [
  { key: "visits", label: "Visits" },
  { key: "tests", label: "Tests" },
  { key: "attachments", label: "Files" },
  { key: "timeline", label: "Timeline" },
];

function StickyTabs({ active, onSelect }: { active: MobileTab; onSelect: (tab: MobileTab) => void }) {
  return (
    <div className="sticky top-0 z-20 border-b border-[#dbe7ef] bg-[#fbfdff]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[44rem] px-4">
        {TAB_ITEMS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelect(tab.key)}
              className={`relative flex-1 py-3 text-center text-[13px] font-semibold transition ${
                isActive ? "text-[#287fc0]" : "text-slate-400"
              }`}
            >
              {tab.label}
              {isActive ? <span className="absolute inset-x-3 -bottom-px h-[2.5px] rounded bg-[#2f8fd3]" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="mb-2.5 mt-4 flex items-baseline justify-between">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{title}</h2>
      {meta ? <span className="text-xs text-slate-400">{meta}</span> : null}
    </div>
  );
}

function RailItem({
  color = "accent",
  last = false,
  children,
}: {
  color?: RailColor;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border-[3px] ${RAIL_NODE_CLASS[color]}`} />
        {last ? null : <span className="my-1 w-0.5 flex-1 bg-[#dbe7ef]" />}
      </div>
      <div className="min-w-0 flex-1 pb-2">{children}</div>
    </div>
  );
}

function InfoTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#bfe0f5] bg-white px-2 py-0.5 text-[10.5px] font-semibold text-[#2a6fa8]">
      {children}
    </span>
  );
}

function HeroStat({ label, value, divider = false }: { label: string; value: string; divider?: boolean }) {
  return (
    <div className={`relative flex-1 text-center ${divider ? "before:absolute before:left-0 before:top-0.5 before:bottom-0.5 before:w-px before:bg-white/20" : ""}`}>
      <p className="text-[10px] uppercase tracking-[0.08em] text-white/70">{label}</p>
      <p className="mt-0.5 text-sm font-bold">{value}</p>
    </div>
  );
}

function VisitDetailSection({
  title,
  count,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-[#dbe7ef] bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-800">
          {title}
          {typeof count === "number" ? (
            <span className="rounded-full border border-[#bfe0f5] bg-[#ecf6fd] px-2 py-0.5 text-[11px] font-bold text-[#2a6fa8]">
              {count}
            </span>
          ) : null}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${isOpen ? "rotate-180" : "rotate-0"}`} />
      </button>
      {isOpen ? <div className="border-t border-[#dbe7ef] px-3.5 py-3">{children}</div> : null}
    </div>
  );
}

const MODULE_ICON: Partial<Record<SpecialtyModuleKey, typeof Activity>> = {
  myopia_management: Eye,
  tbi_evaluation: Activity,
  pediatric_growth_measurement: LineChart,
};

function TestsTab({
  clinicSpecialty,
  growthHistory,
  isLoading,
  moduleEntries,
  myopiaError,
  myopiaHistory,
  onOpenModule,
  onOpenBinocularVision,
  onOpenTbiEvaluation,
  binocularVisionError,
  binocularVisionEvaluations,
  tbiError,
  tbiEvaluations,
}: {
  clinicSpecialty: Patient["status"] | string | null | undefined;
  growthHistory: PediatricGrowthSummary | null;
  isLoading: boolean;
  moduleEntries: LongitudinalTrackRecord[];
  myopiaError: string;
  myopiaHistory: MyopiaHistory | null;
  onOpenModule: (moduleKey: SpecialtyModuleKey) => void;
  onOpenBinocularVision: () => void;
  onOpenTbiEvaluation: () => void;
  binocularVisionError: string;
  binocularVisionEvaluations: BinocularVisionEvaluationRecord[];
  tbiError: string;
  tbiEvaluations: TbiEvaluationRecord[];
}) {
  const modules = getSpecialtyModules(clinicSpecialty as never);
  const growthRecords = growthHistory?.records ?? [];
  const latestGrowthRecord = growthRecords[growthRecords.length - 1] ?? null;
  const latestMyopiaRecord = myopiaHistory?.records.at(-1) ?? null;
  const latestTbiEvaluation = tbiEvaluations.at(-1) ?? null;
  const latestBinocularVisionEvaluation = binocularVisionEvaluations.at(-1) ?? null;

  const rows = modules.map((moduleKey) => {
    if (moduleKey === "myopia_management") {
      const count = myopiaHistory?.records.length ?? 0;
      return {
        key: moduleKey,
        date: latestMyopiaRecord ? shortDate(latestMyopiaRecord.measured_at) : "—",
        count,
        error: myopiaError,
      };
    }
    if (moduleKey === "tbi_evaluation") {
      return {
        key: moduleKey,
        date: latestTbiEvaluation ? shortDate(latestTbiEvaluation.measured_at || latestTbiEvaluation.created_at) : "—",
        count: tbiEvaluations.length,
        error: tbiError,
      };
    }
    if (moduleKey === "binocular_vision") {
      return {
        key: moduleKey,
        date: latestBinocularVisionEvaluation ? shortDate(latestBinocularVisionEvaluation.measured_at || latestBinocularVisionEvaluation.created_at) : "—",
        count: binocularVisionEvaluations.length,
        error: binocularVisionError,
      };
    }
    if (moduleKey === "pediatric_growth_measurement") {
      return {
        key: moduleKey,
        date: latestGrowthRecord ? shortDate(latestGrowthRecord.measured_at) : "—",
        count: growthRecords.length,
        error: "",
      };
    }
    const entries = moduleEntriesFor(moduleEntries, moduleKey);
    const latestEntry = entries[0] ?? null;
    return {
      key: moduleKey,
      date: latestEntry ? shortDate(latestEntry.measured_at) : "—",
      count: entries.length,
      error: "",
    };
  });

  if (isLoading) {
    return <p className="clinic-empty-state">Loading tests...</p>;
  }

  if (!rows.length) {
    return <p className="clinic-empty-state">No tests available for this specialty yet.</p>;
  }

  return (
    <div>
      {myopiaError ? <p className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{myopiaError}</p> : null}
      <div className="-mx-4 border-t border-[#dbe7ef]">
        {rows.map((row) => {
          const Icon = MODULE_ICON[row.key] ?? ClipboardList;
          const subline = row.error
            ? row.error
            : row.count
              ? `${row.count} record${row.count === 1 ? "" : "s"}`
              : "No records yet";
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => {
                if (row.key === "tbi_evaluation") {
                  onOpenTbiEvaluation();
                  return;
                }
                if (row.key === "binocular_vision") {
                  onOpenBinocularVision();
                  return;
                }
                onOpenModule(row.key);
              }}
              className="flex w-full items-center gap-3 border-b border-[#dbe7ef] bg-white px-4 py-3.5 text-left"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-[#dbe7ef] bg-[#f3f8fb] text-[#2f8fd3]">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{moduleLabel(row.key)}</span>
                <span className={`mt-0.5 block text-xs ${row.error ? "text-rose-600" : "text-slate-400"}`}>{subline}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-slate-500">{row.date}</span>
              <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-slate-300" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModuleHistorySheet({
  entries,
  moduleKey,
  onClose,
  onSave,
  value,
  onValueChange,
  isSaving,
}: {
  entries: LongitudinalTrackRecord[];
  moduleKey: SpecialtyModuleKey | null;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  value: string;
  onValueChange: (value: string) => void;
  isSaving: boolean;
}) {
  if (!moduleKey) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/35">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-[0_-16px_48px_rgba(15,23,42,0.24)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Previous Evaluations</p>
            <h3 className="mt-1 text-xl font-semibold text-slate-900">{moduleLabel(moduleKey)}</h3>
          </div>
          <button type="button" onClick={onClose} className="clinic-icon-button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          {entries.length ? entries.map((entry) => (
            <article key={entry.id} className="rounded-xl border border-[#dbe7ef] bg-[#f7fbfd] p-3">
              <p className="text-sm font-semibold text-slate-900">{formatDate(entry.measured_at)}</p>
              <p className="mt-1 text-sm leading-5 text-slate-600">{formatModuleSummary(entry)}</p>
            </article>
          )) : (
            <p className="rounded-xl border border-dashed border-[#bfd7e8] bg-[#f7fbfd] px-3 py-5 text-center text-sm text-slate-500">
              No evaluations yet.
            </p>
          )}
        </div>
        <label className="mt-5 block text-sm font-semibold text-slate-700">
          New
          <textarea
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            rows={5}
            className="mt-2 w-full resize-none rounded-[18px] border border-[#bfd7e8] bg-white px-4 py-3 text-base font-normal leading-6 text-slate-800 outline-none focus:border-[#6daed8]"
          />
        </label>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="mt-4 h-12 w-full rounded-2xl bg-[#2f8fd3] text-sm font-semibold text-white disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

export default function MobilePatientPage() {
  const params = useParams<{ patientId: string }>();
  const patientId = params.patientId;
  const { clinicSettings, currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activeTab, setActiveTab] = useState<MobileTab>("visits");
  const [visits, setVisits] = useState<PatientChartVisit[]>([]);
  const [isVisitsLoading, setIsVisitsLoading] = useState(true);
  const [visitsError, setVisitsError] = useState("");
  const [selectedVisitId, setSelectedVisitId] = useState("");
  const [visitDetailsById, setVisitDetailsById] = useState<Record<string, PatientVisitDetail>>({});
  const [loadingVisitDetailId, setLoadingVisitDetailId] = useState("");
  const [visitDetailError, setVisitDetailError] = useState("");
  const [openSections, setOpenSections] = useState<Record<VisitSectionKey, boolean>>({
    note: false,
    attachments: false,
  });
  const [notes, setNotes] = useState<ConsultationNote[]>([]);
  const [attachments, setAttachments] = useState<PatientAttachment[]>([]);
  const [isAttachmentsLoading, setIsAttachmentsLoading] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState("");
  const [hasLoadedAttachmentsTab, setHasLoadedAttachmentsTab] = useState(false);
  const [myopiaHistory, setMyopiaHistory] = useState<MyopiaHistory | null>(null);
  const [growthHistory, setGrowthHistory] = useState<PediatricGrowthSummary | null>(null);
  const [moduleEntries, setModuleEntries] = useState<LongitudinalTrackRecord[]>([]);
  const [tbiEvaluations, setTbiEvaluations] = useState<TbiEvaluationRecord[]>([]);
  const [binocularVisionEvaluations, setBinocularVisionEvaluations] = useState<BinocularVisionEvaluationRecord[]>([]);
  const [isTestsLoading, setIsTestsLoading] = useState(false);
  const [testsError, setTestsError] = useState("");
  const [hasLoadedTestsTab, setHasLoadedTestsTab] = useState(false);
  const [tbiError, setTbiError] = useState("");
  const [binocularVisionError, setBinocularVisionError] = useState("");
  const [isTbiLoading, setIsTbiLoading] = useState(false);
  const [isBinocularVisionLoading, setIsBinocularVisionLoading] = useState(false);
  const [isTbiEvaluationOpen, setIsTbiEvaluationOpen] = useState(false);
  const [isBinocularVisionOpen, setIsBinocularVisionOpen] = useState(false);
  const [activeModuleKey, setActiveModuleKey] = useState<SpecialtyModuleKey | null>(null);
  const [moduleEntryNotes, setModuleEntryNotes] = useState("");
  const [isSavingModuleEntry, setIsSavingModuleEntry] = useState(false);
  const [patientTimeline, setPatientTimeline] = useState<PatientTimelineEvent[]>([]);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [hasLoadedTimelineTab, setHasLoadedTimelineTab] = useState(false);
  const [error, setError] = useState("");
  const [isUploadingProfilePhoto, setIsUploadingProfilePhoto] = useState(false);
  const [profilePhotoVersion, setProfilePhotoVersion] = useState(0);
  const [profilePhotoObjectUrl, setProfilePhotoObjectUrl] = useState("");
  const [photoPreview, setPhotoPreview] = useState<PhotoPreview | null>(null);
  const [aiSummary, setAiSummary] = useState<PatientSummary | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [isRegeneratingSummary, setIsRegeneratingSummary] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(true);

  useEffect(() => {
    setOpenSections({ note: false, attachments: false });
  }, [selectedVisitId]);

  useEffect(() => {
    setPatientTimeline([]);
    setTimelineError("");
    setIsTimelineLoading(false);
    setHasLoadedTimelineTab(false);
    setTbiEvaluations([]);
    setBinocularVisionEvaluations([]);
    setModuleEntries([]);
    setTbiError("");
    setBinocularVisionError("");
    setIsTbiLoading(false);
    setIsBinocularVisionLoading(false);
    setIsTbiEvaluationOpen(false);
    setIsBinocularVisionOpen(false);
  }, [patientId]);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser || !patientId) {
      return;
    }

    let active = true;
    setIsVisitsLoading(true);
    setVisitsError("");

    Promise.all([api.getPatient(patientId), api.listPatientChartVisits(patientId)])
      .then(([patientRow, visitRows]) => {
        if (!active) {
          return;
        }
        setPatients([patientRow]);
        setVisits(visitRows);
        setSelectedVisitId(visitRows[0]?.id ?? "");
        setError("");
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : "Failed to load patient chart.";
        setError(message);
        setVisitsError(message);
      })
      .finally(() => {
        if (active) {
          setIsVisitsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin, patientId]);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser || !patientId) {
      return;
    }
    let active = true;
    setIsSummaryLoading(true);
    setSummaryError("");
    api
      .getPatientSummary(patientId)
      .then(async (result) => {
        if (active) {
          setAiSummary(result);
        }
        if (result.stale && active) {
          setIsRegeneratingSummary(true);
          try {
            const refreshed = await api.regeneratePatientSummary(patientId);
            if (active) {
              setAiSummary(refreshed);
            }
          } catch (regenerateError) {
            if (active && !result.summary) {
              setSummaryError(
                regenerateError instanceof Error ? regenerateError.message : "Failed to generate summary."
              );
            }
          } finally {
            if (active) {
              setIsRegeneratingSummary(false);
            }
          }
        }
      })
      .catch((loadError) => {
        if (active) {
          setSummaryError(
            loadError instanceof Error ? loadError.message : "Failed to load summary."
          );
        }
      })
      .finally(() => {
        if (active) {
          setIsSummaryLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin, patientId]);

  useEffect(() => {
    if (!patientId || !selectedVisitId || visitDetailsById[selectedVisitId]) {
      return;
    }

    let active = true;
    setLoadingVisitDetailId(selectedVisitId);
    setVisitDetailError("");

    api.getPatientVisitDetail(patientId, selectedVisitId)
      .then((detail) => {
        if (!active) {
          return;
        }
        setVisitDetailsById((current) => ({ ...current, [selectedVisitId]: detail }));
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setVisitDetailError(loadError instanceof Error ? loadError.message : "Failed to load visit detail.");
      })
      .finally(() => {
        if (active) {
          setLoadingVisitDetailId((current) => (current === selectedVisitId ? "" : current));
        }
      });

    return () => {
      active = false;
    };
  }, [patientId, selectedVisitId, visitDetailsById]);

  useEffect(() => {
    if (!patientId || activeTab !== "attachments" || hasLoadedAttachmentsTab) {
      return;
    }

    let active = true;
    setIsAttachmentsLoading(true);
    setAttachmentsError("");

    Promise.all([api.listPatientNotes(patientId), api.listPatientAttachments(patientId)])
      .then(([noteRows, attachmentRows]) => {
        if (!active) {
          return;
        }
        setNotes(noteRows);
        setAttachments(attachmentRows);
        setHasLoadedAttachmentsTab(true);
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setAttachmentsError(loadError instanceof Error ? loadError.message : "Failed to load attachments.");
      })
      .finally(() => {
        if (active) {
          setIsAttachmentsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, hasLoadedAttachmentsTab, patientId]);

  useEffect(() => {
    if (!patientId || activeTab !== "tests" || hasLoadedTestsTab) {
      return;
    }

    let active = true;
    const clinicSpecialty = clinicSettings?.clinic_specialty ?? null;
    const shouldLoadMyopia = specialtyHasModule(clinicSpecialty, "myopia_management");
    const shouldLoadTbi = specialtyHasModule(clinicSpecialty, "tbi_evaluation");
    const shouldLoadBinocularVision = specialtyHasModule(clinicSpecialty, "binocular_vision");
    const shouldLoadGrowth = specialtyHasModule(clinicSpecialty, "pediatric_growth_measurement");
    setIsTestsLoading(true);
    setIsTbiLoading(shouldLoadTbi);
    setIsBinocularVisionLoading(shouldLoadBinocularVision);
    setTestsError("");
    setTbiError("");
    setBinocularVisionError("");

    Promise.all([
      shouldLoadMyopia ? api.getPatientMyopiaHistory(patientId) : Promise.resolve(null),
      shouldLoadGrowth ? api.getPatientGrowthHistory(patientId) : Promise.resolve(null),
      shouldLoadTbi ? api.listPatientTbiEvaluations(patientId) : Promise.resolve([] as TbiEvaluationRecord[]),
      shouldLoadBinocularVision ? api.listPatientBinocularVisionEvaluations(patientId) : Promise.resolve([] as BinocularVisionEvaluationRecord[]),
      api.listPatientModuleEntries(patientId),
    ])
      .then(([myopia, growth, tbi, binocularVision, entries]) => {
        if (!active) {
          return;
        }
        setMyopiaHistory(myopia);
        setGrowthHistory(growth);
        setTbiEvaluations(tbi);
        setBinocularVisionEvaluations(binocularVision);
        setModuleEntries(entries);
        setHasLoadedTestsTab(true);
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setTestsError(loadError instanceof Error ? loadError.message : "Failed to load tests.");
        setTbiError(loadError instanceof Error ? loadError.message : "Failed to load TBI evaluations.");
        setBinocularVisionError(loadError instanceof Error ? loadError.message : "Failed to load binocular vision evaluations.");
      })
      .finally(() => {
        if (active) {
          setIsTestsLoading(false);
          setIsTbiLoading(false);
          setIsBinocularVisionLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, clinicSettings?.clinic_specialty, hasLoadedTestsTab, patientId]);

  useEffect(() => {
    if (!patientId || activeTab !== "timeline" || hasLoadedTimelineTab) {
      return;
    }

    let active = true;
    setIsTimelineLoading(true);
    setTimelineError("");

    api.getPatientTimeline(patientId)
      .then((rows) => {
        if (!active) {
          return;
        }
        setPatientTimeline(rows);
        setHasLoadedTimelineTab(true);
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setPatientTimeline([]);
        setTimelineError(loadError instanceof Error ? loadError.message : "Failed to load timeline.");
      })
      .finally(() => {
        if (active) {
          setIsTimelineLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, hasLoadedTimelineTab, patientId]);

  const patient = useMemo(() => patients.find((row) => row.id === patientId) ?? null, [patientId, patients]);

  useEffect(() => {
    if (!patient?.profile_photo_url) {
      setProfilePhotoObjectUrl("");
      return;
    }

    let active = true;
    let objectUrl = "";

    api.getPatientProfilePhoto(patient.id)
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
  }, [patient?.id, patient?.profile_photo_url, patient?.profile_photo_updated_at, profilePhotoVersion]);

  const selectedVisit = useMemo(
    () => visits.find((visit) => visit.id === selectedVisitId) ?? visits[0] ?? null,
    [selectedVisitId, visits],
  );
  const selectedVisitDetail = selectedVisit ? visitDetailsById[selectedVisit.id] ?? null : null;

  const clinicName = clinicSettings?.clinic_name || "Clinic EMR";

  const initials = useMemo(() => {
    const parts = (patient?.name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return "?";
    }
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
  }, [patient?.name]);

  const sexShort = patient?.sex_at_birth ? String(patient.sex_at_birth)[0]?.toUpperCase() : null;
  const ageLabel = patient
    ? patient.age != null
      ? `${patient.age}${sexShort ? ` · ${sexShort}` : ""}`
      : sexShort || "—"
    : "—";

  const patientWideAttachments = (() => {
    const seen = new Set<string>();
    const noteRows = notes.flatMap((note) => {
      const assets = note.snapshot_asset_payload?.length ? note.snapshot_asset_payload : note.asset_payload || [];
      return assets
        .filter((asset) => asset.kind === "attachment")
        .flatMap((asset) => {
          const key = noteAttachmentKey(asset);
          if (seen.has(key)) {
            return [];
          }
          seen.add(key);
          return [{
            id: `note-${note.id}-${asset.id}`,
            label: asset.name,
            timestamp: note.finalized_at || note.created_at,
            attachmentId: asset.attachment_id,
            contentType: asset.content_type,
            open: () => {
              if (asset.attachment_id) {
                void openLinkedAttachment(asset.attachment_id, asset.name, asset.content_type, note.finalized_at || note.created_at);
                return;
              }
              if (isImageContentType(asset.content_type) && asset.data_base64) {
                openNoteImage(asset);
                return;
              }
              openNoteAttachmentViewer(asset);
            },
          }];
        });
    });
    const noteAttachmentIds = new Set(noteRows.map((row) => row.attachmentId).filter(Boolean));
    const patientRows = attachments
      .filter((attachment) => !noteAttachmentIds.has(attachment.id))
      .map((attachment) => ({
        id: `patient-${attachment.id}`,
        label: attachment.file_name,
        timestamp: attachment.created_at,
        attachmentId: attachment.id,
        contentType: attachment.content_type,
        open: async () => openPatientAttachment(attachment),
      }));
    return [...noteRows, ...patientRows].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
  })();

  function toggleSection(section: VisitSectionKey) {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  }

  async function openVisitAttachment(attachment: PatientVisitAttachmentRow) {
    try {
      if (attachment.attachment_id) {
        await openLinkedAttachment(attachment.attachment_id, attachment.label, attachment.content_type, attachment.timestamp);
        return;
      }
      if (attachment.source_type === "note_attachment" && attachment.data_base64) {
        if (isImageContentType(attachment.content_type)) {
          openNoteImage({
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
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Failed to open attachment.");
    }
  }

  async function openLinkedAttachment(attachmentId: string, label: string, contentType: string, timestamp: string) {
    if (!patient) {
      return;
    }
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

  async function openPatientAttachment(attachment: PatientAttachment) {
    if (!isImageContentType(attachment.content_type)) {
      openPatientAttachmentViewer(attachment.id);
      return;
    }
    setPhotoPreview({
      src: "",
      alt: attachment.file_name || "Patient attachment",
      title: attachment.file_name || "Patient attachment",
      isLoading: true,
    });
    try {
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
    } catch (downloadError) {
      setPhotoPreview(null);
      setError(downloadError instanceof Error ? downloadError.message : "Failed to open attachment.");
    }
  }

  function openNoteImage(asset: NoteAsset) {
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

  function openProfilePhotoPreview() {
    if (!patient || !profilePhotoObjectUrl) {
      return;
    }
    setPhotoPreview({
      src: profilePhotoObjectUrl,
      alt: `${patient.name} profile photo`,
      title: `${patient.name} profile photo`,
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

  async function uploadProfilePhoto(file: File | null | undefined) {
    if (!patient || !file) {
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Only JPG, PNG, and WEBP patient photos are supported.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Patient photo must be 5 MB or smaller.");
      return;
    }

    setIsUploadingProfilePhoto(true);
    setError("");
    try {
      const updated = await api.uploadPatientProfilePhoto(patient.id, file);
      setPatients((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setProfilePhotoVersion((version) => version + 1);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload patient photo.");
    } finally {
      setIsUploadingProfilePhoto(false);
    }
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
      setHasLoadedTimelineTab(false);
      setPatientTimeline([]);
      setHasLoadedTestsTab(true);
      setActiveTab("tests");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save evaluation.";
      setTbiError(message);
      throw saveError;
    } finally {
      setIsTbiLoading(false);
    }
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
      setHasLoadedTimelineTab(false);
      setPatientTimeline([]);
      setHasLoadedTestsTab(true);
      setActiveTab("tests");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save evaluation.";
      setBinocularVisionError(message);
      throw saveError;
    } finally {
      setIsBinocularVisionLoading(false);
    }
  }

  async function saveModuleEntry() {
    if (!patientId || !activeModuleKey) {
      return;
    }
    const notes = moduleEntryNotes.trim();
    if (!notes) {
      setTestsError("Enter notes before saving.");
      return;
    }
    setIsSavingModuleEntry(true);
    setTestsError("");
    try {
      const payload = {
        track_type: activeModuleKey,
        measured_at: new Date().toISOString(),
        summary_fields: { summary: notes },
        raw_payload: { notes },
      };
      const saved = await api.createPatientModuleEntry(patientId, payload);
      setModuleEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setModuleEntryNotes("");
      setActiveModuleKey(null);
      setActiveTab("tests");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save evaluation.";
      setTestsError(message);
      throw saveError;
    } finally {
      setIsSavingModuleEntry(false);
    }
  }

  return (
    <MobileShell title={patient?.name || "Patient"} bleed>
      {({ openMenu }) => (
        <>
          {/* full-bleed hero (absorbs the app bar) */}
          <div className="bg-gradient-to-br from-[#2f8fd3] to-[#245f92] px-4 pb-3.5 pt-3 text-white">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openMenu}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/25 bg-white/15 text-white"
                aria-label="Open menu"
              >
                <Menu className="h-[18px] w-[18px]" />
              </button>
              <span className="flex-1" />
              <span className="text-[11px] font-bold tracking-[0.22em]">{clinicName.toUpperCase()}</span>
              <span className="flex-1" />
              <Link
                href="/m/patients"
                className="grid h-9 w-9 place-items-center rounded-full border border-white/25 bg-white/15 text-white"
                aria-label="Back to patients"
              >
                <ArrowLeft className="h-[18px] w-[18px]" />
              </Link>
            </div>

            {patient ? (
              <>
                <div className="mt-3.5 flex items-center gap-3">
                  {profilePhotoObjectUrl ? (
                    <button
                      type="button"
                      onClick={openProfilePhotoPreview}
                      className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-white/35 bg-white/20 text-[15px] font-bold focus:outline-none focus:ring-2 focus:ring-white/70"
                      aria-label="Open patient photo"
                    >
                      <NextImage unoptimized src={profilePhotoObjectUrl} alt={`${patient.name} profile photo`} width={48} height={48} className="h-full w-full object-cover" />
                      <span className="absolute inset-x-0 bottom-0 bg-slate-950/35 py-0.5 text-center text-[8.5px] font-bold uppercase tracking-[0.08em] text-white">
                        {isUploadingProfilePhoto ? "..." : "Photo"}
                      </span>
                    </button>
                  ) : (
                    <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-white/35 bg-white/20 text-[15px] font-bold">
                      {initials}
                      <span className="absolute inset-x-0 bottom-0 bg-slate-950/35 py-0.5 text-center text-[8.5px] font-bold uppercase tracking-[0.08em] text-white">
                        {isUploadingProfilePhoto ? "..." : "Photo"}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <h1 className="truncate text-lg font-bold leading-tight">{patient.name}</h1>
                    <p className="mt-0.5 truncate text-xs text-white/80">
                      {patient.phone || "No phone"} · {patient.address || "No address on file"}
                    </p>
                    <div className="mt-1.5 flex gap-2">
                      <label className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1 text-[10.5px] font-bold text-white">
                        Upload
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          aria-label="Upload patient photo"
                          disabled={isUploadingProfilePhoto}
                          onChange={(event) => {
                            void uploadProfilePhoto(event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <label className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1 text-[10.5px] font-bold text-white">
                        Camera
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="sr-only"
                          aria-label="Take patient photo"
                          disabled={isUploadingProfilePhoto}
                          onChange={(event) => {
                            void uploadProfilePhoto(event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
                <div className="mt-3.5 flex border-t border-white/20 pt-2.5">
                  <HeroStat label="Age" value={ageLabel} />
                  <HeroStat label="Visits" value={String(visits.length)} divider />
                  <HeroStat label="Last seen" value={shortDate(patient.last_visit_at)} divider />
                </div>
              </>
            ) : (
              <div className="mt-4 h-12" />
            )}
          </div>

          {patient ? (
            <>
              {/* AI summary band (collapsible) */}
              <div className="border-b border-[#bfe0f5] bg-[#ecf6fd] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setIsSummaryOpen((open) => !open)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#2f8fd3]/15 text-[#2f8fd3]">
                    <Sparkles className="h-3 w-3" />
                  </span>
                  <span className="flex-1 text-xs font-bold tracking-[0.04em] text-[#1d4d72]">AI SUMMARY</span>
                  {isRegeneratingSummary ? <span className="text-[11px] font-medium text-[#2f6c98]">Updating…</span> : null}
                  <ChevronDown className={`h-4 w-4 text-[#2a6fa8] transition ${isSummaryOpen ? "" : "-rotate-90"}`} />
                </button>
                {isSummaryOpen ? (
                  <div className="mt-1.5">
                    {isSummaryLoading && !aiSummary ? (
                      <div className="space-y-2">
                        <div className="h-3 w-11/12 animate-pulse rounded bg-[#d7e9f7]" />
                        <div className="h-3 w-9/12 animate-pulse rounded bg-[#d7e9f7]" />
                      </div>
                    ) : summaryError ? (
                      <p className="text-[12.5px] text-rose-600">{summaryError}</p>
                    ) : aiSummary?.summary ? (
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#33587a]">{aiSummary.summary}</p>
                    ) : (
                      <p className="text-[12.5px] text-[#5b6b80]">No summary available yet.</p>
                    )}
                  </div>
                ) : null}
              </div>

              {/* sticky tabs */}
              <StickyTabs active={activeTab} onSelect={setActiveTab} />

              {/* tab content */}
              <div className="px-4 pb-8">
                {error ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

                {activeTab === "visits" ? (
                  <>
                    <SectionHeading title="Visits" meta={visits.length ? `${visits.length} total` : undefined} />
                    {visitsError ? <p className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{visitsError}</p> : null}
                    {isVisitsLoading ? (
                      <p className="clinic-empty-state">Loading visits...</p>
                    ) : visits.length ? (
                      visits.map((visit, index) => {
                        const isSelected = visit.id === selectedVisit?.id;
                        const detail = isSelected ? selectedVisitDetail : null;
                        const isLoadingDetail = isSelected && loadingVisitDetailId === visit.id;
                        return (
                          <RailItem key={visit.id} color={isSelected ? "accent" : "dim"} last={index === visits.length - 1}>
                            <button
                              type="button"
                              onClick={() => setSelectedVisitId(visit.id)}
                              className={`w-full rounded-[14px] border p-3 text-left shadow-[0_6px_16px_rgba(64,131,181,0.07)] ${
                                isSelected ? "border-[#bfe0f5] bg-[#ecf6fd]" : "border-[#dbe7ef] bg-white"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-sm font-bold text-slate-900">
                                  {visit.reason || `Visit ${index + 1}`}
                                </span>
                                <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400">
                                  {shortDate(visit.created_at)}
                                </span>
                              </div>
                              {detail ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {detail.consultation_note?.content ? (
                                    <InfoTag>
                                      <FileText className="h-3 w-3" /> Note
                                    </InfoTag>
                                  ) : null}
                                  {detail.attachments.length ? (
                                    <InfoTag>
                                      <ImageIcon className="h-3 w-3" /> {detail.attachments.length} file
                                      {detail.attachments.length === 1 ? "" : "s"}
                                    </InfoTag>
                                  ) : null}
                                </div>
                              ) : null}
                            </button>

                            {isSelected ? (
                              <div className="mt-2 grid gap-2">
                                {visitDetailError ? (
                                  <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{visitDetailError}</p>
                                ) : null}
                                <VisitDetailSection
                                  title="Consultation note"
                                  isOpen={openSections.note}
                                  onToggle={() => toggleSection("note")}
                                >
                                  {isLoadingDetail ? (
                                    <p className="text-sm text-slate-400">Loading consultation note...</p>
                                  ) : detail?.consultation_note?.content ? (
                                    <div className="whitespace-pre-wrap rounded-[10px] border border-[#dbe7ef] bg-[#f7fbfd] px-3 py-2.5 text-[13px] leading-6 text-slate-700">
                                      {detail.consultation_note.content}
                                    </div>
                                  ) : (
                                    <p className="text-sm text-slate-400">No consultation note on this visit yet.</p>
                                  )}
                                </VisitDetailSection>
                                <VisitDetailSection
                                  title="Files & media"
                                  count={detail?.attachments.length ?? 0}
                                  isOpen={openSections.attachments}
                                  onToggle={() => toggleSection("attachments")}
                                >
                                  {isLoadingDetail ? (
                                    <p className="text-sm text-slate-400">Loading attachments...</p>
                                  ) : detail?.attachments.length ? (
                                    <div className="grid gap-2">
                                      {detail.attachments.map((attachment) => (
                                        <button
                                          key={attachment.id}
                                          type="button"
                                          onClick={() => void openVisitAttachment(attachment)}
                                          className="flex items-center gap-3 rounded-[10px] border border-[#dbe7ef] bg-white p-2.5 text-left"
                                        >
                                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] border border-[#dbe7ef] bg-[#f3f8fb] text-slate-400">
                                            {attachment.content_type.startsWith("image/") ? (
                                              <ImageIcon className="h-4 w-4" />
                                            ) : (
                                              <FileText className="h-4 w-4" />
                                            )}
                                          </span>
                                          <span className="min-w-0">
                                            <span className="block truncate text-[13px] font-semibold text-slate-800">
                                              {attachment.label}
                                            </span>
                                            <span className="block text-[11px] text-slate-400">{shortDate(attachment.timestamp)}</span>
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-sm text-slate-400">No attachments on this visit yet.</p>
                                  )}
                                </VisitDetailSection>
                              </div>
                            ) : null}
                          </RailItem>
                        );
                      })
                    ) : (
                      <p className="clinic-empty-state">No visits recorded yet.</p>
                    )}
                  </>
                ) : null}

                {activeTab === "tests" ? (
                  <>
                    <SectionHeading title="Evaluations" meta={clinicSettings?.clinic_specialty ? String(clinicSettings.clinic_specialty) : undefined} />
                    {testsError ? <p className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{testsError}</p> : null}
                    <TestsTab
                      clinicSpecialty={clinicSettings?.clinic_specialty ?? null}
                      growthHistory={growthHistory}
                      isLoading={isTestsLoading}
                      moduleEntries={moduleEntries}
                      myopiaError=""
                      myopiaHistory={myopiaHistory}
                      onOpenModule={(moduleKey) => {
                        setActiveModuleKey(moduleKey);
                        setModuleEntryNotes("");
                      }}
                      onOpenBinocularVision={() => setIsBinocularVisionOpen(true)}
                      onOpenTbiEvaluation={() => setIsTbiEvaluationOpen(true)}
                      binocularVisionError={binocularVisionError}
                      binocularVisionEvaluations={binocularVisionEvaluations}
                      tbiError={tbiError}
                      tbiEvaluations={tbiEvaluations}
                    />
                  </>
                ) : null}

                {activeTab === "attachments" ? (
                  <>
                    <SectionHeading
                      title="Attachments"
                      meta={patientWideAttachments.length ? `${patientWideAttachments.length} file${patientWideAttachments.length === 1 ? "" : "s"}` : undefined}
                    />
                    {attachmentsError ? <p className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{attachmentsError}</p> : null}
                    {isAttachmentsLoading ? (
                      <p className="clinic-empty-state">Loading attachments...</p>
                    ) : patientWideAttachments.length ? (
                      <div className="-mx-4 border-t border-[#dbe7ef]">
                        {patientWideAttachments.map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => void row.open()}
                            className="flex w-full items-center gap-3 border-b border-[#dbe7ef] bg-white px-4 py-3.5 text-left"
                          >
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-[#dbe7ef] bg-[#f3f8fb] text-[#2f8fd3]">
                              {isImageName(row.label) ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{row.label}</span>
                            <span className="shrink-0 text-xs font-semibold text-slate-500">{shortDate(row.timestamp)}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="clinic-empty-state">No attachments yet.</p>
                    )}
                  </>
                ) : null}

                {activeTab === "timeline" ? (
                  <>
                    <SectionHeading title="Activity" meta="Newest first" />
                    {timelineError ? <p className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{timelineError}</p> : null}
                    {isTimelineLoading ? (
                      <p className="clinic-empty-state">Loading timeline...</p>
                    ) : patientTimeline.length ? (
                      patientTimeline.map((event, index) => {
                        const meta = timelineMeta(event.type);
                        return (
                          <RailItem key={event.id} color={meta.color} last={index === patientTimeline.length - 1}>
                            <div className="rounded-[14px] border border-[#dbe7ef] bg-white p-3 shadow-[0_6px_16px_rgba(64,131,181,0.07)]">
                              <span className={`mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] ${meta.kindClass}`}>
                                {meta.label}
                              </span>
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-sm font-bold text-slate-900">{event.title}</span>
                                <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400">{shortDate(event.timestamp)}</span>
                              </div>
                              {event.description ? (
                                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{event.description}</p>
                              ) : null}
                            </div>
                          </RailItem>
                        );
                      })
                    ) : (
                      <p className="clinic-empty-state">No timeline records yet.</p>
                    )}
                  </>
                ) : null}
              </div>
            </>
          ) : isVisitsLoading ? (
            <p className="clinic-empty-state m-4">Loading chart...</p>
          ) : (
            <p className="clinic-empty-state m-4">Patient not found.</p>
          )}

          <TbiEvaluationModal
            open={isTbiEvaluationOpen}
            patient={patient}
            evaluations={tbiEvaluations}
            isLoading={isTbiLoading}
            error={tbiError}
            readOnly={false}
            onClose={() => setIsTbiEvaluationOpen(false)}
            onSave={saveTbiEvaluation}
          />
          <BinocularVisionModal
            open={isBinocularVisionOpen}
            patient={patient}
            evaluations={binocularVisionEvaluations}
            isLoading={isBinocularVisionLoading}
            error={binocularVisionError}
            readOnly={false}
            onClose={() => setIsBinocularVisionOpen(false)}
            onSave={saveBinocularVisionEvaluation}
          />
          <ModuleHistorySheet
            entries={activeModuleKey ? moduleEntriesFor(moduleEntries, activeModuleKey) : []}
            moduleKey={activeModuleKey}
            onClose={() => setActiveModuleKey(null)}
            onSave={saveModuleEntry}
            value={moduleEntryNotes}
            onValueChange={setModuleEntryNotes}
            isSaving={isSavingModuleEntry}
          />
          <PhotoPreviewModal preview={photoPreview} onClose={closePhotoPreview} />
        </>
      )}
    </MobileShell>
  );
}
