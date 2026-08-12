"use client";

import { Check, Clock3, Trash2, UserPlus, UserRoundCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CheckInRequest } from "@/lib/types";

function formatDob(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatElapsed(value: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? "" : "s"} ago`;
}

function formatSex(value: CheckInRequest["submitted_sex_at_birth"]) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ageFromDob(value: string) {
  const dob = new Date(`${value}T00:00:00Z`);
  const today = new Date();
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = today.getUTCMonth() < dob.getUTCMonth()
    || (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

function initialsForName(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
}

interface PendingCheckInsProps {
  requests: CheckInRequest[];
  pendingCount?: number;
  pendingRequestId: string;
  isLoading?: boolean;
  error?: string;
  variant?: "inline" | "drawer";
  isOpen?: boolean;
  onClose?: () => void;
  onRetry?: () => void;
  onUseExisting: (requestId: string, patientId: string) => void;
  onCreateNew: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export function PendingCheckIns({
  requests,
  pendingCount,
  pendingRequestId,
  isLoading = false,
  error = "",
  variant = "inline",
  isOpen = true,
  onClose,
  onRetry,
  onUseExisting,
  onCreateNew,
  onReject,
}: PendingCheckInsProps) {
  const [rejectingRequestId, setRejectingRequestId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (variant !== "drawer" || !isOpen) {
      setRejectingRequestId("");
      return;
    }
    const previousOverflow = document.body.style.overflow;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const intervalId = window.setInterval(() => setNow(Date.now()), 60000);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      window.clearInterval(intervalId);
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen, onClose, variant]);

  if (variant === "inline") {
    if (!requests.length) return null;
    return (
      <section className="mb-4 shrink-0 border-y border-[#dbe7ef] bg-white/75 py-3">
        <div className="mb-3 flex items-center gap-2 px-1">
          <h2 className="text-sm font-semibold text-slate-900">Pending check-ins</h2>
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{requests.length}</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {requests.map((request) => {
            const busy = pendingRequestId === request.id;
            return (
              <article key={request.id} className="w-[min(88vw,390px)] shrink-0 rounded-lg border border-amber-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{request.submitted_name}</h3>
                    <p className="mt-1 text-xs text-slate-600">{request.submitted_phone} · DOB {formatDob(request.submitted_date_of_birth)}</p>
                    {request.submitted_email ? <p className="mt-1 truncate text-xs text-slate-600">{request.submitted_email}</p> : null}
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" />{formatElapsed(request.created_at, now)}</span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-slate-700">{request.submitted_reason}</p>
                {request.candidates.length ? (
                  <div className="mt-4 space-y-2 border-t border-[#e8eef3] pt-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Possible existing patient</p>
                    {request.candidates.map((candidate) => (
                      <div key={candidate.id} className="flex items-center gap-3 rounded-lg bg-[#f3f8fb] p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">{candidate.name}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-600">{candidate.match_reasons.join(" + ")}</p>
                        </div>
                        <button type="button" disabled={busy} onClick={() => onUseExisting(request.id, candidate.id)} aria-label={`Use existing patient ${candidate.name}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700 disabled:opacity-50"><UserRoundCheck className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-4 flex items-center gap-2">
                  <button type="button" disabled={busy} onClick={() => onCreateNew(request.id)} className="inline-flex items-center gap-2 rounded-lg bg-[#2f8fd3] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><UserPlus className="h-3.5 w-3.5" />Create new</button>
                  <button type="button" disabled={busy} onClick={() => onReject(request.id)} aria-label={`Reject ${request.submitted_name}`} className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-700 disabled:opacity-50"><X className="h-4 w-4" /></button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close check-in requests"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[1px]"
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="check-in-drawer-title"
        className="relative flex h-full w-full max-w-[480px] flex-col border-l border-[#dbe7ef] bg-[#f6f9fb] shadow-[-20px_0_60px_rgba(31,43,61,0.16)]"
      >
        <div className="flex items-center gap-3 border-b border-[#dbe7ef] bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id="check-in-drawer-title" className="text-lg font-bold text-[#1f2b3d]">Check-in requests</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {isLoading && !requests.length ? "Loading requests…" : `${pendingCount ?? requests.length} awaiting review`}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close check-in requests"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-700 transition hover:bg-[#edf5fa]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {error && !requests.length ? (
            <div className="grid min-h-[320px] place-items-center text-center">
              <div className="max-w-xs">
                <p className="text-sm font-bold text-rose-700">Couldn&apos;t load check-in requests</p>
                <p className="mt-2 text-sm text-slate-600">{error}</p>
                {onRetry ? (
                  <button type="button" onClick={onRetry} className="mt-4 rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#267fc0]">
                    Try again
                  </button>
                ) : null}
              </div>
            </div>
          ) : isLoading && !requests.length ? (
            <div className="grid min-h-[320px] place-items-center text-center">
              <div>
                <Clock3 className="mx-auto h-6 w-6 animate-pulse text-[#2f8fd3]" />
                <p className="mt-3 text-sm font-semibold text-slate-600">Loading check-in requests…</p>
              </div>
            </div>
          ) : requests.length ? (
            <div className="space-y-4">
              {error ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <span>{error}</span>
                  {onRetry ? <button type="button" onClick={onRetry} className="shrink-0 font-bold">Retry</button> : null}
                </div>
              ) : null}
              {requests.map((request) => {
                const busy = pendingRequestId === request.id;
                const confirmingReject = rejectingRequestId === request.id;
                return (
                  <article key={request.id} className="w-full rounded-[16px] border border-l-4 border-[#dbe7ef] border-l-[#2f8fd3] bg-white px-3.5 py-3 shadow-[0_6px_16px_rgba(64,131,181,0.07)]">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#4e8fcc] to-[#7659b8] text-sm font-bold text-white">
                        {initialsForName(request.submitted_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[15px] font-bold leading-5 tracking-[-0.01em] text-[#1f2b3d]">{request.submitted_name}</h3>
                        <p className="mt-0.5 truncate text-xs text-[#5b6b80]">
                          {ageFromDob(request.submitted_date_of_birth)}y{request.submitted_sex_at_birth ? ` · ${formatSex(request.submitted_sex_at_birth)}` : ""}
                        </p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#bfe0f5] bg-[#ecf6fd] px-2 py-1 text-[11px] font-semibold text-[#2a6fa8]">
                        <Clock3 className="h-3 w-3" />
                        {formatElapsed(request.created_at, now)}
                      </span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <span className="max-w-full rounded-lg border border-[#bfe0f5] bg-[#ecf6fd] px-2 py-1 text-[11px] font-semibold text-[#2a6fa8]">
                        {request.submitted_reason}
                      </span>
                    </div>

                    {request.candidates.length ? (
                      <div className="mt-3 space-y-2 border-t border-dashed border-[#dbe7ef] pt-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-700">Possible existing patient — choose a record</p>
                        {request.candidates.map((candidate) => (
                          <div key={candidate.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-bold text-slate-900">{candidate.name}</p>
                                <p className="mt-0.5 text-xs text-amber-800">{candidate.match_reasons.join(" + ")}</p>
                              </div>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onUseExisting(request.id, candidate.id)}
                                aria-label={`Approve ${request.submitted_name} using existing patient ${candidate.name}`}
                                title={`Use ${candidate.name}'s record`}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-emerald-200 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 active:scale-95 disabled:opacity-50"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {confirmingReject ? (
                      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3" role="alert">
                        <p className="text-sm font-semibold text-rose-900">Decline this request?</p>
                        <p className="mt-1 text-xs leading-5 text-rose-700">The patient will be told to speak with reception.</p>
                        <div className="mt-3 flex justify-end gap-2">
                          <button type="button" disabled={busy} onClick={() => setRejectingRequestId("")} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
                          <button type="button" disabled={busy} onClick={() => onReject(request.id)} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Declining…" : "Decline"}</button>
                        </div>
                      </div>
                    ) : (
                      <footer className="mt-3 flex items-center justify-between gap-2 border-t border-dashed border-[#dbe7ef] pt-2.5">
                        <span className="text-xs font-semibold text-[#1f2b3d]">Walk-in</span>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRejectingRequestId(request.id)}
                            aria-label={`Decline ${request.submitted_name}`}
                            title="Decline request"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100 active:scale-95 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onCreateNew(request.id)}
                            aria-label={request.candidates.length ? `Approve ${request.submitted_name} as a new patient` : `Approve and add ${request.submitted_name} to queue`}
                            title={request.candidates.length ? "Create a new patient and approve" : "Approve and add to queue"}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-emerald-200 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 active:scale-95 disabled:opacity-50"
                          >
                            {request.candidates.length ? <UserPlus className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                          </button>
                        </div>
                      </footer>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-[320px] place-items-center text-center">
              <div>
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e8f4fb] text-[#2a6fa8]">
                  <Check className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-bold text-[#1f2b3d]">All caught up</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
