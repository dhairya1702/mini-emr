"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";

type FollowUpBookingContext = {
  follow_up_id: string;
  patient_name: string;
  clinic_name: string;
  scheduled_for: string;
  notes: string;
  booking_token: string;
  suggested_slots: string[];
};

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function FollowUpBookingPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [context, setContext] = useState<FollowUpBookingContext | null>(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const minimumDateTime = useMemo(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadContext() {
      if (!token) {
        setError("Booking link is missing or invalid.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(
          `${API_BASE_URL}/public/follow-up-booking?token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as FollowUpBookingContext | { detail?: string };
        if (!response.ok) {
          throw new Error(
            typeof (payload as { detail?: string }).detail === "string"
              ? (payload as { detail?: string }).detail
              : "Failed to load booking link.",
          );
        }
        if (!active) {
          return;
        }
        setContext(payload as FollowUpBookingContext);
        const bookingContext = payload as FollowUpBookingContext;
        setScheduledFor(
          bookingContext.suggested_slots[0]
            ? toLocalDateTimeInput(bookingContext.suggested_slots[0])
            : toLocalDateTimeInput(bookingContext.scheduled_for),
        );
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load booking link.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadContext();
    return () => {
      active = false;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !scheduledFor) {
      setError("Pick a follow-up time to continue.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/public/follow-up-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          scheduled_for: new Date(scheduledFor).toISOString(),
        }),
      });
      if (!response.ok) {
        let message = "Could not confirm this follow-up.";
        try {
          const payload = (await response.json()) as { detail?: string };
          if (payload.detail) {
            message = payload.detail;
          }
        } catch {}
        throw new Error(message);
      }
      setSuccessMessage("Follow-up confirmed. The clinic schedule has been updated.");
      setContext((current) =>
        current
          ? {
              ...current,
              scheduled_for: new Date(scheduledFor).toISOString(),
            }
          : current,
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not confirm this follow-up.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#eaf6ff_0%,#f8fcff_45%,#fefefe_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-[22px] border border-[#dbe7ef] bg-white/95 p-7 shadow-[0_14px_38px_rgba(64,131,181,0.09)] sm:p-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-slate-500">
              Follow-Up Booking
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-slate-900 sm:text-4xl">
              Confirm or reschedule your review
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Pick a time that works for you. The clinic will see the updated follow-up slot
              immediately.
            </p>
          </div>
          <div className="rounded-xl bg-[#f3f8fb] p-3 text-[#2a6fa8]">
            <Calendar className="h-6 w-6" />
          </div>
        </div>

        {isLoading ? (
          <div className="mt-10 rounded-[18px] border border-[#dbe7ef] bg-[#f3f8fb]/70 px-5 py-6 text-sm text-slate-600">
            Loading booking details...
          </div>
        ) : error && !context ? (
          <div className="mt-10 rounded-[18px] border border-rose-200 bg-rose-50 px-5 py-6 text-sm text-rose-700">
            {error}
          </div>
        ) : context ? (
          <div className="mt-10 space-y-6">
            <section className="grid gap-4 rounded-[18px] border border-[#dbe7ef] bg-[#f3f8fb]/70 p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Clinic</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{context.clinic_name}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Patient</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{context.patient_name}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Current time</p>
                <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                  <Clock3 className="h-4 w-4 text-[#2a6fa8]" />
                  {formatDateTime(context.scheduled_for)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Notes</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">
                  {context.notes || "Please return for the planned review."}
                </p>
              </div>
            </section>

            <form
              onSubmit={handleSubmit}
              className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-[0_8px_24px_rgba(64,131,181,0.06)]"
            >
              {context.suggested_slots.length ? (
                <div className="mb-5">
                  <p className="mb-2 text-sm font-medium text-slate-700">Suggested open times</p>
                  <div className="flex flex-wrap gap-2">
                    {context.suggested_slots.map((slot) => {
                      const active = scheduledFor === toLocalDateTimeInput(slot);
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setScheduledFor(toLocalDateTimeInput(slot))}
                          className={`rounded-xl border px-4 py-2 text-sm transition ${
                            active
                              ? "border-[#9fc7e1] bg-[#2f8fd3] text-white"
                              : "border-[#bfd7e8] bg-[#f3f8fb] text-slate-700 hover:bg-[#dbeaf4]"
                          }`}
                        >
                          {formatDateTime(slot)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Choose follow-up time
                </span>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  min={minimumDateTime}
                  onChange={(event) => setScheduledFor(event.target.value)}
                  className="w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 py-3 text-slate-800 outline-none transition focus:border-[#6daed8]"
                />
              </label>

              {error ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {successMessage ? (
                <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {successMessage}
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                  {isSubmitting ? "Saving..." : "Confirm follow-up"}
                </button>
                <p className="text-sm text-slate-500">
                  The clinic schedule is updated as soon as you confirm.
                </p>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function FollowUpBookingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[linear-gradient(180deg,#eaf6ff_0%,#f8fcff_45%,#fefefe_100%)] px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl rounded-[22px] border border-[#dbe7ef] bg-white/95 p-7 shadow-[0_14px_38px_rgba(64,131,181,0.09)] sm:p-10">
            <div className="rounded-[18px] border border-[#dbe7ef] bg-[#f3f8fb]/70 px-5 py-6 text-sm text-slate-600">
              Loading booking details...
            </div>
          </div>
        </main>
      }
    >
      <FollowUpBookingPageContent />
    </Suspense>
  );
}
