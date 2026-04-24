"use client";

import { PatientCard } from "@/components/patient-card";
import { Patient, PatientStatus } from "@/lib/types";

interface PatientColumnProps {
  title: string;
  status: PatientStatus;
  patients: Patient[];
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  canAdvance?: (patient: Patient) => boolean;
}

export function PatientColumn({
  title,
  status,
  patients,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  canAdvance,
}: PatientColumnProps) {
  const statusLabel = status === "done" ? "billing" : status;
  const statusTone =
    status === "waiting"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : status === "consultation"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <section className="rounded-[28px] border border-sky-200 bg-white/95 p-4 shadow-[0_18px_50px_rgba(125,211,252,0.14)] xl:min-h-[680px]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <p className="text-sm text-slate-500">{patients.length} patients</p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${statusTone}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="space-y-3">
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
