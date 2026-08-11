"use client";

import { ArrowLeft, CalendarDays, CheckCircle2, ClipboardCheck, Clock3, LoaderCircle, XCircle } from "lucide-react";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { api } from "@/lib/api";
import { formatDateTimeInTimeZone } from "@/lib/timezone";
import type {
  PublicAppointmentBooking,
  PublicAppointmentSlots,
  PublicCheckInContext,
  PublicCheckInStatus,
  SexAtBirth,
} from "@/lib/types";

function CheckInPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const initialBookingToken = searchParams.get("booking") || "";
  const [context, setContext] = useState<PublicCheckInContext | null>(null);
  const [intent, setIntent] = useState<"walk_in" | "appointment" | "">("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sexAtBirth, setSexAtBirth] = useState<SexAtBirth | "">("");
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [trackingToken, setTrackingToken] = useState("");
  const [hasLoadedTrackingToken, setHasLoadedTrackingToken] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState<PublicCheckInStatus | null>(null);
  const [appointmentSlots, setAppointmentSlots] = useState<PublicAppointmentSlots | null>(null);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [appointment, setAppointment] = useState<PublicAppointmentBooking | null>(null);
  const [isManagingAppointment, setIsManagingAppointment] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTrackingToken(new URLSearchParams(window.location.hash.slice(1)).get("check-in") || "");
    setHasLoadedTrackingToken(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedTrackingToken) return;
    if (initialBookingToken) {
      let active = true;
      api.getPublicAppointment(initialBookingToken)
        .then((booking) => {
          if (!active) return;
          setAppointment(booking);
          setContext({
            clinic_name: booking.clinic_name,
            clinic_address: "",
            clinic_phone: "",
          });
        })
        .catch((loadError) => {
          if (active) setError(loadError instanceof Error ? loadError.message : "Appointment is unavailable.");
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
      return () => {
        active = false;
      };
    }
    if (trackingToken) {
      let active = true;
      if (token) {
        api.getPublicCheckInContext(token)
          .then((row) => {
            if (active) setContext(row);
          })
          .catch(() => {
            // The private tracking token remains usable after the public QR link changes.
          })
          .finally(() => {
            if (active) setIsLoading(false);
          });
      } else {
        setIsLoading(false);
      }
      return () => {
        active = false;
      };
    }
    if (!token) {
      setError("This check-in link is invalid.");
      setIsLoading(false);
      return;
    }
    let active = true;
    api.getPublicCheckInContext(token)
      .then((row) => {
        if (active) setContext(row);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Check-in is unavailable.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hasLoadedTrackingToken, initialBookingToken, token, trackingToken]);

  useEffect(() => {
    if (!trackingToken || (checkInStatus && checkInStatus !== "pending")) return;
    let active = true;
    async function refreshStatus() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await api.getPublicCheckInStatus(trackingToken);
        if (active) setCheckInStatus(response.status);
      } catch {
        // Keep the last useful status and retry; staff review remains authoritative.
      }
    }
    void refreshStatus();
    const intervalId = window.setInterval(() => void refreshStatus(), 10000);
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void refreshStatus();
    }
    function handleFocus() {
      void refreshStatus();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [checkInStatus, trackingToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sexAtBirth) {
      setError("Select sex.");
      return;
    }
    if (!intent) {
      setError("Choose Walk-in or Appointment.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      if (intent === "appointment") {
        const slots = await api.getPublicAppointmentSlots(token);
        setAppointmentSlots(slots);
        setSelectedSlot(slots.suggested_slots[0] || "");
        if (!slots.suggested_slots.length) {
          setError("No appointment times are currently available.");
        }
        return;
      }
      const submitted = await api.submitPublicCheckIn({
        token,
        name,
        phone,
        email,
        date_of_birth: dateOfBirth,
        sex_at_birth: sexAtBirth,
        reason,
      });
      setTrackingToken(submitted.tracking_token);
      setCheckInStatus(submitted.status);
      const url = new URL(window.location.href);
      url.hash = new URLSearchParams({ "check-in": submitted.tracking_token }).toString();
      window.history.replaceState({}, "", url.toString());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit check-in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function bookAppointment() {
    if (!sexAtBirth || !selectedSlot) {
      setError("Choose an appointment time.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const booked = await api.bookPublicAppointment({
        token,
        name,
        phone,
        email,
        date_of_birth: dateOfBirth,
        sex_at_birth: sexAtBirth,
        reason,
        scheduled_for: selectedSlot,
      });
      setAppointment(booked);
      setAppointmentSlots({
        clinic_name: booked.clinic_name,
        timezone: booked.timezone,
        suggested_slots: booked.suggested_slots,
      });
      const url = new URL(window.location.href);
      url.searchParams.set("booking", booked.booking_token);
      window.history.replaceState({}, "", url.toString());
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "Could not book this appointment.");
      try {
        const refreshed = await api.getPublicAppointmentSlots(token);
        setAppointmentSlots(refreshed);
        setSelectedSlot(refreshed.suggested_slots[0] || "");
      } catch {}
    } finally {
      setIsSubmitting(false);
    }
  }

  async function rescheduleAppointment() {
    if (!appointment || !selectedSlot) return;
    setIsSubmitting(true);
    setError("");
    try {
      const updated = await api.reschedulePublicAppointment(
        appointment.booking_token,
        selectedSlot,
      );
      setAppointment(updated);
      setAppointmentSlots({
        clinic_name: updated.clinic_name,
        timezone: updated.timezone,
        suggested_slots: updated.suggested_slots,
      });
      setIsManagingAppointment(false);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not reschedule this appointment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelAppointment() {
    if (!appointment || !window.confirm("Cancel this appointment?")) return;
    setIsCancelling(true);
    setError("");
    try {
      setAppointment(await api.cancelPublicAppointment(appointment.booking_token));
      setIsManagingAppointment(false);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel this appointment.");
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f9fb] px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-xl">
        <header className="mb-7 border-b border-[#dbe7ef] pb-6">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#e8f4fb] text-[#2a6fa8]">
            <ClipboardCheck className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-semibold text-slate-900">
            {context?.clinic_name || "Patient check-in"}
          </h1>
          {context ? (
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              {context.clinic_address ? <p>{context.clinic_address}</p> : null}
              {context.clinic_phone ? <p>{context.clinic_phone}</p> : null}
            </div>
          ) : null}
        </header>

        {isLoading ? (
          <div className="flex items-center gap-3 py-12 text-sm text-slate-600">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            Loading check-in...
          </div>
        ) : appointment && context ? (
          <section className="rounded-lg border border-[#dbe7ef] bg-white p-6 sm:p-7">
            {appointment.status === "cancelled" ? (
              <XCircle className="h-10 w-10 text-slate-500" />
            ) : (
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            )}
            <h2 className="mt-5 text-xl font-semibold text-slate-900">
              {appointment.status === "cancelled" ? "Appointment cancelled" : "Appointment booked"}
            </h2>
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
              <Clock3 className="h-4 w-4 text-[#2a6fa8]" />
              {formatDateTimeInTimeZone(appointment.scheduled_for, appointment.timezone)}
            </p>

            {error ? <div className="mt-4 border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

            {appointment.status === "scheduled" && isManagingAppointment ? (
              <div className="mt-6 border-t border-[#dbe7ef] pt-5">
                <p className="mb-3 text-sm font-medium text-slate-700">Choose a new time</p>
                <div className="grid gap-2">
                  {(appointmentSlots?.suggested_slots || []).map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`rounded-xl border px-4 py-3 text-left text-sm ${
                        selectedSlot === slot
                          ? "border-[#2f8fd3] bg-[#e8f4fb] text-[#1d659a]"
                          : "border-[#bfd7e8] text-slate-700"
                      }`}
                    >
                      {formatDateTimeInTimeZone(slot, appointment.timezone)}
                    </button>
                  ))}
                </div>
                <div className="mt-5 flex gap-3">
                  <button type="button" onClick={rescheduleAppointment} disabled={!selectedSlot || isSubmitting} className="rounded-xl bg-[#2f8fd3] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
                    {isSubmitting ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={() => setIsManagingAppointment(false)} className="rounded-xl border border-[#bfd7e8] px-5 py-3 text-sm text-slate-700">
                    Back
                  </button>
                </div>
              </div>
            ) : appointment.status === "scheduled" ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const refreshed = await api.getPublicAppointment(appointment.booking_token);
                      setAppointment(refreshed);
                      setAppointmentSlots({
                        clinic_name: refreshed.clinic_name,
                        timezone: refreshed.timezone,
                        suggested_slots: refreshed.suggested_slots,
                      });
                      setSelectedSlot(refreshed.suggested_slots[0] || "");
                      setIsManagingAppointment(true);
                    } catch (loadError) {
                      setError(loadError instanceof Error ? loadError.message : "Could not load appointment times.");
                    }
                  }}
                  className="rounded-xl border border-[#bfd7e8] bg-white px-5 py-3 text-sm font-semibold text-slate-700"
                >
                  Reschedule
                </button>
                <button type="button" onClick={cancelAppointment} disabled={isCancelling} className="rounded-xl border border-rose-200 bg-white px-5 py-3 text-sm font-semibold text-rose-700 disabled:opacity-60">
                  {isCancelling ? "Cancelling..." : "Cancel appointment"}
                </button>
              </div>
            ) : null}
          </section>
        ) : trackingToken ? (
          <section className={`rounded-lg border bg-white p-7 ${
            checkInStatus === "approved"
              ? "border-emerald-200"
              : checkInStatus === "rejected" || checkInStatus === "expired"
                ? "border-rose-200"
                : "border-[#bfe0f5]"
          }`} aria-live="polite">
            {checkInStatus === "approved" ? (
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            ) : checkInStatus === "rejected" || checkInStatus === "expired" ? (
              <XCircle className="h-10 w-10 text-rose-500" />
            ) : (
              <Clock3 className="h-10 w-10 text-[#2f8fd3]" />
            )}
            <h2 className="mt-5 text-xl font-semibold text-slate-900">
              {checkInStatus === "approved"
                ? "You’re in the queue"
                : checkInStatus === "rejected"
                  ? "Please speak with reception"
                  : checkInStatus === "expired"
                    ? "This request expired"
                    : "Check-in submitted"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {checkInStatus === "approved"
                ? "Your place is confirmed. Please remain nearby while the clinic prepares for your visit."
                : checkInStatus === "rejected"
                  ? "Reception could not add this request to the queue. Please speak with clinic staff for help."
                  : checkInStatus === "expired"
                    ? "Submit a new check-in request or speak with reception for help."
                    : `Reception${context?.clinic_name ? ` at ${context.clinic_name}` : ""} is reviewing your request. Keep this page open for confirmation.`}
            </p>
            {!checkInStatus || checkInStatus === "pending" ? (
              <p className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-[#2a6fa8]">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                Checking for an update…
              </p>
            ) : null}
          </section>
        ) : appointmentSlots && context ? (
          <section className="rounded-lg border border-[#dbe7ef] bg-white p-6 sm:p-7">
            <button type="button" onClick={() => { setAppointmentSlots(null); setError(""); }} className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600">
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div className="flex items-center gap-3">
              <CalendarDays className="h-6 w-6 text-[#2a6fa8]" />
              <h2 className="text-xl font-semibold text-slate-900">Choose an appointment</h2>
            </div>
            <div className="mt-5 grid gap-2">
              {appointmentSlots.suggested_slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setSelectedSlot(slot)}
                  className={`rounded-xl border px-4 py-3 text-left text-sm ${
                    selectedSlot === slot
                      ? "border-[#2f8fd3] bg-[#e8f4fb] text-[#1d659a]"
                      : "border-[#bfd7e8] text-slate-700 hover:bg-[#f3f8fb]"
                  }`}
                >
                  {formatDateTimeInTimeZone(slot, appointmentSlots.timezone)}
                </button>
              ))}
            </div>
            {error ? <div className="mt-4 border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            <button type="button" onClick={bookAppointment} disabled={!selectedSlot || isSubmitting} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-60">
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting ? "Booking..." : "Book appointment"}
            </button>
          </section>
        ) : context ? (
          <form onSubmit={submit} className="space-y-5 rounded-lg border border-[#dbe7ef] bg-white p-6 sm:p-7">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Visit type</legend>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ["walk_in", "Walk-in"],
                  ["appointment", "Appointment"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={intent === value}
                    onClick={() => {
                      setIntent(value);
                      setError("");
                    }}
                    className={`h-12 rounded-xl border text-sm font-semibold ${
                      intent === value
                        ? "border-[#2f8fd3] bg-[#e8f4fb] text-[#1d659a]"
                        : "border-[#bfd7e8] bg-white text-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Full name</span>
              <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="w-full rounded-xl border border-[#bfd7e8] px-4 py-3 text-base text-slate-900 outline-none focus:border-[#6daed8] focus:ring-4 focus:ring-[#d8ebf7]" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Phone number</span>
              <input required minLength={6} maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" className="w-full rounded-xl border border-[#bfd7e8] px-4 py-3 text-base text-slate-900 outline-none focus:border-[#6daed8] focus:ring-4 focus:ring-[#d8ebf7]" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Email <span className="font-normal text-slate-500">(optional)</span>
              </span>
              <input type="email" maxLength={200} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" className="w-full rounded-xl border border-[#bfd7e8] px-4 py-3 text-base text-slate-900 outline-none focus:border-[#6daed8] focus:ring-4 focus:ring-[#d8ebf7]" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Date of birth</span>
              <input required type="date" max={new Date().toISOString().slice(0, 10)} value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} autoComplete="bday" className="mx-auto block h-[52px] min-h-[52px] w-[90%] min-w-0 max-w-[90%] rounded-xl border border-[#bfd7e8] px-4 py-3 text-base text-slate-900 outline-none [inline-size:90%] [max-inline-size:90%] [min-inline-size:0] focus:border-[#6daed8] focus:ring-4 focus:ring-[#d8ebf7]" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Sex</span>
              <select
                required
                value={sexAtBirth}
                onChange={(event) => {
                  setSexAtBirth(event.target.value as SexAtBirth | "");
                  setError("");
                }}
                className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-[#6daed8] focus:ring-4 focus:ring-[#d8ebf7]"
              >
                <option value="">Select sex</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Reason for visit</span>
              <textarea required maxLength={200} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} className="w-full resize-none rounded-xl border border-[#bfd7e8] px-4 py-3 text-base text-slate-900 outline-none focus:border-[#6daed8] focus:ring-4 focus:ring-[#d8ebf7]" />
            </label>

            {error ? <div className="border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

            <button type="submit" disabled={isSubmitting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#287fc0] disabled:opacity-60">
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting
                ? intent === "appointment" ? "Loading times..." : "Submitting..."
                : intent === "walk_in" ? "Submit walk-in" : "Continue"}
            </button>
          </form>
        ) : (
          <div className="border-l-4 border-rose-400 bg-rose-50 px-4 py-4 text-sm text-rose-700">
            {error || "Check-in is unavailable."}
          </div>
        )}
      </div>
    </main>
  );
}

export default function CheckInPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center text-sm text-slate-600">Loading check-in...</main>}>
      <CheckInPageContent />
    </Suspense>
  );
}
