"use client";

import { ArrowRight, Check, Phone } from "lucide-react";

import { Patient, PatientStatus } from "@/lib/types";

const nextStatus: Record<PatientStatus, PatientStatus | null> = {
  waiting: "consultation",
  consultation: "done",
  done: null,
};

const buttonLabel: Record<PatientStatus, string> = {
  waiting: "Start",
  consultation: "Complete",
  done: "Done",
};

interface PatientCardProps {
  patient: Patient;
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  canAdvance?: boolean;
}

export function PatientCard({ patient, onOpen, onAdvance, canAdvance = true }: PatientCardProps) {
  const target = nextStatus[patient.status];
  const createdAt = new Date(patient.last_visit_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const statusTone =
    patient.status === "waiting"
      ? "bg-amber-50 text-amber-700"
      : patient.status === "consultation"
        ? "bg-sky-100 text-sky-700"
        : "bg-emerald-100 text-emerald-700";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(patient)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(patient);
        }
      }}
      className="w-full rounded-[20px] border border-sky-200 bg-white p-2.5 text-left shadow-[0_8px_18px_rgba(125,211,252,0.08)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_14px_30px_rgba(125,211,252,0.14)]"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold text-slate-800">{patient.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusTone}`}>
              {patient.status}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-500">
            <Phone className="h-3.5 w-3.5" />
            {patient.phone}
          </p>
        </div>
        <span className="rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[10px] font-medium text-slate-500">
          {createdAt}
        </span>
      </div>

      <p className="mt-2 line-clamp-1 text-[13px] text-slate-700">
        <span className="font-semibold text-slate-500">Reason:</span> {patient.reason}
      </p>

      <div className="mt-2 flex justify-end">
        {target && canAdvance ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-sky-600"
            onClick={(event) => {
              event.stopPropagation();
              onAdvance(patient, target);
            }}
          >
            {buttonLabel[patient.status]}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1.5 text-[12px] text-sky-700">
            <Check className="h-3.5 w-3.5" />
            {target ? "View" : buttonLabel[patient.status]}
          </span>
        )}
      </div>
    </div>
  );
}
