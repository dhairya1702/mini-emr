"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MobileAddPatientModal } from "@/components/mobile/mobile-add-patient-modal";
import { MobilePatientCard } from "@/components/mobile/mobile-patient-card";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import { resolveMobileConsultationScope, readMobileConsultationDraft } from "@/lib/mobile/consultation";
import { getMobileQueuePatients } from "@/lib/mobile/queue";
import type { Patient, PatientInput } from "@/lib/types";

export default function MobileQueuePage() {
  const { currentUser, error: shellError, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);

  const loadPatients = useCallback(async () => {
    if (!currentUser) {
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      setPatients(await api.listPatients());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load queue.");
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser) {
      return;
    }
    void loadPatients();
  }, [currentUser, isAuthReady, isRedirectingToLogin, loadPatients]);

  const queuePatients = useMemo(() => getMobileQueuePatients(patients), [patients]);

  async function handleCreatePatient(payload: PatientInput) {
    const created = await api.createPatient(payload);
    setPatients((current) => [created, ...current]);
  }

  async function handleRemoveFromQueue(patient: Patient) {
    const previousPatients = patients;
    const removedPatient: Patient = { ...patient, status: "done", billed: true };

    setPatients((current) =>
      current.map((entry) => (entry.id === patient.id ? removedPatient : entry)),
    );
    setError("");

    try {
      const saved = await api.updatePatient(patient.id, {
        status: "done",
        billed: true,
      });
      setPatients((current) =>
        current.map((entry) => (entry.id === patient.id ? saved : entry)),
      );
    } catch (removeError) {
      setPatients(previousPatients);
      setError(removeError instanceof Error ? removeError.message : "Failed to remove patient from queue.");
    }
  }

  if (!isAuthReady || isRedirectingToLogin) {
    return (
      <MobileShell title="Queue">
        <p className="clinic-empty-state">Loading...</p>
      </MobileShell>
    );
  }

  return (
    <MobileShell
      title="Queue"
      subtitle={`${queuePatients.length} active consultation${queuePatients.length === 1 ? "" : "s"}`}
      action={
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf5fa] text-[#2a6fa8] transition hover:bg-[#dbeaf4]"
          aria-label="Add patient"
        >
          <Plus className="h-5 w-5" />
        </button>
      }
    >
      {shellError || error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{shellError || error}</p>
      ) : null}

      <section className="flex min-h-[calc(100vh-150px)] flex-col rounded-[18px] border border-[#bfd7e8] bg-white/95 p-4 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Waiting</h2>
            <p className="text-sm text-slate-500">{queuePatients.length} patients</p>
          </div>
          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            aria-label="Add patient"
            title="Add patient"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#edf5fa] text-[#2a6fa8] transition hover:bg-[#dbeaf4]"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="rounded-[14px] border border-dashed border-[#bfd7e8] bg-[#f5f9fc] px-4 py-8 text-center text-sm text-slate-500">
              Loading queue...
            </p>
          ) : queuePatients.length ? (
            <div className="space-y-3">
              {queuePatients.map((patient) => {
                const scope = resolveMobileConsultationScope(currentUser, patient.id);
                const draft = scope ? readMobileConsultationDraft(scope) : null;
                return (
                  <MobilePatientCard
                    key={patient.id}
                    patient={patient}
                    href={`/m/consultation/${patient.id}`}
                    hasDraft={Boolean(draft?.noteId || draft?.generatedNote)}
                    onRemoveFromQueue={handleRemoveFromQueue}
                  />
                );
              })}
            </div>
          ) : (
            <div className="rounded-[14px] border border-dashed border-[#bfd7e8] bg-[#f5f9fc] px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-600">No patients in this stage.</p>
              <p className="mt-1 text-xs text-slate-500">New arrivals and transitions will appear here.</p>
            </div>
          )}
        </div>
      </section>

      <MobileAddPatientModal open={isAddOpen} onClose={() => setIsAddOpen(false)} onSubmit={handleCreatePatient} />
    </MobileShell>
  );
}
