"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";

import {
  formatDateTimeInTimeZone,
  getTodayIsoDateInTimeZone,
  toDateTimeInputInTimeZone,
  zonedDateTimeInputToUtcIso,
} from "@/lib/timezone";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";

type FollowUpBookingContext = {
  follow_up_id: string;
  patient_name: string;
  clinic_name: string;
  timezone: string;
  scheduled_for: string;
  notes: string;
  booking_token: string;
  appointment_id: string | null;
  appointment_status: string | null;
  appointment_scheduled_for: string | null;
  suggested_slots: string[];
};

async function fetchBookingContext(token: string): Promise<FollowUpBookingContext> {
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
  return payload as FollowUpBookingContext;
}

function FollowUpBookingPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [context, setContext] = useState<FollowUpBookingContext | null>(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const minimumDateTime = useMemo(() => {
    const timeZone = context?.timezone || "UTC";
    return `${getTodayIsoDateInTimeZone(timeZone)}T00:00`;
  }, [context?.timezone]);

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
        const payload = await fetchBookingContext(token);
        if (!active) {
          return;
        }
        setContext(payload);
        const bookingContext = payload;
        setScheduledFor(
          bookingContext.suggested_slots[0]
            ? toDateTimeInputInTimeZone(bookingContext.suggested_slots[0], bookingContext.timezone)
            : toDateTimeInputInTimeZone(bookingContext.scheduled_for, bookingContext.timezone),
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
          scheduled_for: zonedDateTimeInputToUtcIso(scheduledFor, context?.timezone || "UTC"),
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
      const refreshed = await fetchBookingContext(token);
      setContext(refreshed);
      setSuccessMessage(
        context?.appointment_status === "scheduled"
          ? "Appointment rescheduled."
          : "Appointment booked.",
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not confirm this follow-up.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!token || !window.confirm("Cancel this appointment? You can use this link to book again later.")) {
      return;
    }
    setIsCancelling(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/public/follow-up-booking/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { detail?: string };
        throw new Error(payload.detail || "Could not cancel this appointment.");
      }
      const refreshed = await fetchBookingContext(token);
      setContext(refreshed);
      setSuccessMessage("Appointment cancelled. This link remains available if you need to book again.");
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "Could not cancel this appointment.",
      );
    } finally {
      setIsCancelling(false);
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
              Book or manage your appointment
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Choose a time, reschedule an existing booking, or cancel it from this page.
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
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {context.appointment_status === "scheduled" ? "Booked time" : "Follow-up due"}
                </p>
                <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                  <Clock3 className="h-4 w-4 text-[#2a6fa8]" />
                  {formatDateTimeInTimeZone(
                    context.appointment_scheduled_for || context.scheduled_for,
                    context.timezone,
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Notes</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">
                  {context.notes || "Please return for the planned review."}
                </p>
              </div>
            </section>

            {context.appointment_status ? (
              <div
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
                  context.appointment_status === "scheduled"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : context.appointment_status === "cancelled"
                      ? "border-slate-200 bg-slate-50 text-slate-700"
                      : "border-blue-200 bg-blue-50 text-blue-700"
                }`}
              >
                {context.appointment_status === "cancelled" ? (
                  <XCircle className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {context.appointment_status === "scheduled"
                  ? "Appointment booked"
                  : context.appointment_status === "cancelled"
                    ? "Appointment cancelled"
                    : "Appointment checked in"}
              </div>
            ) : null}

            {context.appointment_status === "checked_in" ? null : (
            <form
              onSubmit={handleSubmit}
              className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-[0_8px_24px_rgba(64,131,181,0.06)]"
            >
              {context.suggested_slots.length ? (
                <div className="mb-5">
                  <p className="mb-2 text-sm font-medium text-slate-700">Suggested open times</p>
                  <div className="flex flex-wrap gap-2">
                    {context.suggested_slots.map((slot) => {
                      const active = scheduledFor === toDateTimeInputInTimeZone(slot, context.timezone);
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setScheduledFor(toDateTimeInputInTimeZone(slot, context.timezone))}
                          className={`rounded-xl border px-4 py-2 text-sm transition ${
                            active
                              ? "border-[#9fc7e1] bg-[#2f8fd3] text-white"
                              : "border-[#bfd7e8] bg-[#f3f8fb] text-slate-700 hover:bg-[#dbeaf4]"
                          }`}
                        >
                          {formatDateTimeInTimeZone(slot, context.timezone)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {context.appointment_status === "scheduled"
                    ? "Choose a new time"
                    : "Choose appointment time"}
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
                  {isSubmitting
                    ? "Saving..."
                    : context.appointment_status === "scheduled"
                      ? "Reschedule appointment"
                      : context.appointment_status === "cancelled"
                        ? "Book again"
                        : "Book appointment"}
                </button>
                {context.appointment_status === "scheduled" ? (
                  <button
                    type="button"
                    disabled={isSubmitting || isCancelling}
                    onClick={handleCancel}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-5 py-3 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCancelling ? <RefreshCw className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    {isCancelling ? "Cancelling..." : "Cancel appointment"}
                  </button>
                ) : null}
              </div>
            </form>
            )}
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
