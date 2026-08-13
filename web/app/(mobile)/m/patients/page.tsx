"use client";

import { Download, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { MobileShell } from "@/components/mobile/mobile-shell";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import { useInfinitePatients } from "@/lib/use-infinite-patients";
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
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const recentPatientsScope = useMemo(
    () => currentUser?.org_id && currentUser?.id ? { orgId: currentUser.org_id, userId: currentUser.id } : null,
    [currentUser?.id, currentUser?.org_id],
  );

  const {
    patients,
    isLoading,
    isLoadingMore,
    error: patientLoadError,
    reload: reloadPatients,
    sentinelRef,
  } = useInfinitePatients({
    enabled: isAuthReady && !isRedirectingToLogin && Boolean(currentUser),
    q: query,
  });

  useEffect(() => {
    setRecentPatients(recentPatientsScope ? loadRecentPatients(recentPatientsScope) : []);
  }, [recentPatientsScope]);

  const filteredPatients = patients;

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
    <MobileShell title="Patients" subtitle={`${filteredPatients.length} loaded`}>
      <section className="-mx-1">
        <div className="grid gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
            <label className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-3 text-slate-500">
              <Search className="h-4 w-4 shrink-0 text-[#2a6fa8]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search patients"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={isExporting}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-800 disabled:opacity-60"
              aria-label="Export patients"
              title="Export patients"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={reloadPatients}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-800"
              aria-label="Refresh patients"
              title="Refresh patients"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <p className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            {patients.length} patient{patients.length === 1 ? "" : "s"} loaded
          </p>
        </div>

        {recentPatients.length ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent patients</p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {recentPatients.slice(0, 4).map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => openPatient(patient)}
                  className="min-w-[132px] rounded-xl border border-[#dbe7ef] bg-white px-3 py-2 text-left"
                >
                  <p className="truncate text-[13px] font-semibold text-slate-900">{patient.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">{formatVisitDate(patient.last_visit_at)}</p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {exportStatus ? <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{exportStatus}</p> : null}
      </section>

      {error || patientLoadError ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error || patientLoadError}</p> : null}
      {isLoading ? (
        <p className="clinic-empty-state">Loading patients...</p>
      ) : (
        <div className="-mx-2 mt-3 overflow-hidden border-y border-[#dbe7ef] bg-white">
          {filteredPatients.length ? (
            <div className="divide-y divide-[#dbe7ef]">
              {filteredPatients.map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => openPatient(patient)}
                  className="block w-full bg-white px-3 py-2.5 text-left transition hover:bg-[#f3f8fb]/70"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{patient.name}</p>
                    </div>
                    <p className="shrink-0 whitespace-nowrap text-[11px] font-medium text-slate-400">{formatVisitDate(patient.last_visit_at)}</p>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                    {patient.phone || "No phone"} · {patient.reason || "No reason added"}
                  </p>
                </button>
              ))}
              <div ref={sentinelRef} data-testid="patient-scroll-sentinel" className="flex min-h-12 items-center justify-center">
                {isLoadingMore ? <LoaderCircle className="h-5 w-5 animate-spin text-[#2a6fa8]" aria-label="Loading more patients" /> : null}
              </div>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-slate-700">
                {patients.length ? "No patients match this search yet." : "No patients have been recorded yet."}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {patients.length ? "Try a broader name, phone number, or reason." : "Add a patient from the queue to start chart history."}
              </p>
            </div>
          )}
        </div>
      )}
    </MobileShell>
  );
}
