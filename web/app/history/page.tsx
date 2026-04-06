"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Search } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { authStorage } from "@/lib/auth";
import { api } from "@/lib/api";
import { AuthUser, ClinicSettings, Patient } from "@/lib/types";

type HistoryFilter = "all" | "waiting" | "consultation" | "done" | "billed";

export default function HistoryPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isRedirectingToLogin, setIsRedirectingToLogin] = useState(false);

  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  useEffect(() => {
    let active = true;

    async function loadPage() {
      const token = authStorage.getToken();
      if (!token) {
        if (active) {
          setIsRedirectingToLogin(true);
          setIsAuthReady(true);
        }
        router.replace("/login");
        return;
      }

      try {
        const [user, settings, historyPatients] = await Promise.all([
          api.getCurrentUser(),
          api.getClinicSettings(),
          api.listPatients(),
        ]);
        if (active) {
          setCurrentUser(user);
          setClinicSettings(settings);
          setPatients(historyPatients.sort((left, right) => right.created_at.localeCompare(left.created_at)));
          setIsAuthReady(true);
        }
      } catch (loadError) {
        if (active) {
          authStorage.clear();
          setError(loadError instanceof Error ? loadError.message : "Session expired.");
          setIsRedirectingToLogin(true);
          setIsAuthReady(true);
          router.replace("/login");
        }
      }
    }

    loadPage();
    return () => {
      active = false;
    };
  }, [router]);

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

  function handleLogout() {
    authStorage.clear();
    setIsRedirectingToLogin(true);
    router.replace("/login");
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
            {visiblePatients.length ? visiblePatients.map((patient) => (
              <button
                key={patient.id}
                type="button"
                onClick={() => setSelectedPatient(patient)}
                className="rounded-[28px] border border-sky-200 bg-sky-50/30 p-5 text-left transition hover:border-sky-300 hover:bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-slate-900">{patient.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{patient.phone}</p>
                  </div>
                  <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-600">
                    {patient.billed ? "billed" : patient.status}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-600">{patient.reason}</p>
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  {new Date(patient.created_at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </button>
            )) : (
              <div className="col-span-full rounded-[28px] border border-dashed border-sky-300 bg-sky-50/30 px-6 py-16 text-center text-sm text-slate-500">
                No patients matched this history view.
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
    </main>
  );
}
