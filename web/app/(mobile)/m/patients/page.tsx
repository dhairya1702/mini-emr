"use client";

import { Download, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { MobileShell } from "@/components/mobile/mobile-shell";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import { loadRecentPatients, saveRecentPatient } from "@/lib/recent-patients";
import type { Patient } from "@/lib/types";

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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function MobilePatientsPage() {
  const router = useRouter();
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const recentPatientsScope = useMemo(
    () => currentUser?.org_id && currentUser?.id ? { orgId: currentUser.org_id, userId: currentUser.id } : null,
    [currentUser?.id, currentUser?.org_id],
  );

  async function loadPatients() {
    if (!currentUser) {
      return;
    }
    setIsLoading(true);
    try {
      const rows = await api.listPatients();
      setPatients(rows.sort((left, right) => right.last_visit_at.localeCompare(left.last_visit_at)));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load patients.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser) {
      return;
    }
    let active = true;
    void loadPatients().finally(() => {
      if (!active) {
        return;
      }
    });
    return () => {
      active = false;
    };
    // loadPatients intentionally reads current user state and is only needed on shell readiness changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, isAuthReady, isRedirectingToLogin]);

  useEffect(() => {
    setRecentPatients(recentPatientsScope ? loadRecentPatients(recentPatientsScope) : []);
  }, [recentPatientsScope]);

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return patients;
    }
    const normalizedPhoneQuery = normalizePhone(normalized);
    return patients.filter((patient) => (
      patient.name.toLowerCase().includes(normalized) ||
      patient.phone.toLowerCase().includes(normalized) ||
      patient.reason.toLowerCase().includes(normalized) ||
      (normalizedPhoneQuery.length >= 3 && normalizePhone(patient.phone).includes(normalizedPhoneQuery))
    ));
  }, [patients, query]);

  function openPatient(patient: Patient) {
    if (recentPatientsScope) {
      setRecentPatients(saveRecentPatient({ ...recentPatientsScope, patient }));
    }
    router.push(`/m/patient/${patient.id}`);
  }

  async function handleExport() {
    setIsExporting(true);
    setError("");
    setExportStatus("");
    try {
      downloadBlob(await api.exportPatientsCsv(), "patients.csv");
      setExportStatus("Export downloaded.");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to export patients.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <MobileShell title="Patients" subtitle={`${filteredPatients.length} records`}>
      <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-4 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
        <div className="grid gap-3">
          <div className="flex gap-2">
            <label className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-[#bfd7e8] bg-[#f3f8fb]/60 px-3 text-slate-500">
              <Search className="h-5 w-5 shrink-0 text-[#2a6fa8]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search patients"
                className="min-w-0 flex-1 bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={isExporting}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#bfd7e8] bg-white text-slate-800 disabled:opacity-60"
              aria-label="Export patients"
              title="Export patients"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void loadPatients()}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#bfd7e8] bg-white text-slate-800"
              aria-label="Refresh patients"
              title="Refresh patients"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="rounded-2xl border border-[#dbe7ef] bg-[#f3f8fb]/60 px-4 py-2.5 text-sm text-slate-600">
            <span className="text-lg font-semibold text-slate-900">{patients.length}</span>{" "}
            <span className="font-medium text-slate-500">Patients</span>
          </div>
        </div>

        {recentPatients.length ? (
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent patients</p>
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {recentPatients.slice(0, 4).map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => openPatient(patient)}
                  className="min-w-[160px] rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/50 px-3.5 py-2.5 text-left"
                >
                  <p className="truncate text-sm font-semibold text-slate-900">{patient.name}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{patient.reason || "No reason"} · {formatVisitDate(patient.last_visit_at)}</p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {exportStatus ? <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{exportStatus}</p> : null}
      </section>

      {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {isLoading ? (
        <p className="clinic-empty-state">Loading patients...</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-[18px] border border-[#bfd7e8] bg-white shadow-[0_14px_34px_rgba(64,131,181,0.08)]">
          {filteredPatients.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[680px] border-separate border-spacing-0">
                <thead className="bg-[#f3f8fb]/95">
                  <tr className="text-left">
                    <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Patient</th>
                    <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Phone</th>
                    <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Last reason</th>
                    <th className="border-b border-[#dbe7ef] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Last visit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPatients.map((patient) => (
                    <tr key={patient.id} onClick={() => openPatient(patient)} className="cursor-pointer hover:bg-[#f3f8fb]/70">
                      <td className="border-b border-[#dbe7ef] px-4 py-3 text-sm">
                        <p className="font-semibold text-slate-900">{patient.name}</p>
                        <p className="mt-1 text-xs text-slate-500">ID {patient.id.slice(0, 8).toUpperCase()}</p>
                      </td>
                      <td className="border-b border-[#dbe7ef] px-4 py-3 text-sm text-slate-600">{patient.phone}</td>
                      <td className="border-b border-[#dbe7ef] px-4 py-3 text-sm text-slate-600">
                        <div className="max-w-[220px] truncate">{patient.reason}</div>
                      </td>
                      <td className="border-b border-[#dbe7ef] px-4 py-3 text-sm text-slate-500">{formatVisitDate(patient.last_visit_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-slate-700">
                {patients.length ? "No patients match this search yet." : "No patients have been recorded yet."}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {patients.length ? "Try a broader name, reason, or phone fragment." : "Add a patient from the queue to start chart history."}
              </p>
            </div>
          )}
        </div>
      )}
    </MobileShell>
  );
}
