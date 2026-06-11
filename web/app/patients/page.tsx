"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { api } from "@/lib/api";
import { loadRecentPatients, saveRecentPatient } from "@/lib/recent-patients";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient, PatientChartVisit, PatientVisitDetail } from "@/lib/types";

function formatVisitDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function upsertPatient(current: Patient[], incoming: Patient) {
  const withoutMatch = current.filter((patient) => patient.id !== incoming.id);
  return [incoming, ...withoutMatch].sort((left, right) =>
    right.last_visit_at.localeCompare(left.last_visit_at),
  );
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const loadPageData = useCallback(async () => {
    const records = await api.listPatients();
    return records.sort((left, right) => right.last_visit_at.localeCompare(left.last_visit_at));
  }, []);
  const onPageData = useCallback((data: Patient[]) => {
    setPatients(data);
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
  const currentUserId = currentUser?.id;
  const currentOrgId = currentUser?.org_id;
  const recentPatientsScope = useMemo(
    () => currentUserId && currentOrgId ? { orgId: currentOrgId, userId: currentUserId } : null,
    [currentOrgId, currentUserId],
  );

  useEffect(() => {
    setRecentPatients(recentPatientsScope ? loadRecentPatients(recentPatientsScope) : []);
  }, [recentPatientsScope]);

  function rememberRecentPatient(patient: Patient) {
    if (!recentPatientsScope) {
      return;
    }
    setRecentPatients(saveRecentPatient({ ...recentPatientsScope, patient }));
  }

  const visiblePatients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return patients;
    }
    const normalizedPhoneQuery = normalizePhone(normalizedQuery);
    return patients.filter((patient) =>
      patient.name.toLowerCase().includes(normalizedQuery) ||
      patient.phone.toLowerCase().includes(normalizedQuery) ||
      patient.reason.toLowerCase().includes(normalizedQuery) ||
      (normalizedPhoneQuery.length >= 3 && normalizePhone(patient.phone).includes(normalizedPhoneQuery)),
    );
  }, [patients, query]);

  async function handleUpdatePatient(
    patientId: string,
    payload: {
      name: string;
      phone: string;
      email: string;
      address: string;
      reason: string;
      age: number;
      weight: number;
      height: number | null;
      temperature: number;
    },
  ) {
    const saved = await api.updatePatient(patientId, payload);
    setPatients((current) => current.map((patient) => (patient.id === patientId ? saved : patient)));
    setSelectedPatient(saved);
    rememberRecentPatient(saved);
  }

  async function handleLoadPatientVisits(patientId: string): Promise<PatientChartVisit[]> {
    return api.listPatientChartVisits(patientId);
  }

  async function handleLoadPatientVisitDetail(patientId: string, visitId: string): Promise<PatientVisitDetail> {
    return api.getPatientVisitDetail(patientId, visitId);
  }

  async function handleExport() {
    setIsExporting(true);
    setExportError("");
    setExportStatus("");
    try {
      const blob = await handleExportPatientsCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "patients.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportStatus("Export downloaded.");
    } catch (loadError) {
      setExportError(loadError instanceof Error ? loadError.message : "Failed to export patients.");
    } finally {
      setIsExporting(false);
    }
  }

  if (isRedirectingToLogin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
          Redirecting to login...
        </div>
      </main>
    );
  }

  if (!isAuthReady) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
          Loading ClinicOS...
        </div>
      </main>
    );
  }

  return (
    <main className="clinic-page">
      <div className="clinic-container">
        <AppHeader
          clinicName={clinicName}
          currentUser={currentUser}
          active="patients"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="clinic-panel">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex w-full flex-col gap-3 lg:max-w-3xl lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/50 px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <Search className="h-4 w-4 text-[#2a6fa8]" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by name, phone fragment, or visit reason"
                    className="w-full bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>
              <div className="rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/60 px-4 py-2.5 text-sm text-slate-600 lg:min-w-[140px]">
                <span className="text-lg font-semibold text-slate-900">{patients.length}</span>{" "}
                <span className="font-medium text-slate-500">Patients</span>
              </div>
            </div>

            <div className="flex justify-start lg:justify-end">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleExport()}
                  disabled={isExporting}
                  aria-label={isExporting ? "Preparing patient export" : "Export patients"}
                  title={isExporting ? "Preparing export" : "Export patients"}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#9fc7e1] bg-white text-slate-800 transition hover:bg-[#f3f8fb] disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  aria-label="Retry loading patients"
                  title="Retry loading patients"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#9fc7e1] bg-white text-slate-800 transition hover:bg-[#f3f8fb]"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {recentPatients.length ? (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent Patients</p>
              <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                {recentPatients.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => {
                      setSelectedPatient(patient);
                      rememberRecentPatient(patient);
                  }}
                    className="min-w-[180px] rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3.5 py-2.5 text-left transition hover:border-[#bfd7e8] hover:bg-white"
                  >
                    <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {patient.reason || "No reason"} · {formatVisitDate(patient.last_visit_at)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {exportError ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {exportError}
            </div>
          ) : null}
          {exportStatus ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {exportStatus}
            </div>
          ) : null}

          <div className="mt-6 overflow-hidden rounded-[18px] border border-[#bfd7e8] bg-white">
            {visiblePatients.length ? (
              <div className="max-h-[68vh] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0">
                  <thead className="sticky top-0 z-10 bg-[#f3f8fb]/95 backdrop-blur">
                    <tr className="text-left">
                      <th className="border-b border-[#dbe7ef] px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Patient
                      </th>
                      <th className="border-b border-[#dbe7ef] px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Phone
                      </th>
                      <th className="border-b border-[#dbe7ef] px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Last Reason
                      </th>
                      <th className="border-b border-[#dbe7ef] px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Last Visit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePatients.map((patient) => (
                      <tr
                        key={patient.id}
                        onClick={() => {
                          setSelectedPatient(patient);
                          rememberRecentPatient(patient);
                        }}
                        className="cursor-pointer transition hover:bg-[#f3f8fb]/70"
                      >
                        <td className="border-b border-[#dbe7ef] px-5 py-4 text-sm text-slate-800">
                          <div className="font-semibold text-slate-900">{patient.name}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            ID {patient.id.slice(0, 8).toUpperCase()}
                          </div>
                        </td>
                        <td className="border-b border-[#dbe7ef] px-5 py-4 text-sm text-slate-600">
                          {patient.phone}
                        </td>
                        <td className="border-b border-[#dbe7ef] px-5 py-4 text-sm text-slate-600">
                          <div className="max-w-md truncate">{patient.reason}</div>
                        </td>
                        <td className="border-b border-[#dbe7ef] px-5 py-4 text-sm text-slate-500">
                          {formatVisitDate(patient.last_visit_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-medium text-slate-700">
                  {patients.length
                    ? "No patients match this search yet."
                    : error === "Failed to fetch" || error.includes("timed out")
                      ? "The backend is unavailable right now."
                      : "No patients have been recorded yet."}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {patients.length
                    ? "Try a broader name, reason, or phone fragment."
                    : error === "Failed to fetch" || error.includes("timed out")
                      ? "Check the API server and refresh this page."
                      : "Add a patient from the queue to start building the chart history."}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      <PatientDetailsDrawer
        patient={selectedPatient}
        clinicSpecialty={clinicSettings?.clinic_specialty ?? null}
        onLoadVisits={handleLoadPatientVisits}
        onLoadVisitDetail={handleLoadPatientVisitDetail}
        onLoadMyopiaHistory={(patientId) => api.getPatientMyopiaHistory(patientId)}
        onLoadGrowthHistory={(patientId) => api.getPatientGrowthHistory(patientId)}
        onSave={handleUpdatePatient}
        onClose={() => setSelectedPatient(null)}
      />

      {isSettingsOpen ? (
      <LazySettingsDrawer
        open={isSettingsOpen}
        settings={clinicSettings}
        currentUser={currentUser}
        users={users}
        onLoadUsers={loadUsers}
        auditEvents={auditEvents}
        onLoadAuditEvents={loadAuditEvents}
        patients={patients.filter((patient) => patient.status === "done" && !patient.billed)}
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
          setPatients((current) => upsertPatient(current, checkedInPatient));
          return {
            id: appointmentId,
            checked_in_at: new Date().toISOString(),
            checked_in_patient_id: checkedInPatient.id,
          };
        }}
        onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
        onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
        onBillingComplete={(patientId) => {
          setPatients((current) =>
            current.map((patient) =>
              patient.id === patientId ? { ...patient, billed: true } : patient,
            ),
          );
          setIsSettingsOpen(false);
        }}
      />
      ) : null}
    </main>
  );
}
