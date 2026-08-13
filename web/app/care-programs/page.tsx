"use client";

import {
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Download,
  FileText,
  Filter,
  MessageCircle,
  Search,
  Settings2,
  UserPlus,
  UserRoundCheck,
  X,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppMenuDrawer } from "@/components/app-menu-drawer";
import { CareProgramEnrollmentModal } from "@/components/care-programs/care-program-enrollment-modal";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { HistoricalMyopiaModal } from "@/components/optometry/myopia/historical-myopia-modal";
import { api } from "@/lib/api";
import { canUseClinicalTools } from "@/lib/permissions";
import type {
  CareProgramOffering,
  MyopiaMeasurementPayload,
  MyopiaMeasurementRecord,
  ProgramEnrollment,
  ProgramEnrollmentStatus,
  ProgramEnrollmentSummary,
} from "@/lib/types";

type WorklistFilter = "current" | "overdue" | "due_soon" | "pending" | "unassigned" | "completed" | "all";

function formatDate(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function statusTone(status: ProgramEnrollmentStatus) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "pending") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "completed") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function dueState(row: ProgramEnrollmentSummary) {
  if (row.status !== "active" || !row.next_action_at) return "none";
  const days = (new Date(row.next_action_at).getTime() - Date.now()) / 86_400_000;
  if (days < -1) return "overdue";
  if (days <= 30) return "due_soon";
  return "future";
}

