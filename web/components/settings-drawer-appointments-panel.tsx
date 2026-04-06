"use client";

import { Fragment, useState } from "react";
import { CalendarClock, Plus } from "lucide-react";

import { Appointment, FollowUp, Patient } from "@/lib/types";

interface SettingsDrawerAppointmentsPanelProps {
  appointments: Appointment[];
  followUps: FollowUp[];
  patients: Patient[];
  onCheckInAppointment: (appointmentId: string) => Promise<void>;
  onUpdateAppointment: (
    appointmentId: string,
    payload: { scheduled_for?: string; status?: "scheduled" | "checked_in" | "cancelled" },
  ) => Promise<void>;
  onUpdateFollowUp: (
    followUpId: string,
    payload: { status?: "scheduled" | "completed" | "cancelled"; scheduled_for?: string; notes?: string },
  ) => Promise<void>;
}

type AppointmentView = "appointments" | "followUps";
type AppointmentFilter = "all" | "scheduled" | "checked_in" | "cancelled";
type FollowUpFilter = "all" | "scheduled" | "completed" | "cancelled";

export function SettingsDrawerAppointmentsPanel({
  appointments,
  followUps,
  patients,
  onCheckInAppointment,
  onUpdateAppointment,
  onUpdateFollowUp,
}: SettingsDrawerAppointmentsPanelProps) {
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
  const patientNames = Object.fromEntries(patients.map((patient) => [patient.id, patient.name]));
  const visibleAppointments = appointments
    .filter((appointment) => appointmentFilter === "all" || appointment.status === appointmentFilter)
    .filter((appointment) => {
      const query = appointmentQuery.trim().toLowerCase();
      if (!query) return true;
      return (
        appointment.name.toLowerCase().includes(query) ||
        appointment.phone.toLowerCase().includes(query) ||
        appointment.reason.toLowerCase().includes(query)
      );
    })
    .sort((left, right) => left.scheduled_for.localeCompare(right.scheduled_for));
  const visibleFollowUps = followUps
    .filter((followUp) => followUpFilter === "all" || followUp.status === followUpFilter)
    .filter((followUp) => {
      const query = followUpQuery.trim().toLowerCase();
      if (!query) return true;
      const patientName = (patientNames[followUp.patient_id] || "").toLowerCase();
      return (
        patientName.includes(query) ||
        followUp.notes.toLowerCase().includes(query)
      );
    })
    .sort((left, right) => left.scheduled_for.localeCompare(right.scheduled_for));

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

  async function handleCheckInAppointment(appointmentId: string) {
    setCheckingInId(appointmentId);
    setStatusMessage("");
    try {
      await onCheckInAppointment(appointmentId);
      setStatusMessage("Appointment added to the waiting queue.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to move appointment to the queue.",
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
      await onUpdateAppointment(appointmentId, {
        scheduled_for: new Date(`${rescheduleDate}T${rescheduleTime}:00`).toISOString(),
      });
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
      await onUpdateFollowUp(followUpId, {
        scheduled_for: new Date(`${followUpDate}T${followUpTime}:00`).toISOString(),
        notes: followUpNotes.trim(),
        status: "scheduled",
      });
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
      await onUpdateFollowUp(followUpId, { status });
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
      await onUpdateAppointment(appointmentId, { status: "cancelled" });
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

        {activeView === "appointments" ? (
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
            {visibleAppointments.length ? (
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
                {visibleAppointments.map((appointment) => (
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
                              onClick={() => handleCheckInAppointment(appointment.id)}
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
                placeholder="Search patient or notes"
                className="min-w-[240px] rounded-full border border-sky-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400"
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
            {visibleFollowUps.length ? (
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
                {visibleFollowUps.map((followUp) => (
                  <Fragment key={followUp.id}>
                    <tr className="border-t border-sky-100 first:border-t-0">
                      <td className="px-4 py-3 text-slate-800">
                        {patientNames[followUp.patient_id] || "Patient"}
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
