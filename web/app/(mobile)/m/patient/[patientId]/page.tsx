"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown, FileText, Image as ImageIcon, Sparkles, UserRound } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileShell } from "@/components/mobile/mobile-shell";
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
  TbiEvaluationCreatePayload,
  TbiEvaluationRecord,
} from "@/lib/types";
import { specialtyHasModule } from "@/lib/specialty";

type MobileTab = "visits" | "tests" | "attachments" | "timeline";
type VisitSectionKey = "note" | "attachments";

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
      className={`inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-semibold transition ${
        active
          ? "bg-[#2f8fd3] text-white shadow-[0_10px_22px_rgba(47,143,211,0.18)]"
          : "border border-[#bfd7e8] bg-white text-slate-700"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-[#edf5fa] text-slate-500"}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function TimelineCard({ event }: { event: PatientTimelineEvent }) {
  return (
    <article className="rounded-[18px] border border-[#dbe7ef] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{event.title}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">{event.description}</p>
        </div>
        <p className="shrink-0 text-xs text-slate-500">{formatDate(event.timestamp)}</p>
      </div>
    </article>
  );
}

function MobileAccordion({
  children,
  count,
  isOpen,
  onToggle,
  title,
}: {
  children: React.ReactNode;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <section className="rounded-[22px] border border-[#dbe7ef] bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {typeof count === "number" ? (
            <span className="rounded-full border border-[#bfd7e8] bg-[#f3f8fb] px-2.5 py-0.5 text-xs font-medium text-slate-600">
              {count}
            </span>
          ) : null}
        </div>
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-500 transition ${isOpen ? "rotate-180" : "rotate-0"}`} />
      </button>
      {isOpen ? <div className="border-t border-[#dbe7ef] px-4 py-4">{children}</div> : null}
    </section>
  );
}

