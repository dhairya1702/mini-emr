"use client";

import { Patient, PatientStatus } from "@/lib/types";
import { PatientCard } from "@/components/patient-card";

interface PatientColumnProps {
  title: string;
  status: PatientStatus;
  patients: Patient[];
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
}

export function PatientColumn({
  title,
  status,
  patients,
  onOpen,
  onAdvance,
}: PatientColumnProps) {
  const statusLabel = status === "done" ? "billing" : status;

  return (
    <section className="rounded-[28px] border border-sky-200 bg-white/95 p-4 shadow-[0_18px_50px_rgba(125,211,252,0.14)] xl:min-h-[680px]">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <p className="text-sm text-slate-500">{patients.length} patients</p>
        </div>
        <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-700">
          {statusLabel}
        </span>
      </div>

      <div className="space-y-3">
        {patients.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-sky-300 bg-sky-50/40 px-4 py-10 text-center text-sm text-slate-500">
            No patients in this stage.
          </div>
        ) : (
          patients.map((patient) => (
            <PatientCard
              key={patient.id}
              patient={patient}
              onOpen={onOpen}
              onAdvance={onAdvance}
            />
          ))
        )}
      </div>
    </section>
  );
}
