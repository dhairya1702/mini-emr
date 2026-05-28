"use client";

import { ArrowRight, Check, GripVertical, Trash2 } from "lucide-react";
import type { HTMLAttributes } from "react";

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

function formatPatientMetadata(patient: Patient) {
  const reason = patient.reason.trim();
  const age =
    typeof patient.age === "number" && Number.isFinite(patient.age)
      ? `${patient.age}y`
      : "";
  const metadata = [age, reason].filter(Boolean).join(" · ");
  return metadata || "No reason added";
}

interface PatientCardProps {
  patient: Patient;
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  canAdvance?: boolean;
  dragHandleProps?: {
    attributes?: HTMLAttributes<HTMLElement>;
    listeners?: HTMLAttributes<HTMLElement>;
    setActivatorNodeRef?: (node: HTMLElement | null) => void;
    disabled?: boolean;
  };
}

export function PatientCard({
  patient,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  canAdvance = true,
  dragHandleProps,
}: PatientCardProps) {
  const target = nextStatus[patient.status];
  const createdAt = new Date(patient.last_visit_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const patientMetadata = formatPatientMetadata(patient);

  return (
    <div
      ref={dragHandleProps?.setActivatorNodeRef}
      {...dragHandleProps?.attributes}
      {...dragHandleProps?.listeners}
      role="button"
      aria-label={`Drag ${patient.name}; open chart`}
      tabIndex={0}
      onClick={() => onOpen(patient)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(patient);
        }
      }}
      className={`group w-full rounded-[14px] border border-[#bfd7e8] bg-white px-3 py-2.5 text-left shadow-[0_7px_18px_rgba(64,131,181,0.06)] transition hover:border-[#9fc7e1] hover:shadow-[0_12px_26px_rgba(64,131,181,0.1)] ${
        dragHandleProps && !dragHandleProps.disabled ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-start gap-2">
          {dragHandleProps ? (
            <span
              aria-hidden="true"
              title="Drag patient"
              className={`mt-[-1px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition ${
                dragHandleProps.disabled ? "opacity-40" : "group-hover:bg-[#edf5fa] group-hover:text-[#2a6fa8]"
              }`}
            >
              <GripVertical className="h-4 w-4" />
            </span>
          ) : null}
          <p className="min-w-0 truncate text-[15px] font-semibold leading-5 text-slate-800">{patient.name}</p>
        </div>
        <span className="rounded-lg border border-[#dbe7ef] bg-[#edf5fa] px-2.5 py-1 text-[10px] font-medium text-slate-500">
          {createdAt}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <p className="line-clamp-1 min-w-0 text-[13px] text-slate-700">
          {patientMetadata}
        </p>
        <div className="flex shrink-0 justify-end gap-1.5">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100"
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#2f8fd3] text-white transition hover:bg-[#287fc0]"
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#edf5fa] text-[#2a6fa8]"
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
