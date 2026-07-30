"use client";

import { Check, Clock3, UserPlus, UserRoundCheck, X } from "lucide-react";

import type { CheckInRequest } from "@/lib/types";

function formatDob(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatSubmittedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSex(value: CheckInRequest["submitted_sex_at_birth"]) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface PendingCheckInsProps {
  requests: CheckInRequest[];
  pendingRequestId: string;
  onUseExisting: (requestId: string, patientId: string) => void;
  onCreateNew: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export function PendingCheckIns({
  requests,
  pendingRequestId,
  onUseExisting,
  onCreateNew,
  onReject,
}: PendingCheckInsProps) {
  if (!requests.length) return null;

  return (
    <section className="mb-4 shrink-0 border-y border-[#dbe7ef] bg-white/75 py-3">
      <div className="mb-3 flex items-center gap-2 px-1">
        <h2 className="text-sm font-semibold text-slate-900">Pending check-ins</h2>
        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
          {requests.length}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {requests.map((request) => {
          const busy = pendingRequestId === request.id;
          return (
            <article key={request.id} className="w-[min(88vw,390px)] shrink-0 rounded-lg border border-amber-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-slate-900">{request.submitted_name}</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    {request.submitted_phone} · DOB {formatDob(request.submitted_date_of_birth)}
                  </p>
                  {request.submitted_email ? (
                    <p className="mt-1 truncate text-xs text-slate-600">{request.submitted_email}</p>
                  ) : null}
                  {request.submitted_sex_at_birth ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Sex: {formatSex(request.submitted_sex_at_birth)}
                    </p>
                  ) : null}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  {formatSubmittedAt(request.created_at)}
                </span>
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-slate-700">{request.submitted_reason}</p>

              {request.candidates.length ? (
                <div className="mt-4 space-y-2 border-t border-[#e8eef3] pt-3">
                  <p className="text-xs font-semibold uppercase text-slate-500">Possible existing patient</p>
                  {request.candidates.map((candidate) => (
                    <div key={candidate.id} className="flex items-center gap-3 rounded-lg bg-[#f3f8fb] p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{candidate.name}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-600">
                          {candidate.match_reasons.join(" + ")}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          DOB {candidate.date_of_birth ? formatDob(candidate.date_of_birth) : "not recorded"} · Last visit {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(candidate.last_visit_at))}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onUseExisting(request.id, candidate.id)}
                        title="Use existing patient"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <UserRoundCheck className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 border-t border-[#e8eef3] pt-3 text-xs text-slate-500">No likely patient match</p>
              )}

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onCreateNew(request.id)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2f8fd3] px-3 py-2 text-xs font-semibold text-white hover:bg-[#287fc0] disabled:opacity-50"
                >
                  {busy ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                  Create new
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onReject(request.id)}
                  title="Reject check-in"
                  className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