function TestsTab({
  clinicSpecialty,
  growthHistory,
  isLoading,
  myopiaError,
  myopiaHistory,
  onOpenTbiEvaluation,
  tbiError,
  tbiEvaluations,
}: {
  clinicSpecialty: Patient["status"] | string | null | undefined;
  growthHistory: PediatricGrowthSummary | null;
  isLoading: boolean;
  myopiaError: string;
  myopiaHistory: MyopiaHistory | null;
  onOpenTbiEvaluation: () => void;
  tbiError: string;
  tbiEvaluations: TbiEvaluationRecord[];
}) {
  const isOptometryClinic = specialtyHasModule(clinicSpecialty as never, "myopia_management");
  const isPediatricsClinic = specialtyHasModule(clinicSpecialty as never, "pediatric_growth_measurement");
  const growthRecords = growthHistory?.records ?? [];
  const latestGrowthRecord = growthRecords[growthRecords.length - 1] ?? null;

  if (isLoading) {
    return <p className="clinic-empty-state">Loading tests...</p>;
  }

  return (
    <div className="grid gap-4">
      {myopiaError ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{myopiaError}</p> : null}
      {isOptometryClinic ? (
        <section className="rounded-[22px] border border-[#dbe7ef] bg-white p-5 shadow-[0_12px_30px_rgba(47,61,50,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Myopia</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            {(myopiaHistory?.records.length ?? 0)} readings
          </p>
          <p className="mt-2 text-sm text-slate-600">
            OD {myopiaHistory?.baseline_delta?.right_mm ?? "—"} · OS {myopiaHistory?.baseline_delta?.left_mm ?? "—"}
          </p>
        </section>
      ) : null}
      {isOptometryClinic ? (
        <section className="rounded-[22px] border border-[#dbe7ef] bg-white p-5 shadow-[0_12px_30px_rgba(47,61,50,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Neurovision / TBI</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            {tbiEvaluations.length} evaluations
          </p>
          {tbiError ? <p className="mt-2 text-sm text-rose-600">{tbiError}</p> : null}
          <button
            type="button"
            onClick={onOpenTbiEvaluation}
            className="mt-4 rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700"
          >
            Open
          </button>
        </section>
      ) : null}
      {isPediatricsClinic ? (
        <section className="rounded-[22px] border border-[#dbe7ef] bg-white p-5 shadow-[0_12px_30px_rgba(47,61,50,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Growth</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            {growthRecords.length} readings
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {latestGrowthRecord ? `${latestGrowthRecord.height_cm} cm · ${latestGrowthRecord.weight_kg} kg` : "No latest measurement"}
          </p>
          <p className="mt-2 text-sm text-slate-500">{growthHistory?.trend_summary || "No trend yet"}</p>
        </section>
      ) : null}
      {!isOptometryClinic && !isPediatricsClinic ? (
        <p className="clinic-empty-state">No tests available for this patient yet.</p>
      ) : null}
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
  const [tbiEvaluations, setTbiEvaluations] = useState<TbiEvaluationRecord[]>([]);
  const [isTestsLoading, setIsTestsLoading] = useState(false);
  const [testsError, setTestsError] = useState("");
  const [hasLoadedTestsTab, setHasLoadedTestsTab] = useState(false);
  const [tbiError, setTbiError] = useState("");
  const [isTbiLoading, setIsTbiLoading] = useState(false);
  const [isTbiEvaluationOpen, setIsTbiEvaluationOpen] = useState(false);
  const [patientTimeline, setPatientTimeline] = useState<PatientTimelineEvent[]>([]);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [hasLoadedTimelineTab, setHasLoadedTimelineTab] = useState(false);
  const [error, setError] = useState("");
  const [aiSummary, setAiSummary] = useState<PatientSummary | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [isRegeneratingSummary, setIsRegeneratingSummary] = useState(false);

  useEffect(() => {
    setOpenSections({ note: false, attachments: false });
  }, [selectedVisitId]);

  useEffect(() => {
    setPatientTimeline([]);
    setTimelineError("");
    setIsTimelineLoading(false);
    setHasLoadedTimelineTab(false);
    setTbiEvaluations([]);
    setTbiError("");
    setIsTbiLoading(false);
    setIsTbiEvaluationOpen(false);
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
    const shouldLoadGrowth = specialtyHasModule(clinicSpecialty, "pediatric_growth_measurement");
    setIsTestsLoading(true);
    setIsTbiLoading(shouldLoadTbi);
    setTestsError("");
    setTbiError("");

    Promise.all([
      shouldLoadMyopia ? api.getPatientMyopiaHistory(patientId) : Promise.resolve(null),
      shouldLoadGrowth ? api.getPatientGrowthHistory(patientId) : Promise.resolve(null),
      shouldLoadTbi ? api.listPatientTbiEvaluations(patientId) : Promise.resolve([] as TbiEvaluationRecord[]),
    ])
      .then(([myopia, growth, tbi]) => {
        if (!active) {
          return;
        }
        setMyopiaHistory(myopia);
        setGrowthHistory(growth);
        setTbiEvaluations(tbi);
        setHasLoadedTestsTab(true);
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setTestsError(loadError instanceof Error ? loadError.message : "Failed to load tests.");
        setTbiError(loadError instanceof Error ? loadError.message : "Failed to load TBI evaluations.");
      })
      .finally(() => {
        if (active) {
          setIsTestsLoading(false);
          setIsTbiLoading(false);
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
  const selectedVisit = useMemo(
    () => visits.find((visit) => visit.id === selectedVisitId) ?? visits[0] ?? null,
    [selectedVisitId, visits],
  );
  const selectedVisitDetail = selectedVisit ? visitDetailsById[selectedVisit.id] ?? null : null;

  const patientWideAttachments = useMemo(() => {
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
            open: () => asset.attachment_id ? openPatientAttachmentViewer(asset.attachment_id) : openNoteAttachmentViewer(asset),
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
        open: async () => openPatientAttachmentViewer(attachment.id),
      }));
    return [...noteRows, ...patientRows].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
  }, [attachments, notes]);

  function toggleSection(section: VisitSectionKey) {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  }

  async function openVisitAttachment(attachment: PatientVisitAttachmentRow) {
    try {
      if (attachment.attachment_id) {
        openPatientAttachmentViewer(attachment.attachment_id!);
        return;
      }
      if (attachment.source_type === "note_attachment" && attachment.data_base64) {
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
      const message = saveError instanceof Error ? saveError.message : "Failed to save TBI evaluation.";
      setTbiError(message);
      throw saveError;
    } finally {
      setIsTbiLoading(false);
    }
  }

  return (
    <MobileShell
      title={patient?.name || "Patient"}
      subtitle={patient ? `${patient.age ?? "-"} years | ${patient.phone || "No phone"}` : "Chart"}
      action={
        <Link
          href="/m/patients"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[#bfd7e8] bg-white text-slate-700"
          aria-label="Back to patients"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      }
    >
      {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      {patient ? (
        <>
          <section className="rounded-[22px] border border-[#dbe7ef] bg-white p-5 shadow-[0_12px_30px_rgba(47,61,50,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Patient chart</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">{patient.name}</h1>
            <p className="mt-2 text-sm text-slate-500">
              {patient.phone} · Age {patient.age ?? "-"} · {patient.address || "No address"} · last visit {formatDate(patient.last_visit_at)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
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
          </section>

          <section className="mt-4 rounded-[22px] border border-[#cfe3f3] bg-gradient-to-br from-[#f3f9fe] to-[#eaf4fc] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#2f8fd3]/10 text-[#2f8fd3]">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm font-semibold text-[#1d4d72]">Summary</span>
              </div>
              {isRegeneratingSummary ? (
                <span className="text-xs font-medium text-[#2f6c98]">Updating…</span>
              ) : null}
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
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{aiSummary.summary}</p>
              ) : (
                <p className="text-sm text-slate-500">No summary available yet.</p>
              )}
            </div>
          </section>

          <div className="mt-4 grid gap-4">
            {activeTab === "visits" ? (
              <>
                {visitsError ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{visitsError}</p> : null}
                {isVisitsLoading ? (
                  <p className="clinic-empty-state">Loading visits...</p>
                ) : visits.length ? (
                  <section className="grid gap-3">
                    {visits.map((visit, index) => (
                      <button
                        key={visit.id}
                        type="button"
                        onClick={() => setSelectedVisitId(visit.id)}
                        className={`flex items-center justify-between gap-3 rounded-[18px] border px-4 py-4 text-left ${
                          visit.id === selectedVisit?.id
                            ? "border-[#9fc7e1] bg-[#f3f8fb] shadow-[inset_3px_0_0_#2f8fd3]"
                            : "border-[#dbe7ef] bg-white"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="rounded-xl bg-[#f3f8fb] p-2 ring-1 ring-[#dbe7ef]">
                            <UserRound className="h-4 w-4 text-[#2f8fd3]" />
                          </div>
                          <p className="truncate text-base font-semibold text-slate-900">Visit {index + 1}</p>
                        </div>
                        <p className="shrink-0 text-xs text-slate-500">{formatDate(visit.created_at)}</p>
                      </button>
                    ))}
                  </section>
                ) : (
                  <p className="clinic-empty-state">No visits recorded yet.</p>
                )}

                {selectedVisit ? (
                  <div className="grid gap-4">
                    <section className="rounded-[18px] border border-[#dbe7ef] bg-white px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Reason</p>
                      <h2 className="mt-1 text-xl font-semibold text-slate-900">
                        {selectedVisitDetail?.reason || selectedVisit.reason || "Recorded visit"}
                      </h2>
                      {visitDetailError ? <p className="mt-2 text-sm text-rose-700">{visitDetailError}</p> : null}
                    </section>

                    <MobileAccordion title="Consultation note" isOpen={openSections.note} onToggle={() => toggleSection("note")}>
                      {loadingVisitDetailId === selectedVisit.id ? (
                        <p className="clinic-empty-state">Loading consultation note...</p>
                      ) : selectedVisitDetail?.consultation_note?.content ? (
                        <div className="whitespace-pre-wrap rounded-[18px] border border-[#dbe7ef] bg-[#f7fbfd] px-4 py-3 text-sm leading-6 text-slate-700">
                          {selectedVisitDetail.consultation_note.content}
                        </div>
                      ) : (
                        <p className="clinic-empty-state">No consultation note on this visit yet.</p>
                      )}
                    </MobileAccordion>

                    <MobileAccordion
                      title="Files and media"
                      count={selectedVisitDetail?.attachments.length ?? 0}
                      isOpen={openSections.attachments}
                      onToggle={() => toggleSection("attachments")}
                    >
                      {loadingVisitDetailId === selectedVisit.id ? (
                        <p className="clinic-empty-state">Loading attachments...</p>
                      ) : selectedVisitDetail?.attachments.length ? (
                        <div className="grid gap-3">
                          {selectedVisitDetail.attachments.map((attachment) => (
                            <button
                              key={attachment.id}
                              type="button"
                              onClick={() => void openVisitAttachment(attachment)}
                              className="flex items-center gap-3 rounded-[18px] border border-[#dbe7ef] bg-white p-4 text-left"
                            >
                              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#dbe7ef] bg-[#f3f8fb] text-slate-500">
                                {attachment.content_type.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800">{attachment.label}</p>
                                <p className="text-xs text-slate-500">{formatDate(attachment.timestamp)}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="clinic-empty-state">No attachments on this visit yet.</p>
                      )}
                    </MobileAccordion>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeTab === "tests" ? (
              <>
                {testsError ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{testsError}</p> : null}
	                <TestsTab
	                  clinicSpecialty={clinicSettings?.clinic_specialty ?? null}
	                  growthHistory={growthHistory}
	                  isLoading={isTestsLoading}
	                  myopiaError=""
	                  myopiaHistory={myopiaHistory}
	                  onOpenTbiEvaluation={() => setIsTbiEvaluationOpen(true)}
	                  tbiError={tbiError}
	                  tbiEvaluations={tbiEvaluations}
	                />
              </>
            ) : null}

            {activeTab === "attachments" ? (
              <section className="rounded-[22px] border border-[#dbe7ef] bg-white p-5 shadow-[0_12px_30px_rgba(47,61,50,0.08)]">
                {isAttachmentsLoading ? <p className="clinic-empty-state">Loading attachments...</p> : null}
                {attachmentsError ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{attachmentsError}</p> : null}
                {!isAttachmentsLoading ? (
                  <div className="divide-y divide-[#edf3f8]">
                    {patientWideAttachments.length ? (
                      patientWideAttachments.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => void row.open()}
                          className="flex w-full items-center justify-between gap-4 py-3 text-left"
                        >
                          <p className="min-w-0 truncate text-sm font-medium text-slate-900">{row.label}</p>
                          <p className="shrink-0 text-xs text-slate-500">{formatDate(row.timestamp)}</p>
                        </button>
                      ))
                    ) : (
                      <p className="py-8 text-center text-sm text-slate-500">No attachments yet.</p>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "timeline" ? (
              <section className="rounded-[22px] border border-[#dbe7ef] bg-white p-5 shadow-[0_12px_30px_rgba(47,61,50,0.08)]">
                {isTimelineLoading ? <p className="clinic-empty-state">Loading timeline...</p> : null}
                {timelineError ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{timelineError}</p> : null}
                {!isTimelineLoading && !timelineError ? (
                  patientTimeline.length ? (
                    <div className="grid gap-3">
                      {patientTimeline.map((event) => <TimelineCard key={event.id} event={event} />)}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-sm text-slate-500">No timeline records yet.</p>
                  )
                ) : null}
              </section>
            ) : null}
          </div>
	        </>
	      ) : isVisitsLoading ? (
        <p className="clinic-empty-state">Loading chart...</p>
      ) : (
        <p className="clinic-empty-state">Patient not found.</p>
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
	    </MobileShell>
	  );
	}
