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
}

export function PatientCard({ patient, onOpen, onAdvance }: PatientCardProps) {
  const target = nextStatus[patient.status];
  const createdAt = new Date(patient.created_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

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
      className="w-full rounded-[20px] border border-sky-300 bg-sky-50/60 p-2 text-left shadow-[0_6px_16px_rgba(125,211,252,0.08)] transition hover:border-sky-400 hover:bg-white"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold text-slate-800">{patient.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-500">
            <Phone className="h-3.5 w-3.5" />
            {patient.phone}
          </p>
        </div>
        <span className="rounded-full border border-sky-100 bg-white px-2 py-0.5 text-[10px] text-slate-500">
          {createdAt}
        </span>
      </div>

      <div className="mt-2 block text-left">
        <p className="text-[13px] leading-5 text-slate-600">{patient.reason}</p>
      </div>

      <div className="mt-2.5 flex justify-end">
        {target ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-sky-600"
            onClick={(event) => {
              event.stopPropagation();
              onAdvance(patient, target);
            }}
          >
            {buttonLabel[patient.status]}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-[12px] text-sky-700">
            <Check className="h-3.5 w-3.5" />
            {buttonLabel[patient.status]}
          </span>
        )}
      </div>
    </div>
  );
}
