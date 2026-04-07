"use client";

import { Fragment, useEffect, useState } from "react";
import { CalendarClock, Plus } from "lucide-react";

import { api } from "@/lib/api";
import { Appointment, FollowUp, PatientMatch } from "@/lib/types";

interface SettingsDrawerAppointmentsPanelProps {
  onCheckInAppointment: (
    appointmentId: string,
    options?: { existingPatientId?: string; forceNew?: boolean },
  ) => Promise<{ id: string; checked_in_at: string | null; checked_in_patient_id: string | null }>;
  onUpdateAppointment: (
    appointmentId: string,
    payload: { scheduled_for?: string; status?: "scheduled" | "checked_in" | "cancelled" },
  ) => Promise<Appointment>;
  onUpdateFollowUp: (
    followUpId: string,
    payload: { status?: "scheduled" | "completed" | "cancelled"; scheduled_for?: string; notes?: string },
  ) => Promise<FollowUp>;
}

type AppointmentView = "appointments" | "followUps";
type AppointmentFilter = "all" | "scheduled" | "checked_in" | "cancelled";
type FollowUpFilter = "all" | "scheduled" | "completed" | "cancelled";

export function SettingsDrawerAppointmentsPanel({
  onCheckInAppointment,
  onUpdateAppointment,
  onUpdateFollowUp,
}: SettingsDrawerAppointmentsPanelProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [activeView, setActiveView] = useState<AppointmentView>("followUps");
  const [appointmentFilter, setAppointmentFilter] = useState<AppointmentFilter>("all");
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>("all");
  const [appointmentQuery, setAppointmentQuery] = useState("");
  const [followUpQuery, setFollowUpQuery] = useState("");
  const [checkingInId, setCheckingInId] = useState("");
  const [editingAppointmentId, setEditingAppointmentId] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [editingFollowUpId, setEditingFollowUpId] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [savingAppointmentId, setSavingAppointmentId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [duplicateCheckIn, setDuplicateCheckIn] = useState<{
    appointmentId: string;
    appointmentName: string;
    matches: PatientMatch[];
  } | null>(null);

  useEffect(() => {
    let active = true;
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      setLoadError("");
      const request =
        activeView === "appointments"
          ? api.listAppointments({
              status: appointmentFilter === "all" ? undefined : appointmentFilter,
              q: appointmentQuery.trim() || undefined,
            }).then((rows) => {
              if (active) {
                setAppointments(rows);
              }
            })
          : api.listFollowUps({
              status: followUpFilter === "all" ? undefined : followUpFilter,
              q: followUpQuery.trim() || undefined,
            }).then((rows) => {
              if (active) {
                setFollowUps(rows);
              }
            });

      void request
        .catch((error) => {
          if (active) {
            setLoadError(error instanceof Error ? error.message : "Failed to load schedule data.");
          }
        })
        .finally(() => {
          if (active) {
            setIsLoading(false);
          }
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [activeView, appointmentFilter, appointmentQuery, followUpFilter, followUpQuery]);

  function formatDateTime(value: string) {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatStatusLabel(value: string) {
    return value.replace("_", " ");
  }

  function statusChipClasses(status: string) {
    if (status === "scheduled") return "border-sky-200 bg-sky-50 text-sky-700";
    if (status === "checked_in" || status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    return "border-slate-200 bg-slate-50 text-slate-600";
  }

  async function handleCheckIn(
    appointmentId: string,
    options?: { existingPatientId?: string; forceNew?: boolean },
  ) {
    setCheckingInId(appointmentId);
    setStatusMessage("");
    try {
      const updated = await onCheckInAppointment(appointmentId, options);
      setAppointments((current) =>
        current.map((appointment) =>
          appointment.id === appointmentId
            ? {
                ...appointment,
                status: "checked_in",
                checked_in_at: updated.checked_in_at,
                checked_in_patient_id: updated.checked_in_patient_id,
              }
            : appointment,
        ),
      );
      setDuplicateCheckIn(null);
      setStatusMessage("Appointment added to the waiting queue.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to move appointment to the queue.",
      );
    } finally {
      setCheckingInId("");
    }
  }

  async function handleStartCheckIn(appointment: Appointment) {
    setStatusMessage("");
    setDuplicateCheckIn(null);
    setCheckingInId(appointment.id);
    try {
      const matches = await api.previewAppointmentCheckIn(appointment.id);
      if (matches.length) {
        setDuplicateCheckIn({
          appointmentId: appointment.id,
          appointmentName: appointment.name,
          matches,
        });
        setStatusMessage("Possible active duplicate found. Choose the correct queue patient or create a new one.");
        return;
      }
      await handleCheckIn(appointment.id);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to check the queue before check-in.",
      );
    } finally {
      setCheckingInId("");
    }
  }

  function startReschedule(appointment: Appointment) {
    const localDate = new Date(appointment.scheduled_for);
    const isoDate = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0"),
    ].join("-");
    const isoTime = `${String(localDate.getHours()).padStart(2, "0")}:${String(localDate.getMinutes()).padStart(2, "0")}`;
    setEditingAppointmentId(appointment.id);
    setRescheduleDate(isoDate);
    setRescheduleTime(isoTime);
    setStatusMessage("");
  }

  async function handleSaveReschedule(appointmentId: string) {
    if (!rescheduleDate || !rescheduleTime) {
      setStatusMessage("Choose a date and time to reschedule.");
      return;
    }
    setSavingAppointmentId(appointmentId);
    setStatusMessage("");
    try {
      const updated = await onUpdateAppointment(appointmentId, {
        scheduled_for: new Date(`${rescheduleDate}T${rescheduleTime}:00`).toISOString(),
      });
      setAppointments((current) =>
        current.map((appointment) => (appointment.id === appointmentId ? updated : appointment)),
      );
      setEditingAppointmentId("");
      setStatusMessage("Appointment rescheduled.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to reschedule appointment.");
    } finally {
      setSavingAppointmentId("");
    }
  }

  function startFollowUpEdit(followUp: FollowUp) {
    const localDate = new Date(followUp.scheduled_for);
    const isoDate = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0"),
    ].join("-");
    const isoTime = `${String(localDate.getHours()).padStart(2, "0")}:${String(localDate.getMinutes()).padStart(2, "0")}`;
    setEditingFollowUpId(followUp.id);
    setFollowUpDate(isoDate);
    setFollowUpTime(isoTime);
    setFollowUpNotes(followUp.notes);
    setStatusMessage("");
  }

  async function handleSaveFollowUp(followUpId: string) {
    if (!followUpDate || !followUpTime) {
      setStatusMessage("Choose a date and time for the follow-up.");
      return;
    }
    setSavingAppointmentId(followUpId);
    setStatusMessage("");
    try {
      const updated = await onUpdateFollowUp(followUpId, {
        scheduled_for: new Date(`${followUpDate}T${followUpTime}:00`).toISOString(),
        notes: followUpNotes.trim(),
        status: "scheduled",
      });
      setFollowUps((current) =>
        current.map((followUp) => (followUp.id === followUpId ? updated : followUp)),
      );
      setEditingFollowUpId("");
      setStatusMessage("Follow-up updated.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to update follow-up.");
    } finally {
      setSavingAppointmentId("");
    }
  }

  async function handleUpdateFollowUpStatus(
    followUpId: string,
    status: "scheduled" | "completed" | "cancelled",
  ) {
    setSavingAppointmentId(followUpId);
    setStatusMessage("");
    try {
      const updated = await onUpdateFollowUp(followUpId, { status });
      setFollowUps((current) =>
        current.map((followUp) => (followUp.id === followUpId ? updated : followUp)),
      );
      if (editingFollowUpId === followUpId) {
        setEditingFollowUpId("");
      }
      setStatusMessage(
        status === "completed"
          ? "Follow-up marked completed."
          : status === "cancelled"
            ? "Follow-up cancelled."
            : "Follow-up updated.",
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to update follow-up.");
    } finally {
      setSavingAppointmentId("");
    }
  }

  async function handleCancelAppointment(appointmentId: string) {
    setSavingAppointmentId(appointmentId);
    setStatusMessage("");
    try {
      const updated = await onUpdateAppointment(appointmentId, { status: "cancelled" });
      setAppointments((current) =>
        current.map((appointment) => (appointment.id === appointmentId ? updated : appointment)),
      );
      if (editingAppointmentId === appointmentId) {
        setEditingAppointmentId("");
      }
      setStatusMessage("Appointment cancelled.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to cancel appointment.");
    } finally {
      setSavingAppointmentId("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-sky-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-sky-700" />
          <div>
            <h3 className="text-base font-semibold text-slate-900">Appointments</h3>
            <p className="mt-1 text-sm text-slate-600">
              Keep confirmed appointments separate from consultation follow-ups.
            </p>
          </div>
        </div>

        <div className="mb-4 inline-flex rounded-full border border-sky-200 bg-sky-50 p-1">
          {[
            { id: "appointments", label: "Appointments" },
            { id: "followUps", label: "Follow Ups" },
          ].map((view) => {
            const isActive = activeView === view.id;

            return (
              <button
                key={view.id}
                type="button"
                onClick={() => setActiveView(view.id as AppointmentView)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-white text-sky-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {view.label}
              </button>
            );
          })}
        </div>

        {loadError ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {loadError}
          </div>
        ) : null}

        {duplicateCheckIn ? (
          <div className="mb-4 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Active patient match found for {duplicateCheckIn.appointmentName}
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  Reuse an existing queue patient if this is the same visit, or create a new queue entry if it is a separate visit.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDuplicateCheckIn(null)}
                className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
              >
                Dismiss
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {duplicateCheckIn.matches.map((match) => (
                <div key={match.id} className="rounded-[20px] border border-amber-200 bg-white px-4 py-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{match.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {match.phone} · {formatStatusLabel(match.status)} · {new Date(match.created_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">{match.reason}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCheckIn(duplicateCheckIn.appointmentId, { existingPatientId: match.id })}
                      disabled={checkingInId === duplicateCheckIn.appointmentId}
                      className="rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-60"
                    >
                      Use Existing Patient
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => handleCheckIn(duplicateCheckIn.appointmentId, { forceNew: true })}
                disabled={checkingInId === duplicateCheckIn.appointmentId}
                className="rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-sky-50 disabled:opacity-60"
              >
                Create New Queue Entry Anyway
              </button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-[24px] border border-dashed border-sky-300 bg-sky-50/30 px-6 py-16 text-center text-sm text-slate-500">
            Loading {activeView === "appointments" ? "appointments" : "follow-ups"}...
          </div>
        ) : activeView === "appointments" ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <input
                value={appointmentQuery}
                onChange={(event) => setAppointmentQuery(event.target.value)}
                placeholder="Search patient, phone, or reason"
                className="min-w-[260px] rounded-full border border-sky-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400"
              />
              {(["all", "scheduled", "checked_in", "cancelled"] as AppointmentFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setAppointmentFilter(filter)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] transition ${
                    appointmentFilter === filter
                      ? "bg-sky-500 text-white"
                      : "border border-sky-200 bg-white text-slate-600 hover:bg-sky-50"
                  }`}
                >
                  {formatStatusLabel(filter)}
                </button>
              ))}
            </div>
            {appointments.length ? (
              <div className="overflow-hidden rounded-[22px] border border-sky-200">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-sky-50/80 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Patient</th>
                      <th className="px-4 py-3 text-left font-semibold">Appointment For</th>
                      <th className="px-4 py-3 text-left font-semibold">Reason</th>
                      <th className="px-4 py-3 text-left font-semibold">Status</th>
                      <th className="px-4 py-3 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {appointments.map((appointment) => (
                      <Fragment key={appointment.id}>
                        <tr className="border-t border-sky-100 first:border-t-0">
                          <td className="px-4 py-3 text-slate-800">
                            <div className="font-medium">{appointment.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{appointment.phone}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {formatDateTime(appointment.scheduled_for)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{appointment.reason}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${statusChipClasses(appointment.status)}`}>
                              {formatStatusLabel(appointment.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {appointment.status === "scheduled" ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleStartCheckIn(appointment)}
                                  disabled={checkingInId === appointment.id || savingAppointmentId === appointment.id}
                                  className="inline-flex items-center justify-center rounded-full border border-sky-200 bg-sky-50 p-2 text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                                  aria-label={`Add ${appointment.name} to queue`}
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startReschedule(appointment)}
                                  disabled={savingAppointmentId === appointment.id}
                                  className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50 disabled:opacity-60"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCancelAppointment(appointment.id)}
                                  disabled={savingAppointmentId === appointment.id}
                                  className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">No actions</span>
                            )}
                          </td>
                        </tr>
                        {editingAppointmentId === appointment.id && appointment.status === "scheduled" ? (
                          <tr className="border-t border-sky-100 bg-sky-50/40">
                            <td colSpan={5} className="px-4 py-4">
                              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">New Date</span>
                                  <input
                                    type="date"
                                    value={rescheduleDate}
                                    onChange={(event) => setRescheduleDate(event.target.value)}
                                    className="rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">New Time</span>
                                  <input
                                    type="time"
                                    value={rescheduleTime}
                                    onChange={(event) => setRescheduleTime(event.target.value)}
                                    className="rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveReschedule(appointment.id)}
                                    disabled={savingAppointmentId === appointment.id}
                                    className="rounded-full bg-sky-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
                                  >
                                    {savingAppointmentId === appointment.id ? "Saving..." : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingAppointmentId("")}
                                    disabled={savingAppointmentId === appointment.id}
                                    className="rounded-full border border-sky-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white disabled:opacity-60"
                                  >
                                    Close
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-sky-300 bg-sky-50/30 px-6 py-16 text-center text-sm text-slate-500">
                No appointments matched this view.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <input
                value={followUpQuery}
                onChange={(event) => setFollowUpQuery(event.target.value)}
                placeholder="Search patient or follow-up notes"
                className="min-w-[260px] rounded-full border border-sky-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400"
              />
              {(["all", "scheduled", "completed", "cancelled"] as FollowUpFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setFollowUpFilter(filter)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] transition ${
                    followUpFilter === filter
                      ? "bg-sky-500 text-white"
                      : "border border-sky-200 bg-white text-slate-600 hover:bg-sky-50"
                  }`}
                >
                  {formatStatusLabel(filter)}
                </button>
              ))}
            </div>
            {followUps.length ? (
              <div className="overflow-hidden rounded-[22px] border border-sky-200">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-sky-50/80 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Patient</th>
                      <th className="px-4 py-3 text-left font-semibold">Follow-Up For</th>
                      <th className="px-4 py-3 text-left font-semibold">Notes</th>
                      <th className="px-4 py-3 text-left font-semibold">Status</th>
                      <th className="px-4 py-3 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {followUps.map((followUp) => (
                      <Fragment key={followUp.id}>
                        <tr className="border-t border-sky-100 first:border-t-0">
                          <td className="px-4 py-3 text-slate-800">
                            {followUp.patient_name || "Patient"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatDateTime(followUp.scheduled_for)}</td>
                          <td className="px-4 py-3 text-slate-600">{followUp.notes || "No notes"}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${statusChipClasses(followUp.status)}`}>
                              {formatStatusLabel(followUp.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {followUp.status === "scheduled" ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => startFollowUpEdit(followUp)}
                                  disabled={savingAppointmentId === followUp.id}
                                  className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50 disabled:opacity-60"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateFollowUpStatus(followUp.id, "completed")}
                                  disabled={savingAppointmentId === followUp.id}
                                  className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60"
                                >
                                  Complete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateFollowUpStatus(followUp.id, "cancelled")}
                                  disabled={savingAppointmentId === followUp.id}
                                  className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">No actions</span>
                            )}
                          </td>
                        </tr>
                        {editingFollowUpId === followUp.id && followUp.status === "scheduled" ? (
                          <tr className="border-t border-sky-100 bg-sky-50/40">
                            <td colSpan={5} className="px-4 py-4">
                              <div className="grid gap-3 md:grid-cols-[220px_180px_1fr_auto] md:items-end">
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">New Date</span>
                                  <input
                                    type="date"
                                    value={followUpDate}
                                    onChange={(event) => setFollowUpDate(event.target.value)}
                                    className="rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">New Time</span>
                                  <input
                                    type="time"
                                    value={followUpTime}
                                    onChange={(event) => setFollowUpTime(event.target.value)}
                                    className="rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Notes</span>
                                  <input
                                    value={followUpNotes}
                                    onChange={(event) => setFollowUpNotes(event.target.value)}
                                    className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveFollowUp(followUp.id)}
                                    disabled={savingAppointmentId === followUp.id}
                                    className="rounded-full bg-sky-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
                                  >
                                    {savingAppointmentId === followUp.id ? "Saving..." : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingFollowUpId("")}
                                    disabled={savingAppointmentId === followUp.id}
                                    className="rounded-full border border-sky-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white disabled:opacity-60"
                                  >
                                    Close
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-sky-300 bg-sky-50/30 px-6 py-16 text-center text-sm text-slate-500">
                No follow-ups matched this view.
              </div>
            )}
          </>
        )}

        {statusMessage ? (
          <p className="mt-4 text-sm font-medium text-slate-700">{statusMessage}</p>
        ) : null}
      </div>
    </div>
  );
}
