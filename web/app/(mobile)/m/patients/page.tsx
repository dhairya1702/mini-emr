"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MobilePatientCard } from "@/components/mobile/mobile-patient-card";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import type { Patient } from "@/lib/types";

export default function MobilePatientsPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser) {
      return;
    }
    let active = true;
    setIsLoading(true);
    api.listPatients()
      .then((rows) => {
        if (active) {
          setPatients(rows);
          setError("");
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load patients.");
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin]);

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return patients;
    }
    return patients.filter((patient) =>
      [patient.name, patient.phone, patient.reason].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [patients, query]);

  return (
    <MobileShell title="Patients" subtitle={`${filteredPatients.length} records`}>
      <label className="mb-4 flex h-12 items-center gap-3 rounded-2xl border border-[#bfd7e8] bg-white px-3 text-slate-500">
        <Search className="h-5 w-5" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search patients"
          className="min-w-0 flex-1 bg-transparent text-base text-slate-800 outline-none placeholder:text-[#8a928b]"
        />
      </label>
      {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {isLoading ? (
        <p className="clinic-empty-state">Loading patients...</p>
      ) : (
        <div className="grid gap-3">
          {filteredPatients.map((patient) => (
            <MobilePatientCard key={patient.id} patient={patient} href={`/m/patient/${patient.id}`} />
          ))}
        </div>
      )}
    </MobileShell>
  );
}
