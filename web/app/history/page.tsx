"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Download, RefreshCw, Search } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { loadRecentPatients, saveRecentPatient } from "@/lib/recent-patients";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient, PatientVisit } from "@/lib/types";

type HistoryFilter = "all" | "waiting" | "consultation" | "done" | "billed";
type HistoryExportRange = "today" | "7d" | "30d" | "month" | "all";

function formatHistoryStatus(visit: PatientVisit) {
  if (visit.billed) {
    return "Billed";
  }
  if (visit.status === "consultation") {
    return "Consultation";
  }
  if (visit.status === "done") {
    return "Billing";
  }
  return "Waiting";
}

function normalizeVisit(value: PatientVisit): PatientVisit {
  return {
    ...value,
    id: String(value.id ?? ""),
    patient_id: String(value.patient_id ?? ""),
    name: String(value.name ?? ""),
    phone: String(value.phone ?? ""),
    reason: String(value.reason ?? ""),
    source: String(value.source ?? ""),
    appointment_id: value.appointment_id ? String(value.appointment_id) : null,
    created_at: String(value.created_at ?? ""),
    last_visit_at: String(value.last_visit_at ?? value.created_at ?? ""),
    billed: Boolean(value.billed),
    status:
      value.status === "consultation" || value.status === "done" || value.status === "waiting"
        ? value.status
        : "waiting",
    age: value.age ?? null,
    weight: value.weight ?? null,
    height: value.height ?? null,
    temperature: value.temperature ?? null,
  };
}

