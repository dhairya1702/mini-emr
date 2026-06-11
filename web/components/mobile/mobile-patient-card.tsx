"use client";

import Link from "next/link";
import { ChevronRight, Trash2 } from "lucide-react";

import type { Patient } from "@/lib/types";

function formatPatientMetadata(patient: Patient) {
  const reason = patient.reason.trim();
  const age =
    typeof patient.age === "number" && Number.isFinite(patient.age)
      ? `${patient.age}y`
      : "";
  const metadata = [age, reason].filter(Boolean).join(" · ");
  return metadata || "No reason added";
}

function formatVisitTime(patient: Patient) {
  return new Date(patient.last_visit_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MobilePatientCard({
  patient,
  href,
  hasDraft = false,
  onRemoveFromQueue,
}: {
  patient: Patient;
  href: string;
  hasDraft?: boolean;
  onRemoveFromQueue?: (patient: Patient) => void;
}) {
  return (
    <div className="relative min-h-[92px] rounded-[14px] border border-[#bfd7e8] bg-white px-3 py-2.5 text-left shadow-[0_7px_18px_rgba(64,131,181,0.06)] transition hover:border-[#9fc7e1] hover:shadow-[0_12px_26px_rgba(64,131,181,0.1)]">
      <div className={`flex items-start justify-between gap-2.5 ${onRemoveFromQueue ? "pr-16" : "pr-7"}`}>
        <p className="min-w-0 truncate text-[15px] font-semibold leading-5 text-slate-800">{patient.name}</p>
        <span className="rounded-lg border border-[#dbe7ef] bg-[#edf5fa] px-2.5 py-1 text-[10px] font-medium text-slate-500">
          {formatVisitTime(patient)}
        </span>
      </div>
      <div className={`mt-2 flex min-w-0 items-center gap-2 ${onRemoveFromQueue ? "pr-16" : "pr-7"}`}>
        <p className="line-clamp-1 min-w-0 text-[13px] text-slate-700">{formatPatientMetadata(patient)}</p>
        {hasDraft ? (
          <span className="inline-flex shrink-0 rounded-lg border border-[#dbe7ef] bg-[#edf5fa] px-2.5 py-1 text-[10px] font-medium text-slate-500">
            Draft
          </span>
        ) : null}
      </div>
      <div className="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1.5">
        {onRemoveFromQueue ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemoveFromQueue(patient);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100"
            aria-label={`Remove ${patient.name} from queue`}
            title="Remove from queue"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <ChevronRight className="pointer-events-none h-5 w-5 text-slate-400" />
      </div>
      <Link href={href} className="absolute inset-0 z-10 rounded-[14px]" aria-label={`Open ${patient.name}`} />
    </div>
  );
}