export default function CareProgramsPage() {
  const router = useRouter();
  const { clinicSettings, currentUser, handleLogout, isAuthReady, isRedirectingToLogin, users, loadUsers } = useClinicShell();
  const [offerings, setOfferings] = useState<CareProgramOffering[]>([]);
  const [enrollments, setEnrollments] = useState<ProgramEnrollmentSummary[]>([]);
  const [selected, setSelected] = useState<ProgramEnrollment | null>(null);
  const [measurements, setMeasurements] = useState<MyopiaMeasurementRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [programFilter, setProgramFilter] = useState("");
  const [worklistFilter, setWorklistFilter] = useState<WorklistFilter>("current");
  const [pendingReviewId, setPendingReviewId] = useState("");
  const [clinicianComment, setClinicianComment] = useState("");
  const [paymentInput, setPaymentInput] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEnrollmentOpen, setIsEnrollmentOpen] = useState(false);
  const [isMeasurementOpen, setIsMeasurementOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const loadWorklist = useCallback(async () => {
    const [programRows, enrollmentRows] = await Promise.all([
      api.listCareProgramOfferings(),
      api.listCareProgramEnrollments(),
    ]);
    setOfferings(programRows);
    setEnrollments(enrollmentRows);
  }, []);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser) return;
    if (!canUseClinicalTools(currentUser.role)) {
      router.replace("/");
      return;
    }
    if (clinicSettings?.clinic_specialty && clinicSettings.clinic_specialty !== "optometry") {
      setError("Care Programs v1 is available to optometry clinics.");
      setIsLoading(false);
      return;
    }
    loadWorklist()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load care programs."))
      .finally(() => setIsLoading(false));
  }, [clinicSettings?.clinic_specialty, currentUser, isAuthReady, isRedirectingToLogin, loadWorklist, router]);

  const metrics = useMemo(() => ({
    active: enrollments.filter((row) => row.status === "active").length,
    overdue: enrollments.filter((row) => dueState(row) === "overdue").length,
    dueSoon: enrollments.filter((row) => dueState(row) === "due_soon").length,
    pending: enrollments.filter((row) => row.status === "pending").length,
    unassigned: enrollments.filter((row) => row.status === "active" && !row.responsible_user_id).length,
  }), [enrollments]);
  const doctorUsers = useMemo(() => users.filter((user) => canUseClinicalTools(user.role)), [users]);

  const filteredEnrollments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return enrollments.filter((row) => {
      if (query && !`${row.patient_name || ""} ${row.patient_phone || ""}`.toLowerCase().includes(query)) return false;
      if (programFilter && row.catalog_item_id !== programFilter) return false;
      if (worklistFilter === "current" && !["active", "pending"].includes(row.status)) return false;
      if (worklistFilter === "overdue" && dueState(row) !== "overdue") return false;
      if (worklistFilter === "due_soon" && dueState(row) !== "due_soon") return false;
      if (worklistFilter === "pending" && row.status !== "pending") return false;
      if (worklistFilter === "unassigned" && (row.status !== "active" || row.responsible_user_id)) return false;
      if (worklistFilter === "completed" && row.status !== "completed") return false;
      return true;
    });
  }, [enrollments, programFilter, searchQuery, worklistFilter]);

  async function openEnrollment(enrollmentId: string) {
    setIsDetailLoading(true);
    setError("");
    try {
      const detail = await api.getCareProgramEnrollment(enrollmentId);
      const [history] = await Promise.all([
        api.getPatientMyopiaHistory(detail.patient_id),
        loadUsers(),
      ]);
      setSelected(detail);
      setMeasurements(history.records);
      setPaymentInput("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load enrollment.");
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function refreshSelected(detail: ProgramEnrollment) {
    setSelected(detail);
    setEnrollments(await api.listCareProgramEnrollments());
    setMeasurements((await api.getPatientMyopiaHistory(detail.patient_id)).records);
  }

  async function assignDoctor(userId: string) {
    if (!selected) return;
    try {
      await refreshSelected(await api.assignCareProgramEnrollment(selected.id, userId));
      setStatus("Responsible doctor assigned.");
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Failed to assign doctor.");
    }
  }

  async function completeWithMeasurement(reviewId: string, measurementId: string) {
    if (!selected) return;
    try {
      await refreshSelected(await api.completeCareProgramReview(selected.id, reviewId, measurementId));
      setStatus("Review completed and progress report generated.");
      setPendingReviewId("");
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Failed to complete review.");
    }
  }

  async function recordMeasurement(payload: MyopiaMeasurementPayload) {
    if (!selected || !pendingReviewId) return;
    const created = await api.createPatientMyopiaRecord(selected.patient_id, payload);
    await completeWithMeasurement(pendingReviewId, created.id);
  }

  async function generateReport(reviewId: string) {
    if (!selected) return;
    try {
      const report = await api.createCareProgramReport(selected.id, reviewId, clinicianComment);
      await openReport(report.id);
      await refreshSelected(await api.getCareProgramEnrollment(selected.id));
      setStatus("Updated progress report generated.");
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : "Failed to generate report.");
    }
  }

  async function openReport(reportId: string) {
    const blob = await api.getCareProgramReportPdf(reportId);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function sendReport(reportId: string) {
    try {
      await api.sendCareProgramReportWhatsApp(reportId);
      setStatus("Progress report sent on WhatsApp.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send report.");
    }
  }

  async function recordPayment() {
    if (!selected) return;
    try {
      await api.updateInvoicePayment(selected.originating_invoice_id, Number(paymentInput));
      await openEnrollment(selected.id);
      await loadWorklist();
      setStatus("Payment recorded and program activated.");
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Failed to record payment.");
    }
  }

  async function cancelEnrollment() {
    if (!selected) return;
    const reason = window.prompt("Reason for cancelling this care program:");
    if (!reason?.trim()) return;
    try {
      await refreshSelected(await api.cancelCareProgramEnrollment(selected.id, reason.trim()));
      setStatus("Care program cancelled.");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Failed to cancel care program.");
    }
  }

  if (!isAuthReady || isRedirectingToLogin || isLoading) {
    return <main className="grid min-h-screen place-items-center text-sm text-slate-500">Loading care programs...</main>;
  }

  const activeOfferings = offerings.filter((offering) => offering.is_active && offering.catalog_item_id);

  return (
    <main className="clinic-page">
      <div className="clinic-container">
        <AppHeader
          clinicName={clinicSettings?.clinic_name || "ClinicOS"}
          currentUser={currentUser}
          active="care-programs"
          onOpenSettings={() => setIsMenuOpen(true)}
          onLogout={handleLogout}
          timezone={clinicSettings?.timezone}
        />
        {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {status ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div> : null}

        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Care Programs</h1>
            <p className="mt-1 text-sm text-slate-500">Patients enrolled in ongoing clinic care.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => router.push("/care-programs/manage")} className="inline-flex items-center gap-2 rounded-lg border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">
              <Settings2 className="h-4 w-4" />
              Manage programs
            </button>
            <button type="button" onClick={() => setIsEnrollmentOpen(true)} disabled={!activeOfferings.length} className="inline-flex items-center gap-2 rounded-lg bg-[#2f8fd3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <UserPlus className="h-4 w-4" />
              Enroll patient
            </button>
          </div>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {([
            ["Active", metrics.active, CheckCircle2],
            ["Overdue", metrics.overdue, CalendarClock],
            ["Due in 30 days", metrics.dueSoon, CalendarClock],
            ["Pending payment", metrics.pending, CircleDollarSign],
            ["Unassigned", metrics.unassigned, UserRoundCheck],
          ] as Array<[string, number, LucideIcon]>).map(([label, value, Icon]) => (
            <div key={label} className="rounded-lg border border-[#dbe7ef] bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">{label}</span>
                <Icon className="h-4 w-4 text-[#2f8fd3]" />
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
            </div>
          ))}
        </section>

        <section className="mt-5 overflow-hidden rounded-lg border border-[#dbe7ef] bg-white">
          <div className="flex flex-col gap-3 border-b border-[#dbe7ef] p-4 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1 lg:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search patient name or phone" className="h-10 w-full rounded-lg border border-[#bfd7e8] pl-10 pr-3 text-sm" />
            </label>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <select value={programFilter} onChange={(event) => setProgramFilter(event.target.value)} className="h-10 rounded-lg border border-[#bfd7e8] bg-white px-3 text-sm">
                <option value="">All programs</option>
                {offerings.map((offering) => <option key={offering.program_key} value={offering.catalog_item_id || ""}>{offering.name}</option>)}
              </select>
              <select value={worklistFilter} onChange={(event) => setWorklistFilter(event.target.value as WorklistFilter)} className="h-10 rounded-lg border border-[#bfd7e8] bg-white px-3 text-sm">
                <option value="current">Current</option>
                <option value="overdue">Overdue</option>
                <option value="due_soon">Due in 30 days</option>
                <option value="pending">Pending payment</option>
                <option value="unassigned">Unassigned</option>
                <option value="completed">Completed</option>
                <option value="all">All statuses</option>
              </select>
            </div>
          </div>

          <div className="hidden grid-cols-[minmax(180px,1.4fr)_minmax(150px,1fr)_minmax(130px,1fr)_110px_minmax(160px,1fr)_auto] gap-4 bg-[#f7fbfd] px-4 py-3 text-xs font-semibold uppercase text-slate-500 lg:grid">
            <span>Patient</span><span>Program</span><span>Doctor</span><span>Progress</span><span>Next review</span><span>Status</span>
          </div>
          {filteredEnrollments.length ? filteredEnrollments.map((row) => {
            const due = dueState(row);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => void openEnrollment(row.id)}
                className="grid w-full gap-3 border-t border-[#edf2f5] px-4 py-4 text-left hover:bg-[#f9fcfe] lg:grid-cols-[minmax(180px,1.4fr)_minmax(150px,1fr)_minmax(130px,1fr)_110px_minmax(160px,1fr)_auto] lg:items-center"
              >
                <span className="min-w-0"><span className="block truncate font-semibold text-slate-900">{row.patient_name || "Patient"}</span><span className="mt-1 block text-xs text-slate-500">{row.patient_phone}</span></span>
                <span className="text-sm text-slate-700">{row.program_name}</span>
                <span className={`text-sm ${row.responsible_user_name ? "text-slate-700" : "font-medium text-amber-700"}`}>{row.responsible_user_name || "Unassigned"}</span>
                <span className="text-sm tabular-nums text-slate-700">{row.completed_reviews} of {row.total_reviews}</span>
                <span className="min-w-0"><span className={`block text-sm ${due === "overdue" ? "font-semibold text-rose-700" : "text-slate-700"}`}>{row.next_review_title || (row.status === "pending" ? "After payment" : "No review due")}</span><span className="mt-1 block text-xs text-slate-500">{formatDate(row.next_action_at)}</span></span>
                <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusTone(row.status)}`}>{row.status}</span>
              </button>
            );
          }) : (
            <div className="px-5 py-14 text-center text-sm text-slate-500">
              No patients match this worklist.
            </div>
          )}
        </section>
      </div>

      <AppMenuDrawer open={isMenuOpen} currentUser={currentUser} onClose={() => setIsMenuOpen(false)} />
      {isEnrollmentOpen && currentUser ? (
        <CareProgramEnrollmentModal
          offerings={activeOfferings}
          currentUser={currentUser}
          onClose={() => setIsEnrollmentOpen(false)}
          onComplete={async (enrollment, message) => {
            setIsEnrollmentOpen(false);
            await loadWorklist();
            await openEnrollment(enrollment.id);
            setStatus(message);
          }}
        />
      ) : null}

      {selected ? (
        <div className="fixed inset-0 z-40">
          <button type="button" aria-label="Close enrollment" className="absolute inset-0 bg-slate-950/25" onClick={() => setSelected(null)} />
          <aside className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">{selected.program_name}</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">{selected.patient_name}</h2>
                <p className="mt-1 text-sm text-slate-500">{selected.patient_phone}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-[#dbe7ef] p-2 text-slate-500" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <span className={`mt-4 inline-block rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusTone(selected.status)}`}>{selected.status}</span>

            {selected.status === "pending" ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">Balance due: Rs {selected.balance_due.toFixed(2)}</p>
                <div className="mt-2 flex gap-2">
                  <input type="number" min="1" max={selected.agreed_price} value={paymentInput} onChange={(event) => setPaymentInput(event.target.value)} placeholder="Cumulative amount paid" className="min-w-0 flex-1 rounded-lg border border-amber-200 px-3 py-2 text-sm" />
                  <button type="button" onClick={() => void recordPayment()} className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white">Record</button>
                </div>
              </div>
            ) : null}

            <label className="mt-4 block text-sm font-medium text-slate-700">
              Responsible doctor
              <select value={selected.responsible_user_id || ""} onChange={(event) => void assignDoctor(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] bg-white px-3 py-2.5">
                <option value="" disabled>Assign doctor</option>
                {doctorUsers.map((user) => <option key={user.id} value={user.id}>{user.name || user.identifier}</option>)}
              </select>
            </label>

            <div className="mt-5 space-y-3">
              {selected.events.filter((event) => event.event_type === "review").map((review) => (
                <div key={review.id} className="rounded-lg border border-[#dbe7ef] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div><p className="text-sm font-semibold text-slate-900">{review.title}</p><p className="mt-1 text-xs text-slate-500">{formatDate(review.due_at)}</p></div>
                    <span className="text-xs font-medium capitalize text-slate-600">{review.status}</span>
                  </div>
                  {review.status === "scheduled" && selected.status === "active" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => { setPendingReviewId(review.id); setIsMeasurementOpen(true); }} className="rounded-lg bg-[#2f8fd3] px-3 py-2 text-xs font-semibold text-white">Record measurement</button>
                      {measurements.length ? (
                        <select defaultValue="" onChange={(event) => event.target.value && void completeWithMeasurement(review.id, event.target.value)} className="rounded-lg border border-[#bfd7e8] px-2 py-2 text-xs">
                          <option value="">Use existing measurement</option>
                          {measurements.map((measurement) => <option key={measurement.id} value={measurement.id}>{formatDate(measurement.measured_at)} · {measurement.axial_length_right_mm.toFixed(2)}/{measurement.axial_length_left_mm.toFixed(2)}</option>)}
                        </select>
                      ) : null}
                    </div>
                  ) : null}
                  {review.status === "completed" ? (
                    <button type="button" onClick={() => void generateReport(review.id)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#bfd7e8] px-3 py-2 text-xs font-semibold text-[#2a6fa8]"><FileText className="h-3.5 w-3.5" />Generate updated report</button>
                  ) : null}
                </div>
              ))}
            </div>

            <label className="mt-4 block text-sm font-medium text-slate-700">Clinician comment for next report<textarea rows={2} value={clinicianComment} onChange={(event) => setClinicianComment(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5 text-sm" /></label>

            {selected.events.some((event) => event.event_type === "progress_report") ? (
              <div className="mt-5"><h3 className="text-sm font-semibold text-slate-900">Reports</h3><div className="mt-2 space-y-2">
                {selected.events.filter((event) => event.event_type === "progress_report").map((report) => (
                  <div key={report.id} className="flex items-center justify-between rounded-lg border border-[#dbe7ef] px-3 py-2">
                    <span className="text-xs font-medium text-slate-700">{report.title}</span>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => void openReport(report.id)} title="Open report" className="rounded-lg p-2 text-[#2a6fa8]"><Download className="h-4 w-4" /></button>
                      <button type="button" onClick={() => void sendReport(report.id)} title="Send on WhatsApp" className="rounded-lg p-2 text-emerald-700"><MessageCircle className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
              </div></div>
            ) : null}

            {selected.status === "pending" || selected.status === "active" ? (
              <button type="button" onClick={() => void cancelEnrollment()} className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-rose-700"><XCircle className="h-4 w-4" />Cancel program</button>
            ) : null}
          </aside>
        </div>
      ) : null}
      {isDetailLoading ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/10 text-sm font-medium text-slate-700">Loading enrollment...</div> : null}
      <HistoricalMyopiaModal open={isMeasurementOpen} patientAge={null} onClose={() => setIsMeasurementOpen(false)} onSave={recordMeasurement} />
    </main>
  );
}
