"use client";

import { ArrowRight, Check, Trash2 } from "lucide-react";

import { Patient, PatientStatus } from "@/lib/types";

const nextStatus: Record<PatientStatus, PatientStatus | null> = {
  waiting: "consultation",
  consultation: "done",
  done: null,
};

const actionLabel: Record<PatientStatus, string> = {
  waiting: "Start consultation",
  consultation: "Complete consultation",
  done: "Billing done",
};

interface PatientCardProps {
  patient: Patient;
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  canAdvance?: boolean;
}

export function PatientCard({
  patient,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  canAdvance = true,
}: PatientCardProps) {
  const target = nextStatus[patient.status];
  const createdAt = new Date(patient.last_visit_at).toLocaleTimeString([], {
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
      className="w-full rounded-[18px] border border-sky-200 bg-white px-3 py-2.5 text-left shadow-[0_8px_18px_rgba(125,211,252,0.08)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_14px_30px_rgba(125,211,252,0.14)]"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-5 text-slate-800">{patient.name}</p>
        </div>
        <span className="rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[10px] font-medium text-slate-500">
          {createdAt}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <p className="line-clamp-1 min-w-0 text-[13px] text-slate-700">
          <span className="font-semibold text-slate-500">Reason:</span> {patient.reason}
        </p>
        <div className="flex shrink-0 justify-end gap-1.5">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100"
            onClick={(event) => {
              event.stopPropagation();
              onRemoveFromQueue(patient);
            }}
            aria-label={`Remove ${patient.name} from queue`}
            title="Remove from queue"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {target && canAdvance ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-600"
              onClick={(event) => {
                event.stopPropagation();
                onAdvance(patient, target);
              }}
              aria-label={`${actionLabel[patient.status]} for ${patient.name}`}
              title={actionLabel[patient.status]}
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700"
              aria-label={`${target ? "View patient" : actionLabel[patient.status]} for ${patient.name}`}
              title={target ? "View patient" : actionLabel[patient.status]}
            >
              <Check className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
