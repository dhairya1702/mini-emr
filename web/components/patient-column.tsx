"use client";

import { Plus } from "lucide-react";

import { PatientCard } from "@/components/patient-card";
import { Patient, PatientStatus } from "@/lib/types";

interface PatientColumnProps {
  title: string;
  patients: Patient[];
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  onAddPatient?: () => void;
  canAdvance?: (patient: Patient) => boolean;
}

export function PatientColumn({
  title,
  patients,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  onAddPatient,
  canAdvance,
}: PatientColumnProps) {
  return (
    <section className="flex min-h-0 flex-col rounded-[28px] border border-sky-200 bg-white/95 p-4 shadow-[0_18px_50px_rgba(125,211,252,0.14)]">
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <p className="text-sm text-slate-500">{patients.length} patients</p>
        </div>
        {onAddPatient ? (
          <button
            type="button"
            onClick={onAddPatient}
            aria-label="Add patient"
            title="Add patient"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 transition hover:bg-sky-200"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {patients.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-sky-200 bg-sky-50/50 px-4 py-10 text-center">
            <p className="text-sm font-medium text-slate-600">No patients in this stage.</p>
            <p className="mt-1 text-xs text-slate-500">New arrivals and transitions will appear here.</p>
          </div>
        ) : (
          patients.map((patient) => (
            <PatientCard
              key={patient.id}
              patient={patient}
              onOpen={onOpen}
              onAdvance={onAdvance}
              onRemoveFromQueue={onRemoveFromQueue}
              canAdvance={canAdvance ? canAdvance(patient) : true}
            />
          ))
        )}
      </div>
    </section>
  );
}