export default function HistoryPage() {
  const [visits, setVisits] = useState<PatientVisit[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [query, setQuery] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  const loadPageData = useCallback(async () => {
    const historyVisits = await api.listPatientVisits();
    return historyVisits
      .map(normalizeVisit)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }, []);
  const onPageData = useCallback((data: PatientVisit[]) => {
    setVisits(data);
  }, []);
  const {
    currentUser,
    users,
    auditEvents,
    loadUsers,
    loadAuditEvents,
    catalogItems,
    loadCatalogItems,
    clinicSettings,
    error,
    isAuthReady,
    isRedirectingToLogin,
    handleLogout,
    handleSaveClinicSettings,
    applyClinicSettings,
    handleAddStaffUser,
    handleCreateCatalogItem,
    handleAdjustCatalogStock,
    handleDeleteCatalogItem,
    handleCreateInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendInvoice,
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  } = useClinicShellPage({
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";
  useEffect(() => {
    setRecentPatients(loadRecentPatients());
  }, []);
  const uniquePatients = useMemo<Patient[]>(() => {
    const seen = new Set<string>();
    const records: Patient[] = [];
    for (const visit of visits) {
      if (seen.has(visit.patient_id)) {
        continue;
      }
      seen.add(visit.patient_id);
      records.push({
        id: visit.patient_id,
        name: visit.name,
        phone: visit.phone,
        reason: visit.reason,
        age: visit.age,
        weight: visit.weight,
        height: visit.height,
        temperature: visit.temperature,
        status: visit.status,
        billed: visit.billed,
        created_at: visit.created_at,
        last_visit_at: visit.last_visit_at,
      });
    }
    return records;
  }, [visits]);

  const visibleVisits = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visits.filter((visit) => {
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "billed"
            ? visit.billed
            : visit.status === filter;
      const matchesQuery =
        !normalizedQuery ||
        visit.name.toLowerCase().includes(normalizedQuery) ||
        visit.phone.toLowerCase().includes(normalizedQuery) ||
        visit.reason.toLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [filter, visits, query]);

  async function handleUpdatePatient(
    patientId: string,
    payload: {
      name: string;
      phone: string;
      reason: string;
      age: number;
      weight: number;
      height: number | null;
      temperature: number;
    },
  ) {
    const saved = await api.updatePatient(patientId, payload);
    setVisits((current) =>
      current.map((visit) =>
        visit.patient_id === patientId
          ? { ...visit, name: saved.name, phone: saved.phone, status: saved.status, billed: saved.billed, last_visit_at: saved.last_visit_at }
          : visit,
      ),
    );
    setSelectedPatient(saved);
    setRecentPatients(saveRecentPatient(saved));
  }

  async function handleLoadPatientTimeline(patientId: string) {
    return api.getPatientTimeline(patientId);
  }

  async function handleExport(range: HistoryExportRange) {
    setIsExporting(true);
    setIsExportMenuOpen(false);
    setExportError("");
    setExportStatus("");
    try {
      const blob = await handleExportVisitsCsv({ range });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "visits.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportStatus("Export downloaded.");
    } catch (loadError) {
      setExportError(loadError instanceof Error ? loadError.message : "Failed to export visits.");
    } finally {
      setIsExporting(false);
    }
  }

  if (isRedirectingToLogin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">
          Redirecting to login...
        </div>
      </main>
    );
  }

  if (!isAuthReady) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">
          Loading ClinicOS...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <AppHeader
          clinicName={clinicName}
          currentUser={currentUser}
          active="history"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="rounded-[32px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, phone, or reason"
                  className="w-full rounded-full border border-sky-200 bg-sky-50/50 py-3 pl-11 pr-4 text-sm text-slate-800 outline-none transition focus:border-sky-400 sm:w-80"
                />
              </div>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as HistoryFilter)}
                className="rounded-full border border-sky-200 bg-sky-50/50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400"
              >
                <option value="all">All visits</option>
                <option value="waiting">Waiting</option>
                <option value="consultation">In consultation</option>
                <option value="done">Billing</option>
                <option value="billed">Billed</option>
              </select>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <div className="relative inline-flex">
                <button
                  type="button"
                  onClick={() => setIsExportMenuOpen((current) => !current)}
                  disabled={isExporting}
                  className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                  {isExporting ? "Preparing..." : "Export"}
                </button>
                {isExportMenuOpen ? (
                  <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-2xl border border-sky-200 bg-white p-2 shadow-[0_20px_50px_rgba(15,23,42,0.12)]">
                    {[
                      { value: "today", label: "Today" },
                      { value: "7d", label: "Last 7 days" },
                      { value: "30d", label: "Last 30 days" },
                      { value: "month", label: "This month" },
                      { value: "all", label: "All time" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => void handleExport(option.value as HistoryExportRange)}
                        className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-sky-50"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                </div>
                <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-sky-50">
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </button>
              </div>
            </div>
          </div>

          {recentPatients.length ? (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Quick Reopen</p>
              <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                {recentPatients.slice(0, 5).map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => {
                      setSelectedPatient(patient);
                      setRecentPatients(saveRecentPatient(patient));
                    }}
                    className="min-w-[220px] rounded-[22px] border border-sky-100 bg-sky-50/50 px-4 py-3 text-left transition hover:border-sky-200 hover:bg-white"
                  >
                    <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{patient.reason}</p>
                    <p className="mt-2 text-xs text-slate-500">{patient.phone}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {exportError ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {exportError}
            </div>
          ) : null}
          {exportStatus ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {exportStatus}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="col-span-full overflow-hidden rounded-[28px] border border-sky-200 bg-white">
              {visibleVisits.length ? (
                <div className="max-h-[65vh] overflow-auto">
                  <table className="min-w-full border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-sky-50/95 backdrop-blur">
                      <tr className="text-left">
                        <th className="border-b border-sky-100 px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Patient
                        </th>
                        <th className="border-b border-sky-100 px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Phone
                        </th>
                        <th className="border-b border-sky-100 px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Reason
                        </th>
                        <th className="border-b border-sky-100 px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Status
                        </th>
                        <th className="border-b border-sky-100 px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Visit Time
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleVisits.map((visit) => (
                        <tr
                          key={visit.id}
                          onClick={() => {
                            const selected = {
                              id: visit.patient_id,
                              name: visit.name,
                              phone: visit.phone,
                              reason: visit.reason,
                              age: visit.age,
                              weight: visit.weight,
                              height: visit.height,
                              temperature: visit.temperature,
                              status: visit.status,
                              billed: visit.billed,
                              created_at: visit.created_at,
                              last_visit_at: visit.last_visit_at,
                            };
                            setSelectedPatient(selected);
                            setRecentPatients(saveRecentPatient(selected));
                          }}
                          className="cursor-pointer transition hover:bg-sky-50/70"
                        >
                          <td className="border-b border-sky-100 px-5 py-4 text-sm text-slate-800">
                            <div className="font-semibold text-slate-900">{visit.name}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              ID {(visit.patient_id || "unknown").slice(0, 8).toUpperCase()}
                            </div>
                          </td>
                          <td className="border-b border-sky-100 px-5 py-4 text-sm text-slate-600">
                            {visit.phone}
                          </td>
                          <td className="border-b border-sky-100 px-5 py-4 text-sm text-slate-600">
                            <div className="max-w-sm truncate">{visit.reason}</div>
                          </td>
                          <td className="border-b border-sky-100 px-5 py-4 text-sm">
                            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-600">
                              {formatHistoryStatus(visit)}
                            </span>
                          </td>
                          <td className="border-b border-sky-100 px-5 py-4 text-sm text-slate-500">
                            <div className="inline-flex items-center gap-2">
                              <Clock3 className="h-3.5 w-3.5" />
                              {new Date(visit.created_at).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-6 py-16 text-center text-sm text-slate-500">
                  No patients matched this history view.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <PatientDetailsDrawer
        patient={selectedPatient}
        onLoadTimeline={handleLoadPatientTimeline}
        onSave={handleUpdatePatient}
        onClose={() => setSelectedPatient(null)}
      />

      <SettingsDrawer
        open={isSettingsOpen}
        settings={clinicSettings}
        currentUser={currentUser}
        users={users}
        onLoadUsers={loadUsers}
        auditEvents={auditEvents}
        onLoadAuditEvents={loadAuditEvents}
        patients={uniquePatients.filter((patient) => patient.status === "done" && !patient.billed)}
        catalogItems={catalogItems}
        onLoadCatalogItems={loadCatalogItems}
        onClose={() => setIsSettingsOpen(false)}
        onSaveClinic={handleSaveClinicSettings}
        onClinicSettingsChange={applyClinicSettings}
        onAddUser={handleAddStaffUser}
        onCreateCatalogItem={handleCreateCatalogItem}
        onAdjustCatalogStock={handleAdjustCatalogStock}
        onDeleteCatalogItem={handleDeleteCatalogItem}
        onGenerateLetter={handleGenerateLetter}
        onGenerateLetterPdf={(payload) => api.generateLetterPdf(payload)}
        onSendLetter={handleSendLetter}
        onCreateInvoice={handleCreateInvoice}
        onGenerateInvoicePdf={(invoiceId) => api.generateInvoicePdf(invoiceId)}
        onSendInvoice={handleSendInvoice}
        onExportPatientsCsv={handleExportPatientsCsv}
        onExportVisitsCsv={handleExportVisitsCsv}
        onExportInvoicesCsv={handleExportInvoicesCsv}
        onCheckInAppointment={async (appointmentId, options) => {
          const checkedInPatient = options?.existingPatientId
            ? await api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId)
            : await api.checkInAppointment(appointmentId, { force_new: options?.forceNew });
          const refreshedVisits = await api.listPatientVisits();
          setVisits(
            refreshedVisits
              .map(normalizeVisit)
              .sort((left, right) => right.created_at.localeCompare(left.created_at)),
          );
          setSelectedPatient(checkedInPatient);
          return {
            id: appointmentId,
            checked_in_at: new Date().toISOString(),
            checked_in_patient_id: checkedInPatient.id,
          };
        }}
        onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
        onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
        onBillingComplete={(patientId) => {
          setVisits((current) =>
            current.map((visit) =>
              visit.patient_id === patientId ? { ...visit, billed: true } : visit,
            ),
          );
          setIsSettingsOpen(false);
        }}
      />
    </main>
  );
}
