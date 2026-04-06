"use client";

import { useCallback, useMemo, useState } from "react";
import { Clock3, Search } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Invoice, Patient } from "@/lib/types";

type HistoryFilter = "all" | "waiting" | "consultation" | "done" | "billed";

function formatHistoryStatus(patient: Patient) {
  if (patient.billed) {
    return "Billed";
  }
  if (patient.status === "consultation") {
    return "Consultation";
  }
  if (patient.status === "done") {
    return "Billing";
  }
  return "Waiting";
}

export default function HistoryPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [query, setQuery] = useState("");
  const loadPageData = useCallback(async () => {
    const historyPatients = await api.listPatients();
    return historyPatients.sort((left, right) => right.created_at.localeCompare(left.created_at));
  }, []);
  const onPageData = useCallback((data: Patient[]) => {
    setPatients(data);
  }, []);
  const {
    currentUser,
    users,
    catalogItems,
    followUps,
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
  } = useClinicShellPage({
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  const visiblePatients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return patients.filter((patient) => {
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "billed"
            ? patient.billed
            : patient.status === filter;
      const matchesQuery =
        !normalizedQuery ||
        patient.name.toLowerCase().includes(normalizedQuery) ||
        patient.phone.toLowerCase().includes(normalizedQuery) ||
        patient.reason.toLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [filter, patients, query]);

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
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">History</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Patient archive</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                Search prior patients, review queue outcomes, and open the full patient timeline.
              </p>
            </div>
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
                <option value="all">All patients</option>
                <option value="waiting">Waiting</option>
                <option value="consultation">In consultation</option>
                <option value="done">Billing</option>
                <option value="billed">Billed</option>
              </select>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="col-span-full overflow-hidden rounded-[28px] border border-sky-200 bg-white">
              {visiblePatients.length ? (
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
                            <div className="max-w-sm truncate">{patient.reason}</div>
                          </td>
                          <td className="border-b border-sky-100 px-5 py-4 text-sm">
                            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-600">
                              {formatHistoryStatus(patient)}
                            </span>
                          </td>
                          <td className="border-b border-sky-100 px-5 py-4 text-sm text-slate-500">
                            <div className="inline-flex items-center gap-2">
                              <Clock3 className="h-3.5 w-3.5" />
                              {new Date(patient.created_at).toLocaleString([], {
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
        patients={patients.filter((patient) => patient.status === "done" && !patient.billed)}
        catalogItems={catalogItems}
        followUps={followUps}
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
