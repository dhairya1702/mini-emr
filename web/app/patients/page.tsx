"use client";

import { useCallback, useMemo, useState } from "react";
import { Download, Search, UserRound } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient } from "@/lib/types";

function formatVisitDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [isExporting, setIsExporting] = useState("");
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

  const visiblePatients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return patients;
    }
    return patients.filter((patient) =>
      patient.name.toLowerCase().includes(normalizedQuery) ||
      patient.phone.toLowerCase().includes(normalizedQuery) ||
      patient.reason.toLowerCase().includes(normalizedQuery),
    );
  }, [patients, query]);

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
    setPatients((current) => current.map((patient) => (patient.id === patientId ? saved : patient)));
    setSelectedPatient(saved);
  }

  async function handleLoadPatientTimeline(patientId: string) {
    return api.getPatientTimeline(patientId);
  }

  async function handleExport(
    kind: "patients" | "visits",
    loader: () => Promise<Blob>,
  ) {
    setIsExporting(kind);
    setExportError("");
    setExportStatus("");
    try {
      const blob = await loader();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${kind}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportStatus(`${kind === "patients" ? "Patients" : "Visits"} export downloaded.`);
    } catch (loadError) {
      setExportError(loadError instanceof Error ? loadError.message : `Failed to export ${kind}.`);
    } finally {
      setIsExporting("");
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
          active="patients"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="rounded-[32px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.16)] sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs uppercase tracking-[0.2em] text-sky-700">
                <UserRound className="h-3.5 w-3.5" />
                Patients
              </div>
              <h2 className="mt-4 text-2xl font-semibold text-slate-900 sm:text-3xl">
                Search your patient records without leaving the flow.
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Find patients by name or phone, open the chart, and review their visit trail from one clean place.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleExport("patients", handleExportPatientsCsv)}
                  disabled={isExporting === "patients"}
                  className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                  {isExporting === "patients" ? "Preparing..." : "Export Patients"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleExport("visits", handleExportVisitsCsv)}
                  disabled={isExporting === "visits"}
                  className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                  {isExporting === "visits" ? "Preparing..." : "Export Visits"}
                </button>
              </div>
            </div>

            <div className="w-full max-w-xl">
              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Patient Search
              </label>
              <div className="mt-2 flex items-center gap-3 rounded-[28px] border border-sky-200 bg-sky-50/50 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <Search className="h-4 w-4 text-sky-700" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by patient name or phone"
                  className="w-full bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>
            </div>
          </div>

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

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-[24px] border border-sky-100 bg-sky-50/60 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Total Records</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{patients.length}</p>
            </div>
            <div className="rounded-[24px] border border-sky-100 bg-white p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Showing</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{visiblePatients.length}</p>
            </div>
            <div className="rounded-[24px] border border-sky-100 bg-white p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Latest Record</p>
              <p className="mt-3 text-lg font-semibold text-slate-900">
                {patients[0] ? formatVisitDate(patients[0].last_visit_at) : "No records yet"}
              </p>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-[28px] border border-sky-200 bg-white">
            {visiblePatients.length ? (
              <div className="max-h-[68vh] overflow-auto">
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
                        Last Reason
                      </th>
                      <th className="border-b border-sky-100 px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Last Visit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePatients.map((patient) => (
                      <tr
                        key={patient.id}
                        onClick={() => setSelectedPatient(patient)}
                        className="cursor-pointer transition hover:bg-sky-50/70"
                      >
                        <td className="border-b border-sky-100 px-5 py-4 text-sm text-slate-800">
                          <div className="font-semibold text-slate-900">{patient.name}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            ID {patient.id.slice(0, 8).toUpperCase()}
                          </div>
                        </td>
                        <td className="border-b border-sky-100 px-5 py-4 text-sm text-slate-600">
                          {patient.phone}
                        </td>
                        <td className="border-b border-sky-100 px-5 py-4 text-sm text-slate-600">
                          <div className="max-w-md truncate">{patient.reason}</div>
                        </td>
                        <td className="border-b border-sky-100 px-5 py-4 text-sm text-slate-500">
                          {formatVisitDate(patient.last_visit_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-6 py-16 text-center text-sm text-slate-500">
                No patients matched that search.
              </div>
            )}
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
        patients={patients.filter((patient) => patient.status === "done" && !patient.billed)}
        catalogItems={catalogItems}
        onLoadCatalogItems={loadCatalogItems}
        onClose={() => setIsSettingsOpen(false)}
        onSaveClinic={handleSaveClinicSettings}
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
          setPatients((current) => [checkedInPatient, ...current]);
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
    </main>
  );
}
